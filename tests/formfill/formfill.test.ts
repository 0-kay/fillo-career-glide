import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  companyKey,
  fieldSignature,
  formFingerprint,
  hostMatchesPattern,
  signatureFromParts,
  stableToken,
} from "../../supabase/functions/_shared/formfill/signature.ts";
import {
  isTrusted,
  learnedFromModel,
  matchFields,
  planFromCache,
  resolvePath,
  type MappingRow,
} from "../../supabase/functions/_shared/formfill/resolve.ts";

const profile = JSON.parse(readFileSync("tests/ats/profile.json", "utf8"));

let n = 0;
function row(over: Partial<MappingRow> & { type?: string }): MappingRow {
  const type = over.type ?? "text";
  const name = over.field_name ?? "";
  const label = over.field_label ?? "";
  return {
    id: `id-${++n}`,
    scope: "platform",
    domain_pattern: "*.greenhouse.io",
    platform: "greenhouse",
    signature: signatureFromParts(type, name, label),
    field_name: name,
    field_label: label,
    field_type: type,
    profile_path: "first_name",
    meta: {},
    source: "seed",
    confidence: 100,
    success_count: 0,
    override_count: 0,
    ...over,
  };
}

describe("signatures", () => {
  it("ignores framework-generated ids and required markers", () => {
    expect(stableToken("input-4")).toBe("");
    expect(stableToken("a1b2c3d4e5f6")).toBe("");
    expect(stableToken("-1_PersonProfileFields.PhoneType")).toBe("personprofilefields.phonetype");
    expect(fieldSignature({ type: "text", name: "email", label: "Email *" })).toBe(
      fieldSignature({ type: "text", name: "email", label: "Email" }),
    );
  });

  it("keys company scope by tenant on shared job boards only", () => {
    expect(companyKey("https://boards.greenhouse.io/acme/jobs/123")).toBe("boards.greenhouse.io/acme");
    expect(companyKey("https://acme.wd5.myworkdayjobs.com/en-US/careers/job/x")).toBe("acme.wd5.myworkdayjobs.com");
    expect(companyKey("not a url")).toBe("");
  });

  it("matches wildcard patterns to subdomains only", () => {
    expect(hostMatchesPattern("boards.greenhouse.io", "*.greenhouse.io")).toBe(true);
    expect(hostMatchesPattern("greenhouse.io", "*.greenhouse.io")).toBe(false);
    expect(hostMatchesPattern("evilgreenhouse.io", "*.greenhouse.io")).toBe(false);
  });

  it("fingerprint is order independent and changes when a field changes", () => {
    const a = { type: "text", name: "a", label: "A" };
    const b = { type: "text", name: "b", label: "B" };
    expect(formFingerprint([a, b])).toBe(formFingerprint([b, a]));
    expect(formFingerprint([a, b])).not.toBe(formFingerprint([a, { ...b, label: "C" }]));
  });
});

describe("matchFields", () => {
  it("matches by stable name even if the label was reworded", () => {
    const rows = [row({ field_name: "first_name", field_label: "first name" })];
    const { matches } = matchFields([{ type: "text", name: "first_name", label: "Given name" }], rows);
    expect(matches.get(0)?.id).toBe(rows[0].id);
  });

  it("does not guess when a label repeats on the form", () => {
    const rows = [row({ field_label: "type", profile_path: "personal_details.phoneType" })];
    const d = [
      { type: "text", label: "Type" },
      { type: "text", label: "Type" },
    ];
    expect(matchFields(d, rows).matches.size).toBe(0);
  });

  it("does not guess when rows disagree on what a label means", () => {
    const rows = [
      row({ field_label: "country", profile_path: "a" }),
      row({ field_label: "country", profile_path: "b", domain_pattern: "*.other.com" }),
    ];
    expect(matchFields([{ type: "text", label: "Country" }], rows).matches.size).toBe(0);
  });

  it("prefers company rows over platform rows", () => {
    const platform = row({ field_name: "email", profile_path: "personal_details.email" });
    const company = row({
      field_name: "email",
      scope: "company",
      source: "llm",
      profile_path: "personal_details.workEmail",
      confidence: 80,
    });
    const { matches } = matchFields([{ type: "text", name: "email", label: "Email" }], [platform, company]);
    expect(matches.get(0)?.id).toBe(company.id);
  });
});

