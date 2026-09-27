import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireUser } from "../_shared/typesafe/auth.ts";
import { fail, json, preflight } from "../_shared/typesafe/http.ts";
import { recordOutcomes, recordOutcomesBySignature } from "../_shared/formfill/store.ts";

const OUTCOMES = new Set(["success", "override", "missing"]);
const MAX_ITEMS = 200;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    // Each outcome names its mapping by id (cache hits) or by signature (rows the model just
    // learned, which the client has no id for; resolved against `url`).
    const { url, outcomes } = await req.json();
    if (!Array.isArray(outcomes)) return json({ success: false, error: "outcomes required" }, 400);

    const valid = outcomes.filter((o) => o && OUTCOMES.has(o.outcome)).slice(0, MAX_ITEMS);
    const byId = valid.filter((o) => typeof o.id === "string").map((o) => ({ id: o.id, outcome: o.outcome }));
    const bySig = valid
      .filter((o) => typeof o.id !== "string" && typeof o.signature === "string")
      .map((o) => ({ signature: o.signature, outcome: o.outcome }));

    await recordOutcomes(byId);
    if (typeof url === "string") await recordOutcomesBySignature(url, bySig);
    return json({ success: true, recorded: byId.length + bySig.length });
  } catch (error) {
    console.error("❌ report-fill-outcome error:", error);
    return fail(error);
  }
});
