// Completeness drives whether a profile is "ready to fill" (>= 75). It scores what
// application forms actually ask for; projects and certifications are optional and never
// hold a profile back. Screening answers are worth 15 points, pro rata.
export const READY_THRESHOLD = 75;
export const SCREENING_POINTS = 15;

interface CompletenessInput {
  personalDetails?: any;
  workExperience?: any[];
  educationHistory?: any[];
  technicalSkills?: any;
  screeningAnswers?: any[];
}

const filled = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

/** Enabled screening questions and how many of them have an answer. */
export function screeningProgress(answers: unknown): { answered: number; total: number; pct: number } {
  const active = (Array.isArray(answers) ? answers : []).filter((a: any) => a && a.enabled !== false);
  const answered = active.filter((a: any) => String(a.answer ?? '').trim() !== '').length;
  return { answered, total: active.length, pct: active.length ? Math.round((answered / active.length) * 100) : 0 };
}

export const computeCompleteness = (p: CompletenessInput): number => {
  const pd = p.personalDetails || {};
  const addr = pd.address || {};
  const skills = Array.isArray(p.technicalSkills?.all) ? p.technicalSkills.all : [];
  const hasJob = (p.workExperience || []).some((e: any) => filled(e?.jobTitle) || filled(e?.company));
  const hasEdu = (p.educationHistory || []).some((e: any) => filled(e?.degree) || filled(e?.school));
  const hasName = filled(pd.fullName) || filled(pd.full_name);
  const sp = screeningProgress(p.screeningAnswers);

  let score = 0;
  if (hasName) score += 10;
  if (filled(pd.email)) score += 10;
  if (filled(pd.phone)) score += 10;
  if (filled(addr.city) || filled(addr.state) || filled(addr.line1)) score += 10;
  if (hasJob) score += 15;
  if (hasEdu) score += 15;
  if (skills.length > 0) score += 10;
  if (filled(pd.summary)) score += 5;
  if (sp.total > 0) score += Math.round(SCREENING_POINTS * (sp.answered / sp.total));
  return Math.min(score, 100);
};

/** Same score from an application_profiles row (snake_case columns). */
export const computeCompletenessFromRow = (row: any): number =>
  computeCompleteness({
    personalDetails: row?.personal_details,
    workExperience: row?.work_experience,
    educationHistory: row?.education_history,
    technicalSkills: row?.technical_skills,
    screeningAnswers: row?.job_preferences?.screening_answers,
  });
