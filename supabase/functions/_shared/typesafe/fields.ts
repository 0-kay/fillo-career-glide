import {
  type Candidate,
  candidatesForField,
  dedupeByValue,
  deriveCandidates,
  flattenProfile,
  MAX_OPTIONS,
  rankCandidates,
} from "./candidates.ts";
import { choice, NO_MATCH, toPercent } from "./questions.ts";
import { isChoice, type Questions, type SystemOneFn } from "./types.ts";

export interface FieldInput {
  name?: string | null;
  id?: string | null;
  type?: string | null;
  placeholder?: string | null;
  label?: string | null;
  className?: string | null;
  context?: string | null;
  required?: boolean;
  maxLength?: number | null;
}

export interface FieldResult {
  fieldIndex: number;
  shouldFill: boolean;
  value: string | number | boolean | null;
  confidence: number;
  reasoning: string;
  dataPath: string | null;
  fieldType: string;
  source: string;
}

export const DEFAULT_MIN_CONFIDENCE = 65;

/** Field types we refuse to auto-fill no matter how confident the model is. */
const BLOCKED_TYPES = new Set(["password", "hidden", "file"]);
const BLOCKED_NAME = /pass(word|code)|ssn|social_security|credit|card|cvv|routing/i;

function isBlocked(field: FieldInput): boolean {
  if (BLOCKED_TYPES.has(String(field.type ?? "").toLowerCase())) return true;
  return BLOCKED_NAME.test(`${field.name ?? ""} ${field.id ?? ""} ${field.label ?? ""}`);
}

function describeField(field: FieldInput, index: number, variations: string[]) {
  return {
    index,
    label: field.label ?? null,
    name: field.name ?? null,
    id: field.id ?? null,
    type: field.type ?? null,
    placeholder: field.placeholder ?? null,
    required: Boolean(field.required),
    max_length: typeof field.maxLength === "number" ? field.maxLength : null,
    surrounding_text: (field.context ?? "").slice(0, 200) || null,
    known_aliases: variations.length ? variations : null,
  };
}

