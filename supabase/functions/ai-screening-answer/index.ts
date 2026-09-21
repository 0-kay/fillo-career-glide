import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { resolveProvider } from "../_shared/typesafe/client.ts";
import { requireUser } from "../_shared/typesafe/auth.ts";
import { json, preflight } from "../_shared/typesafe/http.ts";
import { legacyClassifyScreening } from "../_shared/typesafe/legacy.ts";
import { systemOne } from "../_shared/typesafe/runtime.deno.ts";
import { classifyScreeningQuestions } from "../_shared/typesafe/screening.ts";

const MIN_SCREENING_CONFIDENCE = 60;

interface ScreeningAnswer {
  id?: string;
  question: string;
  answer: string;
  answerType?: "yes_no" | "text" | "select";
  answerOptions?: string[];
  keywords?: string[];
  enabled?: boolean;
}

interface LiveQuestion {
  questionText: string;
  elementType: string;
  pageOptions: string[];
  screeningOptions: string[];
}

function cleanOptions(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(
        new Set(
          (value as unknown[])
            .map((o) => String(o ?? "").replace(/\s+/g, " ").trim())
            .filter(Boolean)
        )
      )
    : [];
}

// Ported from extension — word-overlap Jaccard over tokens longer than 2 chars
function semanticScore(a: string, b: string): number {
  if (!a || !b) return 0;
  const tok = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);
  const aW = tok(a);
  const bW: (string | null)[] = tok(b);
  if (!aW.length || !bW.length) return 0;
  let hits = 0;
  for (const w of aW) {
    const i = bW.findIndex((bw) => bw && (bw === w || bw.includes(w) || w.includes(bw)));
    if (i !== -1) { hits++; bW[i] = null; }
  }
  return hits / Math.max(aW.length, bW.filter(Boolean).length + hits);
}

// Ported from extension matchQuestionToAnswer — two-phase deterministic scoring
function deterministicMatch(
  questionText: string,
  savedAnswers: ScreeningAnswer[]
): { answer: ScreeningAnswer; score: number } | null {
  const qNorm = questionText
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Phase 1: substring / exact text match
  for (const sa of savedAnswers) {
    if (sa.enabled === false || !sa.answer) continue;
    const saNorm = String(sa.question || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!saNorm) continue;
    const qTokens = qNorm.split(/\s+/).filter((w) => w.length > 2);
    const saTokens = saNorm.split(/\s+/).filter((w) => w.length > 2);
    if (
      qNorm === saNorm ||
      (saNorm.length >= 20 && saTokens.length >= 3 && qNorm.includes(saNorm)) ||
      (qNorm.length >= 20 && qTokens.length >= 3 && saNorm.includes(qNorm))
    )
      return { answer: sa, score: 1.0 };
  }

  // Phase 2: keyword + semantic scoring
  let best: ScreeningAnswer | null = null;
  let bestScore = 0;

  for (const sa of savedAnswers) {
    if (sa.enabled === false || !sa.answer) continue;
    const saQ = String(sa.question || "").toLowerCase();
    if (!saQ) continue;

    const textScore = semanticScore(questionText, saQ);

    let kwScore = 0;
    const kws = sa.keywords ?? [];
    if (kws.length) {
      const matched = kws.filter((kw) => {
        const k = String(kw || "").toLowerCase().replace(/[^a-z0-9]/g, " ").trim();
        return k && qNorm.includes(k);
      });
      kwScore = Math.min(1, matched.length / Math.min(kws.length, 4));
    }

    const score = textScore * 0.6 + kwScore * 0.4;
    if (score > bestScore && score >= MIN_SCREENING_CONFIDENCE / 100) {
      bestScore = score;
      best = sa;
    }
  }

  return best ? { answer: best, score: bestScore } : null;
}

