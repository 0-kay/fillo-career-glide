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

/**
 * Verifies the caller's Supabase user JWT. The public anon key is a valid `apikey` but
 * not a user session, so it fails here — that is the point: these endpoints spend model
 * quota and must not be callable by anyone holding the extension's bundled key.
 *
 * Returns the user, or a ready-to-send 401/429/500 Response.
 */
export async function requireUser(req: Request): Promise<{ id: string } | Response> {
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
    return { id: user.id as string };
  } catch (e) {
    console.error("requireUser: auth check failed", e);
    return json({ success: false, error: "Unauthorized" }, 401);
  }
}
