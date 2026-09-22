import { choice, NO_MATCH, toPercent } from "./questions.ts";
import { isChoice, type SystemOneFn } from "./types.ts";

export interface OptionMatch {
  matchedOptionIndex: number | null;
  confidence: number;
  reasoning: string;
  source: "exact" | "typesafe" | "openai" | "none";
}

const normalize = (s: unknown) =>
  String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Exact and case-insensitive hits never need a model. */
function exactMatch(target: string, options: string[]): number | null {
  const t = normalize(target);
  if (!t) return null;
  const hit = options.findIndex((o) => normalize(o) === t);
  return hit === -1 ? null : hit;
}

export interface MatchOptionOutcome {
  match: OptionMatch;
  model: string | null;
  usage: { input_tokens: number; output_tokens: number } | null;
}

/**
 * Picks the dropdown option that means the same thing as the stored profile value.
 *
 * Options are addressed by index so the answer is an index into the caller's own
 * array — the model cannot return an option that is not on the page.
 */
export async function matchOption(
  systemOne: SystemOneFn,
  targetValue: string,
  options: string[],
  opts: { minConfidence?: number; model?: string } = {},
): Promise<MatchOptionOutcome> {
  const minConfidence = opts.minConfidence ?? 60;
  const cleaned = options.map((o) => String(o ?? "").trim());

  if (!targetValue || cleaned.length === 0) {
    return {
      match: { matchedOptionIndex: null, confidence: 0, reasoning: "nothing to match", source: "none" },
      model: null,
      usage: null,
    };
  }

  const exact = exactMatch(targetValue, cleaned);
  if (exact !== null) {
    return {
      match: {
        matchedOptionIndex: exact,
        confidence: 100,
        reasoning: "exact text match, resolved without the model",
        source: "exact",
      },
      model: null,
      usage: null,
    };
  }

  const criteria: Record<string, string> = {};
  cleaned.forEach((option, i) => {
    if (option) criteria[String(i)] = option;
  });
  criteria[NO_MATCH] = "None of the available options means the same thing as the stored value.";

  const response = await systemOne({
    state: { stored_value: targetValue, available_options: cleaned },
    questions: {
      match: choice(
        {
          task: "A form has a fixed list of options. Select the option that means the same thing as `stored_value`.",
          option_labels: "Each label is the option's index in `available_options`; its description is the option text.",
          guidance: [
            "Treat abbreviations, acronyms and common aliases as equivalent (\"B.Sc.\" and \"Bachelor of Science\", \"CA\" and \"California\").",
            `Choose ${NO_MATCH} when no option carries the same meaning, even if one looks superficially similar.`,
          ],
        },
        criteria,
      ),
    },
    model: opts.model,
  });

  const answer = response.answers.match;
  if (!isChoice(answer)) {
    return {
      match: { matchedOptionIndex: null, confidence: 0, reasoning: "no usable answer", source: "none" },
      model: response.model,
      usage: response.usage,
    };
  }

  const confidence = toPercent(answer.confidence);

  if (answer.choice === NO_MATCH) {
    return {
      match: { matchedOptionIndex: null, confidence, reasoning: "no option matches", source: "typesafe" },
      model: response.model,
      usage: response.usage,
    };
  }

  const index = Number.parseInt(answer.choice, 10);
  if (!Number.isInteger(index) || index < 0 || index >= cleaned.length) {
    return {
      match: { matchedOptionIndex: null, confidence, reasoning: "answer out of range", source: "none" },
      model: response.model,
      usage: response.usage,
    };
  }

  if (confidence < minConfidence) {
    return {
      match: {
        matchedOptionIndex: null,
        confidence,
        reasoning: `confidence ${confidence} below threshold ${minConfidence}`,
        source: "typesafe",
      },
      model: response.model,
      usage: response.usage,
    };
  }

  return {
    match: {
      matchedOptionIndex: index,
      confidence,
      reasoning: `matched "${cleaned[index]}"`,
      source: "typesafe",
    },
    model: response.model,
    usage: response.usage,
  };
}
