import { describe, expect, it } from "vitest";
import {
  dedupeByValue,
  deriveCandidates,
  flattenProfile,
  rankCandidates,
} from "../../supabase/functions/_shared/typesafe/candidates.ts";
import {
  analyzeFields,
  coerceValue,
  toIsoDate,
} from "../../supabase/functions/_shared/typesafe/fields.ts";
import { matchOption } from "../../supabase/functions/_shared/typesafe/options.ts";
import type { SystemOneFn } from "../../supabase/functions/_shared/typesafe/types.ts";
import { profile } from "../fixtures/profile.ts";

describe("flattenProfile", () => {
  it("produces addressable paths for nested values", () => {
    const paths = flattenProfile(profile).map((c) => c.path);
    expect(paths).toContain("first_name");
    expect(paths).toContain("address.city");
    expect(paths).toContain("work_experience[0].company");
    expect(paths).toContain("skills[0]");
  });

  it("omits sensitive keys entirely", () => {
    const flat = flattenProfile({
      email: "a@b.com",
      password: "hunter2",
      billing: { card_number: "4111111111111111", ssn: "123-45-6789" },
    });
    expect(flat.map((c) => c.path)).toEqual(["email"]);
  });

  it("skips empty and null leaves", () => {
    const flat = flattenProfile({ a: "", b: null, c: "  ", d: "keep" });
    expect(flat.map((c) => c.path)).toEqual(["d"]);
  });

  it("keeps boolean and numeric leaves", () => {
    const flat = flattenProfile({ relocate: true, salary: 0 });
    expect(flat.find((c) => c.path === "relocate")?.raw).toBe(true);
    expect(flat.find((c) => c.path === "salary")?.raw).toBe(0);
  });
});

describe("deriveCandidates", () => {
  it("composes a full name the profile never stored", () => {
    const derived = deriveCandidates(flattenProfile(profile));
    const full = derived.find((c) => c.path === "derived.full_name");
    expect(full?.value).toBe("Amara Okonkwo");
  });

  it("counts repeated experience entries", () => {
    const derived = deriveCandidates(flattenProfile(profile));
    const count = derived.find((c) => c.path.endsWith("_count"));
    expect(count?.value).toBe("2");
  });
});

describe("dedupeByValue", () => {
  it("collapses duplicate values onto the shortest path", () => {
    const deduped = dedupeByValue([
      { path: "contact.details.email", value: "a@b.com", raw: "a@b.com" },
      { path: "email", value: "a@b.com", raw: "a@b.com" },
      { path: "other", value: "x", raw: "x" },
    ]);
    expect(deduped).toHaveLength(2);
    expect(deduped.find((c) => c.value === "a@b.com")?.path).toBe("email");
  });

  it("treats case and whitespace differences as the same value", () => {
    const deduped = dedupeByValue([
      { path: "a", value: "San Francisco", raw: "San Francisco" },
      { path: "b", value: "san  francisco", raw: "san  francisco" },
    ]);
    expect(deduped).toHaveLength(1);
  });
});

describe("rankCandidates", () => {
  it("puts the lexically relevant candidate first", () => {
    const ranked = rankCandidates(flattenProfile(profile), {
      name: "city",
      label: "City",
      type: "text",
    });
    expect(ranked[0].path).toBe("address.city");
  });

  it("boosts values that fit the input type", () => {
    const ranked = rankCandidates(flattenProfile(profile), {
      name: "contact",
      label: "Contact",
      type: "email",
    });
    expect(ranked[0].value).toContain("@");
  });
});

describe("toIsoDate", () => {
  it.each([
    ["06/2018", "2018-06-01"],
    ["03/15/2021", "2021-03-15"],
    ["2019-04-02", "2019-04-02"],
    ["June 2020", "2020-06-01"],
    ["Sept 2020", "2020-09-01"],
    ["Jan 5, 2022", "2022-01-05"],
  ])("parses %s", (input, want) => {
    expect(toIsoDate(input)).toBe(want);
  });

  it("returns null for text it cannot parse", () => {
    expect(toIsoDate("Present")).toBeNull();
  });
});

describe("coerceValue", () => {
  const c = (value: string, raw: string | number | boolean = value) => ({ path: "p", value, raw });

  it("casts checkbox values to booleans", () => {
    expect(coerceValue(c("true", true), { type: "checkbox" })).toBe(true);
    expect(coerceValue(c("No"), { type: "checkbox" })).toBe(false);
  });

  it("strips currency from numeric inputs", () => {
    expect(coerceValue(c("$185,000", 185000), { type: "number" })).toBe(185000);
  });

  it("rejects a non-email value for an email input", () => {
    expect(coerceValue(c("San Francisco"), { type: "email" })).toBeNull();
  });

  it("normalizes dates to ISO", () => {
    expect(coerceValue(c("06/2018"), { type: "date" })).toBe("2018-06-01");
    expect(coerceValue(c("06/2018"), { type: "month" })).toBe("2018-06");
  });
});

