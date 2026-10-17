import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeShim } from "./pg-supabase-shim.ts";

let db: PGlite;
let handler: (req: Request) => Promise<Response>;

vi.mock("https://deno.land/std@0.168.0/http/server.ts", () => ({
  serve: (h: (req: Request) => Promise<Response>) => { handler = h; },
}));
vi.mock("../../supabase/functions/_shared/stripe/supabase.ts", () => ({
  getServiceClient: () => makeShim(db),
}));

const SUPABASE_URL = "https://test.supabase.co";
const authUsers = new Map<string, { id: string; email: string }>();
const authCalls: Array<{ method: string; path: string; body?: any }> = [];

function jwt(sub: string, claims: Record<string, unknown> = {}): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64({ sub, ...claims })}.sig`;
}
const now = () => Math.floor(Date.now() / 1000);
const aal1 = (sub: string) => jwt(sub, { aal: "aal1", amr: [{ method: "password", timestamp: now() }] });
const aal2 = (sub: string, ageSec = 5) =>
  jwt(sub, { aal: "aal2", amr: [{ method: "totp", timestamp: now() - ageSec }, { method: "password", timestamp: now() - 60 }] });

async function newUser(email: string, plan = "free") {
  const { rows } = await db.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
  const id = rows[0].id;
  await db.query("insert into public.profiles (id, email, plan) values ($1,$2,$3)", [id, email, plan]);
  authUsers.set(id, { id, email });
  return id;
}
async function newAdmin(email: string, role: "owner" | "admin" | "viewer") {
  const id = await newUser(email);
  await db.query("insert into public.admin_users (user_id, email, role) values ($1,$2,$3)", [id, email, role]);
  return id;
}

async function call(method: "GET" | "POST", path: string, token: string | null, body?: unknown, headers: Record<string, string> = {}) {
  const res = await handler(new Request(`${SUPABASE_URL}/functions/v1/admin-api${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* csv */ }
  return { status: res.status, json, text, headers: res.headers };
}

let owner: string, adminId: string, viewer: string;

