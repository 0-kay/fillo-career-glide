// Pure authorization helpers for the admin API. No Deno/Node specifics so they unit-test in vitest.

export type Role = "owner" | "admin" | "viewer";

/**
 * What a route needs.
 *  read      any active admin, viewer included
 *  users     change a single user (fills, status, plan, limits, data)
 *  bulk      bulk operations
 *  platform  plans, flags, kill switch, tracking policy (owner only)
 *  admins    manage admin accounts (owner only)
 */
export type Capability = "read" | "users" | "bulk" | "platform" | "admins";

const GRANTS: Record<Role, ReadonlySet<Capability>> = {
  owner: new Set<Capability>(["read", "users", "bulk", "platform", "admins"]),
  admin: new Set<Capability>(["read", "users", "bulk"]),
  viewer: new Set<Capability>(["read"]),
};

export function can(role: string | null | undefined, cap: Capability): boolean {
  return !!role && role in GRANTS && GRANTS[role as Role].has(cap);
}

export interface TokenClaims {
  sub?: string;
  aal?: string;
  iat?: number;
  exp?: number;
  amr?: Array<{ method?: string; timestamp?: number }>;
}

/** Decodes the payload of a JWT. The signature must already have been verified (we call
 * /auth/v1/user with the token first), so this is only for reading claims. */
export function decodeClaims(token: string): TokenClaims {
  try {
    const part = token.split(".")[1];
    if (!part) return {};
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const text = typeof atob === "function"
      ? decodeURIComponent(Array.prototype.map.call(atob(b64), (c: string) =>
          "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join(""))
      : "";
    return JSON.parse(text) as TokenClaims;
  } catch {
    return {};
  }
}

export const hasMfa = (c: TokenClaims): boolean => c.aal === "aal2";

/** True when a TOTP verification is recent enough for step-up actions (default 5 minutes). */
export function recentMfa(c: TokenClaims, nowSec = Math.floor(Date.now() / 1000), windowSec = 300): boolean {
  if (!hasMfa(c)) return false;
  const stamps = (c.amr ?? [])
    .filter((a) => a.method === "totp" && typeof a.timestamp === "number")
    .map((a) => a.timestamp as number);
  return stamps.some((t) => nowSec - t <= windowSec && t <= nowSec + 60);
}

/** Empty allowlist means "no restriction". Entries are exact IPs. */
export function ipAllowed(ip: string | null, allowlist: string | undefined): boolean {
  const list = (allowlist ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return true;
  return !!ip && list.includes(ip);
}

export function clientIp(headers: { get(name: string): string | null }): string | null {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim() || null;
  return headers.get("cf-connecting-ip") ?? headers.get("x-real-ip");
}

/** Fixed-window limiter, per isolate. Bounds a single admin's burst; not a global quota. */
export function makeRateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string, now = Date.now()): boolean => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    return true;
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);

/** Keeps only the origins in the comma-separated allowlist; "*" (or unset) allows any. */
export function corsOrigin(origin: string | null, allowlist: string | undefined): string | null {
  const list = (allowlist ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0 || list.includes("*")) return origin ?? "*";
  return origin && list.includes(origin) ? origin : null;
}
