import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getFieldVariationsForOneField } from "../_shared/field-variations.ts";
import { resolveProvider } from "../_shared/typesafe/client.ts";
import { analyzeSingleField } from "../_shared/typesafe/fields.ts";
import { requireUser } from "../_shared/typesafe/auth.ts";
import { fail, json, preflight } from "../_shared/typesafe/http.ts";
import { legacyAnalyzeFields } from "../_shared/typesafe/legacy.ts";
import { systemOne } from "../_shared/typesafe/runtime.deno.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    const { fieldInfo, profileData, fieldVariations = {} } = await req.json();
    const provider = resolveProvider();

    console.log("🧠 Field analysis:", { field: fieldInfo?.name, provider });

    if (provider === "openai") {
      const [result] = await legacyAnalyzeFields([fieldInfo], profileData);
      return json({ success: true, analysis: result });
    }

    const variations = getFieldVariationsForOneField(fieldInfo, fieldVariations);
    const outcome = await analyzeSingleField(systemOne, fieldInfo, profileData, variations);
    const analysis = outcome.results[0];

    console.log("🧠 Field analysis result:", analysis);

    return json({
      success: true,
      analysis,
      debug: {
        provider: "typesafe",
        model: outcome.model,
        usage: outcome.usage,
        candidates: outcome.candidateCount,
        fieldVariations: variations,
      },
    });
  } catch (error) {
    console.error("❌ AI Field Analysis Error:", error);
    return fail(error);
  }
});