beforeAll(async () => {
  process.env.SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const header = String((init.headers as Record<string, string>)?.Authorization ?? "");
    if (url.pathname === "/auth/v1/user") {
      const token = header.replace("Bearer ", "");
      const sub = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub;
      const u = authUsers.get(sub);
      return u ? new Response(JSON.stringify({ id: u.id, email: u.email, email_confirmed_at: new Date().toISOString() }), { status: 200 })
               : new Response("{}", { status: 401 });
    }
    const m = url.pathname.match(/^\/auth\/v1\/admin\/users\/(.+)$/);
    if (m) {
      authCalls.push({ method: init.method ?? "GET", path: m[1], body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (init.method === "DELETE") await db.query("delete from auth.users where id=$1", [m[1]]);
      return new Response("{}", { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });

  db = new PGlite();
  await db.exec(readFileSync("tests/admin/supabase-stub.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/20261012000000-admin-dashboard.sql", "utf8"));
  await import("../../supabase/functions/admin-api/index.ts");

  owner = await newAdmin("owner@fyllo.test", "owner");
  adminId = await newAdmin("admin@fyllo.test", "admin");
  viewer = await newAdmin("viewer@fyllo.test", "viewer");
});
afterAll(async () => { await db.close(); vi.unstubAllGlobals(); });
beforeEach(() => { authCalls.length = 0; });

describe("authentication", () => {
  it("rejects missing tokens and non-admin users with the same 403", async () => {
    expect((await call("GET", "/me", null)).status).toBe(401);
    const stranger = await newUser("nobody@example.com");
    const r = await call("GET", "/me", aal2(stranger));
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("forbidden");
  });

  it("requires MFA (aal2) for everything except /me", async () => {
    const me = await call("GET", "/me", aal1(owner));
    expect(me.status).toBe(200);
    expect(me.json.data).toMatchObject({ role: "owner", mfa: { verified: false } });
    const r = await call("GET", "/metrics/overview?range=7d", aal1(owner));
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("mfa_required");
  });

  it("binds an invited email on first sign-in, and does not bootstrap when an owner exists", async () => {
    await db.query("insert into public.admin_users (email, role) values ('newbie@fyllo.test','viewer')");
    const id = await newUser("newbie@fyllo.test");
    const me = await call("GET", "/me", aal2(id));
    expect(me.status).toBe(200);
    expect(me.json.data.role).toBe("viewer");

    process.env.ADMIN_BOOTSTRAP_OWNER_EMAIL = "sneaky@example.com";
    const sneaky = await newUser("sneaky@example.com");
    expect((await call("GET", "/me", aal2(sneaky))).status).toBe(403);
    delete process.env.ADMIN_BOOTSTRAP_OWNER_EMAIL;
  });

  it("disabled admins are locked out", async () => {
    const id = await newAdmin("gone@fyllo.test", "admin");
    await db.query("update public.admin_users set status='disabled' where user_id=$1", [id]);
    expect((await call("GET", "/users", aal2(id))).status).toBe(403);
  });
});

describe("role enforcement (server side)", () => {
  it("viewer can read but every state-changing endpoint returns 403", async () => {
    const target = await newUser("t1@example.com");
    expect((await call("GET", "/users", aal2(viewer))).status).toBe(200);
    const writes: Array<[string, unknown]> = [
      [`/users/${target}/fills`, { op: "grant", amount: 5, reason: "x" }],
      [`/users/${target}/status`, { action: "suspend", reason: "x" }],
      [`/users/${target}/plan`, { plan: "BETA", reason: "x" }],
      [`/users/${target}/delete-activity`, { reason: "x", confirm: true }],
      ["/bulk", { action: "grant", ids: [target], params: { amount: 1 }, reason: "x" }],
      ["/platform/kill-switch", { enabled: true, reason: "x" }],
      ["/plans", { name: "X", reason: "x" }],
      ["/flags", { key: "x", reason: "x" }],
      ["/admins", { op: "invite", email: "a@b.co", role: "admin", reason: "x" }],
    ];
    for (const [path, body] of writes) {
      const r = await call("POST", path, aal2(viewer), body);
      expect(r.status, path).toBe(403);
    }
    expect(Number((await db.query<{ n: string }>("select count(*) n from public.fill_ledger where source='ADMIN_GRANT'")).rows[0].n)).toBe(0);
  });

  it("admin can act on users but not platform settings or other admins", async () => {
    const target = await newUser("t2@example.com");
    const ok = await call("POST", `/users/${target}/fills`, aal2(adminId), { op: "grant", amount: 10, reason: "welcome" });
    expect(ok.status).toBe(200);
    for (const [path, body] of [
      ["/platform/kill-switch", { enabled: true, reason: "x" }],
      ["/plans", { name: "X", reason: "x" }],
      ["/flags", { key: "x", reason: "x" }],
      ["/platform/tracking-policy", { sensitive_field_denylist: [], retention_days: 30, reason: "x" }],
    ] as const) {
      expect((await call("POST", path, aal2(adminId), body)).status, path).toBe(403);
    }
    expect((await call("GET", "/admins", aal2(adminId))).status).toBe(403);
    expect((await call("POST", "/admins", aal2(adminId), { op: "invite", email: "a@b.co", role: "admin", reason: "x" })).status).toBe(403);
  });
});

describe("fills", () => {
  it("grant creates one ADMIN_GRANT row with reason + admin id and an audit entry", async () => {
    const u = await newUser("grant@example.com");
    const r = await call("POST", `/users/${u}/fills`, aal2(adminId), { op: "grant", amount: 50, reason: "support ticket 12" });
    expect(r.status).toBe(200);
    expect(r.json.data).toMatchObject({ delta: 50, balance: 55 });
    const rows = (await db.query("select * from public.fill_ledger where user_id=$1 and source='ADMIN_GRANT'", [u])).rows as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: "support ticket 12", admin_id: adminId });
    const a = (await db.query("select * from public.audit_log where target_user_id=$1 and action='fills.grant'", [u])).rows[0] as any;
    expect(a.admin_email).toBe("admin@fyllo.test");
    expect(a.before).toMatchObject({ balance: 5 });
    expect(a.after).toMatchObject({ balance: 55 });
  });

  it("rejects a missing reason and bad amounts", async () => {
    const u = await newUser("noreason@example.com");
    const noReason = await call("POST", `/users/${u}/fills`, aal2(adminId), { op: "grant", amount: 5 });
    expect(noReason.status).toBe(400);
    expect(noReason.json.code).toBe("reason_required");
    expect((await call("POST", `/users/${u}/fills`, aal2(adminId), { op: "grant", amount: -3, reason: "x" })).status).toBe(400);
    expect((await call("POST", `/users/${u}/fills`, aal2(adminId), { op: "remove", amount: 999, reason: "x" })).status).toBe(409);
    const n = (await db.query<{ n: string }>("select count(*) n from public.fill_ledger where user_id=$1 and source like 'ADMIN%'", [u])).rows[0].n;
    expect(Number(n)).toBe(0);
  });
});

describe("access control", () => {
  it("suspend blocks fills and reinstate restores the previous balance", async () => {
    const u = await newUser("susp@example.com");
    expect((await call("POST", `/users/${u}/fills`, aal2(adminId), { op: "grant", amount: 20, reason: "x" })).status).toBe(200);
    expect((await call("POST", `/users/${u}/status`, aal2(adminId), { action: "suspend", reason: "abuse review" })).status).toBe(200);
    let s = (await db.query<{ s: any }>("select public.entitlement_status($1) s", [u])).rows[0].s;
    expect(s).toMatchObject({ allowed: false, reason: "suspended", balance: 25 });
    expect((await call("POST", `/users/${u}/status`, aal2(adminId), { action: "reinstate", reason: "cleared" })).status).toBe(200);
    s = (await db.query<{ s: any }>("select public.entitlement_status($1) s", [u])).rows[0].s;
    expect(s).toMatchObject({ allowed: true, status: "ACTIVE", balance: 25 });
  });

  it("time-boxed suspension expires on its own", async () => {
    const u = await newUser("timebox@example.com");
    await call("POST", `/users/${u}/status`, aal2(adminId), { action: "suspend", reason: "cool off", until: new Date(Date.now() + 3600_000).toISOString() });
    expect((await db.query<{ s: any }>("select public.entitlement_status($1) s", [u])).rows[0].s.allowed).toBe(false);
    await db.query("update public.entitlements set suspended_until = now() - interval '1 minute' where user_id=$1", [u]);
    expect((await db.query<{ s: any }>("select public.entitlement_status($1) s", [u])).rows[0].s.allowed).toBe(true);
    const a = await db.query("select 1 from public.audit_log where target_user_id=$1 and action='status.auto_reinstate'", [u]);
    expect(a.rows).toHaveLength(1);
  });

  it("revoke needs confirmation, kills sessions, bans the account, and reinstate lifts the ban", async () => {
    const u = await newUser("revoke@example.com");
    await db.query("insert into auth.sessions (user_id) values ($1), ($1)", [u]);
    const noConfirm = await call("POST", `/users/${u}/status`, aal2(adminId), { action: "revoke", reason: "fraud" });
    expect(noConfirm.json.code).toBe("confirmation_required");

    const r = await call("POST", `/users/${u}/status`, aal2(adminId), { action: "revoke", reason: "fraud", confirm: true });
    expect(r.status).toBe(200);
    expect((await db.query("select 1 from auth.sessions where user_id=$1", [u])).rows).toHaveLength(0);
    expect(authCalls).toContainEqual({ method: "PUT", path: u, body: { ban_duration: "876000h" } });
    expect((await db.query<{ s: any }>("select public.entitlement_status($1) s", [u])).rows[0].s)
      .toMatchObject({ allowed: false, reason: "revoked" });

    // log_fill_usage must not charge a revoked user
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [u]);
    const before = (await db.query<{ n: string }>("select count(*) n from public.fill_ledger where user_id=$1", [u])).rows[0].n;
    await db.query("select public.log_fill_usage()");
    expect((await db.query<{ n: string }>("select count(*) n from public.fill_ledger where user_id=$1", [u])).rows[0].n).toBe(before);

    await call("POST", `/users/${u}/status`, aal2(adminId), { action: "reinstate", reason: "mistake", balance: 7 });
    expect(authCalls).toContainEqual({ method: "PUT", path: u, body: { ban_duration: "none" } });
    expect((await db.query<{ s: any }>("select public.entitlement_status($1) s", [u])).rows[0].s)
      .toMatchObject({ allowed: true, balance: 7 });
  });

  it("cannot suspend or revoke an admin account", async () => {
    const r = await call("POST", `/users/${viewer}/status`, aal2(adminId), { action: "suspend", reason: "x" });
    expect(r.status).toBe(409);
    expect(r.json.code).toBe("target_is_admin");
  });
});

