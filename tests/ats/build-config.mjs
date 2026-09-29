// Prepares everything the harness serves instead of calling Supabase:
//   generated/match-config.json  the inline MATCH_CONFIG from the match-config edge function
//   generated/seed-rows.json     the form_mappings seed rows derived from it
//   generated/formfill.js        a browser bundle of the resolve-form-fill planner
// Run: node tests/ats/build-config.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readMatchConfig, rowsFromConfig } from "../../scripts/seed-form-mappings.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "generated");
mkdirSync(out, { recursive: true });

const config = readMatchConfig();
writeFileSync(resolve(out, "match-config.json"), JSON.stringify({ success: true, config, rowCount: 1 }));
const rows = rowsFromConfig(config).map((r, i) => ({ id: `seed-${i}`, success_count: 0, override_count: 0, ...r }));
writeFileSync(resolve(out, "seed-rows.json"), JSON.stringify(rows));

await build({
  entryPoints: [resolve(here, "formfill-entry.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  outfile: resolve(out, "formfill.js"),
  logLevel: "warning",
});

console.log("platforms:", Object.values(config.domains).map((d) => d.platform).join(", "));
console.log(`seed rows: ${rows.length}; planner bundle: generated/formfill.js`);
