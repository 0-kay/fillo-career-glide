import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
};

// =============== Utilities ===============
function toStringArray(val) {
    if (!val) return [];
    const s = String(val);
    return s.trim() ? s.trim().split(/\s+/) : [];
}

// Robust extractor for legacy chat/completions fallback
function extractJSONArray(raw) {
    if (typeof raw !== "string") throw new Error("Invalid AI response type");
    let text = raw.replace(/^🧠\s*Raw AI Response:\s*/i, "").trim();

    // Unquote if entire content is a single quoted JSON string
    if ((text.startsWith('"') && text.endsWith('"')) || /^"\s*[\s\S]*\s*"$/.test(text)) {
        try {
            text = JSON.parse(text);
        } catch {}
    }

    // Remove code fences
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) text = fenced[1];

    const start = text.indexOf("[");
    if (start === -1) throw new Error("No JSON array found in AI response");

    const end = findMatchingArrayBracket(text, start);
    if (end === -1) throw new Error("AI response appears truncated (unterminated array)");

    const slice = text.slice(start, end + 1);
    const parsed = JSON.parse(slice);
    if (!Array.isArray(parsed)) throw new Error("AI response must be a JSON array");

    return parsed;
}

function findMatchingArrayBracket(s, startIdx) {
    let depth = 0, inStr = false, quote = null, esc = false;
    for (let i = startIdx; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
            if (esc) {
                esc = false;
                continue;
            }
            if (ch === "\\") {
                esc = true;
                continue;
            }
            if (ch === quote) {
                inStr = false;
                quote = null;
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            inStr = true;
            quote = ch;
            continue;
        }
        if (ch === "[") depth++;
        else if (ch === "]") {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

// =============== OpenAI callers ===============
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

// Strict JSON schema for one result item
const resultItemSchema = {
    type: "object",
    required: ["fieldIndex", "shouldFill", "value", "confidence", "reasoning", "dataPath", "fieldType"],
    additionalProperties: false,
    properties: {
        fieldIndex: { type: "integer" },
        shouldFill: { type: "boolean" },
        value: { type: ["string", "number", "boolean", "null"] },
        confidence: { type: "number" },
        reasoning: { type: "string" },
        dataPath: { type: ["string", "null"] },
        fieldType: { type: "string" }
    }
};

// Try modern Responses API with strict schema (OBJECT root w/ `fields` array)
async function callOpenAIResponses(openaiApiKey, model, prompt) {
    const body = {
        model,
        temperature: 0.1,
        max_output_tokens: 4096,
        input: [{
            role: "user",
            content: [{ type: "input_text", text: prompt }]
        }],
        text: {
            format: {
                type: "json_schema",
                name: "FieldBatch",
                strict: true,
                schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        fields: {
                            type: "array",
                            items: resultItemSchema
                        }
                    },
                    required: ["fields"]
                }
            }
        }
    };

    const resp = await fetch(OPENAI_RESPONSES_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${openaiApiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        throw new Error(`OpenAI Responses API error: ${resp.status} ${resp.statusText}${errText ? ` - ${errText}` : ""}`);
    }

    const data = await resp.json();
    const raw = data?.output_text ?? data?.output?.[0]?.content?.find(p => p?.type === "output_text")?.text ?? "";
    if (!raw) throw new Error("Empty structured output from Responses API");

    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!obj || !Array.isArray(obj.fields)) {
        throw new Error("Structured output missing 'fields' array");
    }

    return obj.fields;
}

// Legacy fallback: chat/completions + extractor
async function callOpenAIChat(openaiApiKey, model, prompt) {
    const resp = await fetch(OPENAI_CHAT_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${openaiApiKey}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 4096,
            temperature: 0.1
        })
    });

    if (!resp.ok) throw new Error(`OpenAI Chat API error: ${resp.status} ${resp.statusText}`);

    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content ?? "";
    console.log("🧠 Raw AI Response:", raw);

    return extractJSONArray(raw);
}

