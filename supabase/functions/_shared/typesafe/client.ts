import type { SystemOneFn } from "./types.ts";

/** Reads env under both Deno (edge functions) and Node (tests, apps/api). */
export function readEnv(name: string): string | undefined {
  const g = globalThis as unknown as {
    Deno?: { env?: { get(k: string): string | undefined } };
    process?: { env?: Record<string, string | undefined> };
  };
  const value = g.Deno?.env?.get ? g.Deno.env.get(name) : g.process?.env?.[name];
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export type Provider = "typesafe" | "openai" | "ab";

export function resolveProvider(): Provider {
  const raw = (readEnv("AI_PROVIDER") ?? "typesafe").toLowerCase();
  return raw === "openai" || raw === "ab" ? raw : "typesafe";
}

export interface Telemetry {
  provider: Provider;
  model?: string;
  latencyMs: number;
  usage?: { input_tokens: number; output_tokens: number };
}

/** Wraps a SystemOneFn to record model, latency and token usage per call. */
export function instrument(fn: SystemOneFn): {
  run: SystemOneFn;
  telemetry: () => Telemetry | null;
} {
  let last: Telemetry | null = null;
  return {
    run: async (request) => {
      const started = Date.now();
      const result = await fn(request);
      last = {
        provider: "typesafe",
        model: result.model,
        latencyMs: Date.now() - started,
        usage: result.usage,
      };
      return result;
    },
    telemetry: () => last,
  };
}

/**
 * Runs the legacy path alongside TypeSafe when AI_PROVIDER=ab.
 * TypeSafe's result is always the one served; the legacy result is logged only.
 */
export async function withComparison<T>(
  provider: Provider,
  label: string,
  primary: () => Promise<T>,
  legacy: (() => Promise<T>) | null,
  describe: (value: T) => unknown,
): Promise<T> {
  if (provider !== "ab" || !legacy) return primary();

  const [a, b] = await Promise.allSettled([primary(), legacy()]);
  if (a.status === "rejected") throw a.reason;

  if (b.status === "fulfilled") {
    const left = JSON.stringify(describe(a.value));
    const right = JSON.stringify(describe(b.value));
    console.log(
      left === right ? `🟰 ab/${label}: agree` : `⚠️ ab/${label}: disagree`,
      { typesafe: left, openai: right },
    );
  } else {
    console.log(`⚠️ ab/${label}: legacy path failed`, b.reason?.message);
  }

  return a.value;
}