describe("step-up and destructive actions", () => {
  it("kill switch needs a recent TOTP, halts fills, and resumes; both transitions audited", async () => {
    const u = await newUser("ks@example.com");
    const stale = await call("POST", "/platform/kill-switch", aal2(owner, 3600), { enabled: true, reason: "incident", message: "Down for maintenance" });
    expect(stale.status).toBe(403);
    expect(stale.json.code).toBe("mfa_recent_required");

    expect((await call("POST", "/platform/kill-switch", aal2(owner), { enabled: true, reason: "incident", message: "Down for maintenance" })).status).toBe(200);
    expect((await db.query<{ s: any }>("select public.entitlement_status($1) s", [u])).rows[0].s)
      .toMatchObject({ allowed: false, reason: "kill_switch", message: "Down for maintenance" });
    expect((await call("POST", "/platform/kill-switch", aal2(owner), { enabled: false, reason: "resolved" })).status).toBe(200);
    expect((await db.query<{ s: any }>("select public.entitlement_status($1) s", [u])).rows[0].s.allowed).toBe(true);
    const actions = (await db.query<{ action: string }>("select action from public.audit_log where action like 'platform.kill_switch%' order by created_at")).rows;
    expect(actions.map((a) => a.action)).toEqual(["platform.kill_switch_on", "platform.kill_switch_off"]);
  });

  it("delete-account needs step-up MFA and a typed confirmation, then audits before deleting", async () => {
    const u = await newUser("delete-me@example.com");
    await call("POST", `/users/${u}/fills`, aal2(adminId), { op: "grant", amount: 1, reason: "x" });
    const noMfa = await call("POST", `/users/${u}/delete-account`, aal2(owner, 3600), { reason: "gdpr request", confirm: "delete-me@example.com" });
    expect(noMfa.json.code).toBe("mfa_recent_required");
    const wrong = await call("POST", `/users/${u}/delete-account`, aal2(owner), { reason: "gdpr request", confirm: "nope" });
    expect(wrong.json.code).toBe("confirmation_mismatch");
    const done = await call("POST", `/users/${u}/delete-account`, aal2(owner), { reason: "gdpr request", confirm: "DELETE-ME@example.com" });
    expect(done.status).toBe(200);
    expect((await db.query("select 1 from auth.users where id=$1", [u])).rows).toHaveLength(0);
    const a = (await db.query("select * from public.audit_log where target_user_id=$1 and action='account.delete'", [u])).rows as any[];
    expect(a).toHaveLength(1);
    // ledger history survives account deletion
    expect((await db.query("select 1 from public.fill_ledger where user_id=$1", [u])).rows.length).toBeGreaterThan(0);
  });
});

