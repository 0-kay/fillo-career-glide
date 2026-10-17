// Account-activity emails (Pro activated/ended, résumé ready/failed). Same look as the
// welcome and confirm emails: logo header, white rounded card, greeting, big headline,
// purple pill button, tinted "what next" box, quiet footer. Pure functions: no I/O.
import { esc, FONT, LOGO, PURPLE } from "./email-theme.ts";

export interface LifecycleEmail { subject: string; html: string }

interface Shell {
  first?: string;
  headline: string;
  intro: string; // trusted HTML (callers escape dynamic parts)
  button: { label: string; href: string };
  note?: string; // small text under the button
  box?: { title: string; steps: [string, string][] }; // trusted HTML per step
  site: string;
}

function shell(o: Shell): string {
  const step = ([n, text]: [string, string]) =>
    `<tr><td valign="top" width="36" style="font-size:13px;font-weight:700;color:${PURPLE};padding:7px 0">${n}</td><td style="font-size:15px;line-height:1.45;color:#171321;padding:6px 0">${text}</td></tr>`;
  return `<!doctype html><html><body style="margin:0;background:#F6F4FB;font-family:${FONT};color:#171321">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 0 18px 4px"><table cellpadding="0" cellspacing="0"><tr>
<td><img src="${LOGO}" width="30" height="30" alt="" style="display:block;border:0;border-radius:7px"></td>
<td style="padding-left:10px;font-size:18px;font-weight:600">Fyllo</td></tr></table></td></tr>
<tr><td style="background:#fff;border-radius:22px;padding:36px 34px">
<div style="font-size:15px;color:#6C6577;padding-bottom:14px">${o.first ? `Hi ${esc(o.first)},` : "Hi there,"}</div>
<div style="font-size:32px;line-height:1.1;font-weight:700;letter-spacing:-0.02em;padding-bottom:16px">${o.headline}</div>
<div style="font-size:16px;line-height:1.6;color:#6C6577;padding-bottom:26px">${o.intro}</div>
<table cellpadding="0" cellspacing="0"><tr><td style="background:${PURPLE};border-radius:999px"><a href="${esc(o.button.href)}" style="display:inline-block;padding:15px 30px;font-size:16px;font-weight:600;color:#fff;text-decoration:none">${o.button.label}</a></td></tr></table>
<div style="font-size:13px;color:#6C6577;padding:12px 0 ${o.box ? 28 : 6}px">${o.note ?? ""}</div>
${o.box ? `<table width="100%" cellpadding="0" cellspacing="0" style="background:#F3EEFB;border-radius:16px"><tr><td style="padding:22px">
<div style="font-size:16px;font-weight:700;padding-bottom:8px">${o.box.title}</div>
<table cellpadding="0" cellspacing="0" width="100%">${o.box.steps.map(step).join("")}</table>
</td></tr></table>` : ""}
<div style="font-size:15px;line-height:1.6;color:#6C6577;padding:26px 0 0">Questions? Just reply to this email. It comes straight to me.</div>
<div style="font-size:15px;font-weight:600;padding-top:14px">Kayode</div>
<div style="font-size:13px;color:#6C6577">Founder, Fyllo</div>
</td></tr>
<tr><td style="padding:24px 8px 0;font-size:12px;line-height:1.6;color:#6C6577">
You're getting this because of activity on your Fyllo account.<br><br>
Fyllo &middot; <a href="https://fylloai.com" style="color:#6C6577">fylloai.com</a> &middot; <a href="${esc(o.site)}/privacy" style="color:#6C6577">Privacy</a>
</td></tr></table></td></tr></table></body></html>`;
}

