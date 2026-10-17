import { describe, expect, it } from "vitest";
import {
  can, corsOrigin, decodeClaims, hasMfa, ipAllowed, isUuid, makeRateLimiter, recentMfa,
} from "../../supabase/functions/_shared/admin/authz.ts";
import { resolveRange } from "../../supabase/functions/_shared/admin/range.ts";
import { csvCell, toCsv } from "../../supabase/functions/_shared/admin/csv.ts";
import { fromDbError } from "../../supabase/functions/_shared/admin/errors.ts";

const jwt = (claims: object) =>
  `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.y`;

describe("authz", () => {
  it("role capability matrix", () => {
    expect(can("owner", "admins")).toBe(true);
    expect(can("admin", "users")).toBe(true);
    expect(can("admin", "platform")).toBe(false);
    expect(can("admin", "admins")).toBe(false);
    expect(can("viewer", "read")).toBe(true);
    expect(can("viewer", "users")).toBe(false);
    expect(can("viewer", "bulk")).toBe(false);
    expect(can("nobody", "read")).toBe(false);
    expect(can(null, "read")).toBe(false);
  });

  it("reads aal and recent TOTP from claims", () => {
    const now = 1_700_000_000;
    const c = decodeClaims(jwt({ aal: "aal2", amr: [{ method: "totp", timestamp: now - 60 }] }));
    expect(hasMfa(c)).toBe(true);
    expect(recentMfa(c, now)).toBe(true);
    expect(recentMfa(c, now + 600)).toBe(false);
    expect(hasMfa(decodeClaims(jwt({ aal: "aal1" })))).toBe(false);
    expect(recentMfa(decodeClaims(jwt({ aal: "aal1", amr: [{ method: "totp", timestamp: now }] })), now)).toBe(false);
    expect(decodeClaims("garbage")).toEqual({});
  });

  it("ip allowlist: empty allows everyone, otherwise exact match", () => {
    expect(ipAllowed("1.2.3.4", undefined)).toBe(true);
    expect(ipAllowed(null, "")).toBe(true);
    expect(ipAllowed("1.2.3.4", "1.2.3.4, 5.6.7.8")).toBe(true);
    expect(ipAllowed("9.9.9.9", "1.2.3.4")).toBe(false);
    expect(ipAllowed(null, "1.2.3.4")).toBe(false);
  });

  it("rate limiter blocks past the max within the window", () => {
    const allow = makeRateLimiter(2, 1000);
    expect(allow("a", 0)).toBe(true);
    expect(allow("a", 10)).toBe(true);
    expect(allow("a", 20)).toBe(false);
    expect(allow("b", 20)).toBe(true);
    expect(allow("a", 1500)).toBe(true);
  });

  it("validates uuids and cors origins", () => {
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
    expect(isUuid("nope")).toBe(false);
    expect(corsOrigin("https://admin.fyllo.app", "https://admin.fyllo.app")).toBe("https://admin.fyllo.app");
    expect(corsOrigin("https://evil.example", "https://admin.fyllo.app")).toBeNull();
    expect(corsOrigin(null, undefined)).toBe("*");
  });
});

describe("range", () => {
  const now = Date.parse("2026-10-12T15:30:00Z");
  it("7d covers the last 7 UTC days and compares to the previous 7", () => {
    const r = resolveRange("7d", null, null, now);
    expect(r.current).toEqual({ from: "2026-10-06T00:00:00.000Z", to: "2026-10-13T00:00:00.000Z" });
    expect(r.previous).toEqual({ from: "2026-09-29T00:00:00.000Z", to: "2026-10-06T00:00:00.000Z" });
  });
  it("today is one day; custom is inclusive of its end date", () => {
    expect(resolveRange("today", null, null, now).current.from).toBe("2026-10-12T00:00:00.000Z");
    const c = resolveRange("custom", "2026-10-01", "2026-10-03", now);
    expect(c.current).toEqual({ from: "2026-10-01T00:00:00.000Z", to: "2026-10-04T00:00:00.000Z" });
    expect(c.previous.from).toBe("2026-09-28T00:00:00.000Z");
  });
  it("rejects invalid custom ranges", () => {
    expect(() => resolveRange("custom", "x", "2026-01-01", now)).toThrow();
    expect(() => resolveRange("custom", "2026-02-01", "2026-01-01", now)).toThrow();
    expect(() => resolveRange("custom", "2020-01-01", "2026-01-01", now)).toThrow();
  });
});

describe("csv", () => {
  it("quotes and neutralises formulas", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell(null)).toBe("");
    expect(toCsv(["a", "b"], [{ a: 1, b: "x" }])).toBe("a,b\r\n1,x\r\n");
  });
});

describe("db error mapping", () => {
  it("maps raised codes to statuses", () => {
    expect(fromDbError("reason_required")?.status).toBe(400);
    expect(fromDbError("insufficient_balance")?.status).toBe(409);
    expect(fromDbError("user_not_found")?.status).toBe(404);
    expect(fromDbError("something else")).toBeNull();
  });
});
