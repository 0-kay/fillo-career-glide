// The pre-TypeSafe OpenAI implementations, kept so AI_PROVIDER=ab can diff the two
// paths on live traffic. Uses global fetch only, so it runs under Deno and Node alike.

import { readEnv } from "./client.ts";
import type { FieldInput, FieldResult } from "./fields.ts";
import type { OptionMatch } from "./options.ts";
import type { ScreeningAnswer, UnmatchedQuestion } from "./screening.ts";

async function chat(prompt: string, model: string, maxTokens: number): Promise<string> {
  const apiKey = readEnv("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.1,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`);
  const data = await res.json();
  return String(data.choices?.[0]?.message?.content ?? "");
}

function parseJson(raw: string): unknown {
  const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  return JSON.parse(cleaned);
}

export async function legacyMatchOption(
  targetValue: string,
  options: string[],
): Promise<OptionMatch> {
  const prompt = `
You are an expert form-filling AI assistant. Your task is to match the user's intended value against a strict list of available dropdown options on a webpage.

USER'S INTENDED VALUE (from database):
"${targetValue}"

AVAILABLE DROPDOWN OPTIONS:
${JSON.stringify(options, null, 2)}

INSTRUCTIONS:
1. Find the single best semantic match from the available options.
2. Consider abbreviations, acronyms, and common aliases (e.g., "B.Sc." = "Bachelor of Science", "CA" = "California").
3. If no option is a reasonable match, return null.

RESPONSE FORMAT (JSON ONLY):
{ "matchedOptionIndex": 5, "confidence": 95, "reasoning": "..." }
`;
  const parsed = parseJson(await chat(prompt, "gpt-3.5-turbo", 150)) as {
    matchedOptionIndex?: number | null;
    confidence?: number;
    reasoning?: string;
  };
  const index =
    typeof parsed.matchedOptionIndex === "number" &&
    parsed.matchedOptionIndex >= 0 &&
    parsed.matchedOptionIndex < options.length
      ? parsed.matchedOptionIndex
      : null;
  return {
    matchedOptionIndex: index,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    reasoning: parsed.reasoning ?? "legacy openai",
    source: "openai",
  };
}

export async function legacyAnalyzeFields(
  fields: FieldInput[],
  profile: unknown,
): Promise<FieldResult[]> {
  const list = fields
    .map(
      (f, i) => `
FIELD #${i}:
- Name: "${f.name}"
- ID: "${f.id}"
- Type: "${f.type}"
- Placeholder: "${f.placeholder}"
- Label: "${f.label}"
- Required: ${f.required}
- Max Length: ${f.maxLength}`,
    )
    .join("\n");

  const prompt = `
You are an expert form-filling AI assistant. Analyze ALL these form fields at once and determine what profile data should fill each field.

COMPLETE PROFILE DATA AVAILABLE:
${JSON.stringify(profile, null, 2)}

FORM FIELDS TO ANALYZE:
${list}

Only fill fields with confidence >= 65. Never invent data. Never fill passwords or payment info.

RESPONSE FORMAT (JSON ARRAY ONLY):
[{ "fieldIndex": 0, "shouldFill": true, "value": "...", "confidence": 85, "reasoning": "...", "dataPath": "...", "fieldType": "..." }]
`;
  const parsed = parseJson(await chat(prompt, "gpt-3.5-turbo", 1500));
  if (!Array.isArray(parsed)) throw new Error("AI response must be an array");

  return fields.map((_, i) => {
    const r = parsed[i] as Record<string, unknown> | undefined;
    const confidence = typeof r?.confidence === "number" ? r.confidence : 0;
    return {
      fieldIndex: i,
      shouldFill: Boolean(r?.shouldFill) && confidence >= 65,
      value: (r?.value as string) ?? null,
      confidence,
      reasoning: String(r?.reasoning ?? "legacy openai"),
      dataPath: (r?.dataPath as string) ?? null,
      fieldType: String(r?.fieldType ?? "unknown"),
      source: "openai",
    };
  });
}

export async function legacyClassifyScreening(
  unmatched: UnmatchedQuestion[],
  savedAnswers: ScreeningAnswer[],
): Promise<Map<number, number>> {
  const savedList = savedAnswers.map((sa, i) => `${i}: "${sa.question}"`).join("\n");
  const questionList = unmatched.map((u, i) => `${i}: "${u.questionText}"`).join("\n");

  const prompt = `You are matching job application questions to a list of pre-saved screening answers.
For each question below, return the index of the best matching saved answer, or -1 if none applies.

SAVED ANSWERS:
${savedList}

QUESTIONS TO CLASSIFY (return one number per line, in order):
${questionList}

Output ONLY a JSON array of integers, e.g. [2, -1, 0]`;

  const raw = (await chat(prompt, "gpt-4o-mini", 100)).trim();
  const match = raw.match(/\[[\s\S]*?\]/);
  const indices: number[] = JSON.parse(match ? match[0] : raw);

  const out = new Map<number, number>();
  unmatched.forEach((u, pos) => {
    const idx = indices[pos];
    if (typeof idx === "number" && idx >= 0 && idx < savedAnswers.length) {
      out.set(u.originalIndex, idx);
    }
  });
  return out;
}
