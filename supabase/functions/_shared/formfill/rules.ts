// Deterministic field -> profile path rules. These run before the model: a field the page
// already describes unambiguously (autocomplete token, input type, a standard label) never
// needs a model call, so the model budget is spent only on genuinely custom questions.
//
// Rules match whole labels/names only. A substring rule ("company" anywhere) would fire on
// "Have you ever worked for this company?", and a wrong fill is worse than a blank one.

import { type FieldDescriptor, normalizeText } from "./signature.ts";

const AUTOCOMPLETE: Record<string, string> = {
  "given-name": "first_name",
  "additional-name": "middle_name",
  "family-name": "last_name",
  name: "personal_details.fullName",
  email: "personal_details.email",
  tel: "personal_details.phone",
  "tel-national": "personal_details.phone",
  "street-address": "personal_details.address.line1",
  "address-line1": "personal_details.address.line1",
  "address-line2": "personal_details.address.line2",
  "address-level2": "personal_details.address.city",
  "address-level1": "personal_details.address.state",
  "postal-code": "personal_details.address.postalCode",
  "country-name": "personal_details.address.country",
  country: "personal_details.address.country",
  organization: "__current_company",
  url: "personal_details.website",
};

const PHRASES: Record<string, string[]> = {
  first_name: ["first name", "given name", "firstname", "fname", "legal first name", "preferred first name"],
  middle_name: ["middle name", "middlename"],
  last_name: ["last name", "family name", "surname", "lastname", "lname", "legal last name"],
  "personal_details.fullName": ["full name", "name", "your name", "legal name", "fullname", "full legal name"],
  "personal_details.email": ["email", "email address", "e mail", "e mail address", "your email"],
  "personal_details.phone": ["phone", "phone number", "mobile", "mobile number", "mobile phone", "cell phone", "telephone", "contact number"],
  "personal_details.linkedin": ["linkedin", "linkedin profile", "linkedin url", "linkedin profile url", "linkedin link"],
  "personal_details.github": ["github", "github url", "github profile", "github link"],
  "personal_details.website": ["website", "personal website", "portfolio", "portfolio url", "website url", "other website", "other website url", "personal website url", "portfolio link", "personal site"],
  "personal_details.address.line1": ["address", "street address", "address line 1", "street"],
  "personal_details.address.line2": ["address line 2", "apartment", "apt suite"],
  "personal_details.address.city": ["city", "current city", "town city", "location city", "current location", "location"],
  "personal_details.address.state": ["state", "province", "state province", "state region"],
  "personal_details.address.postalCode": ["zip", "zip code", "postal code", "postcode", "zip postal code"],
  "personal_details.address.country": ["country", "country of residence"],
  __current_company: ["current company", "current employer", "most recent employer"],
  "job_preferences.eeo.gender": ["gender", "gender identity", "sex"],
  "job_preferences.eeo.disability_status": ["disability status", "disability"],
  "screening:veteran": ["veteran status", "protected veteran status", "veteran"],
  "screening:race": ["race", "ethnicity", "race ethnicity", "race or ethnicity"],
  __today: ["date signed", "signature date", "today s date", "todays date", "date of signature", "disability signature date"],
};

const BY_PHRASE = new Map<string, string>();
for (const [path, phrases] of Object.entries(PHRASES)) {
  for (const p of phrases) BY_PHRASE.set(p, path);
}

/** "urls[LinkedIn]" -> "linkedin", "candidate-location" -> "candidate location", "firstName" -> "first name". */
function nameWords(raw: string | null | undefined): string[] {
  const s = String(raw ?? "");
  const inner = s.match(/\[([^\]]+)\]\s*$/)?.[1] ?? s;
  const plain = inner.replace(/[_\-.]+/g, " ");
  // Try both "LinkedIn" -> "linkedin" and "firstName" -> "first name".
  return [normalizeText(plain), normalizeText(plain.replace(/([a-z])([A-Z])/g, "$1 $2"))];
}

export interface RuleHit {
  path: string;
  rule: string;
}

export function ruleFor(d: FieldDescriptor): RuleHit | null {
  const ac = String(d.autocomplete ?? "").trim().toLowerCase().split(/\s+/).pop() ?? "";
  if (ac && ac !== "off" && ac !== "on" && AUTOCOMPLETE[ac]) return { path: AUTOCOMPLETE[ac], rule: `autocomplete:${ac}` };

  const type = String(d.type ?? "").toLowerCase();
  if (type === "email") return { path: "personal_details.email", rule: "type:email" };
  if (type === "tel") return { path: "personal_details.phone", rule: "type:tel" };

  const label = normalizeText(d.label);
  if (label && BY_PHRASE.has(label)) return { path: BY_PHRASE.get(label)!, rule: `label:${label}` };

  // Names are only trusted when the label is missing or too generic to contradict them
  // (Lever labels its signature date just "Date"; the name says eeo[disabilitySignatureDate]).
  if (!label || label.split(" ").length <= 2) {
    for (const raw of [d.name, d.id]) {
      for (const words of nameWords(raw)) {
        if (words && BY_PHRASE.has(words)) return { path: BY_PHRASE.get(words)!, rule: `name:${words}` };
      }
    }
  }
  return null;
}

/** A field that asks the applicant something, as opposed to asking for a profile attribute. */
export function isQuestionLike(d: FieldDescriptor): boolean {
  const label = String(d.label ?? "").trim();
  if (!label) return false;
  if (/\?\s*\*?\s*$/.test(label)) return true;
  if (label.split(/\s+/).length >= 7) return true;
  const opts = (d.options ?? []).map((o) => normalizeText(o));
  return opts.includes("yes") && opts.includes("no");
}

const YES = /^(yes|y|true)\b/i;
const NO = /^(no|n|false)\b/i;

/**
 * Maps a stored answer onto the option text the page offers, so the client selects an
 * option that exists. Returns the original value when no option is a confident match;
 * the client's own option matcher still gets a chance then.
 */
export function pickOption(value: string, options: string[] | null | undefined): string {
  const opts = (options ?? []).map((o) => String(o ?? "").trim()).filter(Boolean);
  if (opts.length === 0) return value;
  const v = normalizeText(value);
  const exact = opts.find((o) => normalizeText(o) === v);
  if (exact) return exact;
  if (YES.test(value) || NO.test(value)) {
    const want = YES.test(value) ? YES : NO;
    const hits = opts.filter((o) => want.test(o.trim()));
    if (hits.length === 1) return hits[0];
  }
  const starts = opts.filter((o) => {
    const n = normalizeText(o);
    return n.startsWith(v) || v.startsWith(n);
  });
  if (starts.length === 1) return starts[0];
  return value;
}
