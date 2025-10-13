## LLM Autofill Orchestration

- Feature flag: `VITE_ENABLE_LLM_PLAN` (frontend), MCP proxy via `VITE_MCP_BASE`, `VITE_MCP_TOKEN` (dev only).
- Content script collects compact page context, calls Orchestrator `POST /llm/fill-plan` with user JWT.
- Orchestrator verifies JWT, uses OpenAI tool-calling with a single tool `get_profile`.
- Tool resolves via MCP RPC allowlist: `get_application_profile(profile_id)`, `get_default_profile_for_user(user_id)`.
- LLM returns a plan: `{ mapping: [{ id, value, confidence, reason? }] }`.
- Content script applies values where `confidence >= 60`, dispatching DOM events.
- Mapping-first filler remains as fallback.

Contracts
- Request: `{ pageCtx: { url, title, inputs: PageInput[] }, profileId?: string, useAI?: boolean }`
- Response: `{ mapping: Array<{ id: string; value: string; confidence: number; reason?: string }>, notes?: string[] }`

Guardrails
- JWT required; rate limit per user + origin.
- Server logs: counts, latency, model; no raw PII.
- Never send service role/MCP tokens to browser.
- Send trimmed context only (no full HTML).
- LLM must select only from profile JSON; no invention.

Dev proxy
- Vite dev proxies `/mcp` → `http://localhost:8787`.

Rollout
- Start disabled; enable on staging for selected domains; measure coverage and costs; keep fallback. 