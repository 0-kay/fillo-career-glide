// Shared by the auth email hook and the OAuth signup notifier.

export const BRAND = "#4B0082";
export const FROM = Deno.env.get("MAIL_FROM") ?? "Fyllo <kayode@fylloai.com>";
export const NOTIFY = (Deno.env.get("NOTIFY_EMAIL") ?? "ojedelekayode21@gmail.com,kayode@fylloai.com").split(",").map((e) => e.trim());

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function layout(title: string, body: string, button?: { label: string; href: string }) {
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

export async function send(to: string | string[], subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}


export async function notifySignup(u: { email: string; name?: string; domain: string; provider: string }) {
  await send(
    NOTIFY,
    `New Fyllo signup: ${u.email}`,
    layout("New signup", `<strong>${esc(u.name || "(no name)")}</strong><br>${esc(u.email)}<br>Via ${esc(u.provider)} on ${esc(u.domain)}<br>${new Date().toUTCString()}`),
  );
}
