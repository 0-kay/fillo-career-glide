import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { requireUser } from "../_shared/typesafe/auth.ts";
import { fail, json, preflight } from "../_shared/typesafe/http.ts";
import { getServiceClient } from "../_shared/stripe/supabase.ts";
import { notifySignup, safeSiteUrl, sendWelcome } from "../_shared/email.ts";

/**
 * Sends a new user their welcome email (with a dashboard link) and, for Google/Apple signups,
 * tells the owner too. Those skip the confirmation email, so the send-auth-email hook never
 * sees them. The client calls this after sign-in with the user's own session; metadata flags
 * make each email fire at most once per user.
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
    const meta = u.user_metadata ?? {};
    // Google/Apple accounts are new when created; email accounts count from when they confirm.
    const since = provider === "email" ? u.email_confirmed_at ?? u.created_at : u.created_at;
    const fresh = Date.now() - new Date(since).getTime() < 10 * 60_000;
    const needsWelcome = !meta.welcome_sent && fresh;
    const needsOwnerNote = provider !== "email" && !meta.signup_notified && fresh;
    if (!needsWelcome && !needsOwnerNote) return json({ success: true, notified: false });

    // Set the flags first so a retry or double-tab can't send twice.
    await db.auth.admin.updateUserById(u.id, {
      user_metadata: { ...meta, welcome_sent: true, ...(needsOwnerNote ? { signup_notified: true } : {}) },
    });

    const name = meta.full_name ?? meta.name;
    const host = String(domain).slice(0, 100);
    if (needsWelcome && u.email) await sendWelcome({ email: u.email, name, siteUrl: safeSiteUrl(host) });
    if (needsOwnerNote) {
      await notifySignup({ email: u.email ?? "(no email)", name, domain: host, provider });
    }
    return json({ success: true, notified: true });
  } catch (e) {
    console.error("notify-signup failed", e);
    return fail(e);
  }
});
