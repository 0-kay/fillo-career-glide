export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });

export const preflight = (): Response => new Response(null, { headers: corsHeaders });

export const fail = (error: unknown, extra: Record<string, unknown> = {}): Response =>
  json({ success: false, error: (error as Error)?.message ?? String(error), ...extra }, 500);
