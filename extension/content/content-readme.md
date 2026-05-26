Fillo Chrome Extension Content Scripts

This folder contains the modular content script implementation for the Fillo extension. The former monolithic content.js was split into focused files and loaded in order via manifest.json. Modules communicate through a shared global namespace window.__Fillo, which works in Chrome MV3 without a bundler or ESM imports.

Load order (from extension/manifest.json)
1. content/namespace.js
2. content/config.js
3. content/utils.js
4. content/mapping.js
5. content/ai.js
6. content/planner.js
7. content/engine.js
8. content/messaging.js

Why this structure
- Clear responsibilities per file make the code easier to navigate and maintain.
- No reliance on import/export, import.meta, or importScripts in the content world.
- Chrome injects files in order; each file attaches exports to window.__Fillo so later files can safely use them.

Modules overview

namespace.js — global bootstrap
- Purpose: Creates the single global namespace that all modules attach to.
- Exposes: __Fillo.state, __Fillo.config, __Fillo.utils, __Fillo.mapping, __Fillo.ai, __Fillo.planner, __Fillo.engine, __Fillo.messaging.
- Consumers: Every other module assumes window.__Fillo exists.

config.js — feature flags and constants
- AI_CONFIG: { enabled, supabaseUrl, supabaseKey } for Supabase Edge Functions used by AI analysis.
- ENABLE_LLM_PLAN_FLAG_NAME: the window flag name to disable the experimental LLM planner (window.__ENABLE_LLM_PLAN = false).
- Thresholds: SEMANTIC_SCORE_THRESHOLD, MAPPING_SCORE_MIN.
- Used by: ai.js, planner.js, engine.js.

utils.js — shared utilities
- fetchWithTimeout(url, options, timeout): fetch with abort and friendly error messages.
- getValue(obj, keys[]): safe deep getter for profile fields.
- isElementVisible(el): visibility checks for form elements.
- getFieldLabel(el): finds associated label text via for=, parent label, or sibling label.
- showNotification(message, type): simple toast-like in-page notification.
- Used by: ai.js (fetch), engine.js (multiple helpers).

mapping.js — mapping configuration helpers
- getRawMappingConfig(): loads matching_fields.json via chrome.runtime.getURL.
- flattenMapping(config): converts nested field variations into a flat array of { path, variants, isArray }.
- shouldBeArrayField(path): detects array-like profile sections (e.g., work_experience[]).
- loadMapping(): cached loader returning the flattened mapping list.
- Used by: engine.js (primary deterministic pass), ai.js (context for AI requests).

ai.js — AI-powered matching via Supabase Edge Functions
- analyzeBatchFieldsWithAI(fields, profileData, mappingConfig): sends a batch to functions/v1/ai-batch-analysis; returns per-field decisions (shouldFill, value, confidence, fieldIndex).
- analyzeSingleFieldWithAI(fieldInfo, profileData): single-field analyzer (legacy/fallback) using functions/v1/ai-field-analysis.
- Auth: Uses AI_CONFIG.supabaseKey (publishable anon key) as Bearer to call Edge Functions.
- Used by: engine.js (optional AI fallback when useAI === true).

planner.js — experimental LLM planner
- candidateInputs(): collects visible inputs with nearby text/labels for context.
- buildPageContext(): returns { url, title, inputs }.
- requestFillPlan(pageCtx, { profileId, useAI }): POSTs to an external planner endpoint; includes FILLO_AUTH_TOKEN from chrome.storage.local when available.
- indexInputs(): maps internal ids (el_0, el_1, …) back to DOM nodes.
- setValue(el, value): sets form values and dispatches input/change/blur.
- runLLMAutofill({ profileId }): checks the window flag and applies plan entries with confidence ≥ 60.
- Toggle: Disable by setting window.__ENABLE_LLM_PLAN = false on the page.
- Used by: engine.js (always attempted first, fails safe).

engine.js — core filling engine
- handleFillForm(profileData, useAI=false): Orchestrates filling:
  1) Runs planner (best-effort, optional).
  2) Loads mapping and attempts deterministic fills with element-scoring.
  3) If useAI, batches unmatched fields and applies AI results.
  4) Starts a MutationObserver to re-run when new fields appear (SPAs/ATS lazy loads).
  5) Shows a summary notification and returns a result object.
- observeDynamic(profileData, mappingConfig, useAI): Sets up DOM observation and triggers refills on added inputs.
- Internal helpers: computeScore, fillElement, getElementContext, processSingleField, processArrayField, findSemanticMatch, enhancedFallbackMatch.

messaging.js — Chrome messaging and init
- initialize(): one-time setup; cleans up the observer on unload.
- onMessage(actions):
  - fillForm: calls engine.handleFillForm(profileData, useAI) and responds with the summary.
  - detectFields: placeholder for future expansion.
  - stopObservation: disconnects dynamic observer.
  - reloadAIConfig: placeholder for dynamic config refresh.

How modules reference each other
- Each file immediately executes (IIFE) and writes to window.__Fillo.*.
- Later files rely on symbols defined by earlier files (per manifest order).
- There are no ESM imports/exports, which avoids MV3 restrictions.

Common usage patterns
- Trigger a fill from popup/background:
  chrome.tabs.sendMessage(tabId, { action: 'fillForm', profileData, useAI: true });

- Disable the experimental planner on a page:
  window.__ENABLE_LLM_PLAN = false;

- Stop dynamic observation:
  chrome.tabs.sendMessage(tabId, { action: 'stopObservation' });

Web-accessible resources
- matching_fields.json is declared in web_accessible_resources and fetched via chrome.runtime.getURL by mapping.js.

Notes & troubleshooting
- If the planner endpoint (https://api.yourapp.com/llm/fill-plan) is not implemented, planner errors are caught and the engine continues with mapping/AI.
- Ensure AI_CONFIG.supabaseKey is a publishable anon key and that Supabase RLS protects your tables.
- Check the target page console for logs. Many operations log progress or warnings.

In short
- namespace.js sets the stage.
- config.js defines toggles and endpoints.
- utils.js provides shared helpers.
- mapping.js loads/normalizes field variations.
- ai.js integrates AI analysis (optional).
- planner.js runs a best-effort LLM planning pass.
- engine.js orchestrates all filling strategies.
- messaging.js wires Chrome messages to the engine.
