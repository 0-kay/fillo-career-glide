import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import type Stripe from "https://esm.sh/stripe@17.4.0?target=deno";
import { readEnv } from "../_shared/typesafe/client.ts";
import { getStripe } from "../_shared/stripe/client.ts";
import { getServiceClient } from "../_shared/stripe/supabase.ts";

/**
 * Stripe calls this directly (no Supabase session) to report subscription lifecycle
 * events. Trust comes from the Stripe-Signature header, verified against
 * STRIPE_WEBHOOK_SECRET — never from anything in the request body.
 *
 * Configure in the Stripe dashboard: Developers → Webhooks → this function's URL,
 * events: checkout.session.completed, customer.subscription.updated,
 * customer.subscription.deleted. Paste the resulting signing secret into
 * STRIPE_WEBHOOK_SECRET.
 */
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  const signature = req.headers.get("stripe-signature");
  const secret = readEnv("STRIPE_WEBHOOK_SECRET");
  if (!signature || !secret) {
    return new Response("Webhook not configured", { status: 500 });
  }

  const body = await req.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    // constructEventAsync (not the sync constructEvent) — Deno has no Node crypto module.
    event = await stripe.webhooks.constructEventAsync(body, signature, secret);
  } catch (err) {
    console.error("stripe-webhook: bad signature", err);
    return new Response("Invalid signature", { status: 400 });
  }

  const db = getServiceClient();

  async function upsertFromSubscription(sub: Stripe.Subscription, fallbackUserId?: string) {
    const userId = (sub.metadata?.supabase_user_id as string | undefined) ?? fallbackUserId;
    const item = sub.items.data[0];
    const plan = ["active", "trialing"].includes(sub.status) ? "pro" : "free";

    const patch = {
      stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      stripe_subscription_id: sub.id,
      plan,
      subscription_status: sub.status,
      price_interval: item?.price?.recurring?.interval ?? null,
      current_period_end: item?.current_period_end
        ? new Date(item.current_period_end * 1000).toISOString()
        : null,
    };

    const query = userId
      ? db.from("profiles").update(patch).eq("id", userId)
      : db.from("profiles").update(patch).eq("stripe_customer_id", patch.stripe_customer_id);
    const { error } = await query;
    if (error) throw error;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription" && session.subscription) {
          const subId = typeof session.subscription === "string"
            ? session.subscription
            : session.subscription.id;
          const sub = await stripe.subscriptions.retrieve(subId);
          await upsertFromSubscription(sub, session.client_reference_id ?? undefined);
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await upsertFromSubscription(sub);
        break;
      }
      default:
        // Ignore everything else — we only track subscription state.
        break;
    }
  } catch (error) {
    console.error(`stripe-webhook: failed handling ${event.type}`, error);
    // Still 500 so Stripe retries — but we've logged enough to debug from the dashboard.
    return new Response("Handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
