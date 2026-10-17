import { readEnv } from "./client.ts";
import { json } from "./http.ts";

const WINDOW_MS = 60_000;
const MAX_CALLS_PER_WINDOW = 60;

// Best-effort, per-isolate. It bounds a single user's burst; it is not a global quota.
const calls = new Map<string, number[]>();

function rateLimited(userId: string, now = Date.now()): boolean {
  const recent = (calls.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_CALLS_PER_WINDOW) {
    calls.set(userId, recent);
    return true;
  }
  recent.push(now);
  calls.set(userId, recent);
  return false;
}

export type EntitlementGate = "none" | "revoked" | "fill";

const GATE_TTL_MS = 10_000;
const gateCache = new Map<string, { at: number; status: Record<string, unknown> }>();

/**
 * Server-side entitlement enforcement: the extension is untrusted, so endpoints that do the
 * work of a fill re-check the user's entitlement here. Fails open if the lookup itself fails
 * (an entitlement-service outage must not take fills down for everyone).
 */
async function entitlementGate(userId: string, gate: EntitlementGate): Promise<Response | null> {
  if (gate === "none") return null;
  const url = readEnv("SUPABASE_URL");
  const serviceKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return null;

  let status = gateCache.get(userId);
  if (!status || Date.now() - status.at > GATE_TTL_MS) {
    try {
      const res = await fetch(`${url}/rest/v1/rpc/entitlement_status`, {
        method: "POST",
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_user: userId }),
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return null;
      status = { at: Date.now(), status: await res.json() };
      gateCache.set(userId, status);
    } catch (e) {
      console.warn("entitlementGate: lookup failed, failing open", e);
      return null;
    }
  }

  const s = status.status;
  const blocked = s.status === "REVOKED" || (gate === "fill" && s.allowed === false);
  if (!blocked) return null;
  return json({
    success: false,
    error: String(s.message || "Your access has been paused. Contact support."),
    code: s.reason ?? "blocked",
  }, 403);
}

/**
 * Verifies the caller's Supabase user JWT. The public anon key is a valid `apikey` but
 * not a user session, so it fails here — that is the point: these endpoints spend model
 * quota and must not be callable by anyone holding the extension's bundled key.
 *
 * `opts.gate` picks the entitlement check: "revoked" (default) rejects removed users,
 * "fill" also rejects suspended users, the kill switch and users with no fills left, and
 * "none" skips it (billing and sign-up endpoints must stay reachable).
 *
 * Returns the user, or a ready-to-send 401/403/429/500 Response.
 */
export async function requireUser(
  req: Request,
  opts: { gate?: EntitlementGate } = {},
): Promise<{ id: string } | Response> {
  const url = readEnv("SUPABASE_URL");
  const anonKey = readEnv("SUPABASE_ANON_KEY");
  if (!url || !anonKey) {
    console.error("requireUser: SUPABASE_URL / SUPABASE_ANON_KEY not set");
    return json({ success: false, error: "Auth is not configured" }, 500);
  }

  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return json({ success: false, error: "Unauthorized" }, 401);

  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey },
    });
    if (!res.ok) return json({ success: false, error: "Unauthorized" }, 401);
    const user = await res.json();
    if (!user?.id) return json({ success: false, error: "Unauthorized" }, 401);
    if (rateLimited(user.id)) return json({ success: false, error: "Too many requests" }, 429);
    const blocked = await entitlementGate(user.id as string, opts.gate ?? "revoked");
    if (blocked) return blocked;
    return { id: user.id as string };
  } catch (e) {
    console.error("requireUser: auth check failed", e);
    return json({ success: false, error: "Unauthorized" }, 401);
  }
}
