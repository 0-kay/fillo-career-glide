export const MCP_BASE = import.meta.env.VITE_MCP_BASE || '/mcp'
export const MCP_TOKEN = import.meta.env.VITE_MCP_TOKEN || ''
export function authHeaders() {
  return MCP_TOKEN ? { Authorization: `Bearer ${MCP_TOKEN}` } : {}
} 