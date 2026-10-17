import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const stub = readFileSync("tests/admin/supabase-stub.sql", "utf8");
const migration = readFileSync("supabase/migrations/20261012000000-admin-dashboard.sql", "utf8");

let db: PGlite;
let seq = 0;

async function newUser(opts: { plan?: string; email?: string } = {}): Promise<string> {
  const email = opts.email ?? `user${++seq}@example.com`;
  const { rows } = await db.query<{ id: string }>(
    "insert into auth.users (email) values ($1) returning id", [email]);
  const id = rows[0].id;
  await db.query("insert into public.profiles (id, email, plan) values ($1, $2, $3)", [id, email, opts.plan ?? "free"]);
  return id;
}

const asUser = async (id: string) => db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
const one = async <T = any>(sql: string, params: unknown[] = []): Promise<T> =>
  (await db.query<T>(sql, params)).rows[0];
const balance = async (id: string) =>
  Number((await one<{ b: string }>("select coalesce(sum(delta),0) b from public.fill_ledger where user_id=$1", [id])).b);
const cached = async (id: string) =>
  (await one<{ balance: number }>("select balance from public.entitlements where user_id=$1", [id])).balance;
const ent = async (id: string) =>
  (await one<{ s: any }>("select public.entitlement_status($1) s", [id])).s;
const admin = "00000000-0000-0000-0000-0000000000aa";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(stub);
  await db.exec(migration);
});
afterAll(async () => { await db.close(); });

