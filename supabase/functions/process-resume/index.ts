// Parses an uploaded résumé on the server and writes the result to application_profiles.
// The browser only uploads the file and calls this once; processing continues in the
// background (EdgeRuntime.waitUntil), so refreshing or closing the tab changes nothing.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { processResume, type PipelineDeps, type ProfileRecord } from "../_shared/resume/pipeline.ts";
import { parseResumeWithOpenAI } from "../_shared/resume/openai.ts";
import { extractResumeText } from "../_shared/resume/extract.ts";
import { sendLifecycleEmail } from "../_shared/lifecycle-email.ts";
import { READY_THRESHOLD } from "../_shared/resume/completeness.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await supabase.auth.getUser(jwt);
  const userId = auth?.user?.id;
  if (!userId) return json({ error: "Unauthorized" }, 401);

  let profileId = "";
  try { profileId = String((await req.json()).profileId ?? ""); } catch { /* handled below */ }
  if (!profileId) return json({ error: "profileId is required" }, 400);

  const { data: owned } = await supabase
    .from("application_profiles").select("id, user_id, job_preferences, resume_metadata")
    .eq("id", profileId).eq("user_id", userId).maybeSingle();
  if (!owned) return json({ error: "Profile not found" }, 404);

  const status = (owned.resume_metadata as Record<string, unknown> | null)?.parsing_status;
  if (status === "Completed") return json({ status: "Completed" });

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  const deps: PipelineDeps = {
    loadProfile: async (id) => {
      const { data } = await supabase.from("application_profiles")
        .select("id, user_id, job_preferences, resume_metadata").eq("id", id).eq("user_id", userId).maybeSingle();
      return (data as ProfileRecord | null) ?? null;
    },
    downloadResume: async (path) => {
      const { data, error } = await supabase.storage.from("resumes").download(path);
      if (error || !data) throw new Error(`Could not read the uploaded résumé: ${error?.message ?? "missing file"}`);
      return new Uint8Array(await data.arrayBuffer());
    },
    extractText: extractResumeText,
    parseWithModel: (text, fileName) => {
      if (!apiKey) throw new Error("Résumé parsing is not configured (missing OPENAI_API_KEY)");
      return parseResumeWithOpenAI(apiKey, text, fileName);
    },
    saveProfile: async (id, patch) => {
      const { error } = await supabase.from("application_profiles").update(patch).eq("id", id).eq("user_id", userId);
      if (error) throw new Error(`Saving the profile failed: ${error.message}`);
    },
  };

  // Stamp the start so the dashboard can tell "working" from "abandoned".
  await deps.saveProfile(profileId, {
    resume_metadata: { ...(owned.resume_metadata ?? {}), parsing_status: "Processing", processing_started_at: new Date().toISOString(), error: undefined },
  });

  const startedKey = new Date().toISOString();
  const run = async () => {
    const outcome = await processResume(deps, profileId);
    const { data: row } = await supabase.from("application_profiles")
      .select("completeness, work_experience, education_history, technical_skills, resume_metadata")
      .eq("id", profileId).maybeSingle();
    const meta = (row?.resume_metadata ?? {}) as Record<string, any>;
    if (outcome === "Completed") {
      const completeness = Number(row?.completeness ?? 0);
      await sendLifecycleEmail(supabase, userId, `ready:${profileId}`, {
        kind: "resume_ready",
        profileName: String(meta.profile_name || meta.fileName || "Your"),
        completeness,
        jobs: (row?.work_experience ?? []).length,
        degrees: (row?.education_history ?? []).length,
        skills: (row?.technical_skills?.all ?? []).length,
        ready: completeness >= READY_THRESHOLD,
      });
    } else {
      await sendLifecycleEmail(supabase, userId, `failed:${profileId}:${startedKey}`, { kind: "resume_failed", reason: meta.error });
    }
  };
  EdgeRuntime.waitUntil(run().catch((e) => console.error("process-resume crashed", profileId, e)));
  return json({ status: "Processing" }, 202);
});
