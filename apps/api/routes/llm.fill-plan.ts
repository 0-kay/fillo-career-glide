import type { Request, Response } from 'express'
import { OpenAI } from 'openai'
import { mcpRpc } from '../integrations/mcp/server-client' // server-only MCP client
import { analyzeFields, type FieldInput } from '../../../supabase/functions/_shared/typesafe/fields'
import { systemOne } from '../../../supabase/functions/_shared/typesafe/runtime.node'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

/** Verifies the caller's Supabase session against the Auth server. Fails closed. */
async function verifyJwt(authHeader?: string): Promise<{ id: string } | null> {
  const url = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!url || !anonKey || !token) return null
  try {
    const res = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: anonKey } })
    if (!res.ok) return null
    const user = await res.json()
    return user?.id ? { id: user.id as string } : null
  } catch {
    return null
  }
}

/**
 * Hybrid planner.
 *
 * OpenAI still decides whether the canonical profile is needed and calls get_profile
 * for it. Choosing what goes in each input is a typed selection over that profile, so
 * the planner can only return values the profile actually contains.
 */
export async function fillPlan(req: Request, res: Response) {
  try {
    const user = await verifyJwt(req.headers.authorization)
    if (!user) return res.status(401).end()

    const { pageCtx, profileId } = req.body || {}
    if (!pageCtx?.inputs?.length) return res.json({ mapping: [] })

    const tools = [{
      type: 'function' as const,
      function: {
        name: 'get_profile',
        description: 'Fetch canonical application profile for this user/profile id.',
        parameters: { type: 'object', properties: { profileId: { type: 'string', nullable: true } } }
      }
    }]

    const step1 = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You plan autofill for job application forms. Call get_profile to retrieve the candidate profile. Do not produce field values yourself.'
        },
        { role: 'user', content: JSON.stringify({ pageCtx, profileId }) }
      ],
      tools,
      tool_choice: 'auto',
      temperature: 0.2
    })

    const call = (step1.choices[0].message as any).tool_calls?.[0]

    // The RPCs are service_role-only and scope by the user id verified above
    const profile = call?.function?.name === 'get_profile'
      ? (await (profileId
          ? mcpRpc('get_application_profile', { profile_id: profileId, user_id: user.id })
          : mcpRpc('get_default_profile_for_user', { user_id: user.id }))).data
      : (await mcpRpc('get_default_profile_for_user', { user_id: user.id })).data

    const inputs: FieldInput[] = pageCtx.inputs.map((input: any) => ({
      name: input.name ?? null,
      id: input.id ?? null,
      type: input.type ?? 'text',
      label: input.label ?? null,
      placeholder: input.placeholder ?? null,
      required: Boolean(input.required),
      maxLength: typeof input.maxLength === 'number' ? input.maxLength : null,
      context: input.context ?? null
    }))

    const { results, model, usage } = await analyzeFields(systemOne, inputs, profile)

    const mapping = results.map((r, i) => ({
      id: pageCtx.inputs[i]?.id ?? String(i),
      value: r.shouldFill ? r.value : '',
      confidence: r.confidence,
      reason: r.reasoning,
      dataPath: r.dataPath
    }))

    return res.json({ mapping, meta: { model, usage } })
  } catch (e: any) {
    console.error('fillPlan error', e)
    return res.status(500).json({ mapping: [], error: 'plan_failed' })
  }
}