describe("entitlement + ledger", () => {
  it("issues the monthly allowance once and consumes it with USAGE rows", async () => {
    const u = await newUser();
    const first = await ent(u);
    expect(first).toMatchObject({ allowed: true, status: "ACTIVE", balance: 5, unlimited: false });
    expect((await ent(u)).balance).toBe(5); // idempotent

    await asUser(u);
    for (let i = 0; i < 5; i++) await db.query("select public.log_fill_usage()");
    expect(await one("select public.can_run_fill() ok")).toMatchObject({ ok: false });
    const s = await ent(u);
    expect(s).toMatchObject({ allowed: false, reason: "no_balance", balance: 0 });
    expect(await balance(u)).toBe(0);
    expect(await cached(u)).toBe(0);
    expect(await one("select used, cap from public.get_fill_usage()")).toMatchObject({ used: 5, cap: 5 });
  });

  it("admin grant: one ADMIN_GRANT row with reason + admin id, balance +50, audited", async () => {
    const u = await newUser();
    await ent(u);
    const before = await balance(u);
    const r = await one<{ r: any }>(
      "select public.admin_adjust_fills($1,$2,'grant',50,'support goodwill') r", [admin, u]);
    expect(r.r).toMatchObject({ delta: 50, balance: before + 50 });
    const rows = (await db.query("select * from public.fill_ledger where user_id=$1 and source='ADMIN_GRANT'", [u])).rows as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ delta: 50, reason: "support goodwill", admin_id: admin });
    expect(await cached(u)).toBe(before + 50);
    const a = await one<any>("select * from public.audit_log where target_user_id=$1 and action='fills.grant'", [u]);
    expect(a.before).toMatchObject({ balance: before });
    expect(a.after).toMatchObject({ balance: before + 50, delta: 50 });
    expect(a.reason).toBe("support goodwill");
  });

  it("rejects admin adjustments without a reason", async () => {
    const u = await newUser();
    await expect(db.query("select public.admin_adjust_fills($1,$2,'grant',5,'  ')", [admin, u])).rejects.toThrow(/reason_required/);
    await expect(db.query("select public.admin_set_status($1,$2,'SUSPENDED','')", [admin, u])).rejects.toThrow(/reason_required/);
    expect(await balance(u)).toBe(0);
  });

  it("is idempotent for a repeated idempotency key", async () => {
    const u = await newUser();
    await ent(u);
    const b = await balance(u);
    await db.query("select public.admin_adjust_fills($1,$2,'grant',10,'promo',null,'key-1')", [admin, u]);
    const again = await one<{ r: any }>("select public.admin_adjust_fills($1,$2,'grant',10,'promo',null,'key-1') r", [admin, u]);
    expect(again.r.replayed).toBe(true);
    expect(await balance(u)).toBe(b + 10);
  });

  it("set and reset are corrective entries, never overwrites", async () => {
    const u = await newUser();
    await ent(u);
    await db.query("select public.admin_adjust_fills($1,$2,'set',100,'fix')", [admin, u]);
    expect(await balance(u)).toBe(100);
    await db.query("select public.admin_adjust_fills($1,$2,'set',40,'fix again')", [admin, u]);
    expect(await balance(u)).toBe(40);
    await db.query("select public.admin_adjust_fills($1,$2,'reset',null,'back to plan')", [admin, u]);
    expect(await balance(u)).toBe(5);
    const n = await one<{ n: string }>("select count(*) n from public.fill_ledger where user_id=$1 and source in ('ADMIN_GRANT','ADMIN_REMOVE','RESET')", [u]);
    expect(Number(n.n)).toBe(3);
  });

  it("cannot remove more than the balance", async () => {
    const u = await newUser();
    await ent(u);
    await expect(db.query("select public.admin_adjust_fills($1,$2,'remove',99,'oops')", [admin, u])).rejects.toThrow(/insufficient_balance/);
  });

  it("expires unspent granted fills once, FIFO, without double counting", async () => {
    const u = await newUser();
    await db.query("update public.plans set default_fills=0 where name='FREE'"); // isolate from the allowance
    await ent(u);
    await db.query(
      "insert into public.fill_ledger (user_id, delta, source, reason, admin_id, expires_at, created_at) values ($1,10,'ADMIN_GRANT','promo',$2, now() - interval '1 day', now() - interval '10 days')",
      [u, admin]);
    await db.query(
      "insert into public.fill_ledger (user_id, delta, source, reason, admin_id, created_at) values ($1,10,'ADMIN_GRANT','keep',$2, now() - interval '9 days')",
      [u, admin]);
    // 4 fills used while both grants were open: consumed from the soonest-expiring grant
    await db.query(
      "insert into public.fill_ledger (user_id, delta, source, units, created_at) values ($1,-4,'USAGE',4, now() - interval '5 days')", [u]);

    const s = await ent(u);
    // 20 granted - 4 used - 6 unspent of the expired grant = 10
    expect(s.balance).toBe(10);
    const expiry = (await db.query("select delta from public.fill_ledger where user_id=$1 and source='EXPIRY'", [u])).rows as any[];
    expect(expiry).toEqual([{ delta: -6 }]);

    // re-checking never expires it again, and the ledger still sums to the cached balance
    expect((await ent(u)).balance).toBe(10);
    expect(await balance(u)).toBe(10);
    expect(await cached(u)).toBe(10);
    await db.query("update public.plans set default_fills=5 where name='FREE'");
  });

  it("a grant that was fully used before it expired expires nothing", async () => {
    const u = await newUser();
    await db.query("update public.plans set default_fills=0 where name='FREE'");
    await ent(u);
    await db.query(
      "insert into public.fill_ledger (user_id, delta, source, reason, admin_id, expires_at, created_at) values ($1,3,'ADMIN_GRANT','promo',$2, now() - interval '1 day', now() - interval '10 days')",
      [u, admin]);
    await db.query(
      "insert into public.fill_ledger (user_id, delta, source, units, created_at) values ($1,-3,'USAGE',3, now() - interval '5 days')", [u]);
    expect((await ent(u)).balance).toBe(0);
    expect((await db.query("select 1 from public.fill_ledger where user_id=$1 and source='EXPIRY'", [u])).rows).toHaveLength(0);
    await db.query("update public.plans set default_fills=5 where name='FREE'");
  });

  it("unlimited (Pro) users are never blocked on balance and their usage rows carry delta 0", async () => {
    const u = await newUser({ plan: "pro" });
    await asUser(u);
    expect(await ent(u)).toMatchObject({ allowed: true, unlimited: true, plan: "PRO" });
    for (let i = 0; i < 8; i++) await db.query("select public.log_fill_usage()");
    const s = await ent(u);
    expect(s.allowed).toBe(true);
    const sums = await one<{ d: string; u: string }>(
      "select coalesce(sum(delta),0) d, coalesce(sum(units),0) u from public.fill_ledger where user_id=$1 and source='USAGE'", [u]);
    expect(Number(sums.d)).toBe(0);
    expect(Number(sums.u)).toBe(8);
    expect(await one("select cap from public.get_fill_usage()")).toMatchObject({ cap: null });
  });

  it("per-user daily cap blocks once reached", async () => {
    const u = await newUser();
    await db.query("select public.admin_set_limits($1,$2,'{\"daily_fill_cap\": 2}'::jsonb,'trial limits')", [admin, u]);
    await asUser(u);
    await db.query("select public.log_fill_usage()");
    expect((await ent(u)).allowed).toBe(true);
    await db.query("select public.log_fill_usage()");
    expect(await ent(u)).toMatchObject({ allowed: false, reason: "daily_cap" });
  });

  it("feature flags resolve user override, then plan override, then default", async () => {
    const u = await newUser();
    const other = await newUser();
    await db.query("insert into public.feature_flags (key, default_enabled, overrides) values ('new_ats', false, $1::jsonb)",
      [JSON.stringify({ users: { [u]: true }, plans: { FREE: false } })]);
    expect((await one<{ r: boolean }>("select public.feature_flag_enabled('new_ats',$1) r", [u])).r).toBe(true);
    expect((await one<{ r: boolean }>("select public.feature_flag_enabled('new_ats',$1) r", [other])).r).toBe(false);
    await db.query("update public.feature_flags set default_enabled = true, overrides = '{}' where key='new_ats'");
    expect((await one<{ r: boolean }>("select public.feature_flag_enabled('new_ats',$1) r", [other])).r).toBe(true);
    expect((await one<{ r: boolean }>("select public.feature_flag_enabled('missing',$1) r", [other])).r).toBe(false);
    await asUser(u);
    expect((await one<{ f: any }>("select public.get_my_flags() f")).f).toMatchObject({ new_ats: true });
  });

  it("legacy usage this month is carried into the ledger by the migration backfill", async () => {
    const fresh = new PGlite();
    await fresh.exec(stub);
    const { rows } = await fresh.query<{ id: string }>("insert into auth.users (email) values ('old@example.com') returning id");
    const id = rows[0].id;
    await fresh.query("insert into public.profiles (id, email) values ($1,'old@example.com')", [id]);
    for (let i = 0; i < 3; i++) await fresh.query("insert into public.fill_usage_events (user_id) values ($1)", [id]);
    await fresh.exec(migration);
    const b = await fresh.query<{ balance: number }>("select balance from public.entitlements where user_id=$1", [id]);
    expect(b.rows[0].balance).toBe(2); // 5 allowance - 3 already used this month
    await fresh.close();
  });
});
