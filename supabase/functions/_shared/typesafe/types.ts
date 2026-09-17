// Wire-format types for the TypeSafe System One API.
// Declared locally rather than imported from @typesafe-ai/sdk so this module can be
// loaded unchanged by both Deno (edge functions) and Node (tests, apps/api).

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type EntryType = string | { [key: string]: JsonValue } | JsonValue[] | null;

export interface NoulQuestion {
  type: "noul";
  instructions?: EntryType;
  criteria?: { true?: EntryType; false?: EntryType } | null;
}

export interface ChoiceQuestion {
  type: "choice";
  instructions?: EntryType;
  criteria: Record<string, EntryType>;
}

export interface ScoreQuestion {
  type: "score";
  instructions?: EntryType;
  criteria: readonly [EntryType, EntryType, ...EntryType[]];
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type Questions = Record<string, Question>;

export interface NoulResponse {
  type: "noul";
  noul: number;
}

export interface ChoiceResponse {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface ScoreResponse {
  type: "score";
  score: number;
  confidence: number;
  legend: Record<string, EntryType>;
  probabilities: Record<string, number>;
}

export type Answer = NoulResponse | ChoiceResponse | ScoreResponse;

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

export interface SystemOneResult {
  model: string;
  answers: Record<string, Answer>;
  usage: Usage;
}

export interface SystemOneRequest {
  state: EntryType;
  questions: Questions;
  model?: string;
}

/** The single dependency the engines have on a runtime. Fakeable in tests. */
export interface SystemOneFn {
  (request: SystemOneRequest): Promise<SystemOneResult>;
}

export function isChoice(a: Answer | undefined): a is ChoiceResponse {
  return !!a && a.type === "choice";
}

export function isScore(a: Answer | undefined): a is ScoreResponse {
  return !!a && a.type === "score";
}

export function isNoul(a: Answer | undefined): a is NoulResponse {
  return !!a && a.type === "noul";
}
