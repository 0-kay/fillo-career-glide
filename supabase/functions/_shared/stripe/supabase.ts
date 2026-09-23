import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { readEnv } from "../typesafe/client.ts";

/** Service-role client. Webhooks arrive with no user session, so updating a user's
 * billing row has to go through the service role, scoped explicitly by id/customer id
 * in each query below rather than relying on RLS. */
export function getServiceClient(): SupabaseClient {
  return createClient(
    readEnv("SUPABASE_URL") ?? "",
    readEnv("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
}
