import { z } from 'zod'
export const McpResultSchema = z.object({ data: z.unknown() })
export type McpResult = z.infer<typeof McpResultSchema> 