/** Re-types the selected value for the target input. Code owns every transformation. */
export function coerceValue(
  candidate: Candidate,
  field: FieldInput,
): string | number | boolean | null {
  const type = String(field.type ?? "text").toLowerCase();
  const value = candidate.value;

  if (type === "checkbox" || type === "radio") {
    if (typeof candidate.raw === "boolean") return candidate.raw;
    return /^(true|yes|y|1)$/i.test(value);
  }

  if (type === "number" || type === "range") {
    const n = Number.parseFloat(value.replace(/[^0-9.\-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  if (type === "tel") {
    const cleaned = value.replace(/[^\d+\-()\s]/g, "").trim();
    return cleaned || null;
  }

  if (type === "email") return value.includes("@") ? value : null;

  if (type === "date" || type === "month") {
    const iso = toIsoDate(value);
    if (!iso) return null;
    return type === "month" ? iso.slice(0, 7) : iso;
  }

  return value;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** Accepts the formats this codebase's profiles actually store; returns YYYY-MM-DD. */
export function toIsoDate(value: string): string | null {
  const v = value.trim();

  let m = v.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (m) return `${m[1]}-${m[2]}-${m[3] ?? "01"}`;

  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;

  m = v.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}-01`;

  m = v.match(/^([A-Za-z]{3,})\.?\s+(\d{4})$/);
  if (m) {
    const mm = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mm) return `${m[2]}-${mm}-01`;
  }

  m = v.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mm = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${m[2].padStart(2, "0")}`;
  }

  return null;
}

export interface AnalyzeOptions {
  minConfidence?: number;
  /** Per-field alias lists, keyed by field index. */
  variations?: Record<number, string[]>;
  model?: string;
}

const skip = (fieldIndex: number, reason: string, confidence = 0): FieldResult => ({
  fieldIndex,
  shouldFill: false,
  value: null,
  confidence,
  reasoning: reason,
  dataPath: null,
  fieldType: "unknown",
  source: "typesafe",
});

export interface AnalyzeOutcome {
  results: FieldResult[];
  model: string | null;
  usage: { input_tokens: number; output_tokens: number } | null;
  candidateCount: number;
  questionCount: number;
}

/**
 * One System One request for every field on the page.
 *
 * Independent questions over shared state run in parallel server-side, so N fields
 * cost roughly one field's latency rather than N sequential round trips.
 */
export async function analyzeFields(
  systemOne: SystemOneFn,
  fields: FieldInput[],
  profile: unknown,
  options: AnalyzeOptions = {},
): Promise<AnalyzeOutcome> {
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const results: FieldResult[] = fields.map((_, i) => skip(i, "not evaluated"));

  const flat = flattenProfile(profile);
  const pool = dedupeByValue([...flat, ...deriveCandidates(flat)]);

  if (pool.length === 0) {
    return {
      results: fields.map((_, i) => skip(i, "profile has no usable values")),
      model: null,
      usage: null,
      candidateCount: 0,
      questionCount: 0,
    };
  }

  const questions: Questions = {};
  const perField = new Map<string, { index: number; byPath: Map<string, Candidate> }>();

  fields.forEach((field, index) => {
    if (isBlocked(field)) {
      results[index] = skip(index, "field type is never auto-filled");
      return;
    }

    const aliases = options.variations?.[index] ?? [];
    const shortlist =
      pool.length <= MAX_OPTIONS
        ? pool
        : rankCandidates(pool, field, aliases).slice(0, MAX_OPTIONS);

    const criteria: Record<string, string> = {};
    const byPath = new Map<string, Candidate>();
    for (const c of shortlist) {
      criteria[c.path] = c.value;
      byPath.set(c.path, c);
    }
    criteria[NO_MATCH] =
      "No value above belongs in this field, or the field should be left for the applicant to complete.";

    const key = `f${index}`;
    questions[key] = choice(
      {
        task: "Select which stored profile value belongs in one field of a job application form.",
        field: `\`fields[${index}]\``,
        field_label: field.label ?? field.name ?? field.id ?? `field ${index}`,
        option_labels: "Each option label is a profile path; its description is the value stored there.",
        guidance: [
          "Choose the value a careful applicant would type into this field.",
          "Match the meaning of the field, not just similar wording in the path.",
          `Choose ${NO_MATCH} when no stored value genuinely belongs here.`,
        ],
      },
      criteria,
    );
    perField.set(key, { index, byPath });
  });

  if (Object.keys(questions).length === 0) {
    return { results, model: null, usage: null, candidateCount: pool.length, questionCount: 0 };
  }

  const state = {
    fields: fields.map((f, i) => describeField(f, i, options.variations?.[i] ?? [])),
  };

  const response = await systemOne({ state, questions, model: options.model });

  for (const [key, { index, byPath }] of perField) {
    const answer = response.answers[key];
    if (!isChoice(answer)) {
      results[index] = skip(index, "model returned no usable answer");
      continue;
    }

    const confidence = toPercent(answer.confidence);
    const field = fields[index];

    if (answer.choice === NO_MATCH) {
      results[index] = skip(index, "no stored profile value fits this field", confidence);
      continue;
    }

    const candidate = byPath.get(answer.choice);
    if (!candidate) {
      results[index] = skip(index, `model selected unknown path "${answer.choice}"`, confidence);
      continue;
    }

    if (confidence < minConfidence) {
      results[index] = {
        ...skip(index, `confidence ${confidence} below threshold ${minConfidence}`, confidence),
        dataPath: candidate.path,
      };
      continue;
    }

    const value = coerceValue(candidate, field);
    if (value === null || value === "") {
      results[index] = {
        ...skip(index, `value at ${candidate.path} is not valid for a ${field.type} input`, confidence),
        dataPath: candidate.path,
      };
      continue;
    }

    const maxLength = typeof field.maxLength === "number" ? field.maxLength : null;
    if (maxLength && maxLength > 0 && String(value).length > maxLength) {
      results[index] = {
        ...skip(index, `value exceeds maxLength ${maxLength}`, confidence),
        dataPath: candidate.path,
      };
      continue;
    }

    results[index] = {
      fieldIndex: index,
      shouldFill: true,
      value,
      confidence,
      reasoning: `selected ${candidate.path}`,
      dataPath: candidate.path,
      fieldType: String(field.type ?? "text"),
      source: "typesafe",
    };
  }

  return {
    results,
    model: response.model,
    usage: response.usage,
    candidateCount: pool.length,
    questionCount: perField.size,
  };
}

/** Single-field convenience used by ai-field-analysis; same engine, one question. */
export async function analyzeSingleField(
  systemOne: SystemOneFn,
  field: FieldInput,
  profile: unknown,
  variations: string[] = [],
  options: Omit<AnalyzeOptions, "variations"> = {},
): Promise<AnalyzeOutcome> {
  return analyzeFields(systemOne, [field], profile, {
    ...options,
    variations: { 0: variations },
  });
}

export { candidatesForField };
