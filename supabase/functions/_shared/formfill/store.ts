import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { readEnv } from "../typesafe/client.ts";
import { companyKey, hostMatchesPattern, hostOf, signatureFromParts } from "./signature.ts";
import type { MappingRow } from "./resolve.ts";

function db() {
  return createClient(readEnv("SUPABASE_URL") ?? "", readEnv("SUPABASE_SERVICE_ROLE_KEY") ?? "");
}

const COLUMNS =
  "id,scope,domain_pattern,platform,signature,field_name,field_label,field_type,profile_path,meta,source,confidence,success_count,override_count";

/** Company rows for this tenant plus every platform row whose wildcard covers the host. */
export async function loadMappings(url: string): Promise<MappingRow[]> {
  const host = hostOf(url);
  if (!host) return [];
  const client = db();

  const [company, platform] = await Promise.all([
    client.from("form_mappings").select(COLUMNS).eq("scope", "company").eq("domain_pattern", companyKey(url)),
    client.from("form_mappings").select(COLUMNS).eq("scope", "platform"),
  ]);
  if (company.error) throw company.error;
  if (platform.error) throw platform.error;

  const platformRows = (platform.data as MappingRow[]).filter((r) => hostMatchesPattern(host, r.domain_pattern));
  return [...(company.data as MappingRow[]), ...platformRows];
}

export interface LearnedMapping {
  type: string;
  name: string;
  label: string;
  profilePath: string;
  confidence: number;
  /** An untrusted company row this mapping supersedes. */
  replaceId?: string;
}

/**
 * Persists model-chosen mappings at company scope so the next fill skips the model.
 * New signatures are inserted; a demoted row is rewritten in place with fresh counters.
 * An existing trusted row is never overwritten.
 */
export async function saveLearned(url: string, platform: string | null, learned: LearnedMapping[]): Promise<void> {
  if (learned.length === 0) return;
  const key = companyKey(url);
  if (!key) return;
  const client = db();

  const inserts = learned.filter((l) => !l.replaceId);
  const replaces = learned.filter((l) => l.replaceId);

  if (inserts.length) {
    const { error } = await client.from("form_mappings").upsert(
      inserts.map((l) => ({
        scope: "company",
        domain_pattern: key,
        platform,
        signature: signatureFromParts(l.type, l.name, l.label),
        field_name: l.name,
        field_label: l.label,
        field_type: l.type,
        profile_path: l.profilePath,
        source: "llm",
        confidence: l.confidence,
      })),
      { onConflict: "scope,domain_pattern,kind,signature", ignoreDuplicates: true },
    );
    if (error) console.error("form_mappings insert failed:", error.message);
  }

  for (const l of replaces) {
    const { error } = await client
      .from("form_mappings")
      .update({
        profile_path: l.profilePath,
        confidence: l.confidence,
        success_count: 0,
        override_count: 0,
        missing_count: 0,
        last_verified_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", l.replaceId!)
      .eq("scope", "company");
    if (error) console.error("form_mappings replace failed:", error.message);
  }
}

export async function recordOutcomes(items: Array<{ id: string; outcome: string }>): Promise<void> {
  if (items.length === 0) return;
  const { error } = await db().rpc("record_form_mapping_outcomes", { p_items: items });
  if (error) throw error;
}

/** Feedback for model-learned rows, which the client only knows by signature. */
export async function recordOutcomesBySignature(
  url: string,
  items: Array<{ signature: string; outcome: string }>,
): Promise<void> {
  const key = companyKey(url);
  if (!key || items.length === 0) return;
  const { data, error } = await db()
    .from("form_mappings")
    .select("id,signature")
    .eq("scope", "company")
    .eq("domain_pattern", key)
    .in("signature", [...new Set(items.map((i) => i.signature))]);
  if (error) throw error;
  const idBySig = new Map((data ?? []).map((r: { id: string; signature: string }) => [r.signature, r.id]));
  await recordOutcomes(
    items.flatMap((i) => (idBySig.has(i.signature) ? [{ id: idBySig.get(i.signature)!, outcome: i.outcome }] : [])),
  );
}

/** Loads a profile row the caller owns. Returns null if it is not theirs. */
export async function loadProfile(userId: string, profileId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await db()
    .from("application_profiles")
    .select("*")
    .eq("id", profileId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as Record<string, unknown> | null;
}
