// Fyllo owner/admin API. One edge function, path-routed under /functions/v1/admin-api/*.
//
// Every request is authenticated and authorised server-side:
//   1. optional IP allowlist (ADMIN_IP_ALLOWLIST)
//   2. the bearer token must be a valid Supabase session (verified against /auth/v1/user)
//   3. the user must be an active row in admin_users (matched by user id, or by confirmed
//      email on first sign-in); extension / end-user tokens are not admins and get 403
//   4. everything except GET /me requires aal2, i.e. the session completed a TOTP challenge
//   5. the route's capability is checked against the admin's role
//   6. step-up actions (delete account, kill switch, admin management) need a TOTP
//      verification from the last 5 minutes
//
// Admin data access is metadata only: counts, plans, statuses, ledger reasons, application
// company/role. Field values, profile contents and URLs are never selected here.

import { sendLifecycleEmail } from "../_shared/lifecycle-email.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { readEnv } from "../_shared/typesafe/client.ts";
import { getServiceClient } from "../_shared/stripe/supabase.ts";
import {
  can,
  type Capability,
  clientIp,
  corsOrigin,
  decodeClaims,
  hasMfa,
  ipAllowed,
  isUuid,
  makeRateLimiter,
  recentMfa,
  type Role,
  type TokenClaims,
} from "../_shared/admin/authz.ts";
import { resolveRange } from "../_shared/admin/range.ts";
import { toCsv } from "../_shared/admin/csv.ts";
import { ApiError, fromDbError } from "../_shared/admin/errors.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

// deno-lint-ignore no-explicit-any
type Db = any;

interface AdminRow {
  id: string;
  user_id: string | null;
  email: string;
  role: Role;
  status: "active" | "disabled";
  mfa_enrolled: boolean;
  last_login_at: string | null;
}

interface Ctx {
  req: Request;
  url: URL;
  db: Db;
  admin: AdminRow;
  adminUserId: string;
  claims: TokenClaims;
  ip: string | null;
  params: string[];
  body: Record<string, unknown>;
}

interface Route {
  method: "GET" | "POST";
  pattern: RegExp;
  cap: Capability;
  /** Needs a TOTP verification from the last 5 minutes. */
  stepUp?: boolean;
  /** Allowed with a password-only (aal1) session. */
  allowAal1?: boolean;
  handler: (c: Ctx) => Promise<Response | unknown>;
}

const BULK_MAX = 500;
const ADMIN_RATE = makeRateLimiter(120, 60_000);
const PLATFORM_RATE = makeRateLimiter(10, 60_000);
const BAN_FOREVER = "876000h";

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function corsHeaders(req: Request): Record<string, string> {
  const origin = corsOrigin(req.headers.get("origin"), readEnv("ADMIN_ALLOWED_ORIGINS"));
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
  if (origin) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function respond(req: Request, body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": typeof body === "string" ? "text/csv; charset=utf-8" : "application/json",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

const ok = (data: unknown) => ({ success: true, data });

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function authenticate(req: Request, db: Db): Promise<{ admin: AdminRow; userId: string; claims: TokenClaims }> {
  const url = readEnv("SUPABASE_URL");
  const anon = readEnv("SUPABASE_ANON_KEY");
  if (!url || !anon) throw new ApiError(500, "not_configured", "Auth is not configured");

  const header = req.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new ApiError(401, "unauthorized", "Unauthorized");

  const res = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: anon } });
  if (!res.ok) throw new ApiError(401, "unauthorized", "Unauthorized");
  const user = await res.json();
  if (!user?.id) throw new ApiError(401, "unauthorized", "Unauthorized");
  const claims = decodeClaims(token);

  let { data: row } = await db.from("admin_users").select("*").eq("user_id", user.id).maybeSingle();

  if (!row && user.email && user.email_confirmed_at) {
    const email = String(user.email).toLowerCase();
    const { data: invited } = await db.from("admin_users").select("*").eq("email", email).is("user_id", null).maybeSingle();
    if (invited) {
      const { data: bound } = await db.from("admin_users").update({ user_id: user.id })
        .eq("id", invited.id).is("user_id", null).select("*").maybeSingle();
      row = bound ?? null;
    } else if (readEnv("ADMIN_BOOTSTRAP_OWNER_EMAIL")?.toLowerCase() === email) {
      // Only ever seeds the first owner; once an owner exists this path is closed.
      const { count } = await db.from("admin_users").select("id", { count: "exact", head: true }).eq("role", "owner");
      if (!count) {
        const { data: created } = await db.from("admin_users")
          .insert({ user_id: user.id, email, role: "owner" }).select("*").maybeSingle();
        row = created ?? null;
      }
    }
  }

  // Same answer for "not an admin" and "disabled" so the endpoint cannot be used to probe.
  if (!row || row.status !== "active") throw new ApiError(403, "forbidden", "Forbidden");
  return { admin: row as AdminRow, userId: user.id as string, claims };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readBody(req: Request): Promise<Record<string, unknown>> {
  if (req.method !== "POST") return {};
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 64_000) throw new ApiError(413, "too_large", "Request body too large");
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new ApiError(400, "invalid_json", "Body must be JSON");
  }
}

