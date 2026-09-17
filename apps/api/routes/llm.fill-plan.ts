import type { Request, Response } from 'express'
import { OpenAI } from 'openai'
import { mcpRpc } from '../integrations/mcp/server-client' // server-only MCP client
import { analyzeFields, type FieldInput } from '../../../supabase/functions/_shared/typesafe/fields'
import { systemOne } from '../../../supabase/functions/_shared/typesafe/runtime.node'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

function verifyJwt(authHeader?: string): { id: string } | null {
  // TODO: verify Supabase JWT properly; stub acceptable initially
  return authHeader ? { id: 'fake-user' } : null
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
    const user = verifyJwt(req.headers.authorization)
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

    // ownership is enforced inside the RPCs
    const profile = call?.function?.name === 'get_profile'
      ? (await mcpRpc(profileId ? 'get_application_profile' : 'get_default_profile_for_user', {
          profile_id: profileId, user_id: user.id
        })).data
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
