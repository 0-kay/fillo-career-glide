import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { resolveProvider, withComparison } from "../_shared/typesafe/client.ts";
import { requireUser } from "../_shared/typesafe/auth.ts";
import { fail, json, preflight } from "../_shared/typesafe/http.ts";
import { legacyMatchOption } from "../_shared/typesafe/legacy.ts";
import { matchOption, type OptionMatch } from "../_shared/typesafe/options.ts";
import { systemOne } from "../_shared/typesafe/runtime.deno.ts";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflight();

  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  try {
    const { targetValue, options = [] } = await req.json();
    const provider = resolveProvider();

    console.log("🧠 Match option:", { targetValue, optionsCount: options.length, provider });

    if (provider === "openai") {
      const match = await legacyMatchOption(targetValue, options);
      return json({ success: true, match });
    }

    const outcome = await withComparison<{ match: OptionMatch; model: string | null }>(
      provider,
      "match-option",
      async () => {
        const r = await matchOption(systemOne, targetValue, options);
        return { match: r.match, model: r.model };
      },
      async () => ({ match: await legacyMatchOption(targetValue, options), model: "openai" }),
      (v) => v.match.matchedOptionIndex,
    );

    console.log("🧠 Match result:", outcome.match);
    return json({ success: true, match: outcome.match, model: outcome.model });
  } catch (error) {
    console.error("❌ AI Match Option Error:", error);
    return fail(error);
  }
});
