import { choice, NO_MATCH, score, toPercent } from "./questions.ts";
import { isChoice, isScore, type SystemOneFn } from "./types.ts";

export interface MissedField {
  label?: string | null;
  placeholder?: string | null;
  name?: string | null;
  type?: string | null;
}

export type Category =
  | "education"
  | "experience"
  | "skills"
  | "personal"
  | "certifications"
  | "other";

export type Priority = "high" | "medium" | "low";
export type MissingDataType = "text" | "date" | "boolean" | "array" | "number";

export interface MissedSuggestion {
  category: Category;
  priority: Priority;
  suggestion: string;
  targetPath: string | null;
  missingDataType: MissingDataType;
  exampleValue: string | null;
  confidence: { category: number; priority: number; dataType: number };
}

const CATEGORY_CRITERIA: Record<Category, string> = {
  education: "Schools attended, degrees, majors, graduation dates, GPA.",
  experience: "Employers, job titles, employment dates, responsibilities.",
  skills: "Technical or professional skills, tools, spoken languages.",
  personal: "Name, contact details, address, work authorization, demographics.",
  certifications: "Licenses, certifications, professional credentials.",
  other: "Anything that does not belong to the categories above.",
};

const DATA_TYPE_CRITERIA: Record<MissingDataType, string> = {
  text: "One short free-text value, such as a job title, school name or description.",
  date: "One calendar date, such as a start, end or graduation date.",
  boolean: "One yes/no or checkbox answer.",
  array: "Several values at once, such as a list of skills or a list of languages.",
  number: "One numeric quantity, such as years of experience or a GPA.",
};

const EXAMPLE_BY_TYPE: Record<MissingDataType, string> = {
  text: "Senior Software Engineer",
  date: "2020-06-01",
  boolean: "Yes",
  array: "React, TypeScript, PostgreSQL",
  number: "5",
};

const PRIORITY_BY_SCORE: Priority[] = ["low", "medium", "high"];

const SECTION_BY_CATEGORY: Record<Category, string | null> = {
  education: "education_history",
  experience: "work_experience",
  skills: "skills",
  certifications: "certifications",
  personal: null,
  other: null,
};

function slug(field: MissedField): string {
  const source = field.name || field.label || field.placeholder || "";
  const s = String(source)
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || "value";
}

function describeField(field: MissedField): string {
  return (
    field.label?.trim() ||
    field.placeholder?.trim() ||
    field.name?.trim() ||
    "this field"
  );
}

/** Composed in code from the typed judgments — System One models select, they do not write. */
function composeSuggestion(
  field: MissedField,
  category: Category,
  section: string | null,
): string {
  const what = describeField(field);
  if (section) {
    return `Add "${what}" to your ${section.replace(/_/g, " ")} so this field fills automatically next time.`;
  }
  return `Add "${what}" to your ${category} details so this field fills automatically next time.`;
}

export interface TriageOutcome {
  suggestion: MissedSuggestion;
  model: string | null;
  usage: { input_tokens: number; output_tokens: number } | null;
}

/**
 * Classifies a batch of unfillable fields into a single actionable profile suggestion.
 *
 * Every free-text part of the result (the sentence, the example value, the target path)
 * is templated by code from typed answers, so nothing here is model-generated prose.
 */
export async function triageMissedFields(
  systemOne: SystemOneFn,
  missedFields: MissedField[],
  profile: unknown,
  opts: { model?: string } = {},
): Promise<TriageOutcome> {
  const primary = missedFields[0] ?? {};

  const sections = new Set<string>();
  if (profile && typeof profile === "object" && !Array.isArray(profile)) {
    for (const [key, value] of Object.entries(profile as Record<string, unknown>)) {
      if (Array.isArray(value) || (value && typeof value === "object")) sections.add(key);
    }
  }
  for (const s of Object.values(SECTION_BY_CATEGORY)) if (s) sections.add(s);

  const sectionCriteria: Record<string, string> = {};
  for (const s of sections) {
    sectionCriteria[s] = `The applicant's "${s.replace(/_/g, " ")}" section.`;
  }
  sectionCriteria[NO_MATCH] = "This belongs at the top level of the profile, not inside a section.";

  const response = await systemOne({
    state: {
      unfillable_fields: missedFields.map((f) => ({
        label: f.label ?? null,
        placeholder: f.placeholder ?? null,
        name: f.name ?? null,
        type: f.type ?? null,
      })),
      existing_profile_sections: [...sections],
    },
    questions: {
      category: choice(
        {
          task: "A job application asked for information the applicant's saved profile does not contain. Which part of a career profile does `unfillable_fields` belong to?",
        },
        CATEGORY_CRITERIA as Record<string, string>,
      ),
      data_type: choice(
        {
          task: "Consider what the applicant would have to type to answer the form field described in `unfillable_fields[0]`. What kind of value is that single answer?",
          note: "Judge the answer the applicant supplies, not how many form fields are listed.",
        },
        DATA_TYPE_CRITERIA as Record<string, string>,
      ),
      section: choice(
        {
          task: "Which existing profile section should the applicant add this information to?",
          note: "Labels are section names already present in the profile, or standard ones.",
        },
        sectionCriteria,
      ),
      priority: score(
        {
          task: "How much does missing `unfillable_fields` hurt this applicant across job applications generally?",
        },
        [
          "Rarely requested, or easy for the applicant to skip without consequence.",
          "Requested by some employers; its absence occasionally blocks an application.",
          "Requested by most employers; its absence repeatedly blocks or weakens applications.",
        ],
      ),
    },
    model: opts.model,
  });

  const categoryAnswer = response.answers.category;
  const dataTypeAnswer = response.answers.data_type;
  const sectionAnswer = response.answers.section;
  const priorityAnswer = response.answers.priority;

  const category: Category = isChoice(categoryAnswer)
    ? (categoryAnswer.choice as Category)
    : "other";

  const missingDataType: MissingDataType = isChoice(dataTypeAnswer)
    ? (dataTypeAnswer.choice as MissingDataType)
    : "text";

  const chosenSection =
    isChoice(sectionAnswer) && sectionAnswer.choice !== NO_MATCH
      ? sectionAnswer.choice
      : SECTION_BY_CATEGORY[category];

  const priority: Priority = isScore(priorityAnswer)
    ? PRIORITY_BY_SCORE[Math.min(2, Math.max(0, Math.round(priorityAnswer.score)))]
    : "medium";

  const key = slug(primary);
  const targetPath = chosenSection
    ? Array.isArray((profile as Record<string, unknown>)?.[chosenSection])
      ? `${chosenSection}[0].${key}`
      : `${chosenSection}.${key}`
    : key;

  return {
    suggestion: {
      category,
      priority,
      suggestion: composeSuggestion(primary, category, chosenSection),
      targetPath,
      missingDataType,
      exampleValue: EXAMPLE_BY_TYPE[missingDataType],
      confidence: {
        category: isChoice(categoryAnswer) ? toPercent(categoryAnswer.confidence) : 0,
        priority: isScore(priorityAnswer) ? toPercent(priorityAnswer.confidence) : 0,
        dataType: isChoice(dataTypeAnswer) ? toPercent(dataTypeAnswer.confidence) : 0,
      },
    },
    model: response.model,
    usage: response.usage,
  };
}
