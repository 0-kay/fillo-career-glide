// Live tests against the real TypeSafe API. Skipped when TYPESAFE_API_KEY is absent.
import { describe, expect, it } from "vitest";
import { analyzeFields } from "../../supabase/functions/_shared/typesafe/fields.ts";
import { triageMissedFields } from "../../supabase/functions/_shared/typesafe/missed.ts";
import { matchOption } from "../../supabase/functions/_shared/typesafe/options.ts";
import { classifyScreeningQuestions } from "../../supabase/functions/_shared/typesafe/screening.ts";
import { systemOne } from "../../supabase/functions/_shared/typesafe/runtime.node.ts";
import {
  expected,
  fields,
  profile,
  savedScreeningAnswers,
  screeningCases,
} from "../fixtures/profile.ts";

const live = process.env.TYPESAFE_API_KEY ? describe : describe.skip;

live("autofill over a whole form", () => {
  it("selects the right profile value for each field in one request", async () => {
    const started = Date.now();
    const out = await analyzeFields(systemOne, fields, profile);
    const elapsed = Date.now() - started;

    const rows = fields.map((f, i) => {
      const got = out.results[i];
      const want = expected[f.name as string];
      const ok = want === null ? !got.shouldFill : got.shouldFill && got.value === want;
      return { field: f.name, want, got: got.value, conf: got.confidence, ok };
    });

    const correct = rows.filter((r) => r.ok).length;
    console.table(rows);
    console.log({
      correct: `${correct}/${rows.length}`,
      latencyMs: elapsed,
      model: out.model,
      usage: out.usage,
      candidates: out.candidateCount,
      questions: out.questionCount,
    });

    // One request covered every field.
    expect(out.questionCount).toBe(fields.length - 1); // password is blocked client-side
    expect(correct / rows.length).toBeGreaterThanOrEqual(0.8);
  });

  it("declines to fill when the profile genuinely lacks the answer", async () => {
    const out = await analyzeFields(
      systemOne,
      [{ name: "securityClearance", type: "text", label: "Active security clearance level" }],
      profile,
    );
    expect(out.results[0].shouldFill).toBe(false);
  });

  it("never returns a value that is not in the profile", async () => {
    const out = await analyzeFields(systemOne, fields, profile);
    const profileText = JSON.stringify(profile).toLowerCase();
    for (const r of out.results) {
      if (!r.shouldFill || typeof r.value !== "string") continue;
      const inProfile =
        profileText.includes(r.value.toLowerCase()) ||
        r.dataPath?.startsWith("derived.") ||
        // dates and phones are reformatted by code from a profile value
        /^\d{4}-\d{2}(-\d{2})?$/.test(r.value);
      expect(inProfile, `${r.dataPath} → ${r.value}`).toBeTruthy();
    }
  });
});

live("dropdown option matching", () => {
  const cases: Array<{ target: string; options: string[]; want: number | null }> = [
    { target: "Bachelor of Science", options: ["High School", "Associate's Degree", "Bachelor's Degree", "Master's Degree", "Doctorate"], want: 2 },
    { target: "California", options: ["AL", "AK", "AZ", "AR", "CA", "CO"], want: 4 },
    { target: "Authorized to work in the US for any employer", options: ["Yes", "No"], want: 0 },
    { target: "I do not have a disability", options: ["Yes, I have a disability", "No, I do not have a disability", "I prefer not to answer"], want: 1 },
    { target: "Senior Software Engineer", options: ["Intern", "Junior", "Mid-level", "Senior", "Staff", "Principal"], want: 3 },
    { target: "Nigeria", options: ["United States", "Canada", "Mexico"], want: null },
  ];

  it.each(cases)("matches $target", async ({ target, options, want }) => {
    const out = await matchOption(systemOne, target, options);
    console.log({ target, got: out.match.matchedOptionIndex, want, conf: out.match.confidence, src: out.match.source });
    expect(out.match.matchedOptionIndex).toBe(want);
  });
});

live("screening question classification", () => {
  it("maps reworded questions onto saved answers in one request", async () => {
    const unmatched = screeningCases.map((c, i) => ({ originalIndex: i, questionText: c.text }));
    const started = Date.now();
    const out = await classifyScreeningQuestions(systemOne, unmatched, savedScreeningAnswers);
    const elapsed = Date.now() - started;

    const rows = screeningCases.map((c, i) => {
      const got = out.matches.get(i);
      return {
        question: c.text.slice(0, 52),
        want: c.expect,
        got: got?.savedIndex ?? null,
        conf: got?.confidence ?? 0,
        ok: (got?.savedIndex ?? null) === c.expect,
      };
    });

    const correct = rows.filter((r) => r.ok).length;
    console.table(rows);
    console.log({ correct: `${correct}/${rows.length}`, latencyMs: elapsed, usage: out.usage });

    expect(correct / rows.length).toBeGreaterThanOrEqual(0.8);
  });

  it("does not map an unrelated question onto a saved answer", async () => {
    const out = await classifyScreeningQuestions(
      systemOne,
      [{ originalIndex: 0, questionText: "Describe your favourite holiday destination." }],
      savedScreeningAnswers,
    );
    expect(out.matches.get(0)).toBeUndefined();
  });
});

live("missed field triage", () => {
  it("classifies a missing graduation date", async () => {
    const out = await triageMissedFields(
      systemOne,
      [{ label: "Expected graduation date", name: "gradDate", type: "date" }],
      { ...profile, education_history: [{ school: "MIT", degree: "BSc" }] },
    );
    console.log(out.suggestion);
    expect(out.suggestion.category).toBe("education");
    expect(out.suggestion.missingDataType).toBe("date");
    expect(out.suggestion.targetPath).toContain("education_history");
    expect(out.suggestion.suggestion).toMatch(/graduation/i);
  });

  it("rates a rarely-requested field lower than a universal one", async () => {
    const [rare, common] = await Promise.all([
      triageMissedFields(systemOne, [{ label: "Preferred desk orientation", name: "desk", type: "text" }], profile),
      triageMissedFields(systemOne, [{ label: "Work authorization status", name: "workAuth", type: "text" }], profile),
    ]);
    console.log({ rare: rare.suggestion.priority, common: common.suggestion.priority });
    const rank = { low: 0, medium: 1, high: 2 };
    expect(rank[common.suggestion.priority]).toBeGreaterThan(rank[rare.suggestion.priority]);
  });
});
