import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { readEnv } from "./typesafe/client.ts";

/** Looks up a user's plan ('free' | 'pro'). Defaults to 'free' on any lookup failure —
 * fail closed on entitlement, not open, but never throw and break the caller's request. */
export async function getUserPlan(userId: string): Promise<"free" | "pro"> {
  try {
    const db = createClient(
      readEnv("SUPABASE_URL") ?? "",
      readEnv("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const { data, error } = await db.from("profiles").select("plan").eq("id", userId).single();
    if (error || !data) return "free";
    return data.plan === "pro" ? "pro" : "free";
  } catch (_e) {
    return "free";
  }
}
