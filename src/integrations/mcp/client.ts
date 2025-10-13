import { McpResultSchema } from './types'
import { MCP_BASE, authHeaders } from './config'

type Eq = Record<string, string | number | boolean>

export async function mcpSelect(table: string, eq?: Eq, opts?: { limit?: number; columns?: string }) {
  const params = new URLSearchParams()
  if (opts?.limit) params.set('limit', String(opts.limit))
  if (opts?.columns) params.set('columns', opts.columns)
  if (eq) Object.entries(eq).forEach(([k, v]) => params.set(k, String(v)))
  const r = await fetch(`${MCP_BASE}/db/${encodeURIComponent(table)}?${params}`, { headers: { ...authHeaders() } })
  if (!r.ok) throw new Error(`mcpSelect ${r.status}`)
  return McpResultSchema.parse(await r.json())
}

export async function mcpInsert(table: string, values: Record<string, unknown>) {
  const r = await fetch(`${MCP_BASE}/db/${encodeURIComponent(table)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ values })
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`mcpInsert ${r.status} ${text}`)
  return McpResultSchema.parse(JSON.parse(text))
}

export async function mcpRpc(fn: string, args?: Record<string, unknown>) {
  const r = await fetch(`${MCP_BASE}/rpc/${encodeURIComponent(fn)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ args })
  })
  if (!r.ok) throw new Error(`mcpRpc ${r.status}`)
  return McpResultSchema.parse(await r.json())
} 