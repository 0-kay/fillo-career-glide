import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { readEnv } from "../_shared/typesafe/client.ts";
import { requireUser } from "../_shared/typesafe/auth.ts";
import { fail, json, preflight } from "../_shared/typesafe/http.ts";
import { getStripe } from "../_shared/stripe/client.ts";
import { getServiceClient } from "../_shared/stripe/supabase.ts";

/**
 * Opens the Stripe Billing Portal for the signed-in user, so they can update their
 * card, change plan, view invoices, or cancel — without us building any of that UI.
 * Returns { url } — redirect the browser there.
 */
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    const db = getServiceClient();
    const { data: profile, error } = await db
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", auth.id)
      .single();
    if (error) throw error;

    const customerId = profile?.stripe_customer_id as string | null;
    if (!customerId) {
      return json({ success: false, error: "No billing account yet — subscribe first." }, 400);
    }

    const appUrl = readEnv("APP_URL") ?? req.headers.get("origin") ?? "http://localhost:8080";
    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/settings`,
    });

    return json({ success: true, url: session.url });
  } catch (error) {
    console.error("stripe-portal error:", error);
    return fail(error);
  }
});
