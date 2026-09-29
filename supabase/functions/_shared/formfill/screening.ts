// Answers application questions from the applicant's saved answers.
//
// Two question shapes, two strategies:
//   choice  (options on the page, or a yes/no question): the model picks one of the page's own
//           options using the saved Q&A as its only evidence. It does not copy a saved answer,
//           because related questions can need opposite answers: "Do you need sponsorship?" (No)
//           vs "Can you work here without sponsorship?" (Yes).
//   open    ("How did you hear about us?", "Salary expectations"): the model picks which saved
//           question asks the same thing, and the saved answer text is used verbatim.
// Either way the model only selects: an option on the page or an index into saved answers.
//
// Shared state holds the saved answers only, never the other questions on the form, so a
// question gets the same answer whatever else the form asks (batch composition used to move
// confidence by 10+ points).

import { choice, NO_MATCH, toPercent } from "../typesafe/questions.ts";
import { canonicalKey } from "./canonical.ts";
import { isChoice, type Questions, type SystemOneFn } from "../typesafe/types.ts";

export interface SavedAnswer {
  key?: string;
  id?: string;
  question?: string;
  answer?: unknown;
  enabled?: boolean;
}

export interface ScreeningItem {
  index: number;
  question: string;
  /** Page options; empty for a free-text field. */
  options: string[];
}

export type ScreeningResult =
  | { kind: "option"; value: string; confidence: number }
  /** key is the canonical question key, or null for a question the applicant wrote (not cacheable). */
  | { kind: "saved"; key: string | null; value: string; confidence: number };

const YES_NO_START = /^(are|do|does|did|will|would|can|could|have|has|is|were|was|should|may)\b/i;

/** Yes/no questions typed into a text box still have exactly two answers. */
export function implicitOptions(question: string, options: string[]): string[] {
  if (options.length) return options;
  return YES_NO_START.test(question.trim()) ? ["Yes", "No"] : [];
}

export async function answerScreening(
  systemOne: SystemOneFn,
  items: ScreeningItem[],
  saved: SavedAnswer[],
  minConfidence: number,
): Promise<Map<number, ScreeningResult>> {
  const out = new Map<number, ScreeningResult>();
  const usable = saved
    .map((sa, i) => ({ sa, i }))
    .filter(({ sa }) => sa.enabled !== false && sa.question && sa.answer != null && String(sa.answer).trim());
  if (!items.length || !usable.length) return out;

  const questions: Questions = {};
  const plans = new Map<string, { item: ScreeningItem; options: string[] }>();

  for (const item of items) {
    const options = implicitOptions(item.question, item.options);
    const key = `s${item.index}`;
    if (options.length) {
      const criteria: Record<string, string> = {};
      options.forEach((o, i) => (criteria[String(i)] = o));
      criteria[NO_MATCH] =
        "The saved answers do not settle this question. Leave it for the applicant.";
      questions[key] = choice(
        {
          task: "Answer one job application question on the applicant's behalf, using only their saved answers.",
          application_question: item.question,
          evidence: "`saved_answers`: questions the applicant has answered before, with their answers.",
          option_labels: "Each label indexes the options shown on the form; its description is the option text.",
          guidance: [
            "Choose an option only when the saved answers state it or it follows directly from them.",
            "Mind the wording: a question can ask the opposite of a saved question (needing sponsorship vs working without it).",
            "Combine saved answers when the question needs more than one of them.",
            `Choose ${NO_MATCH} when the saved answers are about something else, or do not decide between the options.`,
          ],
        },
        criteria,
      );
    } else {
      const criteria: Record<string, string> = {};
      for (const { sa, i } of usable) criteria[String(i)] = String(sa.question);
      criteria[NO_MATCH] = "No saved question asks what this question asks.";
      questions[key] = choice(
        {
          task: "Find the saved question that asks exactly what this job application question asks.",
          application_question: item.question,
          option_labels: "Each label indexes `saved_answers`; its description is that saved question.",
          guidance: [
            "Match on what is being asked, not on shared words.",
            `Choose ${NO_MATCH} rather than a question on a related but different subject.`,
          ],
        },
        criteria,
      );
    }
    plans.set(key, { item, options });
  }

  const response = await systemOne({
    state: {
      saved_answers: usable.map(({ sa }) => ({ question: String(sa.question), answer: String(sa.answer) })),
    },
    questions,
  });

  for (const [key, { item, options }] of plans) {
    const a = response.answers[key];
    if (!isChoice(a) || a.choice === NO_MATCH) continue;
    const confidence = toPercent(a.confidence);
    if (confidence < minConfidence) continue;
    const n = Number.parseInt(a.choice, 10);
    if (!Number.isInteger(n)) continue;

    if (options.length) {
      if (options[n] !== undefined) out.set(item.index, { kind: "option", value: options[n], confidence });
    } else {
      const sa = saved[n];
      if (sa) out.set(item.index, { kind: "saved", key: canonicalKey(sa), value: String(sa.answer), confidence });
    }
  }
  return out;
}
