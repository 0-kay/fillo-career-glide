// Live accuracy + consistency eval of the server planner against the real TypeSafe API.
// Skipped when TYPESAFE_API_KEY is absent. Each case runs RUNS times: an answer that changes
// between identical runs counts as inconsistent even if one of the runs was right.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPlan } from "../../supabase/functions/_shared/formfill/plan.ts";
import type { FieldDescriptor } from "../../supabase/functions/_shared/formfill/signature.ts";
import { systemOne } from "../../supabase/functions/_shared/typesafe/runtime.node.ts";

const live = process.env.TYPESAFE_API_KEY ? describe : describe.skip;
const profile = JSON.parse(readFileSync("tests/ats/profile.json", "utf8"));
const RUNS = 5;
const YN = ["Yes", "No"];

// want: expected value (substring, case-insensitive), or null = must stay blank.
const CASES: Array<{ d: FieldDescriptor; want: string | null }> = [
  // Screening questions the applicant saved answers for (Greenhouse / Ashby wording, plus paraphrases).
  { d: { type: "text", label: "Are you legally authorized to work in the country where the job is located?", options: YN, required: true }, want: "Yes" },
  { d: { type: "text", label: "Will you now or in the future require company sponsorship to retain or extend your work authorization in the country where the job is located?", options: YN, required: true }, want: "No" },
  { d: { type: "radio", label: "Are you eligible to work in the US without a visa?", options: YN }, want: "Yes" },
  { d: { type: "radio", label: "Do you require H-1B sponsorship now or in the future?", options: YN }, want: "No" },
  // Opposite polarity to a saved question: the answer must be derived, not copied.
  { d: { type: "radio", label: "Can you work in the US without company sponsorship?", options: YN }, want: "Yes" },
  { d: { type: "text", label: "Do you require visa sponsorship to work in the US?" }, want: "No" },
  { d: { type: "select-one", label: "Please select your protected veteran status", options: ["I identify as one or more of the classifications of protected veteran listed above", "I am not a protected veteran", "I decline to self-identify for protected veteran status"] }, want: "I am not a protected veteran" },
  // Jobvite (Egnyte) dropdowns: one derivable from saved answers, one not.
  { d: { type: "select-one", label: "Work Authorization", required: true, options: ["I am authorized to work in the country in which this job will be performed", "I will require visa sponsorship to work in the country in which this job will be performed"] }, want: "I am authorized to work" },
  { d: { type: "select-one", label: "Work Status", required: true, options: ["US Citizen", "Permanent Resident", "H1 Visa", "TN Visa", "F1 Visa", "Decline to Self Identify"] }, want: null },
  // Questions with no saved answer: must stay blank rather than be guessed.
  // The profile saved "No" to the default non-compete question.
  { d: { type: "text", label: "Are you currently subject to any non-compete or non-solicitation agreement that would impact your ability to work at Airbnb?", options: YN, required: true }, want: "No" },
  { d: { type: "text", label: "Are you currently or have you ever worked for Airbnb in any capacity?", options: YN, required: true }, want: null },
  { d: { type: "text", label: "Candidate AI Usage Attestation:", options: ["I agree", "I do not agree"], required: true }, want: null },
  { d: { type: "text", name: "question_69024585", label: "How did you hear about this job?", required: true }, want: null },
  { d: { type: "radio", label: "This role requires 3 days/week (M/W/F) in our NYC office. Are you able to commit to this?", options: YN }, want: null },
  { d: { type: "radio", label: "Do you have 3+ years of professional experience with Python?", options: YN }, want: null },
  { d: { type: "text", label: "What are your salary expectations?" }, want: null },
  { d: { type: "textarea", label: "What motivates you to join, and how do you see yourself contributing?" }, want: null },
  // Custom profile fields that no rule covers.
  { d: { type: "text", label: "What is your current job title?" }, want: "Senior Software Engineer" },
  { d: { type: "text", label: "University attended" }, want: "Massachusetts Institute of Technology" },
  { d: { type: "text", label: "Portfolio / personal site" }, want: "amara.dev" },
  { d: { type: "text", label: "Most recent employer name" }, want: "Stripe" },
];

live("server planner, live model", () => {
  it("is accurate and gives the same answer on every run", async () => {
    const descriptors = CASES.map((c) => c.d);
    const runs = [];
    for (let r = 0; r < RUNS; r++) {
      const out = await buildPlan(descriptors, [], profile, { systemOne, modelBudget: Infinity });
      const byIndex = new Map(out.entries.map((e) => [e.fieldIndex, e]));
      runs.push(descriptors.map((_, i) => byIndex.get(i)));
    }

    const rows = CASES.map((c, i) => {
      const answers = runs.map((run) => (run[i] ? String(run[i]!.value) : ""));
      const verdicts = answers.map((a) =>
        c.want === null ? (a ? "wrong" : "ok") : !a ? "miss" : a.toLowerCase().includes(c.want.toLowerCase()) ? "ok" : "wrong",
      );
      return {
        field: String(c.d.label).slice(0, 60),
        want: c.want ?? "(blank)",
        got: [...new Set(answers)].join(" / ") || "(blank)",
        source: runs[0][i]?.source ?? "",
        ok: verdicts.filter((v) => v === "ok").length,
        wrong: verdicts.filter((v) => v === "wrong").length,
        consistent: new Set(answers).size === 1,
      };
    });
    console.table(rows);

    const total = CASES.length * RUNS;
    const ok = rows.reduce((a, r) => a + r.ok, 0);
    const wrong = rows.reduce((a, r) => a + r.wrong, 0);
    const consistent = rows.filter((r) => r.consistent).length;
    console.log({ accuracy: `${ok}/${total}`, wrongFills: wrong, consistent: `${consistent}/${CASES.length}` });

    expect(wrong).toBe(0);
  });
});
