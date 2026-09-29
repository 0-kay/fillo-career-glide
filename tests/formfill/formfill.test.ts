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
  matchFields,
  planFromCache,
  resolvePath,
  type MappingRow,
} from "../../supabase/functions/_shared/formfill/resolve.ts";
import { isQuestionLike, pickOption, ruleFor } from "../../supabase/functions/_shared/formfill/rules.ts";
import { buildPlan } from "../../supabase/functions/_shared/formfill/plan.ts";
import type { SystemOneFn } from "../../supabase/functions/_shared/typesafe/types.ts";

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
    expect(companyKey("https://job-boards.greenhouse.io/embed/job_app?for=MongoDB&token=1")).toBe("job-boards.greenhouse.io/mongodb");
    // A shared board with no tenant must not pool companies together.
    expect(companyKey("https://job-boards.greenhouse.io/embed/job_app?token=1")).toBe("");
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

  it("finds values where real profiles keep them", () => {
    // EEO answers exist only as screening answers; the site is saved as `portfolio`.
    expect(resolvePath(profile, "job_preferences.eeo.gender")).toBe("Female");
    expect(resolvePath(profile, "job_preferences.eeo.disability_status")).toMatch(/^No, I do not have a disability/);
    expect(resolvePath(profile, "personal_details.website")).toBe("https://amara.dev");
    expect(resolvePath(profile, "screening:veteran")).toBe("I am not a protected veteran");
    // snake_case config paths still read camelCase profiles
    expect(resolvePath(profile, "work_experience.0.job_title")).toBe("Senior Software Engineer");
    // education dates are { year, month } objects in real profiles
    expect(resolvePath(profile, "education_history.0.startDate")).toBe("09/2014");
    expect(resolvePath({ e: { year: "2018" } }, "e")).toBe("2018");
    expect(resolvePath(profile, "personal_details.countryPhoneCode")).toBe("United States of America");
    // an unanswered default question is a gap, not an empty string
    expect(resolvePath(profile, "screening:race")).toBeNull();
  });

  it("composes a full name when the profile has none", () => {
    expect(resolvePath({ first_name: "Ada", last_name: "Lovelace" }, "personal_details.fullName")).toBe("Ada Lovelace");
  });
});

describe("rules", () => {
  it("resolves standard fields without a model", () => {
    expect(ruleFor({ autocomplete: "given-name", label: "Whatever" })?.path).toBe("first_name");
    expect(ruleFor({ type: "email" })?.path).toBe("personal_details.email");
    expect(ruleFor({ label: "LinkedIn Profile" })?.path).toBe("personal_details.linkedin");
    expect(ruleFor({ label: "", name: "urls[LinkedIn]" })?.path).toBe("personal_details.linkedin");
  });

  it("never matches on substrings", () => {
    expect(ruleFor({ label: "Have you ever worked for this company?" })).toBeNull();
    expect(ruleFor({ label: "Do you have a disability?" })).toBeNull();
  });

  it("detects questions", () => {
    expect(isQuestionLike({ label: "Are you legally authorized to work in the US?*" })).toBe(true);
    expect(isQuestionLike({ label: "Email" })).toBe(false);
    expect(isQuestionLike({ label: "Relocation", options: ["Yes", "No"] })).toBe(true);
  });

  it("maps answers onto the page's option text", () => {
    expect(pickOption("Yes", ["Yes, I am authorized", "No, I am not"])).toBe("Yes, I am authorized");
    expect(pickOption("No", ["Yes", "No"])).toBe("No");
    expect(pickOption("Female", ["Male", "Female", "Decline"])).toBe("Female");
    expect(pickOption("Maybe", ["Yes", "No"])).toBe("Maybe");
  });
});

describe("buildPlan", () => {
  const fakeModel = (answers: Record<string, { choice: string; confidence: number }>): SystemOneFn =>
    (async () => ({
      answers: Object.fromEntries(
        Object.entries(answers).map(([k, v]) => [k, { type: "choice", probabilities: {}, ...v }]),
      ),
      model: "fake",
      usage: { input_tokens: 0, output_tokens: 0 },
    })) as unknown as SystemOneFn;

  it("offline: fills rules, reports what would need the model", async () => {
    const r = await buildPlan(
      [
        { type: "text", name: "first_name", label: "First Name" },
        { type: "text", label: "Why do you want to work here?" },
        { type: "file", name: "resume" },
      ],
      [],
      profile,
      { systemOne: null, modelBudget: 5 },
    );
    expect(r.entries.map((e) => [e.fieldIndex, e.source, e.value])).toEqual([[0, "rule", "Amara"]]);
    expect(r.stats.fromRules).toBe(1);
  });

  it("spends a capped budget on required fields first", async () => {
    const r = await buildPlan(
      [
        { type: "text", label: "Optional custom thing" },
        { type: "text", label: "Required custom thing", required: true },
      ],
      [],
      profile,
      { systemOne: null, modelBudget: 1 },
    );
    expect(r.stats.overBudget).toBe(1);
  });

  it("answers a choice question with the page's option and does not cache the derived answer", async () => {
    const d = [{ type: "radio", label: "Are you legally authorized to work in the US?", options: ["Yes", "No"] }];
    const r = await buildPlan(d, [], profile, {
      systemOne: fakeModel({ s0: { choice: "0", confidence: 0.95 }, f0: { choice: "__none__", confidence: 0.9 } }),
      modelBudget: 5,
    });
    expect(r.entries[0]).toMatchObject({ source: "screening", value: "Yes", dataPath: null });
    expect(r.learned).toHaveLength(0);
  });

  it("reuses a saved answer verbatim for an open question and caches it by key", async () => {
    // saved index 13 is the gender answer in the fixture profile; open question (no options).
    const d = [{ type: "text", label: "How do you describe your gender identity?" }];
    const r = await buildPlan(d, [], profile, {
      systemOne: fakeModel({ s0: { choice: "13", confidence: 0.9 }, f0: { choice: "__none__", confidence: 0.9 } }),
      modelBudget: 5,
    });
    expect(r.entries[0]).toMatchObject({ source: "screening", value: "Female", dataPath: "screening:gender" });
    expect(r.learned[0].profilePath).toBe("screening:gender");
  });
});