// =============== Prompt builder ===============
function buildPrompt(profileData, fields, allFieldVariations, baseIndex, pastMisses = []) {
    const fieldsAnalysis = fields.map((field, i) => {
        const idx = baseIndex + i;
        return `
FIELD #${idx}:
- Name: "${field?.name ?? ""}"
- ID: "${field?.id ?? ""}"
- Type: "${field?.type ?? ""}"
- Placeholder: "${field?.placeholder ?? ""}"
- Label: "${field?.label ?? ""}"
- CSS Classes: "${field?.className ?? ""}"
- Context: "${field?.context ?? ""}"
- Required: ${Boolean(field?.required)}
- Max Length: ${typeof field?.maxLength === "number" ? field.maxLength : "none"}
- Known Variations: ${allFieldVariations.get(idx)?.join(", ") || "none"}
`;
    }).join("\n");

    const intelligence = pastMisses.length > 0
        ? `\nPROFILE INTELLIGENCE / LESSONS LEARNED (Previous failed fill attempts):
${pastMisses.map((m: any) => `- Failed on: ${m.page_url}\n  Advice: ${m.ai_suggestion}`).join('\n')}\n`
        : '';

    return `
You are an expert form-filling AI assistant. Analyze ALL these form fields at once and determine what profile data should fill each field.

Return a JSON **array** ONLY. The array MUST have exactly one object per field listed below, in ascending "fieldIndex". Do not add or skip items. No prose.

COMPLETE PROFILE DATA AVAILABLE:
${JSON.stringify(profileData ?? {}, null, 2)}
${intelligence}
FORM FIELDS TO ANALYZE:
${fieldsAnalysis}

INTELLIGENT MATCHING RULES:
1. Analyze field semantics, not just exact name matches
2. Consider context clues from labels, placeholders, and surrounding text
3. Handle variations like "firstName" vs "first_name" vs "fname"
4. Support text, email, phone, dates, booleans, arrays
5. Dates may be MM/DD/YYYY or YYYY-MM-DD
6. For arrays, use first item or a sensible aggregate
7. ONLY fill fields with confidence >= 60%
8. CLOSING THE LOOP: Use "LESSONS LEARNED" section. If a field is similar to a previously missed one and profile data still lacks the recommended info, LEAVE IT BLANK. If advice was followed and data is present, FILL IT.

RESPONSE FORMAT (JSON ARRAY ONLY):
[
  {
    "fieldIndex": ${baseIndex},
    "shouldFill": true,
    "value": "exact value to fill",
    "confidence": 85,
    "reasoning": "short explanation",
    "dataPath": "path.to.data.used",
    "fieldType": "detected field type"
  }
  // ... one per field, up to fieldIndex ${baseIndex + fields.length - 1}
]

CRITICAL GUIDELINES:
- Return exactly one result per field in order (fieldIndex ${baseIndex}..${baseIndex + fields.length - 1})
- Use true/false for checkboxes
- Use clean numeric values for numbers
- Never fill passwords/payment data
- JSON array ONLY (no backticks, no code fences, no extra text)
`;
}

