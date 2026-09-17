// Node adapter, used by apps/api and the test suite.
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { readEnv } from "./client.ts";
import type { SystemOneFn, SystemOneResult } from "./types.ts";

let client: TypeSafeClient | null = null;

export function getClient(): TypeSafeClient {
  if (client) return client;
  const apiKey = readEnv("TYPESAFE_API_KEY");
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is not configured");
  client = new TypeSafeClient({
    apiKey,
    defaultModel: readEnv("TYPESAFE_DEFAULT_MODEL") ?? "jev-latest",
    timeout: 15000,
  });
  return client;
}

export const systemOne: SystemOneFn = (request) =>
  getClient().systemOne(request as never) as Promise<SystemOneResult>;
