import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

declare const Deno: { env: { get(key: string): string | undefined } };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

// AI is used only as a constrained classifier: it returns the index into savedAnswers
// (or -1 to skip). It never generates answer text — all answer data comes from savedAnswers.
async function aiClassifyBatch(
  unmatched: Array<{ originalIndex: number; questionText: string }>,
  savedAnswers: ScreeningAnswer[],
  openaiApiKey: string
): Promise<Map<number, number>> {
  const savedList = savedAnswers
    .map((sa, i) => `${i}: "${sa.question}"`)
    .join("\n");

  const questionList = unmatched
    .map((u, i) => `${i}: "${u.questionText}"`)
    .join("\n");

  const prompt = `You are matching job application questions to a list of pre-saved screening answers.
For each question below, return the index of the best matching saved answer, or -1 if none applies.

SAVED ANSWERS:
${savedList}

QUESTIONS TO CLASSIFY (return one number per line, in order):
${questionList}

Rules:
- Match by semantic meaning, not exact wording ("work permit" = "work authorization", "eligible to work" = "authorized to work")
- Only match if you are confident the question is asking the same thing as the saved answer
- Return -1 if the question doesn't clearly map to any saved answer
- Output ONLY a JSON array of integers, e.g. [2, -1, 0]`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 100,
      temperature: 0,
    }),
  });

  if (!response.ok) throw new Error(`OpenAI error: ${response.status}`);

  const data = await response.json();
  const raw = data.choices[0].message.content.trim();
  const jsonMatch = raw.match(/\[[\s\S]*?\]/);
  const indices: number[] = JSON.parse(jsonMatch ? jsonMatch[0] : raw);

  const result = new Map<number, number>();
  unmatched.forEach((u, pos) => {
    const savedIdx = typeof indices[pos] === "number" ? indices[pos] : -1;
    if (savedIdx >= 0 && savedIdx < savedAnswers.length) {
      result.set(u.originalIndex, savedIdx);
    }
  });
  return result;
}

serve(async (req: any) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

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

    if (questions.length === 0)
      return new Response(
        JSON.stringify({ success: true, answers: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );

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

    // Pass 2: AI classifier for unmatched questions (only returns an index, never generates text)
    if (unmatched.length > 0 && savedAnswers.length > 0) {
      const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
      if (openaiApiKey) {
        try {
          console.log(`🤖 AI classifying ${unmatched.length} unmatched questions`);
          const aiMap = await aiClassifyBatch(unmatched, savedAnswers, openaiApiKey);
          for (const { originalIndex, questionText } of unmatched) {
            const savedIdx = aiMap.get(originalIndex);
            if (savedIdx !== undefined) {
              const sa = savedAnswers[savedIdx];
              console.log(`🤖 AI classified: "${questionText.substring(0, 50)}" → saved[${savedIdx}] "${sa.question.substring(0, 40)}"`);
              answers[originalIndex] = buildAnswer(originalIndex, questionText, sa, 0.75);
            } else {
              console.log(`⏭️  No match: "${questionText.substring(0, 60)}"`);
              answers[originalIndex] = skipAnswer(originalIndex, questionText);
            }
          }
        } catch (e: any) {
          console.warn("⚠️ AI classifier failed, skipping unmatched:", e.message);
          for (const { originalIndex, questionText } of unmatched)
            answers[originalIndex] = skipAnswer(originalIndex, questionText);
        }
      } else {
        for (const { originalIndex, questionText } of unmatched)
          answers[originalIndex] = skipAnswer(originalIndex, questionText);
      }
    } else {
      for (const { originalIndex, questionText } of unmatched)
        answers[originalIndex] = skipAnswer(originalIndex, questionText);
    }

    console.log("📋 Screening results:", answers.map(a => ({ q: a.question?.substring(0, 40), v: a.value, c: a.confidence })));

    return new Response(
      JSON.stringify({ success: true, answers }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error: any) {
    console.error("❌ Screening Batch Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