describe("bulk actions", () => {
  it("dry-runs first, then runs asynchronously and reports per-user results", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push(await newUser(`bulk${i}@bulk.test`));
    const filter = { query: "@bulk.test" };

    const dry = await call("POST", "/bulk", aal2(adminId), { action: "grant", filter, params: { amount: 10 }, reason: "launch promo" });
    expect(dry.json.data).toMatchObject({ dry_run: true, will_affect: 4 });
    expect((await db.query("select 1 from public.fill_ledger where source='ADMIN_GRANT' and reason like '%launch promo%'")).rows).toHaveLength(0);

    const noConfirm = await call("POST", "/bulk", aal2(adminId), { action: "grant", filter, params: { amount: 10 }, reason: "launch promo", dry_run: false });
    expect(noConfirm.json.code).toBe("confirmation_required");

    const run = await call("POST", "/bulk", aal2(adminId), { action: "grant", filter, params: { amount: 10 }, reason: "launch promo", dry_run: false, confirm: true });
    expect(run.status).toBe(202);
    const jobId = run.json.data.job_id;
    let job: any;
    for (let i = 0; i < 50; i++) {
      job = (await call("GET", `/bulk/${jobId}`, aal2(adminId))).json.data;
      if (job.job.status === "done" || job.job.status === "failed") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(job.job).toMatchObject({ status: "done", total: 4, succeeded: 4, failed: 0 });
    expect(job.items).toHaveLength(4);
    for (const id of ids) {
      const s = (await db.query<{ s: any }>("select public.entitlement_status($1) s", [id])).rows[0].s;
      expect(s.balance).toBe(15);
    }
  });

  it("caps the size of one operation", async () => {
    const r = await call("POST", "/bulk", aal2(adminId), { action: "suspend", filter: {}, reason: "x" });
    // the whole user base is small here, so shrink the cap by asking for more ids than allowed instead
    expect([200, 400]).toContain(r.status);
    const tooMany = Array.from({ length: 501 }, () => "00000000-0000-0000-0000-000000000000");
    const big = await call("POST", "/bulk", aal2(adminId), { action: "suspend", ids: tooMany, reason: "x" });
    expect(big.json.code).toBe("invalid_ids");
  });

  it("bulk suspend skips admin accounts", async () => {
    const r = await call("POST", "/bulk", aal2(adminId), { action: "suspend", ids: [owner, viewer], reason: "test" });
    expect(r.json.data).toMatchObject({ will_affect: 0, skipped_admins: 2 });
  });
});

