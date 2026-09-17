import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { readEnv } from "../_shared/typesafe/client.ts";
import { fail, json, preflight } from "../_shared/typesafe/http.ts";
import { triageMissedFields } from "../_shared/typesafe/missed.ts";
import { systemOne } from "../_shared/typesafe/runtime.deno.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();

  try {
    const supabaseClient = createClient(
      readEnv("SUPABASE_URL") ?? "",
      readEnv("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
    );

    const { missedFields = [], profileId, profileData, pageUrl } = await req.json();

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) throw new Error("Unauthorized");

    if (!Array.isArray(missedFields) || missedFields.length === 0) {
      return json({ success: true, isDuplicate: false, suggestion: null });
    }

    console.log(`🧠 Triaging ${missedFields.length} missed fields for user ${user.id}`);

    const { suggestion, model, usage } = await triageMissedFields(
      systemOne,
      missedFields,
      profileData,
    );

    console.log("🧠 Triage result:", { suggestion, model, usage });

    const fieldSignature = `${suggestion.category}_${suggestion.targetPath ?? "unknown"}`;

    const { data: existing } = await supabaseClient
      .from("missed_fields")
      .select("id, status, created_at")
      .eq("profile_id", profileId)
      .eq("field_signature", fieldSignature)
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1);

    if (existing && existing.length > 0) {
      const prior = existing[0];

      if (prior.status === "resolved") {
        console.log("✅ Similar suggestion already resolved, skipping");
        return json({ success: true, isDuplicate: true, message: "Similar suggestion already resolved" });
      }

      if (prior.status === "pending") {
        await supabaseClient
          .from("missed_fields")
          .update({ created_at: new Date().toISOString() })
          .eq("id", prior.id);
        console.log("🔄 Updated timestamp on existing pending suggestion");
        return json({ success: true, isDuplicate: true, updated: true });
      }
    }

    const { error: dbError, data: inserted } = await supabaseClient
      .from("missed_fields")
      .insert({
        user_id: user.id,
        profile_id: profileId,
        field_data: missedFields,
        page_url: pageUrl,
        ai_suggestion: suggestion.suggestion,
        status: "pending",
        field_category: suggestion.category,
        priority: suggestion.priority,
        suggested_action: {
          targetPath: suggestion.targetPath,
          missingDataType: suggestion.missingDataType,
          exampleValue: suggestion.exampleValue,
          confidence: suggestion.confidence,
        },
        field_signature: fieldSignature,
      })
      .select()
      .single();

    if (dbError) throw dbError;

    console.log("✅ Created new suggestion:", inserted.id);

    return json({ success: true, suggestion, isDuplicate: false, id: inserted.id });
  } catch (error) {
    console.error("❌ AI Missed Fields Analysis Error:", error);
    return fail(error);
  }
});
