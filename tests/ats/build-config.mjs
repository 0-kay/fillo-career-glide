// Extracts the inline MATCH_CONFIG from the match-config edge function so the harness
// serves exactly what production serves. Run: node tests/ats/build-config.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, "../../supabase/functions/match-config/index.ts"), "utf8");
const start = src.indexOf("const MATCH_CONFIG = ") + "const MATCH_CONFIG = ".length;
const end = src.indexOf(";\n\nserve(", start);
if (start < 30 || end < 0) throw new Error("Could not locate MATCH_CONFIG in match-config/index.ts");
const config = JSON.parse(src.slice(start, end));
mkdirSync(resolve(here, "generated"), { recursive: true });
writeFileSync(resolve(here, "generated/match-config.json"), JSON.stringify({ success: true, config, rowCount: 1 }));
console.log("platforms:", Object.values(config.domains).map((d) => d.platform).join(", "));
