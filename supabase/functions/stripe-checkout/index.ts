import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { readEnv } from "../_shared/typesafe/client.ts";
import { requireUser } from "../_shared/typesafe/auth.ts";
import { fail, json, preflight } from "../_shared/typesafe/http.ts";
import { getProPrices, getStripe } from "../_shared/stripe/client.ts";
import { getServiceClient } from "../_shared/stripe/supabase.ts";

/**
 * Starts a Stripe Checkout session for the signed-in user to subscribe to Pro.
 * POST { interval: "month" | "year" } with the caller's Supabase session token.
 * Returns { url } — redirect the browser there.
 */
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    const { interval } = await req.json().catch(() => ({ interval: "month" }));
    const prices = getProPrices();
    const price = prices.find((p) => p.interval === interval) ?? prices[0];
    if (!price) {
      return json({
        success: false,
        error: "No Stripe price configured. Set STRIPE_PRICE_PRO_MONTHLY / STRIPE_PRICE_PRO_ANNUAL.",
      }, 500);
    }

    const stripe = getStripe();
    const db = getServiceClient();

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("email, stripe_customer_id")
      .eq("id", auth.id)
      .single();
    if (profileError) throw profileError;

    let customerId = profile?.stripe_customer_id as string | null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile?.email ?? undefined,
        metadata: { supabase_user_id: auth.id },
      });
      customerId = customer.id;
      await db.from("profiles").update({ stripe_customer_id: customerId }).eq("id", auth.id);
    }

    const appUrl = readEnv("APP_URL") ?? req.headers.get("origin") ?? "http://localhost:8080";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: auth.id,
      line_items: [{ price: price.priceId, quantity: 1 }],
      success_url: `${appUrl}/settings?checkout=success`,
      cancel_url: `${appUrl}/settings?checkout=cancelled`,
      allow_promotion_codes: true,
      subscription_data: { metadata: { supabase_user_id: auth.id } },
    });

    return json({ success: true, url: session.url });
  } catch (error) {
    console.error("stripe-checkout error:", error);
    return fail(error);
  }
});