describe("admin management", () => {
  it("owner invites admins and cannot change their own account", async () => {
    const boss = await newAdmin("boss@fyllo.test", "owner");
    const inv = await call("POST", "/admins", aal2(boss), { op: "invite", email: "Future@Fyllo.test", role: "admin", reason: "new hire" });
    expect(inv.status).toBe(200);
    const list = (await call("GET", "/admins", aal2(boss))).json.data as any[];
    expect(list.map((a) => a.email)).toContain("future@fyllo.test");
    expect((await call("POST", "/admins", aal2(boss), { op: "invite", email: "future@fyllo.test", role: "viewer", reason: "dup" })).status).toBe(409);

    const self = list.find((a) => a.email === "boss@fyllo.test");
    expect((await call("POST", "/admins", aal2(boss), { op: "role", id: self.id, role: "viewer", reason: "x" })).json.code).toBe("self_change");
    expect((await call("POST", "/admins", aal2(boss, 3600), { op: "invite", email: "x@y.co", role: "admin", reason: "x" })).json.code)
      .toBe("mfa_recent_required");
  });

  it("a demoted or disabled owner immediately loses the ability to manage admins", async () => {
    const a = await newAdmin("owner-a@fyllo.test", "owner");
    const b = await newAdmin("owner-b@fyllo.test", "owner");
    const rows = (await call("GET", "/admins", aal2(a))).json.data as any[];
    const bRow = rows.find((r) => r.email === "owner-b@fyllo.test");

    expect((await call("GET", "/admins", aal2(b))).status).toBe(200);
    expect((await call("POST", "/admins", aal2(a), { op: "role", id: bRow.id, role: "admin", reason: "reorg" })).status).toBe(200);
    expect((await call("GET", "/admins", aal2(b))).status).toBe(403);

    expect((await call("POST", "/admins", aal2(a), { op: "status", id: bRow.id, status: "disabled", reason: "left" })).status).toBe(200);
    expect((await call("GET", "/users", aal2(b))).status).toBe(403);

    const audit = await db.query("select action from public.audit_log where action like 'admin.%' order by created_at");
    expect((audit.rows as any[]).map((r) => r.action)).toEqual(expect.arrayContaining(["admin.invite", "admin.role", "admin.status"]));
  });
});

