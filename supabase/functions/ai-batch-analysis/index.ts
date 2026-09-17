import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getFieldVariationsForOneField } from "../_shared/field-variations.ts";
import { resolveProvider, withComparison } from "../_shared/typesafe/client.ts";
import { analyzeFields, type FieldInput, type FieldResult } from "../_shared/typesafe/fields.ts";
import { fail, json, preflight } from "../_shared/typesafe/http.ts";
import { legacyAnalyzeFields } from "../_shared/typesafe/legacy.ts";
import { systemOne } from "../_shared/typesafe/runtime.deno.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();

  try {
    const { fields = [], profileData, fieldVariations = {} } = await req.json();
    const provider = resolveProvider();

    console.log("🧠 Batch field analysis:", { fields: fields.length, provider });

    if (!Array.isArray(fields) || fields.length === 0) {
      return json({ success: true, results: [], debug: { totalFields: 0 } });
    }

    const variations: Record<number, string[]> = {};
    fields.forEach((f: Parameters<typeof getFieldVariationsForOneField>[0], i: number) => {
      variations[i] = getFieldVariationsForOneField(f, fieldVariations);
    });

    if (provider === "openai") {
      const results = await legacyAnalyzeFields(fields, profileData);
      return json({ success: true, results, debug: { provider: "openai" } });
    }

    const outcome = await withComparison<{
      results: FieldResult[];
      debug: Record<string, unknown>;
    }>(
      provider,
      "batch-analysis",
      async () => {
        const r = await analyzeFields(systemOne, fields, profileData, { variations });
        return {
          results: r.results,
          debug: {
            provider: "typesafe",
            model: r.model,
            usage: r.usage,
            candidates: r.candidateCount,
            questions: r.questionCount,
            totalFields: fields.length,
            fieldsToFill: r.results.filter((x) => x.shouldFill).length,
          },
        };
      },
      async () => ({
        results: await legacyAnalyzeFields(fields, profileData),
        debug: { provider: "openai" },
      }),
      (v) => v.results.map((r) => (r.shouldFill ? r.value : null)),
    );

    for (const r of outcome.results) {
      const name = (fields[r.fieldIndex] as FieldInput)?.name ?? "unnamed";
      console.log(
        r.shouldFill
          ? `🧠 ✅ #${r.fieldIndex} (${name}): "${r.value}" (${r.confidence}%) ← ${r.dataPath}`
          : `🧠 ❌ #${r.fieldIndex} (${name}): ${r.reasoning} (${r.confidence}%)`,
      );
    }

    return json({ success: true, results: outcome.results, debug: outcome.debug });
  } catch (error) {
    console.error("❌ Batch AI Field Analysis Error:", error);
    return fail(error, { results: [] });
  }
});
