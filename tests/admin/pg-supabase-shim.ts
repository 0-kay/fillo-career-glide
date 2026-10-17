// A tiny stand-in for supabase-js, backed by PGlite, covering exactly the query-builder calls
// admin-api makes. It lets the real edge function run end to end in tests.
import type { PGlite } from "@electric-sql/pglite";

type Filter = { sql: (n: number) => string; value?: unknown; skip?: boolean };

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw new Error(`bad identifier ${s}`);
  return `"${s}"`;
};

class Builder implements PromiseLike<{ data: any; error: any; count?: number | null }> {
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private cols = "*";
  private payload: any;
  private onConflict?: string;
  private filters: Filter[] = [];
  private orderBy?: { col: string; asc: boolean };
  private lim?: number;
  private mode: "many" | "maybe" | "single" = "many";
  private head = false;
  private wantCount = false;
  private returning = false;

  constructor(private db: PGlite, private table: string) {}

  select(cols = "*", opts: { count?: string; head?: boolean } = {}) {
    if (this.op === "select") this.cols = cols;
    else this.returning = true;
    this.wantCount = !!opts.count;
    this.head = !!opts.head;
    return this;
  }
  insert(p: any) { this.op = "insert"; this.payload = p; return this; }
  update(p: any) { this.op = "update"; this.payload = p; return this; }
  upsert(p: any, o: { onConflict?: string } = {}) { this.op = "upsert"; this.payload = p; this.onConflict = o.onConflict; return this; }
  delete() { this.op = "delete"; return this; }

  eq(c: string, v: unknown) { this.filters.push({ sql: (n) => `${ident(c)} = $${n}`, value: v }); return this; }
  neq(c: string, v: unknown) { this.filters.push({ sql: (n) => `${ident(c)} <> $${n}`, value: v }); return this; }
  ilike(c: string, v: string) { this.filters.push({ sql: (n) => `${ident(c)} ilike $${n}`, value: v }); return this; }
  is(c: string, v: null) { this.filters.push({ sql: () => `${ident(c)} is null`, skip: true }); void v; return this; }
  not(c: string, _op: string, _v: null) { this.filters.push({ sql: () => `${ident(c)} is not null`, skip: true }); return this; }
  order(c: string, o: { ascending?: boolean } = {}) { this.orderBy = { col: c, asc: o.ascending !== false }; return this; }
  limit(n: number) { this.lim = n; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  single() { this.mode = "single"; return this; }

  private where(start: number): { text: string; values: unknown[] } {
    const values: unknown[] = [];
    const parts = this.filters.map((f) => {
      if (f.skip) return f.sql(0);
      values.push(f.value);
      return f.sql(start + values.length - 1);
    });
    return { text: parts.length ? " where " + parts.join(" and ") : "", values };
  }

  private async exec() {
    const t = `public.${ident(this.table)}`;
    let sql: string;
    let params: unknown[] = [];
    const j = (v: unknown) => (v !== null && typeof v === "object" ? JSON.stringify(v) : v);

    if (this.op === "select") {
      const w = this.where(1);
      params = w.values;
      if (this.head && this.wantCount) sql = `select count(*)::int as count from ${t}${w.text}`;
      else {
        sql = `select ${this.cols === "*" ? "*" : this.cols.split(",").map((c) => ident(c.trim())).join(", ")} from ${t}${w.text}`;
        if (this.orderBy) sql += ` order by ${ident(this.orderBy.col)} ${this.orderBy.asc ? "asc" : "desc"}`;
        if (this.lim) sql += ` limit ${Number(this.lim)}`;
      }
    } else if (this.op === "insert" || this.op === "upsert") {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
      const keys = Object.keys(rows[0]);
      const tuples = rows.map((r) => `(${keys.map((k) => { params.push(j(r[k])); return `$${params.length}`; }).join(", ")})`);
      sql = `insert into ${t} (${keys.map(ident).join(", ")}) values ${tuples.join(", ")}`;
      if (this.op === "upsert") {
        const conflict = this.onConflict ?? keys[0];
        sql += ` on conflict (${conflict.split(",").map((c) => ident(c.trim())).join(", ")}) do update set ` +
          keys.filter((k) => k !== conflict).map((k) => `${ident(k)} = excluded.${ident(k)}`).join(", ");
      }
      if (this.returning || this.mode !== "many") sql += " returning *";
    } else if (this.op === "update") {
      const keys = Object.keys(this.payload);
      const sets = keys.map((k) => { params.push(j(this.payload[k])); return `${ident(k)} = $${params.length}`; });
      const w = this.where(params.length + 1);
      params.push(...w.values);
      sql = `update ${t} set ${sets.join(", ")}${w.text}`;
      if (this.returning || this.mode !== "many") sql += " returning *";
    } else {
      const w = this.where(1);
      params = w.values;
      sql = `delete from ${t}${w.text}`;
    }

    try {
      const res = await this.db.query<any>(sql, params);
      if (this.head && this.wantCount) return { data: null, error: null, count: res.rows[0].count };
      const rows = res.rows;
      if (this.mode === "many") return { data: rows, error: null, count: null };
      if (this.mode === "single" && rows.length !== 1) return { data: null, error: { message: "single row expected" } };
      return { data: rows[0] ?? null, error: null, count: null };
    } catch (e) {
      const err = e as { message: string; code?: string };
      return { data: null, error: { message: err.message, code: err.code } };
    }
  }

  then<R1 = any, R2 = never>(
    ok?: ((v: { data: any; error: any; count?: number | null }) => R1 | PromiseLike<R1>) | null,
    err?: ((e: unknown) => R2 | PromiseLike<R2>) | null,
  ) {
    return this.exec().then(ok, err);
  }
}

export function makeShim(db: PGlite) {
  return {
    from: (table: string) => new Builder(db, table),
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      const names = Object.keys(args);
      const call = names.map((n, i) => `${ident(n)} => $${i + 1}`).join(", ");
      const values = names.map((n) => {
        const v = args[n];
        return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
      });
      try {
        const res = await db.query<{ r: unknown }>(`select public.${ident(fn)}(${call}) as r`, values as any[]);
        return { data: res.rows[0]?.r ?? null, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
  };
}
