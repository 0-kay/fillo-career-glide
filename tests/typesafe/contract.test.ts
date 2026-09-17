// Asserts the engines still produce exactly what extension/content/ai.js parses.
// The edge handlers are thin wrappers over these, and Deno is not available here,
// so this is the closest we get to an integration test of the response contracts.
import { describe, expect, it } from "vitest";
import { analyzeFields } from "../../supabase/functions/_shared/typesafe/fields.ts";
import { matchOption } from "../../supabase/functions/_shared/typesafe/options.ts";
import { classifyScreeningQuestions } from "../../supabase/functions/_shared/typesafe/screening.ts";
import { systemOne } from "../../supabase/functions/_shared/typesafe/runtime.node.ts";
import { fields, profile, savedScreeningAnswers } from "../fixtures/profile.ts";

const live = process.env.TYPESAFE_API_KEY ? describe : describe.skip;

/** Mirrors the normalizer in ai.js analyzeBatchFieldsWithAI. */
function normalizeLikeExtension(results: unknown[]) {
  return results
    .map((raw) => {
      const r = raw as Record<string, unknown>;
      if (!r) return null;
      const fieldIndex =
        typeof r.fieldIndex === "number"
          ? r.fieldIndex
          : typeof r.index === "number"
            ? r.index
            : null;
      if (fieldIndex == null) return null;
      const shouldFill =
        typeof r.shouldFill === "boolean" ? r.shouldFill : r.shouldFill === "true";
      const value = r.value != null ? r.value : null;
      const confidence = typeof r.confidence === "number" ? r.confidence : undefined;
      return { fieldIndex, shouldFill, value, confidence };
    })
    .filter(Boolean);
}

live("batch analysis response contract", () => {
  it("survives the extension's normalizer with every field accounted for", async () => {
    const { results } = await analyzeFields(systemOne, fields, profile);
    const normalized = normalizeLikeExtension(results);

    expect(normalized).toHaveLength(fields.length);
    for (const row of normalized) {
      expect(typeof row!.fieldIndex).toBe("number");
      expect(typeof row!.shouldFill).toBe("boolean");
      expect(typeof row!.confidence).toBe("number");
      if (row!.shouldFill) expect(row!.value).not.toBeNull();
    }
    expect(normalized.map((r) => r!.fieldIndex)).toEqual(fields.map((_, i) => i));
  });

  it("reports confidence on a 0-100 scale, as the caller's threshold assumes", async () => {
    const { results } = await analyzeFields(systemOne, fields.slice(0, 4), profile);
    for (const r of results) {
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(100);
      expect(Number.isInteger(r.confidence)).toBe(true);
    }
  });
});

live("match option response contract", () => {
  it("returns a numeric index the extension will accept", async () => {
    const out = await matchOption(systemOne, "Bachelor of Science", [
      "High School",
      "Bachelor's Degree",
      "Master's Degree",
    ]);
    // ai.js: typeof data.match.matchedOptionIndex === 'number' && confidence >= 60
    expect(typeof out.match.matchedOptionIndex).toBe("number");
    expect(out.match.confidence).toBeGreaterThanOrEqual(60);
  });

  it("returns null rather than a low-confidence index the extension would use", async () => {
    const out = await matchOption(systemOne, "Quantum Basket Weaving", ["Yes", "No"]);
    expect(out.match.matchedOptionIndex).toBeNull();
  });
});

live("screening response contract", () => {
  it("returns saved-answer indices that resolve to real saved answers", async () => {
    const unmatched = [
      { originalIndex: 0, questionText: "Do you need visa sponsorship now or in future?" },
      { originalIndex: 1, questionText: "Tell us about your proudest achievement." },
    ];
    const out = await classifyScreeningQuestions(systemOne, unmatched, savedScreeningAnswers);

    for (const [, match] of out.matches) {
      expect(savedScreeningAnswers[match.savedIndex]).toBeDefined();
      expect(match.confidence).toBeGreaterThanOrEqual(60);
      expect(match.confidence).toBeLessThanOrEqual(100);
    }
    expect(out.matches.get(1)).toBeUndefined();
  });
});