function reasonOf(body: Record<string, unknown>): string {
  const r = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!r) throw new ApiError(400, "reason_required", "A reason is required for this action.");
  if (r.length > 500) throw new ApiError(400, "reason_too_long", "Reason must be 500 characters or fewer.");
  return r;
}

function intOf(v: unknown, name: string, min = 0, max = 1_000_000): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw new ApiError(400, "invalid_" + name, `${name} must be a whole number between ${min} and ${max}.`);
  }
  return n;
}

function dateOf(v: unknown, name: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  const ms = typeof v === "string" ? Date.parse(v) : NaN;
  if (Number.isNaN(ms)) throw new ApiError(400, "invalid_" + name, `${name} must be an ISO date.`);
  return new Date(ms).toISOString();
}

function requireUuid(v: string): string {
  if (!isUuid(v)) throw new ApiError(400, "invalid_id", "Invalid id");
  return v;
}

async function rpc(db: Db, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    throw fromDbError(error.message) ?? new ApiError(500, "db_error", error.message);
  }
  return data;
}

function audit(c: Ctx, action: string, target: string | null, before: unknown, after: unknown, reason: string | null) {
  return rpc(c.db, "admin_audit_event", {
    p_admin: c.adminUserId, p_action: action, p_target: target, p_before: before ?? null,
    p_after: after ?? null, p_reason: reason, p_ip: c.ip,
  });
}

async function isAdminUser(db: Db, userId: string): Promise<boolean> {
  const { count } = await db.from("admin_users").select("id", { count: "exact", head: true }).eq("user_id", userId);
  return !!count;
}

/** Auth-service calls the SQL layer cannot make: ban/unban and account deletion. */
async function authAdmin(method: "PUT" | "DELETE", userId: string, body?: unknown): Promise<boolean> {
  const url = readEnv("SUPABASE_URL");
  const key = readEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return false;
  try {
    const res = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
      method,
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.ok;
  } catch (e) {
    console.error("authAdmin failed", method, e);
    return false;
  }
}

const STATUS_BY_ACTION: Record<string, "ACTIVE" | "SUSPENDED" | "REVOKED"> = {
  suspend: "SUSPENDED",
  revoke: "REVOKED",
  reinstate: "ACTIVE",
};

