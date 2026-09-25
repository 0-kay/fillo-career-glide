import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

/**
 * Supabase "Send Email" auth hook. Replaces Supabase's generic emails with Fyllo-branded ones
 * (sent through Resend) and emails the owner whenever a new account is created.
 *
 * Secrets: RESEND_API_KEY, SEND_EMAIL_HOOK_SECRET (the "v1,whsec_…" value Supabase shows when
 * you enable the hook), and optionally MAIL_FROM / NOTIFY_EMAIL.
 */

const BRAND = "#4B0082";
const FROM = Deno.env.get("MAIL_FROM") ?? "Fyllo <kayode@fylloai.com>";
const NOTIFY = (Deno.env.get("NOTIFY_EMAIL") ?? "ojedelekayode21@gmail.com,kayode@fylloai.com").split(",").map((e) => e.trim());

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

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function layout(title: string, body: string, button?: { label: string; href: string }) {
  return `<!doctype html><html><body style="margin:0;background:#F6F4F9;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a2e">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:16px;padding:36px">
<tr><td style="font-size:22px;font-weight:700;color:${BRAND};padding-bottom:24px">Fyllo</td></tr>
<tr><td style="font-size:20px;font-weight:600;padding-bottom:12px">${esc(title)}</td></tr>
<tr><td style="font-size:15px;line-height:1.6;color:#444;padding-bottom:24px">${body}</td></tr>
${button ? `<tr><td style="padding-bottom:24px"><a href="${esc(button.href)}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:10px">${esc(button.label)}</a></td></tr>` : ""}
<tr><td style="font-size:12px;color:#888;border-top:1px solid #eee;padding-top:16px">If you didn't request this, you can ignore this email.<br>Fyllo · fylloai.com</td></tr>
</table></td></tr></table></body></html>`;
}

function build(p: Payload) {
  const { user, email_data: e } = p;
  const name = user.user_metadata?.full_name?.split(" ")[0];
  const hi = name ? `Hi ${esc(name)},` : "Hi,";
  const params = new URLSearchParams({ token: e.token_hash, type: e.email_action_type, redirect_to: e.redirect_to });
  const link = `${Deno.env.get("SUPABASE_URL")}/auth/v1/verify?${params}`;

  switch (e.email_action_type) {
    case "signup":
      return {
        subject: "Confirm your Fyllo account",
        html: layout("Welcome to Fyllo", `${hi}<br>Confirm your email to finish creating your account. Then you can set up your profile and start filling applications in seconds.`, { label: "Confirm email", href: link }),
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

async function send(to: string | string[], subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
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
      await send(
        NOTIFY,
        `New Fyllo signup: ${u.email}`,
        layout("New signup", `<strong>${esc(u.user_metadata?.full_name ?? "(no name)")}</strong><br>${esc(u.email)}<br>Signed up on ${esc(domain)}<br>${new Date().toUTCString()}`),
      );
    } catch (err) {
      console.error("signup notification failed", err);
    }
  }

  return new Response(JSON.stringify({}), { headers: { "Content-Type": "application/json" } });
});
