import type {
  ChoiceQuestion,
  EntryType,
  NoulQuestion,
  ScoreQuestion,
} from "./types.ts";

export const choice = (
  instructions: EntryType,
  criteria: Record<string, EntryType>,
): ChoiceQuestion => ({ type: "choice", instructions, criteria });

export const noul = (
  instructions: EntryType,
  criteria?: NoulQuestion["criteria"],
): NoulQuestion => ({ type: "noul", instructions, criteria });

export const score = (
  instructions: EntryType,
  criteria: readonly [EntryType, EntryType, ...EntryType[]],
): ScoreQuestion => ({ type: "score", instructions, criteria });

/** Label used across every Choice for "nothing here fits". */
export const NO_MATCH = "__none__";

/** Choice confidence is 0..1; every caller in this codebase speaks 0..100. */
export const toPercent = (confidence: number): number =>
  Math.round(Math.max(0, Math.min(1, confidence)) * 100);
