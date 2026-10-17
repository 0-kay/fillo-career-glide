import { buildResumeUserPrompt, RESUME_SYSTEM_PROMPT } from "./prompt.ts";

/** One model call, hard-capped so a stalled request fails (and retries) instead of hanging. */
export async function parseResumeWithOpenAI(apiKey: string, text: string, fileName: string, timeoutMs = 120_000) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 4000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: RESUME_SYSTEM_PROMPT },
        { role: "user", content: buildResumeUserPrompt(text, fileName) },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`OpenAI error: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const content = String(data.choices?.[0]?.message?.content ?? "").replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(content);
  if (!parsed || typeof parsed !== "object") throw new Error("Model returned no JSON object");
  return parsed as Record<string, unknown>;
}