/** Answers questions from a path→answer table so engine wiring is testable offline. */
function fakeSystemOne(answers: Record<string, { choice: string; confidence: number }>): SystemOneFn {
  return async ({ questions }) => ({
    model: "fake",
    usage: { input_tokens: 0, output_tokens: 0 },
    answers: Object.fromEntries(
      Object.keys(questions).map((key) => {
        const a = answers[key] ?? { choice: "__none__", confidence: 1 };
        return [key, { type: "choice" as const, choice: a.choice, confidence: a.confidence, probabilities: {} }];
      }),
    ),
  });
}

describe("analyzeFields", () => {
  it("never sends a blocked field to the model", async () => {
    let asked: string[] = [];
    const spy: SystemOneFn = async (req) => {
      asked = Object.keys(req.questions);
      return { model: "fake", usage: { input_tokens: 0, output_tokens: 0 }, answers: {} };
    };
    const out = await analyzeFields(
      spy,
      [{ name: "password", type: "password" }, { name: "email", type: "email" }],
      profile,
    );
    expect(asked).toEqual(["f1"]);
    expect(out.results[0].shouldFill).toBe(false);
    expect(out.results[0].reasoning).toMatch(/never auto-filled/);
  });

  it("reads the value from the profile rather than from the model", async () => {
    const out = await analyzeFields(
      fakeSystemOne({ f0: { choice: "address.city", confidence: 0.95 } }),
      [{ name: "city", type: "text" }],
      profile,
    );
    expect(out.results[0]).toMatchObject({
      shouldFill: true,
      value: "San Francisco",
      dataPath: "address.city",
      confidence: 95,
    });
  });

  it("refuses a path the profile does not contain", async () => {
    const out = await analyzeFields(
      fakeSystemOne({ f0: { choice: "address.moon_base", confidence: 0.99 } }),
      [{ name: "city", type: "text" }],
      profile,
    );
    expect(out.results[0].shouldFill).toBe(false);
    expect(out.results[0].reasoning).toMatch(/unknown path/);
  });

  it("holds back a low-confidence selection but reports the path", async () => {
    const out = await analyzeFields(
      fakeSystemOne({ f0: { choice: "address.city", confidence: 0.4 } }),
      [{ name: "city", type: "text" }],
      profile,
    );
    expect(out.results[0]).toMatchObject({ shouldFill: false, confidence: 40, dataPath: "address.city" });
  });

  it("skips a value that would overflow maxLength", async () => {
    const out = await analyzeFields(
      fakeSystemOne({ f0: { choice: "address.street", confidence: 0.99 } }),
      [{ name: "addr", type: "text", maxLength: 5 }],
      profile,
    );
    expect(out.results[0].shouldFill).toBe(false);
    expect(out.results[0].reasoning).toMatch(/maxLength/);
  });

  it("returns one result per field even when nothing is filled", async () => {
    const out = await analyzeFields(fakeSystemOne({}), [{ name: "a" }, { name: "b" }, { name: "c" }], profile);
    expect(out.results.map((r) => r.fieldIndex)).toEqual([0, 1, 2]);
    expect(out.results.every((r) => !r.shouldFill)).toBe(true);
  });

  it("handles an empty profile without calling the model", async () => {
    let called = false;
    const spy: SystemOneFn = async () => {
      called = true;
      return { model: "fake", usage: { input_tokens: 0, output_tokens: 0 }, answers: {} };
    };
    const out = await analyzeFields(spy, [{ name: "a" }], {});
    expect(called).toBe(false);
    expect(out.results[0].shouldFill).toBe(false);
  });
});

describe("matchOption", () => {
  it("resolves an exact match without calling the model", async () => {
    let called = false;
    const spy: SystemOneFn = async () => {
      called = true;
      return { model: "fake", usage: { input_tokens: 0, output_tokens: 0 }, answers: {} };
    };
    const out = await matchOption(spy, "California", ["Nevada", "California", "Oregon"]);
    expect(called).toBe(false);
    expect(out.match).toMatchObject({ matchedOptionIndex: 1, confidence: 100, source: "exact" });
  });

  it("rejects an out-of-range index from the model", async () => {
    const out = await matchOption(
      fakeSystemOne({ match: { choice: "99", confidence: 0.99 } }),
      "Texas",
      ["Nevada", "California"],
    );
    expect(out.match.matchedOptionIndex).toBeNull();
  });

  it("returns null rather than guessing when the model declines", async () => {
    const out = await matchOption(
      fakeSystemOne({ match: { choice: "__none__", confidence: 0.9 } }),
      "Antarctica",
      ["Nevada", "California"],
    );
    expect(out.match.matchedOptionIndex).toBeNull();
    expect(out.match.source).toBe("typesafe");
  });
});