// =============== Main Serve ===============
serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        const { fields, profileData, mappingConfig = [], fieldVariations = {}, pastMisses = [] } = await req.json();

        console.log("🧠 Batch AI Field Analysis Request:", {
            fieldsCount: Array.isArray(fields) ? fields.length : 0,
            fieldNames: Array.isArray(fields) ? fields.map(f => f?.name || f?.id || "unnamed") : [],
            mappingCount: Array.isArray(mappingConfig) ? mappingConfig.length : 0,
            variationKeys: Object.keys(fieldVariations || {}).slice(0, 10),
            pastMissesCount: pastMisses.length
        });

        const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
        if (!openaiApiKey) throw new Error("OpenAI API key not configured");

        const modelPrimary = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";
        const modelFallback = Deno.env.get("OPENAI_FALLBACK_MODEL") || "gpt-4o-mini";

        // Build variations index
        const getFieldVariationsForAll = (fieldsArr) => {
            const allVariations = new Map();
            (fieldsArr || []).forEach((fieldInfo, index) => {
                const variations = new Set();
                const searchTerms = [
                    fieldInfo?.name,
                    fieldInfo?.id,
                    fieldInfo?.placeholder,
                    fieldInfo?.label,
                    ...toStringArray(fieldInfo?.className)
                ].filter(Boolean).map(t => String(t).toLowerCase());

                for (const [_key, value] of Object.entries(fieldVariations || {})) {
                    if (Array.isArray(value)) {
                        const loVals = value.map(v => String(v).toLowerCase());
                        if (searchTerms.some(term => loVals.some(v => v.includes(term) || term.includes(v)))) {
                            value.forEach(v => variations.add(String(v)));
                        }
                    } else if (value && typeof value === "object") {
                        for (const [_subKey, subValue] of Object.entries(value)) {
                            if (Array.isArray(subValue)) {
                                const loVals = subValue.map(v => String(v).toLowerCase());
                                if (searchTerms.some(term => loVals.some(v => v.includes(term) || term.includes(v)))) {
                                    subValue.forEach(v => variations.add(String(v)));
                                }
                            }
                        }
                    }
                }
                allVariations.set(index, Array.from(variations));
            });
            return allVariations;
        };

        const allFieldVariations = getFieldVariationsForAll(fields || []);

        // ========== ANALYSIS STRATEGY ==========
        async function analyzeChunk(baseIndex, slice) {
            const prompt = buildPrompt(profileData, slice, allFieldVariations, baseIndex, pastMisses);

            // Try Responses API (2 attempts)
            for (let attempt = 1; attempt <= 2; attempt++) {
                try {
                    const r = await callOpenAIResponses(openaiApiKey, modelPrimary, prompt);
                    return r;
                } catch (e) {
                    console.warn(`Responses API attempt ${attempt} failed:`, e?.message || e);
                }
            }

            // Fallback: chat/completions (2 attempts)
            for (let attempt = 1; attempt <= 2; attempt++) {
                try {
                    const r = await callOpenAIChat(openaiApiKey, modelFallback, prompt);
                    return r;
                } catch (e) {
                    console.warn(`Chat API attempt ${attempt} failed:`, e?.message || e);
                }
            }

            throw new Error("All OpenAI attempts failed for this chunk");
        }

        async function analyzeAll(fieldsArr) {
            const N = fieldsArr.length;
            const batchSize = Number(Deno.env.get("AI_BATCH_SIZE") || 15);

            if (N <= batchSize) {
                return await analyzeChunk(0, fieldsArr);
            }

            const merged = new Array(N);
            let start = 0;

            while (start < N) {
                const end = Math.min(start + batchSize, N);
                const slice = fieldsArr.slice(start, end);
                const chunkResults = await analyzeChunk(start, slice);

                for (const item of chunkResults) {
                    if (typeof item?.fieldIndex === "number" && item.fieldIndex >= 0 && item.fieldIndex < N) {
                        merged[item.fieldIndex] = item;
                    }
                }
                start = end;
            }

            // Fill missing indices
            for (let i = 0; i < N; i++) {
                if (!merged[i]) {
                    merged[i] = {
                        fieldIndex: i,
                        shouldFill: false,
                        value: null,
                        confidence: 0,
                        reasoning: "No result returned (filled by default)",
                        dataPath: null,
                        fieldType: "unknown"
                    };
                }
            }

            return merged;
        }

        console.log("🧠 Sending analysis with", (fields || []).length, "fields");
        const aiResults = await analyzeAll(fields || []);

        if (!Array.isArray(aiResults)) throw new Error("AI response must be an array");

        if (aiResults.length !== (fields || []).length) {
            console.warn("⚠️ AI response length mismatch:", {
                expected: (fields || []).length,
                received: aiResults.length
            });
        }

        // ====== Validate & sanitize ======
        const sanitizedResults = aiResults.map((result, index) => {
            const field = fields?.[index];
            if (!field || !result || typeof result !== "object") return null;

            const confidence = typeof result.confidence === "number" ? result.confidence : 0;
            let sanitizedValue = result.value;

            if (result.shouldFill && confidence >= 60) {
                const ftype = String(field.type || "text").toLowerCase();

                if (ftype === "email") {
                    if (!(typeof sanitizedValue === "string" && sanitizedValue.includes("@"))) {
                        console.warn(`⚠️ Invalid email for field #${index}:`, sanitizedValue);
                        return null;
                    }
                } else if (ftype === "tel") {
                    sanitizedValue = String(sanitizedValue ?? "").replace(/[^\d+\-\(\)\s]/g, "");
                } else if (ftype === "number") {
                    const numValue = Number(sanitizedValue);
                    if (Number.isNaN(numValue)) {
                        console.warn(`⚠️ Non-numeric value for number field #${index}:`, sanitizedValue);
                        return null;
                    }
                    sanitizedValue = numValue;
                } else if (ftype === "checkbox" || ftype === "radio") {
                    sanitizedValue = sanitizedValue === true || sanitizedValue === "true" || sanitizedValue === 1;
                } else {
                    sanitizedValue = String(sanitizedValue ?? "");
                }
            }

            return {
                fieldIndex: index,
                shouldFill: Boolean(result.shouldFill && confidence >= 60),
                value: sanitizedValue,
                confidence,
                reasoning: result.reasoning || "AI batch analysis",
                dataPath: result.dataPath ?? null,
                fieldType: result.fieldType ?? "unknown",
                source: "batch_ai"
            };
        }).filter(Boolean);

        console.log("🧠 Batch AI Analysis Results:", {
            totalFields: (fields || []).length,
            processedResults: sanitizedResults.length,
            fieldsToFill: sanitizedResults.filter(r => r && r.shouldFill).length,
            averageConfidence: sanitizedResults.length > 0
                ? sanitizedResults.reduce((sum, r) => sum + (r?.confidence || 0), 0) / sanitizedResults.length
                : 0
        });

        return new Response(JSON.stringify({
            success: true,
            results: sanitizedResults
        }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200
        });

    } catch (error) {
        console.error("❌ Batch AI Field Analysis Error:", error);
        return new Response(JSON.stringify({
            success: false,
            error: String(error?.message || error),
            results: []
        }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500
        });
    }
});