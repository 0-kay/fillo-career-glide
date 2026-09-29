// Fill-plan orchestration, free of I/O so it runs the same in the edge function, in unit
// tests, and in the ATS eval harness (with systemOne = null for an offline run).
//
// Each field is decided by the first layer that can answer it, cheapest and most certain first:
//   1. cache      mapping rows (company scope beats platform scope)
//   2. rules      autocomplete token / input type / standard label — no model
//   3. screening  questions answered from the applicant's saved answers (model picks a page option,
//                 or for open questions, which saved answer to reuse)
//   4. model      remaining fields matched to a profile path (model picks a path)
// The model never produces a value; it only chooses where in the profile a value comes from.

import { answerScreening, type SavedAnswer } from "./screening.ts";
import { analyzeFields } from "../typesafe/fields.ts";
import type { SystemOneFn } from "../typesafe/types.ts";
import { type FieldDescriptor, fieldName, fieldSignature, normalizeText } from "./signature.ts";
import { isQuestionLike, pickOption, ruleFor } from "./rules.ts";
import {
  type MappingRow,
  type PlanEntry,
  planFromCache,
  screeningAnswers,
  valueForPath,
} from "./resolve.ts";

export const MIN_LEARN_CONFIDENCE = 70;
/** Model answers below this are discarded (the field is left for the applicant). */
const MIN_CONFIDENCE = 65;

export interface Learned {
  type: string;
  name: string;
  label: string;
  profilePath: string;
  confidence: number;
  replaceId?: string;
}

export interface PlanStats {
  fields: number;
  fromCache: number;
  fromRules: number;
  fromScreening: number;
  fromModel: number;
  /** Fields that reached the model layer but were cut by the plan's model budget. */
  overBudget: number;
  /** Fields nothing could answer (includes fields the profile has no value for). */
  unanswered: number;
}

export interface PlanResult {
  entries: PlanEntry[];
  learned: Learned[];
  stats: PlanStats;
}

export interface PlanOptions {
  /** Null runs every layer except the model ones (offline eval). */
  systemOne: SystemOneFn | null;
  /** Max fields sent to the model in this request; Infinity for no cap. */
  modelBudget: number;
}

const NEVER_FILL = new Set(["password", "hidden", "file", "submit", "button", "checkbox"]);

function learnable(d: FieldDescriptor, path: string, confidence: number, replaceId?: string): Learned | null {
  const name = fieldName(d);
  const label = normalizeText(d.label);
  if (!name && !label) return null;
  return { type: normalizeText(d.type) || "text", name, label, profilePath: path, confidence, replaceId };
}

/** Profile without the saved screening answers: those are matched by question, never by array position. */
function withoutScreening(profile: unknown): unknown {
  if (!profile || typeof profile !== "object") return profile;
  const p = profile as Record<string, unknown>;
  const prefs = p.job_preferences as Record<string, unknown> | undefined;
  if (!prefs || !("screening_answers" in prefs)) return profile;
  const { screening_answers: _drop, ...rest } = prefs;
  return { ...p, job_preferences: rest };
}

