// Stable names for the screening questions every profile starts with.
//
// Saved answers carry a random per-user `id`, so a cached mapping can never point at one by id:
// another user's answer to the same question has a different id. The app seeds every profile
// from the same default questions (src/components/ScreeningQuestionsDialog.tsx), so the question
// text identifies the answer across users. Keep this list in sync with those defaults.

const DEFAULTS: Record<string, string> = {
  work_authorization: "Are you authorized to work lawfully in the United States?",
  sponsorship: "Do you now or in the future require visa sponsorship to maintain work authorization?",
  veteran: "Please select your protected veteran status.",
  disability: "Please check one of the boxes below:",
  non_compete: "Are you subject to any non-compete or non-solicitation restrictions?",
  government_employee: "Are you a current or former government employee?",
  sanctioned_country: "Are you a citizen of any export-controlled or sanctioned country?",
  additional_citizenship: "Do you have citizenship or permanent residency in an additional country?",
  age_18: "Are you at least 18 years of age?",
  background_check: "Are you willing to undergo a background check?",
  salary: "What are your salary expectations?",
  referral_source: "How did you hear about this position?",
  education_level: "Please select your highest level of education.",
  gender: "Please select your gender.",
  race: "Please select your race or ethnicity.",
};

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const BY_QUESTION = new Map(Object.entries(DEFAULTS).map(([k, q]) => [norm(q), k]));

// Older profiles and test fixtures used these keys for the same questions.
const LEGACY_KEYS: Record<string, string> = { disability_status: "disability" };

export interface SavedAnswerLike {
  key?: string;
  question?: string;
}

/** The stable key of a saved answer, or null for a question the applicant wrote themselves. */
export function canonicalKey(sa: SavedAnswerLike | undefined): string | null {
  if (!sa) return null;
  const byQuestion = BY_QUESTION.get(norm(sa.question));
  if (byQuestion) return byQuestion;
  if (sa.key) return LEGACY_KEYS[sa.key] ?? (DEFAULTS[sa.key] ? sa.key : null);
  return null;
}
