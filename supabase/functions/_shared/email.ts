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

export async function send(to: string | string[], subject: string, html: string, replyTo?: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
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

/** Only ever link to our own domains (or localhost for dev), whatever the client sends. */
export function safeSiteUrl(host: string): string {
  const h = host.toLowerCase().split(":")[0];
  if (h === "localhost") return `http://${host}`;
  if (h === "fylloai.com" || h.endsWith(".fylloai.com")) return `https://${host}`;
  return "https://www.fylloai.com";
}

const PURPLE = "#8A2BE2";
const FONT = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";

export function welcomeHtml(first: string | undefined, site: string) {
  const dash = `${site}/dashboard`;
  const field = (label: string, value: string) =>
    `<td width="50%" style="padding:4px"><div style="border:1px solid #DCCBF3;border-radius:10px;background:#fff;padding:9px 12px"><div style="font-size:11px;color:#6C6577">${label}</div><div style="font-size:14px;color:#171321">${value}</div></div></td>`;
  const step = (n: string, title: string, body: string, href?: string, last = false) =>
    `<tr><td style="padding:14px 0;${last ? "" : "border-bottom:1px solid #EEE9F5;"}"><table cellpadding="0" cellspacing="0"><tr>
<td valign="top" width="41" style="font-size:14px;font-weight:700;color:${PURPLE};padding-top:1px">${n}</td>
<td><div style="font-size:16px;font-weight:600;color:#171321">${href ? `<a href="${esc(href)}" style="color:#171321;text-decoration:none">${title} &rarr;</a>` : title}</div>
<div style="font-size:14px;line-height:1.5;color:#6C6577;padding-top:3px">${body}</div></td></tr></table></td></tr>`;

  return `<!doctype html><html><body style="margin:0;background:#F6F4FB;font-family:${FONT};color:#171321">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 0 18px 4px"><table cellpadding="0" cellspacing="0"><tr>
<td style="background:${PURPLE};color:#fff;font-weight:700;font-size:15px;width:30px;height:30px;text-align:center;border-radius:8px">F</td>
<td style="padding-left:10px;font-size:18px;font-weight:600">Fyllo</td></tr></table></td></tr>
<tr><td style="background:#fff;border-radius:22px;padding:36px 34px">
<div style="font-size:15px;color:#6C6577;padding-bottom:14px">${first ? `Hi ${esc(first)},` : "Hi there,"}</div>
<div style="font-size:32px;line-height:1.1;font-weight:700;letter-spacing:-0.02em;padding-bottom:16px">You won't have to type your r&eacute;sum&eacute; into a form again.</div>
<div style="font-size:16px;line-height:1.6;color:#6C6577;padding-bottom:28px">Your account is ready. Give Fyllo about five minutes and your next application goes from twenty minutes of typing to one click.</div>

<table width="100%" cellpadding="0" cellspacing="0" style="background:#F3EEFB;border-radius:16px"><tr><td style="padding:18px">
<table width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font-size:12px;color:#6C6577;padding:0 4px 10px">jobs.greenhouse.io &middot; Senior Product Designer</td>
<td align="right" style="font-size:12px;font-weight:600;color:${PURPLE};padding:0 4px 10px">&#10003; 11 of 11 filled</td></tr></table>
<table width="100%" cellpadding="0" cellspacing="0"><tr>${field("First name", "Alexandra")}${field("Email", "alex.chen@gmail.com")}</tr>
<tr>${field("R&eacute;sum&eacute;", "Alexandra_Chen_Resume.pdf")}${field("Need sponsorship?", "No")}</tr></table>
</td></tr></table>

<div style="font-size:18px;font-weight:700;padding:32px 0 6px">Three steps to your first one-click application</div>
<table width="100%" cellpadding="0" cellspacing="0">
${step("01", "Upload your r&eacute;sum&eacute;", "Fyllo turns it into a profile: contact details, links, experience, education.", dash)}
${step("02", "Add the Chrome extension", "It connects to your account on its own. No extra login.", dash)}
${step("03", "Open a job application and press Fill", "Works on Workday, Greenhouse, Lever, iCIMS, Ashby and more. You review, you submit.", undefined, true)}
</table>

<table cellpadding="0" cellspacing="0" style="margin-top:26px"><tr><td style="background:${PURPLE};border-radius:999px"><a href="${esc(dash)}" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:600;color:#fff;text-decoration:none">Set up my profile</a></td></tr></table>
<div style="font-size:13px;color:#6C6577;padding:12px 0 30px">Takes about 5 minutes. Free plan includes 5 autofills a month.</div>

<table width="100%" cellpadding="0" cellspacing="0" style="background:#171321;border-radius:16px"><tr><td style="padding:24px">
<div style="font-size:11px;font-weight:700;letter-spacing:.1em;color:#C9A6F2">APPLYING TO A LOT OF ROLES?</div>
<div style="font-size:22px;font-weight:700;color:#fff;padding:8px 0 10px">Pro takes the limits off.</div>
<div style="font-size:14px;line-height:1.6;color:#BEB6CB;padding-bottom:18px">Unlimited autofills, a separate profile for each kind of role, full AI help on screening questions, and priority support.</div>
<table cellpadding="0" cellspacing="0"><tr>
<td style="background:#fff;border-radius:999px"><a href="${esc(site)}/pricing" style="display:inline-block;padding:11px 22px;font-size:14px;font-weight:600;color:#171321;text-decoration:none">See Pro &middot; $9/month</a></td>
<td style="padding-left:14px;font-size:13px;color:#BEB6CB">or $90/year, 2 months free</td></tr></table>
</td></tr></table>

<div style="font-size:15px;line-height:1.6;color:#6C6577;padding:28px 0 16px">If a form doesn't fill the way you expected, just reply to this email. It comes straight to me, and I read every one.</div>
<div style="font-size:15px;font-weight:600">Kayode</div>
<div style="font-size:13px;color:#6C6577">Founder, Fyllo</div>
</td></tr>
<tr><td style="padding:24px 8px 0;font-size:12px;line-height:1.6;color:#6C6577">
Fyllo only fills a form when you press Fill, and your data is never sold.<br>
You're getting this because you created a Fyllo account with this address. If that wasn't you, you can ignore this email.<br><br>
Fyllo &middot; <a href="https://fylloai.com" style="color:#6C6577">fylloai.com</a> &middot; <a href="${esc(site)}/privacy" style="color:#6C6577">Privacy</a>
</td></tr></table></td></tr></table></body></html>`;
}

export async function sendWelcome(u: { email: string; name?: string; siteUrl: string }) {
  const first = u.name?.trim().split(" ")[0];
  await send(u.email, "Welcome to Fyllo: your next application takes one click", welcomeHtml(first, u.siteUrl), "kayode@fylloai.com");
}
