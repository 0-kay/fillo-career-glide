// Flattens a profile into a list of concrete (path, value) candidates.
//
// The model never produces a value: it selects a path, and code reads the value back.
// That makes a hallucinated value structurally impossible rather than merely discouraged.

export interface Candidate {
  path: string;
  value: string;
  /** Raw leaf before stringification, so callers can re-type it per field. */
  raw: string | number | boolean;
  /** True when code synthesized this from other leaves (e.g. full_name). */
  derived?: boolean;
}

/** Never offer these as fill candidates regardless of what the profile contains. */
const SENSITIVE = /pass(word|code)|secret|token|ssn|social_security|credit|card_number|cvv|routing|account_number|api_?key/i;

const MAX_LEAVES = 600;
const MAX_STRING = 400;

function isLeaf(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

/** Walk arbitrary profile JSON into dot/bracket paths pointing at scalar leaves. */
export function flattenProfile(profile: unknown): Candidate[] {
  const out: Candidate[] = [];

  const walk = (node: unknown, path: string): void => {
    if (out.length >= MAX_LEAVES || node == null) return;

    if (isLeaf(node)) {
      if (SENSITIVE.test(path)) return;
      const value = String(node).trim();
      if (!value || value.length > MAX_STRING) return;
      out.push({ path, value, raw: node });
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }

    if (typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (SENSITIVE.test(key)) continue;
        walk(value, path ? `${path}.${key}` : key);
      }
    }
  };

  walk(profile, "");
  return out;
}

const findPath = (cands: Candidate[], re: RegExp): Candidate | undefined =>
  cands.find((c) => re.test(c.path));

/**
 * Values a form may ask for that exist in the profile only as parts.
 * Composition is code's job; the model still only selects.
 */
export function deriveCandidates(cands: Candidate[]): Candidate[] {
  const derived: Candidate[] = [];
  const has = (p: string) => cands.some((c) => c.path === p);

  const first = findPath(cands, /(^|\.)(first_?name|given_?name)$/i);
  const last = findPath(cands, /(^|\.)(last_?name|family_?name|surname)$/i);
  if (first && last && !has("full_name")) {
    const value = `${first.value} ${last.value}`.trim();
    derived.push({ path: "derived.full_name", value, raw: value, derived: true });
  }

  const middle = findPath(cands, /(^|\.)middle_?name$/i);
  if (first && middle && last) {
    const value = `${first.value} ${middle.value} ${last.value}`.trim();
    derived.push({ path: "derived.full_name_with_middle", value, raw: value, derived: true });
  }

  const roots = new Set<string>();
  for (const c of cands) {
    const m = c.path.match(/^([a-z_]*(?:experience|employment|work_history)[a-z_]*)\[\d+\]/i);
    if (m) roots.add(m[1]);
  }
  for (const root of roots) {
    const indices = new Set(
      cands
        .map((c) => c.path.match(new RegExp(`^${root}\\[(\\d+)\\]`)))
        .filter(Boolean)
        .map((m) => m![1]),
    );
    if (indices.size > 0) {
      const value = String(indices.size);
      derived.push({
        path: `derived.${root}_count`,
        value,
        raw: indices.size,
        derived: true,
      });
    }
  }

  return derived;
}

const STOP = new Set([
  "the", "your", "you", "please", "enter", "field", "input", "select", "value",
  "name", "text", "this", "and", "for", "with", "are", "was", "has",
]);

/**
 * Form vocabulary rarely matches profile vocabulary: a field called `currentEmployer`
 * has no token in common with `work_experience[0].company`. Without these, the right
 * candidate scores zero and can be pruned out of the shortlist entirely.
 */
