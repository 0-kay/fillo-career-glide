const MCP_BASE = process.env.MCP_BASE || 'http://mcp-bridge:8787'
const MCP_TOKEN = process.env.MCP_TOKEN || ''

function authHeaders() {
  return MCP_TOKEN ? { Authorization: `Bearer ${MCP_TOKEN}` } : {}
}

export async function mcpRpc(fn: string, args?: Record<string, unknown>) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...authHeaders() as any }
  const r = await fetch(`${MCP_BASE}/rpc/${encodeURIComponent(fn)}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ args })
  })
  if (!r.ok) throw new Error(`mcpRpc ${r.status}`)
  return r.json()
} 