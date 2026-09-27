import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireUser } from "../_shared/typesafe/auth.ts";
import { fail, json, preflight } from "../_shared/typesafe/http.ts";
import { systemOne } from "../_shared/typesafe/runtime.deno.ts";
import { getUserPlan } from "../_shared/billing.ts";
import { type FieldDescriptor, formFingerprint, hostOf } from "../_shared/formfill/signature.ts";
import { buildPlan } from "../_shared/formfill/plan.ts";
import { loadMappings, loadProfile, saveLearned } from "../_shared/formfill/store.ts";

// Cache and rule hits are free and unlimited; only fields that reach the model are metered.
const FREE_PLAN_MODEL_FIELD_CAP = 5;
const MAX_FIELDS = 120;

/** Runs after the response when the runtime supports it, so learning never adds latency. */
function background(task: Promise<unknown>): Promise<unknown> | void {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  const guarded = task.catch((e) => console.error("background save failed:", e));
  if (rt?.waitUntil) rt.waitUntil(guarded);
  else return guarded;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    const { url, profileId, fields } = await req.json();
    if (typeof url !== "string" || typeof profileId !== "string" || !Array.isArray(fields)) {
      return json({ success: false, error: "url, profileId and fields are required" }, 400);
    }
    const descriptors = (fields as FieldDescriptor[]).slice(0, MAX_FIELDS);

    const [profile, rows, plan] = await Promise.all([
      loadProfile(auth.id, profileId),
      loadMappings(url),
      getUserPlan(auth.id),
    ]);
    if (!profile) return json({ success: false, error: "Profile not found" }, 404);

    const result = await buildPlan(descriptors, rows, profile, {
      systemOne,
      modelBudget: plan === "pro" ? Infinity : FREE_PLAN_MODEL_FIELD_CAP,
    });

    const wait = background(saveLearned(url, rows[0]?.platform ?? null, result.learned));
    if (wait) await wait;

    return json({
      success: true,
      plan: result.entries,
      debug: {
        host: hostOf(url),
        fingerprint: formFingerprint(descriptors),
        ...result.stats,
        learned: result.learned.length,
      },
    });
  } catch (error) {
    console.error("❌ resolve-form-fill error:", error);
    return fail(error, { plan: [] });
  }
});