function deriveIntent(sa: ScreeningAnswer): string {
  const text =
    String(sa.question || "").toLowerCase() +
    " " +
    (sa.keywords ?? []).join(" ").toLowerCase();

  if (/authorized|authorization|lawfully/.test(text)) return "work_authorization";
  if (/visa|sponsorship/.test(text)) return "visa_sponsorship";
  if (/veteran|vevraa/.test(text)) return "veteran_status";
  if (/disability|ofccp/.test(text)) return "disability_status";
  if (/non.compete|non.solicitation/.test(text)) return "non_compete";
  if (/government.*employ|former.*employ/.test(text)) return "government_employee";
  if (/export.*control|sanctioned/.test(text)) return "export_control";
  if (/additional.*citizen|additional.*residen/.test(text)) return "additional_citizenship";
  if (/\bage\b.*18|18.*\bage\b|18 years|at least 18/.test(text)) return "age_18_or_older";
  if (/background.*check/.test(text)) return "background_check";
  if (/salary|compensation/.test(text)) return "salary_expectation";
  if (/hear.*about|source|referral/.test(text)) return "referral_source";
  if (/education|degree|diploma/.test(text)) return "education_level";
  if (/\bgender\b|\bmale\b|\bfemale\b/.test(text)) return "gender";
  if (/race|ethnicity|hispanic|latino/.test(text)) return "race_ethnicity";
  return "general_text";
}

function deriveValue(
  sa: ScreeningAnswer,
  intent: string
): { value: string; answerText: string } {
  const ans = sa.answer;

  if (sa.answerType === "yes_no")
    return { value: /^yes\b/i.test(ans) ? "yes" : "no", answerText: ans };

  if (intent === "disability_status") {
    if (/yes.*disability|have.*disability|had.*disability/i.test(ans))
      return { value: "has_disability", answerText: ans };
    if (/not.*disability|do not have.*disability|have not had/i.test(ans))
      return { value: "no_disability", answerText: ans };
    return { value: "decline", answerText: ans };
  }

  if (intent === "veteran_status") {
    if (/not.*protected veteran|just not/i.test(ans))
      return { value: "not_protected_veteran", answerText: ans };
    if (/one or more.*veteran|classifications.*veteran|identify as.*veteran/i.test(ans))
      return { value: "protected_veteran", answerText: ans };
    return { value: "decline", answerText: ans };
  }

  if (intent === "gender") {
    if (/^male$/i.test(ans.trim())) return { value: "male", answerText: ans };
    if (/^female$/i.test(ans.trim())) return { value: "female", answerText: ans };
    if (/non.binary/i.test(ans)) return { value: "non_binary", answerText: ans };
    return { value: "opt_out", answerText: ans };
  }

  if (intent === "race_ethnicity") {
    if (/opt out/i.test(ans)) return { value: "opt_out", answerText: ans };
    return { value: "custom_text", answerText: ans };
  }

  if (intent === "education_level") {
    // Return a degree-level stem so the extension can match any Workday phrasing
    // ("Bachelor's (BS/BA)", "Bachelor of Science", "Bachelors", etc.) via substring scoring
    if (/ph\.?d|doctor|doctoral|doctorate/i.test(ans)) return { value: "doctoral", answerText: ans };
    if (/master|mba|m\.s\.|m\.a\./i.test(ans)) return { value: "master", answerText: ans };
    if (/bachelor|b\.s\.|b\.a\.|undergraduate/i.test(ans)) return { value: "bachelor", answerText: ans };
    if (/associate/i.test(ans)) return { value: "associate", answerText: ans };
    if (/high school|ged|secondary/i.test(ans)) return { value: "highschool", answerText: ans };
    return { value: "custom_text", answerText: ans };
  }

  return { value: "custom_text", answerText: ans };
}

function buildAnswer(
  index: number,
  questionText: string,
  sa: ScreeningAnswer,
  score: number
) {
  const confidence = Math.round(score * 100);
  if (confidence < MIN_SCREENING_CONFIDENCE) {
    return skipAnswer(index, questionText);
  }
  const intent = deriveIntent(sa);
  const { value, answerText } = deriveValue(sa, intent);
  return { index, question: questionText, intent, value, answerText, answer: answerText, confidence };
}

function skipAnswer(index: number, questionText: string) {
  return { index, question: questionText, intent: null, value: null, answerText: null, answer: null, confidence: 0 };
}

