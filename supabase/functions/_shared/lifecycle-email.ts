// Sends account-activity emails exactly once per event. The claim row in email_log is
// inserted first (unique on user + kind + key), so webhook retries, double-clicks and
// re-runs can't send twice; if the send itself fails the claim is released for a retry.
// Email problems must never break the action that triggered them, so this never throws.
import {
  proActivatedEmail, proEndedEmail, resumeFailedEmail, resumeReadyEmail,
  type LifecycleEmail, type ResumeReadyData,
} from "./email-lifecycle-templates.ts";

export type LifecycleEvent =
  | { kind: "pro_activated"; source: "payment" | "admin" }
  | { kind: "pro_ended" }
  | ({ kind: "resume_ready" } & ResumeReadyData)
  | { kind: "resume_failed"; reason?: string };

// deno-lint-ignore no-explicit-any
type Db = any;

function build(event: LifecycleEvent, first: string | undefined, site: string): LifecycleEmail {
  const base = { first, site };
  switch (event.kind) {
    case "pro_activated": return proActivatedEmail({ ...base, source: event.source });
    case "pro_ended": return proEndedEmail(base);
    case "resume_ready": return resumeReadyEmail({ ...base, ...event });
    case "resume_failed": return resumeFailedEmail({ ...base, reason: event.reason });
  }
}

export async function sendLifecycleEmail(db: Db, userId: string, dedupeKey: string, event: LifecycleEvent): Promise<boolean> {
  try {
    const { data, error } = await db.auth.admin.getUserById(userId);
    const user = data?.user;
    if (error || !user?.email) return false;

    const claim = await db.from("email_log").insert({ user_id: userId, kind: event.kind, dedupe_key: dedupeKey });
    if (claim.error) {
      // 23505 = already sent for this key. Anything else (e.g. table missing) also skips: better silent than a duplicate.
      if (claim.error.code !== "23505") console.error("email_log insert failed", claim.error.message);
      return false;
    }

    const meta = user.user_metadata ?? {};
    const first = String(meta.full_name ?? meta.name ?? "").trim().split(" ")[0] || undefined;
    // Loaded lazily: email.ts reads Deno env at import time, and callers (e.g. the admin
    // API module, which is unit-tested under Node) shouldn't pay for that unless they send.
    const { send, safeSiteUrl } = await import("./email.ts");
    const mail = build(event, first, safeSiteUrl(Deno.env.get("SITE_HOST") ?? "www.fylloai.com"));
    try {
      await send(user.email, mail.subject, mail.html, "kayode@fylloai.com");
      return true;
    } catch (e) {
      await db.from("email_log").delete().eq("user_id", userId).eq("kind", event.kind).eq("dedupe_key", dedupeKey);
      throw e;
    }
  } catch (e) {
    console.error(`lifecycle email ${event.kind} failed`, e);
    return false;
  }
}
