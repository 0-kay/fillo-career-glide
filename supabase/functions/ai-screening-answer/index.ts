import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function cleanOptions(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(
        value
          .map((o: unknown) => String(o ?? "").replace(/\s+/g, " ").trim())
          .filter(Boolean)
      ))
    : [];
}

function normalizeIntent(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .trim();
}

serve(async (req: any) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const { questions: rawQuestions, profileData: screeningAnswers } = await req.json();
    const questions = Array.isArray(rawQuestions)
      ? rawQuestions.map((q: any) => ({
          questionText: String(q?.questionText ?? q?.question ?? "").trim(),
          elementType: String(q?.elementType ?? q?.type ?? "unknown").trim() || "unknown",
          pageOptions: cleanOptions(q?.pageOptions ?? q?.options),
          screeningOptions: cleanOptions(q?.screeningOptions),
          options: cleanOptions([
            ...cleanOptions(q?.pageOptions ?? q?.options),
            ...cleanOptions(q?.screeningOptions),
          ]),
        })).filter((q: any) => q.questionText)
      : [];

    if (!Array.isArray(questions) || questions.length === 0) {
      return new Response(
        JSON.stringify({ success: true, answers: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    console.log("🧠 AI Screening Batch Request:", {
      count: questions.length,
      questions: questions.map((q: any) => ({
        questionText: q.questionText,
        elementType: q.elementType,
        pageOptionsCount: q.pageOptions.length,
        screeningOptionsCount: q.screeningOptions.length,
      })),
    });

    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiApiKey) throw new Error("OpenAI API key not configured");

    // Build one clearly-labelled block per question so the model can't conflate them
    const questionBlocks = questions.map((q: any, i: number) => {
      const hasScreeningOptions = Array.isArray(q.screeningOptions) && q.screeningOptions.length > 0;
      const screeningOptionLines = hasScreeningOptions
        ? `\n  Saved screening options (context for the applicant's saved answer):\n${q.screeningOptions.map((o: string, j: number) => `    ${j + 1}. "${o}"`).join("\n")}`
        : "";
      return `--- QUESTION ${i} ---\nText: "${q.questionText}"\nInput type: ${q.elementType}${screeningOptionLines}`;
    }).join("\n\n");

    const systemPrompt = `You are filling out job application screening questions on behalf of an applicant.
You will receive a numbered list of questions and the applicant's profile data.
You MUST produce one answer per question — each answer is INDEPENDENT of the others.
Never reuse the same answer across different questions unless the questions are truly identical.

DEFAULTS (use when the profile is silent on a topic):
- Legally authorized to work in the US → Yes (authorized)
- Need visa sponsorship now or in future → No
- Willing to undergo background check → Yes
- At least 18 years old → Yes
- Subject to non-compete or non-solicitation → No
- Current or former government employee → No
- Citizen of export-controlled / sanctioned country → No
- Have a disability → "No, I do not have a disability and have not had one in the past"
- Veteran status → "I am not a protected veteran"
- Race / ethnicity → use profile if available, else "Opt Out"
- Gender → use profile if available, else the "prefer not to answer" option

CANONICAL INTENTS:
- work_authorization
- visa_sponsorship
- background_check
- age_18_or_older
- non_compete
- government_employee
- export_control
- additional_citizenship
- disability_status
- veteran_status
- race_ethnicity
- gender
- education_level
- salary_expectation
- referral_source
- general_text

CANONICAL VALUES:
- yes
- no
- decline
- no_disability
- has_disability
- not_protected_veteran
- protected_veteran
- opt_out
- male
- female
- non_binary
- other
- custom_text

RULES:
1. Read each question's text carefully — it is different from the others.
2. Match each question to the most semantically relevant stored screening answer and use that answer value.
3. Return a normalized intent and value. The browser extension will map that value to the page option locally.
4. For yes/no-style questions, use value "yes" or "no".
5. For disability questions, use "no_disability", "has_disability", or "decline".
6. For veteran questions, use "not_protected_veteran", "protected_veteran", or "decline".
7. For race/ethnicity and gender, use profile if available; otherwise use "opt_out" or "decline".
8. For free-text questions, set value to "custom_text" and answerText to the short text to fill.
9. Fall back to the defaults above only when no stored screening answer is relevant to the question.
10. Assign confidence 0–100. If confidence < 60, set value and answerText to null.

Return ONLY a JSON array — no explanation, no markdown, no code fences:
[{"index":0,"question":"exact question text","intent":"work_authorization","value":"yes","answerText":"Yes","confidence":90},{"index":1,"question":"exact question text","intent":"visa_sponsorship","value":"no","answerText":"No","confidence":85},...]`;

    const userPrompt = `APPLICANT SCREENING ANSWERS (use these as your source of truth):
${JSON.stringify(screeningAnswers, null, 2)}

QUESTIONS TO ANSWER:
${questionBlocks}

Return a JSON array with ${questions.length} entries (index 0 through ${questions.length - 1}).`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 800,
        temperature: 0,
      }),
    });

    if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);

    const data = await response.json();
    let aiAnswers: any[];
    try {
      const content = data.choices[0].message.content.trim();
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      aiAnswers = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch (e) {
      throw new Error("Invalid AI response format");
    }

    if (!Array.isArray(aiAnswers) || aiAnswers.length !== questions.length) {
      throw new Error(`Expected ${questions.length} answers, got ${aiAnswers?.length ?? 0}`);
    }

    const answers = aiAnswers.map((a: any, fallbackIndex: number) => {
      const index = typeof a.index === "number" ? a.index : fallbackIndex;
      const confidence = typeof a.confidence === "number" ? a.confidence : 0;
      const rawIntent = normalizeIntent(a.intent);
      const rawValue = normalizeIntent(a.value);
      const intent = confidence >= 60 && rawIntent ? rawIntent : null;
      const value = confidence >= 60 && rawValue ? rawValue : null;
      const answerText = confidence >= 60 && a.answerText != null
        ? String(a.answerText).trim()
        : (confidence >= 60 && a.answer != null ? String(a.answer).trim() : null);
      const question = questions[index];

      return {
        index,
        question: a.question ?? question?.questionText ?? null,
        intent,
        value,
        answerText,
        answer: answerText ?? (value ? String(value).replace(/_/g, " ") : null),
        confidence,
      };
    });

    console.log("🧠 AI Screening Batch Result:", answers);

    return new Response(
      JSON.stringify({ success: true, answers }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error: any) {
    console.error("❌ AI Screening Batch Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
