import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireUser } from "../_shared/typesafe/auth.ts";
import { fail, json, preflight } from "../_shared/typesafe/http.ts";
import { getServiceClient } from "../_shared/stripe/supabase.ts";
import { notifySignup } from "../_shared/email.ts";

/**
 * Emails the owner about a new Google/Apple signup. Those skip the confirmation email, so
 * the send-auth-email hook never sees them. The client calls this after the OAuth redirect
 * with the user's own session; a metadata flag makes it fire at most once per user.
 * POST { domain } with the caller's Supabase session token.
 */
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    const { domain } = await req.json().catch(() => ({ domain: "unknown" }));
    const db = getServiceClient();
    const { data, error } = await db.auth.admin.getUserById(auth.id);
    if (error || !data.user) throw error ?? new Error("User not found");
    const u = data.user;

    const provider = u.app_metadata?.provider ?? "email";
    const fresh = Date.now() - new Date(u.created_at).getTime() < 10 * 60_000;
    if (provider === "email" || u.user_metadata?.signup_notified || !fresh) {
      return json({ success: true, notified: false });
    }

    // Set the flag first so a retry or double-tab can't send twice.
    await db.auth.admin.updateUserById(u.id, { user_metadata: { ...u.user_metadata, signup_notified: true } });
    await notifySignup({
      email: u.email ?? "(no email)",
      name: u.user_metadata?.full_name ?? u.user_metadata?.name,
      domain: String(domain).slice(0, 100),
      provider,
    });
    return json({ success: true, notified: true });
  } catch (e) {
    console.error("notify-signup failed", e);
    return fail(e);
  }
});
