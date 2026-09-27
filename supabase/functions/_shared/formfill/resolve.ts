// Pure resolution logic: cached mappings + descriptors + profile -> fill plan.
// No I/O here so it can be unit-tested; the edge function wires in the store and Jev.

import { deriveCandidates, flattenProfile } from "../typesafe/candidates.ts";
import { coerceValue } from "../typesafe/fields.ts";
import { pickOption } from "./rules.ts";
import {
  type FieldDescriptor,
  fieldName,
  fieldSignature,
  normalizeText,
} from "./signature.ts";

export interface MappingRow {
  id: string;
  scope: "platform" | "company";
  domain_pattern: string;
  platform: string | null;
  signature: string;
  field_name: string;
  field_label: string;
  field_type: string;
  profile_path: string;
  meta: { default?: string } & Record<string, unknown>;
  source: "seed" | "llm";
  confidence: number;
  success_count: number;
  override_count: number;
}

export interface PlanEntry {
  fieldIndex: number;
  value: string | number | boolean;
  mappingId: string | null;
  signature: string;
  source: "cache" | "rule" | "screening" | "llm";
  confidence: number;
  dataPath: string | null;
}

/** Below this a cached row is not used; the field goes to the model instead. */
export const MIN_ROW_CONFIDENCE = 50;
const MIN_FEEDBACK_SAMPLES = 3;
const MAX_OVERRIDE_RATE = 0.4;

/** A row users keep correcting is wrong (or stale) and must stop being served. */
export function isTrusted(row: MappingRow): boolean {
  if (row.confidence < MIN_ROW_CONFIDENCE) return false;
  // A model-learned row has not earned the benefit of the doubt a curated seed row has:
  // retire it as soon as corrections outnumber confirmations, and re-map it.
  if (row.source === "llm" && row.override_count >= 2 && row.override_count > row.success_count) return false;
  const seen = row.success_count + row.override_count;
  if (row.override_count >= MIN_FEEDBACK_SAMPLES && row.override_count / seen > MAX_OVERRIDE_RATE) {
    return false;
  }
  return true;
}

const SCOPE_RANK = { company: 2, platform: 1 } as const;

function better(a: MappingRow, b: MappingRow): MappingRow {
  const s = SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope];
  if (s !== 0) return s > 0 ? a : b;
  return a.confidence >= b.confidence ? a : b;
}

export interface MatchOutcome {
  matches: Map<number, MappingRow>;
  /** Untrusted company rows for fields we will re-map; the new mapping replaces them. */
  demoted: Map<number, MappingRow>;
}

/**
 * Matches each descriptor to at most one row:
 *   1. exact signature
 *   2. stable name/id equality
 *   3. label equality, only when the label is unambiguous on this form and among the rows
 * Company rows beat platform rows; untrusted rows are never returned.
 */
export function matchFields(descriptors: FieldDescriptor[], rows: MappingRow[]): MatchOutcome {
  const bySig = new Map<string, MappingRow[]>();
  const byName = new Map<string, MappingRow[]>();
  const byLabel = new Map<string, MappingRow[]>();
  const push = (m: Map<string, MappingRow[]>, k: string, r: MappingRow) => {
    if (!k) return;
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  };
  for (const r of rows) {
    push(bySig, r.signature, r);
    push(byName, r.field_name, r);
    if (!r.field_name) push(byLabel, normalizeText(r.field_label), r);
  }

  const labelCount = new Map<string, number>();
  for (const d of descriptors) {
    const l = normalizeText(d.label);
    if (l) labelCount.set(l, (labelCount.get(l) ?? 0) + 1);
  }

  const pick = (candidates: MappingRow[] | undefined): { row?: MappingRow; demoted?: MappingRow } => {
    if (!candidates?.length) return {};
    const trusted = candidates.filter(isTrusted);
    if (trusted.length) {
      const best = trusted.reduce(better);
      // Same-scope rows that disagree on the path mean the key is ambiguous: do not guess.
      const rivals = trusted.filter((r) => r.scope === best.scope);
      if (new Set(rivals.map((r) => r.profile_path)).size > 1) return {};
      return { row: best };
    }
    const demoted = candidates.find((c) => c.scope === "company" && c.source === "llm");
    return { demoted };
  };

  const matches = new Map<number, MappingRow>();
  const demoted = new Map<number, MappingRow>();

  descriptors.forEach((d, i) => {
    const name = fieldName(d);
    const label = normalizeText(d.label);
    // Without a stable name the signature is label-only, so it is only as good as the label is unique.
    const labelUnique = !label || labelCount.get(label) === 1;
    const attempts: Array<MappingRow[] | undefined> = [];
    if (name || labelUnique) attempts.push(bySig.get(fieldSignature(d)));
    if (name) attempts.push(byName.get(name));
    if (label && labelCount.get(label) === 1) {
      const byL = byLabel.get(label);
      // Ambiguous across rows (e.g. two different paths share a label): do not guess.
      if (byL && new Set(byL.map((r) => r.profile_path)).size === 1) attempts.push(byL);
    }
    for (const list of attempts) {
      const { row, demoted: dm } = pick(list);
      if (row) {
        matches.set(i, row);
        return;
      }
      if (dm && !demoted.has(i)) demoted.set(i, dm);
    }
  });

  return { matches, demoted };
}

