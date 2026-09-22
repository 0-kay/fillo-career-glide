import { choice, NO_MATCH, toPercent } from "./questions.ts";
import { isChoice, type Questions, type SystemOneFn } from "./types.ts";

export interface ScreeningAnswer {
  id?: string;
  question: string;
  answer: string;
  answerType?: "yes_no" | "text" | "select";
  answerOptions?: string[];
  keywords?: string[];
  enabled?: boolean;
}

export interface UnmatchedQuestion {
  originalIndex: number;
  questionText: string;
}

export interface ClassifiedMatch {
  savedIndex: number;
  confidence: number;
}

export interface ClassifyOutcome {
  matches: Map<number, ClassifiedMatch>;
  model: string | null;
  usage: { input_tokens: number; output_tokens: number } | null;
}

/**
 * Maps live application questions onto the applicant's pre-saved answers.
 *
 * The model only ever returns an index into savedAnswers, so answer text always comes
 * from what the applicant actually wrote — this function cannot invent an answer.
 */
export async function classifyScreeningQuestions(
  systemOne: SystemOneFn,
  unmatched: UnmatchedQuestion[],
  savedAnswers: ScreeningAnswer[],
  opts: { minConfidence?: number; model?: string } = {},
): Promise<ClassifyOutcome> {
  const minConfidence = opts.minConfidence ?? 60;
  const matches = new Map<number, ClassifiedMatch>();

  const usable = savedAnswers
    .map((sa, index) => ({ sa, index }))
    .filter(({ sa }) => sa.enabled !== false && sa.answer && sa.question);

  if (unmatched.length === 0 || usable.length === 0) {
    return { matches, model: null, usage: null };
  }

  const criteria: Record<string, unknown> = {};
  for (const { sa, index } of usable) {
    criteria[String(index)] = sa.keywords?.length
      ? { question: sa.question, also_covers: sa.keywords }
      : sa.question;
  }
  criteria[NO_MATCH] =
    "The application question is not asking what any saved question asks. Leave it for the applicant.";

  const questions: Questions = {};
  unmatched.forEach((u, position) => {
    questions[`q${position}`] = choice(
      {
        task: "An applicant pre-saved answers to common job application questions. Decide which saved question, if any, is asking the same thing as this one.",
        application_question: u.questionText,
        option_labels: "Each label indexes `saved_questions`; its description is that saved question.",
        guidance: [
          "Match on what is being asked, not on shared wording (\"work permit\", \"eligible to work\" and \"authorized to work\" ask the same thing).",
          "A question about a different subject is not a match even when the phrasing is close.",
          `Choose ${NO_MATCH} rather than forcing a weak match.`,
        ],
      },
      criteria as Record<string, never>,
    );
  });

  const response = await systemOne({
    state: {
      saved_questions: Object.fromEntries(
        usable.map(({ sa, index }) => [String(index), sa.question]),
      ),
      application_questions: unmatched.map((u) => u.questionText),
    },
    questions,
    model: opts.model,
  });

  unmatched.forEach((u, position) => {
    const answer = response.answers[`q${position}`];
    if (!isChoice(answer) || answer.choice === NO_MATCH) return;

    const savedIndex = Number.parseInt(answer.choice, 10);
    if (!Number.isInteger(savedIndex) || !savedAnswers[savedIndex]) return;

    const confidence = toPercent(answer.confidence);
    if (confidence < minConfidence) return;

    matches.set(u.originalIndex, { savedIndex, confidence });
  });

  return { matches, model: response.model, usage: response.usage };
}
