// Server-side résumé processing. Runs inside the edge function after the browser has
// uploaded the file, so a refresh or closed tab can no longer strand a profile on
// "Processing". All I/O is injected so the flow is testable without Supabase/OpenAI.
import { mapParsedResume } from "./map.ts";

type Obj = Record<string, any>;

export interface ProfileRecord {
  id: string;
  user_id: string;
  job_preferences: Obj | null;
  resume_metadata: Obj | null;
}

export interface PipelineDeps {
  loadProfile(id: string): Promise<ProfileRecord | null>;
  downloadResume(path: string): Promise<Uint8Array>;
  extractText(bytes: Uint8Array, fileName: string, fileType: string): Promise<string>;
  parseWithModel(text: string, fileName: string): Promise<Obj>;
  saveProfile(id: string, patch: Obj): Promise<void>;
  now?: () => string;
  retryDelayMs?: number;
}

export const MIN_TEXT_CHARS = 40;
const MAX_ATTEMPTS = 2;
// A model call may now take up to 2 minutes, so only retry failures that happened quickly
// (e.g. a 5xx); a second full-length attempt would outlive the edge function's wall clock.
const RETRY_ONLY_IF_FASTER_THAN_MS = 20_000;

async function markFailed(deps: PipelineDeps, id: string, error: string) {
  const fresh = await deps.loadProfile(id);
  await deps.saveProfile(id, {
    resume_metadata: { ...(fresh?.resume_metadata ?? {}), parsing_status: "Failed", error },
  });
}

export async function processResume(deps: PipelineDeps, profileId: string): Promise<"Completed" | "Failed"> {
  const profile = await deps.loadProfile(profileId);
  if (!profile) throw new Error("Profile not found");
  const meta = profile.resume_metadata ?? {};
  if (meta.parsing_status === "Completed") return "Completed";

  const filePath = meta.file_path as string | undefined;
  if (!filePath) {
    await markFailed(deps, profileId, "No résumé file was uploaded");
    return "Failed";
  }

  try {
    const bytes = await deps.downloadResume(filePath);
    const fileName = (meta.fileName as string) || filePath.split("/").pop() || "resume";
    const text = (await deps.extractText(bytes, fileName, (meta.fileType as string) || "")).trim();
    if (text.length < MIN_TEXT_CHARS) {
      throw new Error("No readable text found in the résumé (is it a scanned image?)");
    }

    let parsed: Obj | null = null;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !parsed; attempt++) {
      const startedAt = Date.now();
      try {
        parsed = await deps.parseWithModel(text, fileName);
      } catch (e) {
        lastError = e;
        if (Date.now() - startedAt > RETRY_ONLY_IF_FASTER_THAN_MS) break;
        if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, deps.retryDelayMs ?? 2000));
      }
    }
    if (!parsed) throw lastError instanceof Error ? lastError : new Error("Parsing failed");

    // Re-read right before saving so anything the user changed while we were parsing
    // (profile name, screening answers) is merged rather than overwritten.
    const fresh = (await deps.loadProfile(profileId)) ?? profile;
    const freshMeta = fresh.resume_metadata ?? {};
    const freshPrefs = fresh.job_preferences ?? {};

    const { row, completeness } = mapParsedResume(parsed, { screeningAnswers: freshPrefs.screening_answers });

    await deps.saveProfile(profileId, {
      ...row,
      job_preferences: { ...freshPrefs, ...(parsed.job_preferences ?? {}), ...(freshPrefs.screening_answers ? { screening_answers: freshPrefs.screening_answers } : {}) },
      resume_metadata: {
        ...freshMeta,
        openAIResponse: parsed,
        parsing_status: "Completed",
        parsed_at: (deps.now ?? (() => new Date().toISOString()))(),
        error: undefined,
        extractionQuality: {
          hasPersonalInfo: !!parsed.personalInfo,
          hasWorkExperience: row.work_experience.length > 0,
          hasEducation: row.education_history.length > 0,
          hasSkills: row.technical_skills.all.length > 0,
          hasProjects: row.projects.length > 0,
          dataCompleteness: completeness,
        },
      },
    });
    return "Completed";
  } catch (e) {
    await markFailed(deps, profileId, e instanceof Error ? e.message : "Processing failed");
    return "Failed";
  }
}
