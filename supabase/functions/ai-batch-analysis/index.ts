import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getFieldVariationsForOneField } from "../_shared/field-variations.ts";
import { resolveProvider, withComparison } from "../_shared/typesafe/client.ts";
import { analyzeFields, type FieldInput, type FieldResult } from "../_shared/typesafe/fields.ts";
import { requireUser } from "../_shared/typesafe/auth.ts";
import { fail, json, preflight } from "../_shared/typesafe/http.ts";
import { legacyAnalyzeFields } from "../_shared/typesafe/legacy.ts";
import { systemOne } from "../_shared/typesafe/runtime.deno.ts";
import { getUserPlan } from "../_shared/billing.ts";

// Free plan gets a capped number of fields per AI-fallback call, not zero — enough to
// be useful, not enough to replace Pro. Everything past the cap is left unanalyzed;
// the caller's rule-based fill already ran on all fields before this is ever reached.
const FREE_PLAN_FIELD_CAP = 5;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    const body = await req.json();
    const { profileData, fieldVariations = {} } = body;
    let fields = body.fields ?? [];
    const provider = resolveProvider();
    const totalRequested = Array.isArray(fields) ? fields.length : 0;

    let capped = false;
    if (Array.isArray(fields) && fields.length > FREE_PLAN_FIELD_CAP) {
      const plan = await getUserPlan(auth.id);
      if (plan !== "pro") {
        fields = fields.slice(0, FREE_PLAN_FIELD_CAP);
        capped = true;
      }
    }

    console.log("🧠 Batch field analysis:", { fields: fields.length, totalRequested, capped, provider });

    if (!Array.isArray(fields) || fields.length === 0) {
      return json({ success: true, results: [], debug: { totalFields: 0 } });
    }

    const variations: Record<number, string[]> = {};
    fields.forEach((f: Parameters<typeof getFieldVariationsForOneField>[0], i: number) => {
      variations[i] = getFieldVariationsForOneField(f, fieldVariations);
    });

    if (provider === "openai") {
      const results = await legacyAnalyzeFields(fields, profileData);
      return json({ success: true, results, debug: { provider: "openai", capped, totalRequested } });
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

    return json({
      success: true,
      results: outcome.results,
      debug: { ...outcome.debug, capped, totalRequested },
    });
  } catch (error) {
    console.error("❌ Batch AI Field Analysis Error:", error);
    return fail(error, { results: [] });
  }
});