const ALIASES: Record<string, string[]> = {
  employer: ["company", "organization", "organisation", "work", "experience"],
  company: ["employer", "organization", "work", "experience"],
  title: ["job", "position", "role", "occupation"],
  position: ["title", "job", "role"],
  role: ["title", "job", "position"],
  school: ["university", "college", "institution", "education"],
  university: ["school", "college", "institution", "education"],
  college: ["school", "university", "institution", "education"],
  degree: ["education", "qualification"],
  major: ["field", "study", "discipline", "education"],
  grad: ["graduation", "education", "completion"],
  graduation: ["grad", "education", "completion"],
  zip: ["postal", "postcode", "address"],
  postal: ["zip", "postcode", "address"],
  mobile: ["phone", "cell", "telephone", "contact"],
  cell: ["phone", "mobile", "telephone"],
  phone: ["mobile", "cell", "telephone", "contact"],
  street: ["address", "line"],
  residence: ["address", "city", "state"],
  salary: ["compensation", "pay", "desired"],
  compensation: ["salary", "pay", "desired"],
  linkedin: ["profile", "social", "url"],
  relocate: ["relocation", "willing", "move"],
  surname: ["last", "family"],
  forename: ["first", "given"],
};

function expand(tokens: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const t of tokens) {
    out.add(t);
    for (const alias of ALIASES[t] ?? []) out.add(alias);
  }
  return out;
}

function tokenize(s: unknown): string[] {
  return String(s ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

export interface FieldLike {
  name?: string | null;
  id?: string | null;
  label?: string | null;
  placeholder?: string | null;
  type?: string | null;
  context?: string | null;
}

/**
 * Lexical pre-rank, used only to cut an oversized candidate list down to the cap.
 * A candidate the model never sees can never be chosen, so we only prune when we must.
 */
export function rankCandidates(
  cands: Candidate[],
  field: FieldLike,
  variations: string[] = [],
): Candidate[] {
  const wanted = expand([
    ...tokenize(field.name),
    ...tokenize(field.id),
    ...tokenize(field.label),
    ...tokenize(field.placeholder),
    ...variations.flatMap(tokenize),
  ]);
  const wantedList = [...wanted];

  const scored = cands.map((c, order) => {
    const pathTokens = tokenize(c.path);
    let hits = 0;
    for (const t of pathTokens) {
      if (wanted.has(t)) hits += 2;
      else if (wantedList.some((w) => w.includes(t) || t.includes(w))) hits += 1;
    }
    if (field.type === "email" && c.value.includes("@")) hits += 3;
    if (field.type === "tel" && /\d{7,}/.test(c.value.replace(/\D/g, ""))) hits += 3;
    if (field.type === "url" && /^https?:\/\//i.test(c.value)) hits += 2;
    return { c, hits, order };
  });

  // Ties keep profile order. Sorting ties by path length let short junk keys
  // displace real data like work_experience[0].company out of the shortlist.
  scored.sort((a, b) => b.hits - a.hits || a.order - b.order);
  return scored.map((s) => s.c);
}

const normalize = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Collapse candidates that hold the same value.
 *
 * Choice splits probability across every option it considers correct, so two paths
 * holding one value (`email` and `contact.email`) halve the reported confidence and
 * trip the caller's threshold even though either answer would have been right.
 */
export function dedupeByValue(cands: Candidate[]): Candidate[] {
  const seen = new Map<string, Candidate>();
  for (const c of cands) {
    const key = normalize(c.value);
    const prev = seen.get(key);
    if (!prev || c.path.length < prev.path.length) seen.set(key, c);
  }
  return [...seen.values()];
}

// Choice accepts up to 255 labels. Pruning is the only way to lose a correct answer
// outright, so the cap stays well above realistic profile sizes and leaves headroom.
export const MAX_OPTIONS = 150;

/** Full pipeline: flatten, add derived, dedupe, then prune only if over the cap. */
export function candidatesForField(
  profile: unknown,
  field: FieldLike,
  variations: string[] = [],
  cap: number = MAX_OPTIONS,
): Candidate[] {
  const flat = flattenProfile(profile);
  const all = dedupeByValue([...flat, ...deriveCandidates(flat)]);
  if (all.length <= cap) return all;
  return rankCandidates(all, field, variations).slice(0, cap);
}