function userFilter(params: URLSearchParams): Record<string, string> {
  const filter: Record<string, string> = {};
  const query = params.get("query")?.trim();
  if (query) filter.query = query.slice(0, 200);
  const status = params.get("status")?.toUpperCase();
  if (status) {
    if (!["ACTIVE", "SUSPENDED", "REVOKED"].includes(status)) throw new ApiError(400, "invalid_status", "Unknown status");
    filter.status = status;
  }
  const plan = params.get("plan")?.toUpperCase();
  if (plan) filter.plan = plan.slice(0, 32);
  for (const key of ["balance_below", "inactive_days"]) {
    const v = params.get(key);
    if (v) filter[key] = String(intOf(v, key, 0, 100_000));
  }
  for (const key of ["active_from", "active_to"]) {
    const v = dateOf(params.get(key), key);
    if (v) filter[key] = v;
  }
  return filter;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const routes: Route[] = [
  // --- identity ---
  {
    method: "GET", pattern: /^\/me$/, cap: "read", allowAal1: true,
    handler: async (c) => {
      const stale = !c.admin.last_login_at || Date.now() - Date.parse(c.admin.last_login_at) > 10 * 60_000;
      const patch: Record<string, unknown> = {};
      if (stale && hasMfa(c.claims)) patch.last_login_at = new Date().toISOString();
      if (hasMfa(c.claims) && !c.admin.mfa_enrolled) patch.mfa_enrolled = true;
      if (Object.keys(patch).length) await c.db.from("admin_users").update(patch).eq("id", c.admin.id);
      return ok({
        id: c.admin.id,
        email: c.admin.email,
        role: c.admin.role,
        mfa: { verified: hasMfa(c.claims), enrolled: c.admin.mfa_enrolled || hasMfa(c.claims), recent: recentMfa(c.claims) },
      });
    },
  },

  // --- metrics ---
  {
    method: "GET", pattern: /^\/metrics\/overview$/, cap: "read",
    handler: async (c) => {
      const q = c.url.searchParams;
      let pair;
      try {
        pair = resolveRange(q.get("range"), q.get("from"), q.get("to"));
      } catch (e) {
        throw new ApiError(400, "invalid_range", (e as Error).message);
      }
      const [current, previous] = await Promise.all([
        rpc(c.db, "admin_metrics_overview", { p_from: pair.current.from, p_to: pair.current.to }),
        rpc(c.db, "admin_metrics_overview", { p_from: pair.previous.from, p_to: pair.previous.to }),
      ]);
      return ok({ current, previous });
    },
  },
  {
    method: "GET", pattern: /^\/metrics\/quality$/, cap: "read",
    handler: async (c) => ok(await rpc(c.db, "admin_metrics_quality", { p_ats: c.url.searchParams.get("ats") || null })),
  },

  // --- users ---
  {
    method: "GET", pattern: /^\/users$/, cap: "read",
    handler: async (c) => {
      const q = c.url.searchParams;
      const csv = q.get("format") === "csv";
      const limit = csv ? 5000 : intOf(q.get("limit") ?? 50, "limit", 1, 200);
      const offset = intOf(q.get("cursor") ?? 0, "cursor", 0, 10_000_000);
      const result = (await rpc(c.db, "admin_list_users", {
        p_filter: userFilter(q), p_sort: q.get("sort") ?? "signup_at", p_dir: q.get("dir") ?? "desc",
        p_limit: limit, p_offset: csv ? 0 : offset,
      })) as { total: number; rows: Array<Record<string, unknown>> };

      if (csv) {
        await audit(c, "users.export", null, null, { rows: result.rows.length, filter: userFilter(q) }, null);
        return new Response(toCsv(
          ["user_id", "email", "plan", "status", "balance", "fills_7d", "fills_all", "last_active", "applications", "signup_at"],
          result.rows), {
          status: 200,
          headers: { ...corsHeaders(c.req), "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="fyllo-users.csv"', "Cache-Control": "no-store" },
        });
      }
      const next = offset + result.rows.length;
      return ok({ ...result, next_cursor: next < result.total ? String(next) : null });
    },
  },
  {
    method: "GET", pattern: /^\/users\/([^/]+)$/, cap: "read",
    handler: async (c) => {
      const id = requireUuid(c.params[0]);
      const detail = await rpc(c.db, "admin_user_detail", { p_user: id });
      if (!detail) throw new ApiError(404, "user_not_found", "User not found.");
      await audit(c, "user.view", id, null, null, null);
      const audits = await rpc(c.db, "admin_audit_list", { p_target: id, p_limit: 50, p_offset: 0 });
      return ok({ ...(detail as object), audit: (audits as { rows: unknown[] }).rows });
    },
  },
  {
    method: "GET", pattern: /^\/users\/([^/]+)\/ledger$/, cap: "read",
    handler: async (c) => {
      const q = c.url.searchParams;
      return ok(await rpc(c.db, "admin_user_ledger", {
        p_user: requireUuid(c.params[0]),
        p_limit: intOf(q.get("limit") ?? 100, "limit", 1, 500),
        p_offset: intOf(q.get("cursor") ?? 0, "cursor", 0, 10_000_000),
      }));
    },
  },
  {
    method: "POST", pattern: /^\/users\/([^/]+)\/fills$/, cap: "users",
    handler: async (c) => {
      const op = String(c.body.op ?? "");
      if (!["grant", "remove", "set", "reset"].includes(op)) throw new ApiError(400, "invalid_op", "op must be grant, remove, set or reset");
      const reason = reasonOf(c.body);
      return ok(await rpc(c.db, "admin_adjust_fills", {
        p_admin: c.adminUserId,
        p_user: requireUuid(c.params[0]),
        p_op: op,
        p_amount: op === "reset" ? null : intOf(c.body.amount, "amount", 0, 100_000),
        p_reason: reason,
        p_expires_at: dateOf(c.body.expires_at, "expires_at"),
        p_idempotency_key: typeof c.body.idempotency_key === "string" ? c.body.idempotency_key.slice(0, 80) : null,
        p_ip: c.ip,
      }));
    },
  },
  {
    method: "POST", pattern: /^\/users\/([^/]+)\/status$/, cap: "users",
    handler: async (c) => {
      const id = requireUuid(c.params[0]);
      const action = String(c.body.action ?? "");
      const status = STATUS_BY_ACTION[action];
      if (!status) throw new ApiError(400, "invalid_action", "action must be suspend, revoke or reinstate");
      const reason = reasonOf(c.body);
      if (action === "revoke" && c.body.confirm !== true) {
        throw new ApiError(400, "confirmation_required", "Revoking access needs explicit confirmation.");
      }
      if (status !== "ACTIVE" && (await isAdminUser(c.db, id))) {
        throw new ApiError(409, "target_is_admin", "Remove this person's admin role before changing their access.");
      }
      const result = await rpc(c.db, "admin_set_status", {
        p_admin: c.adminUserId, p_user: id, p_status: status, p_reason: reason,
        p_until: status === "SUSPENDED" ? dateOf(c.body.until, "until") : null,
        p_balance: status === "ACTIVE" && c.body.balance !== undefined && c.body.balance !== null && c.body.balance !== ""
          ? intOf(c.body.balance, "balance", 0, 100_000) : null,
        p_ip: c.ip,
      });
      // Revocation also stops the Auth service from minting new tokens; reinstating lifts it.
      let banOk: boolean | null = null;
      if (status === "REVOKED") banOk = await authAdmin("PUT", id, { ban_duration: BAN_FOREVER });
      else if (status === "ACTIVE") banOk = await authAdmin("PUT", id, { ban_duration: "none" });
      return ok({ ...(result as object), auth_ban_applied: banOk });
    },
  },
  {
    method: "POST", pattern: /^\/users\/([^/]+)\/plan$/, cap: "users",
    handler: async (c) => {
      const userId = requireUuid(c.params[0]);
      const result = await rpc(c.db, "admin_set_plan", {
        p_admin: c.adminUserId, p_user: userId,
        p_plan: String(c.body.plan ?? ""), p_reason: reasonOf(c.body), p_ip: c.ip,
      }) as { plan?: string; noop?: boolean };
      if (result?.plan === "PRO" && !result.noop) {
        await sendLifecycleEmail(c.db, userId, `admin:${new Date().toISOString()}`, { kind: "pro_activated", source: "admin" });
      }
      return ok(result);
    },
  },
  {
    method: "POST", pattern: /^\/users\/([^/]+)\/limits$/, cap: "users",
    handler: async (c) => {
      const raw = (c.body.limits ?? {}) as Record<string, unknown>;
      const limits: Record<string, number | null> = {};
      for (const key of ["daily_fill_cap", "max_applications_per_day"]) {
        if (key in raw) limits[key] = raw[key] === null ? null : intOf(raw[key], key, 0, 100_000);
      }
      if (Object.keys(limits).length === 0) throw new ApiError(400, "invalid_limits", "No limits supplied.");
      return ok(await rpc(c.db, "admin_set_limits", {
        p_admin: c.adminUserId, p_user: requireUuid(c.params[0]), p_limits: limits,
        p_reason: reasonOf(c.body), p_ip: c.ip,
      }));
    },
  },
  {
    method: "POST", pattern: /^\/users\/([^/]+)\/signout$/, cap: "users",
    handler: async (c) => {
      const id = requireUuid(c.params[0]);
      await rpc(c.db, "admin_force_signout", { p_admin: c.adminUserId, p_user: id, p_reason: reasonOf(c.body), p_ip: c.ip });
      return ok({ signed_out: true });
    },
  },
  {
    method: "POST", pattern: /^\/users\/([^/]+)\/delete-activity$/, cap: "users",
    handler: async (c) => {
      if (c.body.confirm !== true) throw new ApiError(400, "confirmation_required", "Deleting activity data needs explicit confirmation.");
      return ok(await rpc(c.db, "admin_delete_activity", {
        p_admin: c.adminUserId, p_user: requireUuid(c.params[0]), p_reason: reasonOf(c.body), p_ip: c.ip,
      }));
    },
  },
  {
    method: "POST", pattern: /^\/users\/([^/]+)\/delete-account$/, cap: "users", stepUp: true,
    handler: async (c) => {
      const id = requireUuid(c.params[0]);
      const reason = reasonOf(c.body);
      if (await isAdminUser(c.db, id)) {
        throw new ApiError(409, "target_is_admin", "Remove this person's admin role before deleting their account.");
      }
      const { data: profile } = await c.db.from("profiles").select("email").eq("id", id).maybeSingle();
      if (!profile) throw new ApiError(404, "user_not_found", "User not found.");
      const typed = String(c.body.confirm ?? "").trim().toLowerCase();
      if (!typed || (typed !== String(profile.email ?? "").toLowerCase() && typed !== id)) {
        throw new ApiError(400, "confirmation_mismatch", "Type the user's email address (or id) to confirm deletion.");
      }
      // Audit first: the cascade removes the user's rows, but the audit entry has no FK.
      await audit(c, "account.delete", id, { email: profile.email }, null, reason);
      const deleted = await authAdmin("DELETE", id);
      if (!deleted) {
        await audit(c, "account.delete_failed", id, null, null, reason);
        throw new ApiError(502, "delete_failed", "The Auth service did not delete the account. Nothing was removed.");
      }
      return ok({ deleted: true });
    },
  },

  // --- bulk ---
  {
    method: "POST", pattern: /^\/bulk$/, cap: "bulk",
    handler: async (c) => startBulk(c),
  },
  {
    method: "GET", pattern: /^\/bulk$/, cap: "read",
    handler: async (c) => {
      const { data, error } = await c.db.from("bulk_jobs").select("*").order("created_at", { ascending: false }).limit(25);
      if (error) throw new ApiError(500, "db_error", error.message);
      return ok(data);
    },
  },
  {
    method: "GET", pattern: /^\/bulk\/([^/]+)$/, cap: "read",
    handler: async (c) => {
      const id = requireUuid(c.params[0]);
      const { data: job } = await c.db.from("bulk_jobs").select("*").eq("id", id).maybeSingle();
      if (!job) throw new ApiError(404, "not_found", "Bulk job not found.");
      const { data: items } = await c.db.from("bulk_job_items").select("user_id,status,error")
        .eq("job_id", id).order("status", { ascending: true }).limit(500);
      return ok({ job, items: items ?? [] });
    },
  },

  // --- platform administration ---
  {
    method: "GET", pattern: /^\/plans$/, cap: "read",
    handler: async (c) => {
      const { data, error } = await c.db.from("plans").select("*").order("name");
      if (error) throw new ApiError(500, "db_error", error.message);
      return ok(data);
    },
  },
  {
    method: "POST", pattern: /^\/plans$/, cap: "platform",
    handler: async (c) => {
      const name = String(c.body.name ?? "").trim().toUpperCase();
      if (!/^[A-Z0-9_ -]{1,32}$/.test(name)) throw new ApiError(400, "invalid_name", "Plan name must be 1-32 letters/digits.");
      const renewal = String(c.body.renewal_period ?? "none");
      if (!["none", "monthly"].includes(renewal)) throw new ApiError(400, "invalid_renewal", "renewal_period must be none or monthly.");
      const rawLimits = (c.body.limits ?? {}) as Record<string, unknown>;
      const limits: Record<string, unknown> = {};
      if ("unlimited" in rawLimits) limits.unlimited = rawLimits.unlimited === true;
      const reason = reasonOf(c.body);
      const next = {
        name,
        default_fills: intOf(c.body.default_fills ?? 0, "default_fills", 0, 1_000_000),
        renewal_period: renewal,
        limits,
        active: c.body.active !== false,
        updated_at: new Date().toISOString(),
      };
      const { data: before } = await c.db.from("plans").select("*").eq("name", name).maybeSingle();
      const { error } = await c.db.from("plans").upsert(next, { onConflict: "name" });
      if (error) throw new ApiError(500, "db_error", error.message);
      await audit(c, before ? "plan.update" : "plan.create", null, before ?? null, next, reason);
      return ok(next);
    },
  },
  {
    method: "GET", pattern: /^\/flags$/, cap: "read",
    handler: async (c) => {
      const { data, error } = await c.db.from("feature_flags").select("*").order("key");
      if (error) throw new ApiError(500, "db_error", error.message);
      return ok(data);
    },
  },
  {
    method: "POST", pattern: /^\/flags$/, cap: "platform",
    handler: async (c) => {
      const key = String(c.body.key ?? "").trim();
      if (!/^[a-z0-9_.-]{1,64}$/.test(key)) throw new ApiError(400, "invalid_key", "Flag key must be 1-64 chars of a-z 0-9 _ . -");
      const reason = reasonOf(c.body);
      const { data: before } = await c.db.from("feature_flags").select("*").eq("key", key).maybeSingle();

      if (c.body.delete === true) {
        if (!before) throw new ApiError(404, "not_found", "Flag not found.");
        const { error } = await c.db.from("feature_flags").delete().eq("key", key);
        if (error) throw new ApiError(500, "db_error", error.message);
        await audit(c, "flag.delete", null, before, null, reason);
        return ok({ deleted: true });
      }

      const raw = (c.body.overrides ?? {}) as { users?: Record<string, unknown>; plans?: Record<string, unknown> };
      const overrides: { users: Record<string, boolean>; plans: Record<string, boolean> } = { users: {}, plans: {} };
      for (const [uid, v] of Object.entries(raw.users ?? {})) {
        if (!isUuid(uid) || typeof v !== "boolean") throw new ApiError(400, "invalid_overrides", "User overrides must map user ids to true/false.");
        overrides.users[uid] = v;
      }
      for (const [plan, v] of Object.entries(raw.plans ?? {})) {
        if (!/^[A-Z0-9_ -]{1,32}$/.test(plan) || typeof v !== "boolean") throw new ApiError(400, "invalid_overrides", "Plan overrides must map plan names to true/false.");
        overrides.plans[plan] = v;
      }
      if (Object.keys(overrides.users).length > 500) throw new ApiError(400, "invalid_overrides", "At most 500 user overrides per flag.");
      const next = {
        key,
        description: String(c.body.description ?? "").slice(0, 300),
        default_enabled: c.body.default_enabled === true,
        overrides,
        updated_at: new Date().toISOString(),
      };
      const { error } = await c.db.from("feature_flags").upsert(next, { onConflict: "key" });
      if (error) throw new ApiError(500, "db_error", error.message);
      await audit(c, before ? "flag.update" : "flag.create", null, before ?? null, next, reason);
      return ok(next);
    },
  },
  {
    method: "GET", pattern: /^\/platform\/settings$/, cap: "read",
    handler: async (c) => {
      const { data, error } = await c.db.from("platform_settings").select("key,value,updated_at");
      if (error) throw new ApiError(500, "db_error", error.message);
      return ok(Object.fromEntries((data ?? []).map((r: { key: string; value: unknown; updated_at: string }) =>
        [r.key, { ...(r.value as object), updated_at: r.updated_at }])));
    },
  },
  {
    method: "POST", pattern: /^\/platform\/kill-switch$/, cap: "platform", stepUp: true,
    handler: async (c) => {
      if (typeof c.body.enabled !== "boolean") throw new ApiError(400, "invalid_enabled", "enabled must be true or false.");
      const reason = reasonOf(c.body);
      const { data: row } = await c.db.from("platform_settings").select("value").eq("key", "kill_switch").maybeSingle();
      const before = row?.value ?? { enabled: false };
      const message = typeof c.body.message === "string" && c.body.message.trim()
        ? c.body.message.trim().slice(0, 300) : (before as { message?: string }).message ?? "";
      const next = { enabled: c.body.enabled, message };
      const { error } = await c.db.from("platform_settings").upsert(
        { key: "kill_switch", value: next, updated_at: new Date().toISOString(), updated_by: c.adminUserId },
        { onConflict: "key" });
      if (error) throw new ApiError(500, "db_error", error.message);
      await audit(c, next.enabled ? "platform.kill_switch_on" : "platform.kill_switch_off", null, before, next, reason);
      return ok(next);
    },
  },
  {
    method: "POST", pattern: /^\/platform\/tracking-policy$/, cap: "platform",
    handler: async (c) => {
      const list = c.body.sensitive_field_denylist;
      if (!Array.isArray(list) || list.length > 200 || list.some((s) => typeof s !== "string" || !s.trim() || s.length > 64)) {
        throw new ApiError(400, "invalid_denylist", "Denylist must be up to 200 short strings.");
      }
      const next = {
        sensitive_field_denylist: [...new Set(list.map((s: string) => s.trim().toLowerCase()))],
        retention_days: intOf(c.body.retention_days, "retention_days", 1, 3650),
      };
      const reason = reasonOf(c.body);
      const { data: row } = await c.db.from("platform_settings").select("value").eq("key", "tracking_policy").maybeSingle();
      const { error } = await c.db.from("platform_settings").upsert(
        { key: "tracking_policy", value: next, updated_at: new Date().toISOString(), updated_by: c.adminUserId },
        { onConflict: "key" });
      if (error) throw new ApiError(500, "db_error", error.message);
      await audit(c, "platform.tracking_policy", null, row?.value ?? null, next, reason);
      return ok(next);
    },
  },

  // --- admin accounts (owner only) ---
  {
    method: "GET", pattern: /^\/admins$/, cap: "admins",
    handler: async (c) => {
      const { data, error } = await c.db.from("admin_users")
        .select("id,email,role,status,mfa_enrolled,created_at,last_login_at,user_id").order("created_at");
      if (error) throw new ApiError(500, "db_error", error.message);
      return ok((data ?? []).map((r: Record<string, unknown>) => ({ ...r, user_id: undefined, signed_in: !!r.user_id })));
    },
  },
  {
    method: "POST", pattern: /^\/admins$/, cap: "admins", stepUp: true,
    handler: async (c) => {
      const op = String(c.body.op ?? "");
      const reason = reasonOf(c.body);
      const roleOk = (r: unknown): r is Role => r === "owner" || r === "admin" || r === "viewer";

      if (op === "invite") {
        const email = String(c.body.email ?? "").trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError(400, "invalid_email", "Enter a valid email address.");
        if (!roleOk(c.body.role)) throw new ApiError(400, "invalid_role", "role must be owner, admin or viewer.");
        const { data: existingUser } = await c.db.from("profiles").select("id").ilike("email", email).maybeSingle();
        const { error } = await c.db.from("admin_users").insert({
          email, role: c.body.role, user_id: existingUser?.id ?? null, invited_by: c.adminUserId,
        });
        if (error) {
          if (String(error.code) === "23505") throw new ApiError(409, "already_admin", "That email is already an admin.");
          throw new ApiError(500, "db_error", error.message);
        }
        await audit(c, "admin.invite", null, null, { email, role: c.body.role }, reason);
        return ok({ invited: email });
      }

      const id = requireUuid(String(c.body.id ?? ""));
      const { data: target } = await c.db.from("admin_users").select("*").eq("id", id).maybeSingle();
      if (!target) throw new ApiError(404, "not_found", "Admin not found.");
      if (target.id === c.admin.id) throw new ApiError(409, "self_change", "You cannot change your own admin account.");

      const losesOwner = async () => {
        if (target.role !== "owner" || target.status !== "active") return false;
        const { count } = await c.db.from("admin_users").select("id", { count: "exact", head: true })
          .eq("role", "owner").eq("status", "active").neq("id", id);
        return !count;
      };

      if (op === "role") {
        if (!roleOk(c.body.role)) throw new ApiError(400, "invalid_role", "role must be owner, admin or viewer.");
        if (c.body.role !== "owner" && (await losesOwner())) throw new ApiError(409, "last_owner", "There must be at least one active owner.");
        await c.db.from("admin_users").update({ role: c.body.role }).eq("id", id);
        await audit(c, "admin.role", null, { email: target.email, role: target.role }, { email: target.email, role: c.body.role }, reason);
        return ok({ role: c.body.role });
      }
      if (op === "status") {
        const status = c.body.status;
        if (status !== "active" && status !== "disabled") throw new ApiError(400, "invalid_status", "status must be active or disabled.");
        if (status === "disabled" && (await losesOwner())) throw new ApiError(409, "last_owner", "There must be at least one active owner.");
        await c.db.from("admin_users").update({ status }).eq("id", id);
        await audit(c, "admin.status", null, { email: target.email, status: target.status }, { email: target.email, status }, reason);
        return ok({ status });
      }
      if (op === "remove") {
        if (await losesOwner()) throw new ApiError(409, "last_owner", "There must be at least one active owner.");
        await c.db.from("admin_users").delete().eq("id", id);
        await audit(c, "admin.remove", null, { email: target.email, role: target.role }, null, reason);
        return ok({ removed: true });
      }
      throw new ApiError(400, "invalid_op", "op must be invite, role, status or remove.");
    },
  },

  // --- audit + system ---
  {
    method: "GET", pattern: /^\/audit$/, cap: "read",
    handler: async (c) => {
      const q = c.url.searchParams;
      const csv = q.get("format") === "csv";
      const target = q.get("target");
      const result = (await rpc(c.db, "admin_audit_list", {
        p_admin_email: q.get("admin") || null,
        p_action: q.get("action") || null,
        p_target: target ? requireUuid(target) : null,
        p_from: dateOf(q.get("from"), "from"),
        p_to: dateOf(q.get("to"), "to"),
        p_limit: csv ? 1000 : intOf(q.get("limit") ?? 100, "limit", 1, 500),
        p_offset: csv ? 0 : intOf(q.get("cursor") ?? 0, "cursor", 0, 10_000_000),
      })) as { total: number; rows: Array<Record<string, unknown>> };
      if (csv) {
        return new Response(toCsv(
          ["created_at", "admin_email", "action", "target_user_id", "reason", "ip", "before", "after"], result.rows), {
          status: 200,
          headers: { ...corsHeaders(c.req), "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="fyllo-audit.csv"', "Cache-Control": "no-store" },
        });
      }
      const offset = intOf(q.get("cursor") ?? 0, "cursor", 0, 10_000_000);
      const next = offset + result.rows.length;
      return ok({ ...result, next_cursor: next < result.total ? String(next) : null });
    },
  },
  {
    method: "GET", pattern: /^\/system\/health$/, cap: "read",
    handler: async (c) => {
      const health = (await rpc(c.db, "admin_system_health", {})) as Record<string, unknown>;
      return ok({
        ...health,
        providers: {
          stripe: !!readEnv("STRIPE_SECRET_KEY"),
          stripe_webhook: !!readEnv("STRIPE_WEBHOOK_SECRET"),
          typesafe: !!readEnv("TYPESAFE_API_KEY"),
          openai: !!readEnv("OPENAI_API_KEY"),
          ai_provider: readEnv("AI_PROVIDER") ?? "typesafe",
        },
      });
    },
  },
  {
    method: "POST", pattern: /^\/system\/reconcile$/, cap: "users",
    handler: async (c) => {
      const result = await rpc(c.db, "admin_reconcile_balances", { p_fix: c.body.fix !== false });
      await audit(c, "system.reconcile", null, null, result, "manual re-run");
      return ok(result);
    },
  },
];

// ---------------------------------------------------------------------------
// Bulk actions
// ---------------------------------------------------------------------------

const BULK_ACTIONS = ["grant", "suspend", "revoke", "reinstate", "plan"] as const;
type BulkAction = typeof BULK_ACTIONS[number];

async function startBulk(c: Ctx) {
  const action = String(c.body.action ?? "") as BulkAction;
  if (!BULK_ACTIONS.includes(action)) throw new ApiError(400, "invalid_action", `action must be one of ${BULK_ACTIONS.join(", ")}`);
  const reason = reasonOf(c.body);
  const params = (c.body.params ?? {}) as Record<string, unknown>;

  // Validate action parameters once, up front, so a bad request fails before touching anyone.
  const clean: Record<string, unknown> = {};
  if (action === "grant") {
    clean.amount = intOf(params.amount, "amount", 1, 100_000);
    clean.expires_at = dateOf(params.expires_at, "expires_at");
  } else if (action === "plan") {
    clean.plan = String(params.plan ?? "").trim().toUpperCase();
    if (!clean.plan) throw new ApiError(400, "unknown_plan", "A plan is required.");
  } else if (action === "suspend") {
    clean.until = dateOf(params.until, "until");
  }

  let filter: Record<string, string>;
  if (Array.isArray(c.body.ids)) {
    const ids = c.body.ids as unknown[];
    if (ids.length === 0 || ids.length > BULK_MAX || !ids.every(isUuid)) {
      throw new ApiError(400, "invalid_ids", `Provide 1-${BULK_MAX} valid user ids.`);
    }
    filter = { ids: ids.join(",") };
  } else {
    filter = userFilter(new URLSearchParams((c.body.filter ?? {}) as Record<string, string>));
  }

  const segment = (await rpc(c.db, "admin_segment_ids", { p_filter: filter, p_cap: BULK_MAX + 1 })) as { total: number; ids: string[] };
  if (segment.total > BULK_MAX) {
    throw new ApiError(400, "segment_too_large", `This affects ${segment.total} users; the limit is ${BULK_MAX} per operation. Narrow the filter.`);
  }

  // Never change an admin's own access through a bulk run.
  let ids = segment.ids;
  let skippedAdmins = 0;
  if (action === "suspend" || action === "revoke") {
    const { data: admins } = await c.db.from("admin_users").select("user_id").not("user_id", "is", null);
    const adminIds = new Set((admins ?? []).map((a: { user_id: string }) => a.user_id));
    const kept = ids.filter((id) => !adminIds.has(id));
    skippedAdmins = ids.length - kept.length;
    ids = kept;
  }

  if (c.body.dry_run !== false) {
    return ok({ dry_run: true, will_affect: ids.length, skipped_admins: skippedAdmins, action });
  }
  if (c.body.confirm !== true) throw new ApiError(400, "confirmation_required", "Bulk actions need explicit confirmation.");
  if (ids.length === 0) throw new ApiError(400, "empty_segment", "No users match.");

  const { data: job, error } = await c.db.from("bulk_jobs").insert({
    admin_id: c.adminUserId, admin_email: c.admin.email, action, params: clean, filter, reason,
    status: "queued", total: ids.length,
  }).select("*").single();
  if (error) throw new ApiError(500, "db_error", error.message);

  const items = ids.map((user_id) => ({ job_id: job.id, user_id }));
  const { error: itemsError } = await c.db.from("bulk_job_items").insert(items);
  if (itemsError) throw new ApiError(500, "db_error", itemsError.message);

  await audit(c, "bulk.start", null, null, { job_id: job.id, action, total: ids.length, filter, params: clean }, reason);

  const work = runBulk(c.db, job, ids, c.ip);
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work);
  else work.catch((e) => console.error("bulk run failed", e));

  return new Response(JSON.stringify(ok({ job_id: job.id, total: ids.length })), {
    status: 202,
    headers: { ...corsHeaders(c.req), "Content-Type": "application/json" },
  });
}

async function applyBulk(db: Db, job: Record<string, any>, userId: string, ip: string | null) {
  const reason = `[bulk ${String(job.id).slice(0, 8)}] ${job.reason}`;
  const p = job.params as Record<string, unknown>;
  switch (job.action as BulkAction) {
    case "grant":
      await rpc(db, "admin_adjust_fills", {
        p_admin: job.admin_id, p_user: userId, p_op: "grant", p_amount: p.amount, p_reason: reason,
        p_expires_at: p.expires_at ?? null, p_idempotency_key: `bulk:${job.id}`, p_ip: ip,
      });
      return;
    case "plan":
      {
        const result = await rpc(db, "admin_set_plan", { p_admin: job.admin_id, p_user: userId, p_plan: p.plan, p_reason: reason, p_ip: ip }) as { plan?: string; noop?: boolean };
        if (result?.plan === "PRO" && !result.noop) {
          await sendLifecycleEmail(db, userId, `bulk:${job.id}`, { kind: "pro_activated", source: "admin" });
        }
      }
      return;
    case "suspend":
      await rpc(db, "admin_set_status", {
        p_admin: job.admin_id, p_user: userId, p_status: "SUSPENDED", p_reason: reason,
        p_until: p.until ?? null, p_balance: null, p_ip: ip,
      });
      return;
    case "revoke":
      await rpc(db, "admin_set_status", {
        p_admin: job.admin_id, p_user: userId, p_status: "REVOKED", p_reason: reason, p_until: null, p_balance: null, p_ip: ip,
      });
      await authAdmin("PUT", userId, { ban_duration: BAN_FOREVER });
      return;
    case "reinstate":
      await rpc(db, "admin_set_status", {
        p_admin: job.admin_id, p_user: userId, p_status: "ACTIVE", p_reason: reason, p_until: null, p_balance: null, p_ip: ip,
      });
      await authAdmin("PUT", userId, { ban_duration: "none" });
      return;
  }
}

async function runBulk(db: Db, job: Record<string, any>, ids: string[], ip: string | null) {
  let succeeded = 0;
  let failed = 0;
  await db.from("bulk_jobs").update({ status: "running" }).eq("id", job.id);
  try {
    for (const userId of ids) {
      try {
        await applyBulk(db, job, userId, ip);
        succeeded++;
        await db.from("bulk_job_items").update({ status: "ok" }).eq("job_id", job.id).eq("user_id", userId);
      } catch (e) {
        failed++;
        await db.from("bulk_job_items").update({ status: "error", error: String((e as Error).message).slice(0, 300) })
          .eq("job_id", job.id).eq("user_id", userId);
      }
      if ((succeeded + failed) % 10 === 0) {
        await db.from("bulk_jobs").update({ succeeded, failed }).eq("id", job.id);
      }
    }
    await db.from("bulk_jobs").update({ status: "done", succeeded, failed, finished_at: new Date().toISOString() }).eq("id", job.id);
  } catch (e) {
    console.error("bulk job crashed", job.id, e);
    await db.from("bulk_jobs").update({ status: "failed", succeeded, failed, finished_at: new Date().toISOString() }).eq("id", job.id);
  }
  await rpc(db, "admin_audit_event", {
    p_admin: job.admin_id, p_action: "bulk.finish", p_target: null, p_before: null,
    p_after: { job_id: job.id, succeeded, failed }, p_reason: job.reason, p_ip: ip,
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(req) });

  try {
    const ip = clientIp(req.headers);
    if (!ipAllowed(ip, readEnv("ADMIN_IP_ALLOWLIST"))) throw new ApiError(403, "forbidden", "Forbidden");

    const url = new URL(req.url);
    const idx = url.pathname.indexOf("/admin-api");
    const path = (idx >= 0 ? url.pathname.slice(idx + "/admin-api".length) : url.pathname).replace(/\/+$/, "") || "/";

    const matched = routes.find((r) => r.method === req.method && r.pattern.test(path));
    if (!matched) {
      const pathKnown = routes.some((r) => r.pattern.test(path));
      throw new ApiError(pathKnown ? 405 : 404, pathKnown ? "method_not_allowed" : "not_found", "Not found");
    }

    const db = getServiceClient();
    const { admin, userId, claims } = await authenticate(req, db);

    if (!matched.allowAal1 && !hasMfa(claims)) {
      throw new ApiError(403, "mfa_required", "Multi-factor authentication is required.");
    }
    if (!can(admin.role, matched.cap)) throw new ApiError(403, "forbidden", "Your role cannot do this.");
    if (matched.stepUp && !recentMfa(claims)) {
      throw new ApiError(403, "mfa_recent_required", "Re-enter your authenticator code to continue.");
    }
    const limiter = matched.method === "POST" && matched.cap === "platform" ? PLATFORM_RATE : ADMIN_RATE;
    if (!limiter(`${userId}:${matched.cap}`)) throw new ApiError(429, "rate_limited", "Too many requests");

    const params = (path.match(matched.pattern) ?? []).slice(1);
    const body = await readBody(req);
    const out = await matched.handler({ req, url, db, admin, adminUserId: userId, claims, ip, params, body });
    if (out instanceof Response) return out;
    return respond(req, out);
  } catch (e) {
    if (e instanceof ApiError) {
      return respond(req, { success: false, error: e.message, code: e.code }, e.status);
    }
    console.error("admin-api error:", e);
    return respond(req, { success: false, error: "Internal error", code: "internal" }, 500);
  }
});