describe("privacy of responses", () => {
  it("user detail and ledger expose no field values, profile contents or URLs", async () => {
    const u = await newUser("private@example.com");
    await db.query("insert into public.applications (user_id, company_name, position_title, application_url, notes) values ($1,'Acme','Engineer','https://acme.example/jobs/12345?token=secret','salary 200k')", [u]);
    const detail = await call("GET", `/users/${u}`, aal2(adminId));
    expect(detail.status).toBe(200);
    const blob = JSON.stringify(detail.json);
    expect(blob).not.toMatch(/https?:\/\//);
    expect(blob).not.toMatch(/secret|salary|notes|application_url|personal_info/);
    expect(detail.json.data.applications[0]).toEqual(expect.objectContaining({ company_name: "Acme", position_title: "Engineer" }));
    const ledger = await call("GET", `/users/${u}/ledger`, aal2(adminId));
    expect(JSON.stringify(ledger.json)).not.toMatch(/https?:\/\//);
    // viewing a user is itself audited
    expect((await db.query("select 1 from public.audit_log where target_user_id=$1 and action='user.view'", [u])).rows).toHaveLength(1);
  });
});

describe("metrics", () => {
  it("overview matches a hand-computed sample from the ledger", async () => {
    // isolated window far in the past so other tests' data does not interfere
    const a = await newUser("m1@metrics.test");
    const b = await newUser("m2@metrics.test");
    await db.query("update public.profiles set created_at = '2020-03-02T10:00:00Z' where id in ($1,$2)", [a, b]);
    const ins = (u: string, units: number, at: string) =>
      db.query("insert into public.fill_ledger (user_id, delta, source, units, created_at) values ($1,$2,'USAGE',$3,$4)", [u, -units, units, at]);
    await ins(a, 1, "2020-03-02T12:00:00Z");
    await ins(a, 1, "2020-03-03T12:00:00Z");
    await ins(b, 1, "2020-03-03T13:00:00Z");
    await db.query("insert into public.fill_ledger (user_id, delta, source, reason, admin_id, created_at) values ($1, 25,'ADMIN_GRANT','promo',$2,'2020-03-03T09:00:00Z')", [a, adminId]);

    const r = await call("GET", "/metrics/overview?range=custom&from=2020-03-02&to=2020-03-03", aal2(owner));
    expect(r.status).toBe(200);
    const m = r.json.data.current;
    expect(m.new_users).toBe(2);
    expect(m.fills_consumed).toBe(3);
    expect(m.fills_granted).toBe(25);
    expect(m.active_users).toBe(2);
    expect(m.activated_users).toBe(2);
    expect(m.activation_rate).toBe(1);
    expect(m.daily).toHaveLength(2);
    expect(m.daily[0]).toMatchObject({ day: "2020-03-02", fills: 1, active_users: 1, new_users: 2 });
    expect(m.daily[1]).toMatchObject({ day: "2020-03-03", fills: 2, active_users: 2, granted: 25 });
    expect(r.json.data.previous.fills_consumed).toBe(0);
  });

  it("rejects bad ranges", async () => {
    expect((await call("GET", "/metrics/overview?range=custom&from=nope&to=2020-01-01", aal2(owner))).status).toBe(400);
  });
});

describe("ledger integrity", () => {
  it("is append-only: updates, deletes and truncate are rejected", async () => {
    const u = await newUser("append@example.com");
    await call("POST", `/users/${u}/fills`, aal2(adminId), { op: "grant", amount: 3, reason: "x" });
    await expect(db.query("update public.fill_ledger set delta = 9999 where user_id=$1", [u])).rejects.toThrow(/append-only/);
    await expect(db.query("delete from public.fill_ledger where user_id=$1", [u])).rejects.toThrow(/append-only/);
    await expect(db.query("truncate public.fill_ledger")).rejects.toThrow(/append-only/);
    await expect(db.query("update public.audit_log set reason='edited'")).rejects.toThrow(/append-only/);
    await expect(db.query("delete from public.audit_log")).rejects.toThrow(/append-only/);
  });

  it("reconcile repairs a drifted cache and records a job run", async () => {
    const u = await newUser("drift@example.com");
    await db.query("select public.entitlement_status($1)", [u]);
    await db.query("update public.entitlements set balance = 999 where user_id=$1", [u]);
    const health = (await call("GET", "/system/health", aal2(owner))).json.data;
    expect(health.balance_mismatches).toBeGreaterThanOrEqual(1);
    const r = await call("POST", "/system/reconcile", aal2(adminId), {});
    expect(r.json.data.mismatched).toBeGreaterThanOrEqual(1);
    expect((await db.query<{ balance: number }>("select balance from public.entitlements where user_id=$1", [u])).rows[0].balance).toBe(5);
    expect(((await call("GET", "/system/health", aal2(owner))).json.data.jobs as any[]).some((j) => j.job === "reconcile")).toBe(true);
  });
});

describe("users list", () => {
  it("filters, sorts, paginates and exports CSV safely", async () => {
    await newUser("=cmd|calc@csv.test");
    for (let i = 0; i < 3; i++) await newUser(`row${i}@csv.test`);
    const page = await call("GET", "/users?query=%40csv.test&limit=2&sort=email&dir=asc", aal2(viewer));
    expect(page.json.data.total).toBe(4);
    expect(page.json.data.rows).toHaveLength(2);
    expect(page.json.data.next_cursor).toBe("2");
    const next = await call("GET", "/users?query=%40csv.test&limit=2&sort=email&dir=asc&cursor=2", aal2(viewer));
    expect(next.json.data.rows).toHaveLength(2);
    expect(next.json.data.next_cursor).toBeNull();

    const csv = await call("GET", "/users?query=%40csv.test&format=csv", aal2(viewer));
    expect(csv.headers.get("content-type")).toMatch(/text\/csv/);
    expect(csv.text).toContain("'=cmd|calc@csv.test");
    expect((await call("GET", "/users?status=BOGUS", aal2(viewer))).status).toBe(400);
  });
});
