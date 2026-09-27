import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireUser } from "../_shared/typesafe/auth.ts";
import { fail, json, preflight } from "../_shared/typesafe/http.ts";
import { systemOne } from "../_shared/typesafe/runtime.deno.ts";
import { analyzeFields } from "../_shared/typesafe/fields.ts";
import { getFieldVariationsForOneField } from "../_shared/field-variations.ts";
import { getUserPlan } from "../_shared/billing.ts";
import { type FieldDescriptor, formFingerprint, hostOf } from "../_shared/formfill/signature.ts";
import { learnedFromModel, type PlanEntry, planFromCache } from "../_shared/formfill/resolve.ts";
import { type LearnedMapping, loadMappings, loadProfile, saveLearned } from "../_shared/formfill/store.ts";

// Same cap as ai-batch-analysis: cache hits are free and unlimited, model calls are the metered part.
const FREE_PLAN_MODEL_FIELD_CAP = 5;
const MAX_FIELDS = 120;
const MIN_LEARN_CONFIDENCE = 70;

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

    const profile = await loadProfile(auth.id, profileId);
    if (!profile) return json({ success: false, error: "Profile not found" }, 404);

    const rows = await loadMappings(url);
    const cache = planFromCache(descriptors, rows, profile);
    const entries: PlanEntry[] = [...cache.entries];

    let modelFields = cache.unresolved;
    let capped = false;
    if (modelFields.length > FREE_PLAN_MODEL_FIELD_CAP && (await getUserPlan(auth.id)) !== "pro") {
      modelFields = modelFields.slice(0, FREE_PLAN_MODEL_FIELD_CAP);
      capped = true;
    }

    const learned: LearnedMapping[] = [];
    if (modelFields.length > 0) {
      const subset = modelFields.map((i) => descriptors[i]);
      const variations: Record<number, string[]> = {};
      subset.forEach((f, i) => (variations[i] = getFieldVariationsForOneField(f as never, {})));

      const outcome = await analyzeFields(systemOne, subset, profile, { variations });
      for (const r of outcome.results) {
        if (!r.shouldFill || r.value == null) continue;
        const index = modelFields[r.fieldIndex];
        const item = learnedFromModel(descriptors[index], r, cache.demoted.get(index), MIN_LEARN_CONFIDENCE);
        entries.push({
          fieldIndex: index,
          value: r.value,
          mappingId: null,
          signature: item.signature,
          source: "llm",
          confidence: r.confidence,
          dataPath: r.dataPath,
        });
        if (item.learn) learned.push(item.learn);
      }
    }

    const wait = background(saveLearned(url, rows[0]?.platform ?? null, learned));
    if (wait) await wait;

    return json({
      success: true,
      plan: entries.sort((a, b) => a.fieldIndex - b.fieldIndex),
      debug: {
        host: hostOf(url),
        fingerprint: formFingerprint(descriptors),
        fields: descriptors.length,
        fromCache: cache.entries.length,
        fromModel: entries.length - cache.entries.length,
        learned: learned.length,
        capped,
      },
    });
  } catch (error) {
    console.error("❌ resolve-form-fill error:", error);
    return fail(error, { plan: [] });
  }
});