// ---- value resolution -------------------------------------------------------------

function getPath(root: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur: unknown = root;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

const isScalar = (v: unknown): v is string | number | boolean =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";

/** Reads the value a mapping points at. Code owns every read; the model only picks paths. */
interface SavedAnswer {
  key?: string;
  id?: string;
  answer?: unknown;
  enabled?: boolean;
}

/** Saved screening answers, keyed by their stable key (never by array position). */
export function screeningAnswers(profile: unknown): SavedAnswer[] {
  const list = getPath(profile, "job_preferences.screening_answers");
  return Array.isArray(list) ? (list as SavedAnswer[]) : [];
}

export function resolvePath(profile: unknown, path: string, today = new Date()): string | number | boolean | null {
  if (path === "__today") return today.toISOString().slice(0, 10);
  if (path.startsWith("screening:")) {
    const key = path.slice("screening:".length);
    const hit = screeningAnswers(profile).find((a) => a.enabled !== false && (a.key ?? a.id) === key);
    return hit && isScalar(hit.answer) && String(hit.answer).trim() ? hit.answer : null;
  }
  if (path === "__current_company") {
    const v = getPath(profile, "work_experience.0.company");
    return isScalar(v) && String(v).trim() ? v : null;
  }
  if (path.startsWith("derived.")) {
    const c = deriveCandidates(flattenProfile(profile)).find((x) => x.path === path);
    return c ? c.raw : null;
  }

  const v = getPath(profile, path);
  if (isScalar(v) && String(v).trim() !== "") return v;

  // Older profiles have no fullName; compose it rather than leave the field blank.
  if (path === "personal_details.fullName" || path === "name") {
    const c = deriveCandidates(flattenProfile(profile)).find((x) => x.path === "derived.full_name");
    return c ? c.raw : null;
  }
  return null;
}

export interface Resolved {
  value: string | number | boolean;
  dataPath: string | null;
}

/** Row + profile -> the typed value for this field, falling back to the row's default. */
export function valueForRow(row: MappingRow, descriptor: FieldDescriptor, profile: unknown): Resolved | null {
  const fallback = typeof row.meta?.default === "string" ? row.meta.default : null;
  return valueForPath(row.profile_path, descriptor, profile, fallback);
}

/** Reads a profile path and shapes it for the target field (type coercion, option text, length). */
export function valueForPath(
  path: string,
  descriptor: FieldDescriptor,
  profile: unknown,
  fallback: string | null = null,
): Resolved | null {
  const raw = resolvePath(profile, path);
  const source = raw ?? fallback;
  if (source == null || String(source).trim() === "") return null;

  const asText = String(source);
  // Choice fields take option text, never a coerced boolean.
  if (descriptor.options?.length) {
    return { value: pickOption(asText, descriptor.options), dataPath: raw == null ? null : path };
  }
  const typed = coerceValue({ path, value: asText, raw: source }, descriptor);
  if (typed === null || typed === "") return null;

  const max = typeof descriptor.maxLength === "number" ? descriptor.maxLength : null;
  if (max && max > 0 && String(typed).length > max) return null;

  return { value: typed, dataPath: raw == null ? null : path };
}

export interface CachePlan {
  entries: PlanEntry[];
  /** Descriptor indexes the cache could not answer (no row, untrusted, or profile lacks a value). */
  unresolved: number[];
  demoted: Map<number, MappingRow>;
}

const NEVER_FILL_TYPES = new Set(["password", "hidden", "file", "submit", "button"]);

export function planFromCache(
  descriptors: FieldDescriptor[],
  rows: MappingRow[],
  profile: unknown,
): CachePlan {
  const { matches, demoted } = matchFields(descriptors, rows);
  const entries: PlanEntry[] = [];
  const unresolved: number[] = [];

  descriptors.forEach((d, i) => {
    if (NEVER_FILL_TYPES.has(String(d.type ?? "").toLowerCase())) return;
    const row = matches.get(i);
    const resolved = row ? valueForRow(row, d, profile) : null;
    if (row && resolved) {
      entries.push({
        fieldIndex: i,
        value: resolved.value,
        mappingId: row.id,
        signature: fieldSignature(d),
        source: "cache",
        confidence: row.confidence,
        dataPath: resolved.dataPath,
      });
    } else {
      // A trusted row whose profile value is empty is a profile gap, not a cache miss:
      // asking the model would only re-select the same empty path, so leave it blank.
      if (!(row && !resolved)) unresolved.push(i);
    }
  });

  return { entries, unresolved, demoted };
}

