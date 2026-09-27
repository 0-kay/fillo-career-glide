// Field identity for the mapping cache.
//
// A *signature* identifies one field of a form (type + stable name + label). It is what a
// cached mapping is keyed on. The *fingerprint* is a hash of every signature on the page,
// used only to tell "same form as last time" from "form changed" in logs/telemetry.

export interface FieldDescriptor {
  name?: string | null;
  id?: string | null;
  type?: string | null;
  label?: string | null;
  placeholder?: string | null;
  context?: string | null;
  className?: string | null;
  required?: boolean;
  maxLength?: number | null;
  options?: string[] | null;
}

/** Hosts where the first path segment identifies the company, not just the host. */
const PATH_TENANT_HOSTS = new Set([
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "jobs.lever.co",
  "jobs.ashbyhq.com",
  "apply.workable.com",
  "jobs.smartrecruiters.com",
]);

export function normalizeText(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[*:]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Framework-generated identifiers change between page loads and must not be part of a key.
const UNSTABLE = /^(input|field|react-?select|mui|radix|:r)?[-_:]?\d+$|[0-9a-f]{8,}|\d{4,}/i;

/** Normalized name/id, or '' when it looks auto-generated. */
export function stableToken(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim().replace(/^-?\d+[_-]/, "");
  if (!s || UNSTABLE.test(s)) return "";
  return s.toLowerCase();
}

export function fieldName(d: FieldDescriptor): string {
  return stableToken(d.name) || stableToken(d.id);
}

export function fieldSignature(d: FieldDescriptor): string {
  const type = normalizeText(d.type) || "text";
  return `${type}|${fieldName(d)}|${normalizeText(d.label)}`;
}

/** The signature a seeded row (name + label + type) produces, for exact matching. */
export function signatureFromParts(type: string, name: string, label: string): string {
  return `${normalizeText(type) || "text"}|${stableToken(name)}|${normalizeText(label)}`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Scope key for company-level rows: host, plus tenant segment on shared job boards. */
export function companyKey(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "";
  }
  const host = u.hostname.toLowerCase();
  if (PATH_TENANT_HOSTS.has(host)) {
    const seg = u.pathname.split("/").filter(Boolean)[0];
    if (seg) return `${host}/${seg.toLowerCase()}`;
  }
  return host;
}

/** '*.greenhouse.io' matches 'boards.greenhouse.io' (and only subdomains, like the config). */
export function hostMatchesPattern(host: string, pattern: string): boolean {
  if (!host || !pattern) return false;
  if (pattern.startsWith("*.")) return host.endsWith(pattern.slice(1));
  return host === pattern;
}

/** FNV-1a over the sorted signatures. Not security-sensitive; used to compare form shapes. */
export function formFingerprint(descriptors: FieldDescriptor[]): string {
  const joined = descriptors.map(fieldSignature).sort().join("\n");
  let h = 0x811c9dc5;
  for (let i = 0; i < joined.length; i++) {
    h ^= joined.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
