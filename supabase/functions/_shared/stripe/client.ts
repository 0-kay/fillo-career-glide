import Stripe from "https://esm.sh/stripe@17.4.0?target=deno";
import { readEnv } from "../typesafe/client.ts";

/** Shared Stripe client for edge functions. Deno has no Node http module, so Stripe
 * needs its fetch-based HTTP client explicitly. */
export function getStripe(): Stripe {
  const key = readEnv("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key, {
    httpClient: Stripe.createFetchHttpClient(),
    apiVersion: "2024-12-18.acacia",
  });
}

export interface PlanPrice {
  interval: "month" | "year";
  priceId: string;
}

/** Reads the two Stripe Price IDs for the Pro plan from env. Configured once the
 * Product/Prices are created in the Stripe dashboard (test mode first). */
export function getProPrices(): PlanPrice[] {
  const prices: PlanPrice[] = [];
  const monthly = readEnv("STRIPE_PRICE_PRO_MONTHLY");
  const annual = readEnv("STRIPE_PRICE_PRO_ANNUAL");
  if (monthly) prices.push({ interval: "month", priceId: monthly });
  if (annual) prices.push({ interval: "year", priceId: annual });
  return prices;
}