serve(async (req: any) => {
  if (req.method === "OPTIONS") return preflight();

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    const { questions: rawQuestions, profileData } = await req.json();

    const savedAnswers: ScreeningAnswer[] = Array.isArray(profileData)
      ? profileData.filter(
          (a: any) => a && typeof a.question === "string" && typeof a.answer === "string"
        )
      : [];

    const questions: LiveQuestion[] = Array.isArray(rawQuestions)
      ? rawQuestions
          .map((q: any) => ({
            questionText: String(q?.questionText ?? q?.question ?? "").trim(),
            elementType: String(q?.elementType ?? q?.type ?? "unknown").trim() || "unknown",
            pageOptions: cleanOptions(q?.pageOptions ?? q?.options),
            screeningOptions: cleanOptions(q?.screeningOptions),
          }))
          .filter((q) => q.questionText)
      : [];

    if (questions.length === 0) return json({ success: true, answers: [] });

    console.log("🎯 Screening batch:", { questions: questions.length, savedAnswers: savedAnswers.length });

    // Pass 1: deterministic matching
    const answers: ReturnType<typeof buildAnswer | typeof skipAnswer>[] = new Array(questions.length);
    const unmatched: Array<{ originalIndex: number; questionText: string }> = [];

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const match = deterministicMatch(q.questionText, savedAnswers);
      if (match) {
        console.log(`✅ Deterministic: "${q.questionText.substring(0, 50)}" → "${match.answer.question.substring(0, 40)}" (${Math.round(match.score * 100)}%)`);
        answers[i] = buildAnswer(i, q.questionText, match.answer, match.score);
      } else {
        unmatched.push({ originalIndex: i, questionText: q.questionText });
      }
    }

    // Pass 2: the model only ever returns an index into savedAnswers, so answer text
    // always comes from what the applicant wrote.
    if (unmatched.length > 0 && savedAnswers.length > 0) {
      const provider = resolveProvider();
      try {
        console.log(`🤖 Classifying ${unmatched.length} unmatched questions via ${provider}`);

        const matched = new Map<number, { savedIndex: number; confidence: number }>();
        if (provider === "openai") {
          const legacy = await legacyClassifyScreening(unmatched, savedAnswers);
          for (const [originalIndex, savedIndex] of legacy) {
            matched.set(originalIndex, { savedIndex, confidence: 75 });
          }
        } else {
          const out = await classifyScreeningQuestions(systemOne, unmatched, savedAnswers, {
            minConfidence: MIN_SCREENING_CONFIDENCE,
          });
          for (const [originalIndex, m] of out.matches) matched.set(originalIndex, m);
          console.log("🤖 Classifier usage:", { model: out.model, usage: out.usage });
        }

        for (const { originalIndex, questionText } of unmatched) {
          const hit = matched.get(originalIndex);
          if (hit) {
            const sa = savedAnswers[hit.savedIndex];
            console.log(`🤖 Classified: "${questionText.substring(0, 50)}" → saved[${hit.savedIndex}] "${sa.question.substring(0, 40)}" (${hit.confidence}%)`);
            answers[originalIndex] = buildAnswer(originalIndex, questionText, sa, hit.confidence / 100);
          } else {
            console.log(`⏭️  No match: "${questionText.substring(0, 60)}"`);
            answers[originalIndex] = skipAnswer(originalIndex, questionText);
          }
        }
      } catch (e: any) {
        console.warn("⚠️ Classifier failed, skipping unmatched:", e.message);
        for (const { originalIndex, questionText } of unmatched)
          answers[originalIndex] = skipAnswer(originalIndex, questionText);
      }
    } else {
      for (const { originalIndex, questionText } of unmatched)
        answers[originalIndex] = skipAnswer(originalIndex, questionText);
    }

    console.log("📋 Screening results:", answers.map(a => ({ q: a.question?.substring(0, 40), v: a.value, c: a.confidence })));

    return json({ success: true, answers });
  } catch (error: any) {
    console.error("❌ Screening Batch Error:", error);
    return json({ success: false, error: error.message }, 500);
  }
});