describe("feedback", () => {
  it("distrusts a row users keep correcting, but not one with few samples", () => {
    expect(isTrusted(row({ success_count: 2, override_count: 2 }))).toBe(true);
    expect(isTrusted(row({ success_count: 3, override_count: 3 }))).toBe(false);
    expect(isTrusted(row({ success_count: 50, override_count: 3 }))).toBe(true);
  });

  it("demoted company rows are reported for replacement; demoted platform rows fall through", () => {
    const bad = row({ scope: "company", source: "llm", field_name: "q1", success_count: 0, override_count: 4 });
    const seed = row({ field_name: "q2", success_count: 0, override_count: 4 });
    const { matches, demoted } = matchFields(
      [{ type: "text", name: "q1" }, { type: "text", name: "q2" }],
      [bad, seed],
    );
    expect(matches.size).toBe(0);
    expect(demoted.get(0)?.id).toBe(bad.id);
    expect(demoted.has(1)).toBe(false);
  });
});

describe("planFromCache", () => {
  it("resolves values from the profile on the server", () => {
    const rows = [
      row({ field_name: "email", profile_path: "personal_details.email", field_type: "email", type: "email", field_label: "email" }),
    ];
    const plan = planFromCache([{ type: "email", name: "email", label: "Email" }], rows, profile);
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0].value).toBe(profile.personal_details.email);
    expect(plan.entries[0].source).toBe("cache");
  });

  it("leaves a field blank when the mapped profile value is empty, rather than re-asking the model", () => {
    const rows = [row({ field_name: "middle", profile_path: "does.not.exist" })];
    const plan = planFromCache([{ type: "text", name: "middle" }], rows, profile);
    expect(plan.entries).toHaveLength(0);
    expect(plan.unresolved).toHaveLength(0);
  });

  it("sends unmatched fields to the model and never fills passwords or files", () => {
    const plan = planFromCache(
      [
        { type: "text", name: "custom_q", label: "Favourite colour" },
        { type: "password", name: "pw" },
        { type: "file", name: "cv" },
      ],
      [],
      profile,
    );
    expect(plan.unresolved).toEqual([0]);
  });

  it("uses the row default when the profile has no value", () => {
    const rows = [row({ field_name: "phonetype", profile_path: "personal_details.phoneType", meta: { default: "Mobile" } })];
    const plan = planFromCache([{ type: "text", name: "phoneType" }], rows, { personal_details: {} });
    expect(plan.entries[0].value).toBe("Mobile");
  });

  it("composes a full name when the profile has none", () => {
    expect(resolvePath({ first_name: "Ada", last_name: "Lovelace" }, "personal_details.fullName")).toBe("Ada Lovelace");
  });
});

describe("learnedFromModel", () => {
  const d = { type: "text", name: "phone", label: "Phone" };
  it("saves confident choices", () => {
    const r = learnedFromModel(d, { shouldFill: true, confidence: 90, dataPath: "personal_details.phone" }, undefined, 70);
    expect(r.learn?.profilePath).toBe("personal_details.phone");
  });
  it("does not save low-confidence, path-less or identity-less choices", () => {
    expect(learnedFromModel(d, { shouldFill: true, confidence: 60, dataPath: "x" }, undefined, 70).learn).toBeNull();
    expect(learnedFromModel(d, { shouldFill: true, confidence: 90, dataPath: null }, undefined, 70).learn).toBeNull();
    expect(learnedFromModel({ type: "text" }, { shouldFill: true, confidence: 90, dataPath: "x" }, undefined, 70).learn).toBeNull();
  });
  it("replaces a demoted row instead of inserting", () => {
    const bad = row({ scope: "company" });
    expect(learnedFromModel(d, { shouldFill: true, confidence: 90, dataPath: "p" }, bad, 70).learn?.replaceId).toBe(bad.id);
  });
});
