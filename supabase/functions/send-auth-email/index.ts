import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import { confirmHtml, esc, layout, notifySignup, send } from "../_shared/email.ts";

/**
 * Supabase "Send Email" auth hook. Replaces Supabase's generic emails with Fyllo-branded ones
 * (sent through Resend) and emails the owner whenever a new account is created.
 *
 * Secrets: RESEND_API_KEY, SEND_EMAIL_HOOK_SECRET (the "v1,whsec_…" value Supabase shows when
 * you enable the hook), and optionally MAIL_FROM / NOTIFY_EMAIL.
 */

type Payload = {
  user: { id: string; email: string; user_metadata?: { full_name?: string } };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
  };
};

function build(p: Payload) {
  const { user, email_data: e } = p;
  const name = user.user_metadata?.full_name?.split(" ")[0];
  const hi = name ? `Hi ${esc(name)},` : "Hi,";
  const params = new URLSearchParams({ token: e.token_hash, type: e.email_action_type, redirect_to: e.redirect_to });
  const link = `${Deno.env.get("SUPABASE_URL")}/auth/v1/verify?${params}`;

  switch (e.email_action_type) {
    case "signup":
      return {
        subject: "Confirm your email to start using Fyllo",
        html: confirmHtml(name, link),
      };
    case "recovery":
      return {
        subject: "Reset your Fyllo password",
        html: layout("Reset your password", `${hi}<br>Click below to choose a new password.`, { label: "Reset password", href: link }),
      };
    case "magiclink":
      return {
        subject: "Your Fyllo sign-in link",
        html: layout("Sign in to Fyllo", `${hi}<br>Click below to sign in.`, { label: "Sign in", href: link }),
      };
    case "invite":
      return {
        subject: "You're invited to Fyllo",
        html: layout("You're invited", `${hi}<br>Accept your invitation to join Fyllo.`, { label: "Accept invite", href: link }),
      };
    case "email_change":
      return {
        subject: "Confirm your new email for Fyllo",
        html: layout("Confirm your new email", `${hi}<br>Confirm this address to finish changing your Fyllo email.`, { label: "Confirm email", href: link }),
      };
    default:
      return {
        subject: "Your Fyllo verification code",
        html: layout("Your verification code", `${hi}<br>Your code is <strong style="font-size:20px;letter-spacing:2px">${esc(e.token)}</strong>.`),
      };
  }
}

serve(async (req: Request) => {
  const raw = await req.text();
  const secret = (Deno.env.get("SEND_EMAIL_HOOK_SECRET") ?? "").replace("v1,whsec_", "");
  let payload: Payload;
  try {
    payload = new Webhook(secret).verify(raw, Object.fromEntries(req.headers)) as Payload;
  } catch {
    return new Response(JSON.stringify({ error: { http_code: 401, message: "Invalid signature" } }), { status: 401 });
  }

  try {
    const { subject, html } = build(payload);
    await send(payload.user.email, subject, html);
  } catch (err) {
    console.error("send-auth-email failed", err);
    return new Response(JSON.stringify({ error: { http_code: 500, message: String(err) } }), { status: 500 });
  }

  // Tell the owner about new signups. Never let this block the user's own email.
  if (payload.email_data.email_action_type === "signup") {
    try {
      let domain = "unknown";
      try { domain = new URL(payload.email_data.redirect_to).host; } catch { /* keep default */ }
      const u = payload.user;
      await notifySignup({ email: u.email, name: u.user_metadata?.full_name, domain, provider: "email" });
    } catch (err) {
      console.error("signup notification failed", err);
    }
  }

  return new Response(JSON.stringify({}), { headers: { "Content-Type": "application/json" } });
});
