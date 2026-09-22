import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Minimal .env loader so tests pick up TYPESAFE_API_KEY without adding a dotenv dep.
try {
  const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  for (const line of raw.split("\n")) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/i);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] === undefined) {
      process.env[key] = value.replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // No .env present; live tests will self-skip.
}

export const hasLiveKey = Boolean(process.env.TYPESAFE_API_KEY);