export async function buildPlan(
  descriptors: FieldDescriptor[],
  rows: MappingRow[],
  profile: unknown,
  opts: PlanOptions,
): Promise<PlanResult> {
  const cache = planFromCache(descriptors, rows, profile);
  const entries: PlanEntry[] = [...cache.entries];
  const learned: Learned[] = [];
  const stats: PlanStats = {
    fields: descriptors.length,
    fromCache: cache.entries.length,
    fromRules: 0,
    fromScreening: 0,
    fromModel: 0,
    overBudget: 0,
    unanswered: 0,
  };

  // Layer 2: deterministic rules.
  const pending: number[] = [];
  for (const i of cache.unresolved) {
    const d = descriptors[i];
    if (NEVER_FILL.has(String(d.type ?? "").toLowerCase())) continue;
    const hit = ruleFor(d);
    if (hit) {
      const v = valueForPath(hit.path, d, profile);
      // A rule that points at an empty profile value is a profile gap: leave it blank.
      if (v) {
        entries.push({
          fieldIndex: i,
          value: v.value,
          mappingId: null,
          signature: fieldSignature(d),
          source: "rule",
          confidence: 100,
          dataPath: v.dataPath,
        });
        stats.fromRules++;
      }
      continue;
    }
    pending.push(i);
  }

  // Required fields first, then page order, so a capped budget goes where it matters most.
  pending.sort((a, b) => Number(!!descriptors[b].required) - Number(!!descriptors[a].required) || a - b);
  const budget = Number.isFinite(opts.modelBudget) ? Math.max(0, opts.modelBudget) : pending.length;
  const inBudget = pending.slice(0, budget);
  stats.overBudget = pending.length - inBudget.length;

  if (!opts.systemOne || inBudget.length === 0) {
    stats.unanswered = descriptors.length - entries.length;
    return { entries, learned, stats };
  }
  const systemOne = opts.systemOne;

  const saved = screeningAnswers(profile) as SavedAnswer[];
  const hasSaved = saved.some((a) => a.enabled !== false && a.answer != null && a.question);
  // Questions, and any field with fixed options (EEO selects are often saved answers).
  const screeningIdx = hasSaved
    ? inBudget.filter((i) => isQuestionLike(descriptors[i]) || (descriptors[i].options?.length ?? 0) > 0)
    : [];

  // Both layers in one round trip. Everything also goes to path selection: "Willing to
  // relocate?" may be a profile attribute rather than a saved answer. Screening wins on overlap.
  const [screening, fields] = await Promise.all([
    answerScreening(
      systemOne,
      screeningIdx.map((i) => ({
        index: i,
        question: String(descriptors[i].label ?? ""),
        options: (descriptors[i].options ?? []).map(String),
      })),
      saved,
      MIN_CONFIDENCE,
    ),
    analyzeFields(systemOne, inBudget.map((i) => descriptors[i]), withoutScreening(profile), {
      minConfidence: MIN_CONFIDENCE,
    }),
  ]);

  // Layer 3: screening questions.
  const answered = new Set<number>();
  for (const [i, r] of screening) {
    const d = descriptors[i];
    const value = r.kind === "saved" ? pickOption(r.value, d.options) : r.value;
    entries.push({
      fieldIndex: i,
      value,
      mappingId: null,
      signature: fieldSignature(d),
      source: "screening",
      confidence: r.confidence,
      dataPath: r.kind === "saved" && r.key ? `screening:${r.key}` : null,
    });
    answered.add(i);
    stats.fromScreening++;
    // Only a verbatim saved answer is cacheable. A derived option depends on this applicant's
    // answers, so the question -> option decision cannot be shared.
    if (r.kind === "saved" && r.key && r.confidence >= MIN_LEARN_CONFIDENCE) {
      const l = learnable(d, `screening:${r.key}`, r.confidence, cache.demoted.get(i)?.id);
      if (l) learned.push(l);
    }
  }

  // Layer 4: profile-path selection.
  for (const r of fields.results) {
    if (!r.shouldFill || r.value == null || !r.dataPath) continue;
    const i = inBudget[r.fieldIndex];
    if (answered.has(i)) continue;
    const d = descriptors[i];
    const v = valueForPath(r.dataPath, d, profile);
    if (!v) continue;
    entries.push({
      fieldIndex: i,
      value: v.value,
      mappingId: null,
      signature: fieldSignature(d),
      source: "llm",
      confidence: r.confidence,
      dataPath: r.dataPath,
    });
    stats.fromModel++;
    if (r.confidence >= MIN_LEARN_CONFIDENCE) {
      const l = learnable(d, r.dataPath, r.confidence, cache.demoted.get(i)?.id);
      if (l) learned.push(l);
    }
  }

  stats.unanswered = descriptors.length - entries.length;
  entries.sort((a, b) => a.fieldIndex - b.fieldIndex);
  return { entries, learned, stats };
}