export function proActivatedEmail(p: { first?: string; site: string; source: "payment" | "admin" }): LifecycleEmail {
  const intro = p.source === "payment"
    ? "Thanks for subscribing. Your payment went through and Pro is switched on, so there are no more limits on what you can fill."
    : "Your account has been upgraded to Pro. Pro is switched on now, so there are no more limits on what you can fill.";
  return {
    subject: "You're on Fyllo Pro",
    html: shell({
      first: p.first,
      site: p.site,
      headline: "You're on Fyllo Pro.",
      intro: `${intro} Unlimited autofills, a separate profile for each kind of role, and full AI help on screening questions.`,
      button: { label: "Open your dashboard", href: `${p.site}/dashboard` },
      note: p.source === "payment" ? "You can manage or cancel anytime from Plans &amp; billing." : undefined,
      box: {
        title: "Make the most of Pro",
        steps: [
          ["01", "Add a profile for each kind of role you apply to."],
          ["02", "Answer the screening questions once. Fyllo reuses them everywhere."],
          ["03", "Open any application and press Fill."],
        ],
      },
    }),
  };
}

export function proEndedEmail(p: { first?: string; site: string }): LifecycleEmail {
  return {
    subject: "Your Fyllo Pro plan has ended",
    html: shell({
      first: p.first,
      site: p.site,
      headline: "Your Pro plan has ended.",
      intro: "You're back on the Free plan: 5 autofills a month and one profile. Your profiles and screening answers are still saved, and you can bring Pro back whenever you like.",
      button: { label: "See Pro", href: `${p.site}/pricing` },
      note: "Pro is $9 a month or $90 a year.",
    }),
  };
}

export interface ResumeReadyData {
  profileName: string;
  completeness: number;
  jobs: number;
  degrees: number;
  skills: number;
  ready: boolean; // completeness has reached the fill threshold
}

export function resumeReadyEmail(p: { first?: string; site: string } & ResumeReadyData): LifecycleEmail {
  const facts = [
    p.jobs > 0 && `${p.jobs} job${p.jobs === 1 ? "" : "s"}`,
    p.degrees > 0 && `${p.degrees} degree${p.degrees === 1 ? "" : "s"}`,
    p.skills > 0 && `${p.skills} skill${p.skills === 1 ? "" : "s"}`,
  ].filter(Boolean) as string[];
  const found = facts.length ? ` We found ${facts.join(", ")}.` : "";
  const name = `<strong>${esc(p.profileName)}</strong>`;
  return {
    subject: p.ready ? "Your résumé is ready to fill with" : "Your résumé is read. A little more detail needed",
    html: shell({
      first: p.first,
      site: p.site,
      headline: p.ready ? "Your résumé is ready." : "Your résumé is read.",
      intro: p.ready
        ? `Fyllo finished reading your r&eacute;sum&eacute; and built the ${name} profile, ${p.completeness}% complete.${found} Give it a quick look, then you're set to fill.`
        : `Fyllo finished reading your r&eacute;sum&eacute; and built the ${name} profile, ${p.completeness}% complete.${found} It needs to reach 75% before Fyllo can fill with it. Adding the details below gets it there.`,
      button: { label: p.ready ? "Review your profile" : "Finish your profile", href: `${p.site}/dashboard` },
      box: {
        title: p.ready ? "Before your first fill" : "What helps most",
        steps: [
          ["01", "Check your contact details and work history are right."],
          ["02", "Answer the common screening questions once. It also raises your completeness."],
          ["03", "Add the Chrome extension, open an application and press Fill."],
        ],
      },
    }),
  };
}

export function resumeFailedEmail(p: { first?: string; site: string; reason?: string }): LifecycleEmail {
  const scanned = !!p.reason && /readable text|scanned/i.test(p.reason);
  return {
    subject: "We couldn't read your résumé",
    html: shell({
      first: p.first,
      site: p.site,
      headline: "We couldn't read your r&eacute;sum&eacute;.",
      intro: scanned
        ? "The file looks like a scan or an image, so there was no text for Fyllo to read. A PDF or Word file exported straight from your editor will work."
        : "Something went wrong while Fyllo was reading it. Your file is safe, and trying again usually fixes it.",
      button: { label: "Try again", href: `${p.site}/dashboard` },
      note: "From your dashboard you can retry, upload a different file, or fill the profile in by hand.",
    }),
  };
}
