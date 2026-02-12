import type { Request, Response } from 'express'
import { OpenAI } from 'openai'
import { mcpRpc } from '../integrations/mcp/server-client' // server-only MCP client

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

const SYSTEM_PROMPT = `
You are an autofill planner for job application forms.

Steps:
1) Call the tool get_profile to retrieve the candidate’s canonical profile JSON.
2) For each input in pageCtx.inputs, choose the best value from the profile data.
3) Respect constraints: maxLength, required fields.
4) If uncertain, produce confidence < 60 and value "" (empty).
5) Never invent data. Only select from the provided profile JSON.
6) Output only JSON of the form:
{ "mapping": [ { "id": "...", "value": "...", "confidence": 0-100, "reason": "..." } ] }
`.trim()

function verifyJwt(authHeader?: string): { id: string } | null {
  // TODO: verify Supabase JWT properly; stub acceptable initially
  return authHeader ? { id: 'fake-user' } : null
}

export async function fillPlan(req: Request, res: Response) {
  try {
    const user = verifyJwt(req.headers.authorization)
    if (!user) return res.status(401).end()

    const { pageCtx, profileId } = req.body || {}
    if (!pageCtx?.inputs?.length) return res.json({ mapping: [] })

    const tools = [{
      type: 'function',
      function: {
        name: 'get_profile',
        description: 'Fetch canonical application profile for this user/profile id.',
        parameters: { type: 'object', properties: { profileId: { type: 'string', nullable: true } } }
      }
    }]

    const messages: any[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify({ pageCtx, profileId }) }
    ]

    const step1 = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.2
    })

    const msg = step1.choices[0].message as any
    const call = msg.tool_calls?.[0]
    let profile: unknown = null

    if (call?.function?.name === 'get_profile') {
      // ownership enforced inside the RPCs
      profile = (await mcpRpc(profileId ? 'get_application_profile' : 'get_default_profile_for_user', {
        profile_id: profileId, user_id: user.id
      })).data

      messages.push(msg)
      messages.push({ role: 'tool', tool_call_id: call.id, name: 'get_profile', content: JSON.stringify(profile) })
    }

    const step2 = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        ...messages,
        { role: 'system', content: 'Now produce ONLY JSON: { "mapping": [ { "id": "...", "value": "...", "confidence": 0-100, "reason": "..." } ] }' }
      ],
      temperature: 0.2
    })

    const raw = step2.choices[0].message.content || '{}'
    let parsed
    try { parsed = JSON.parse(raw) } catch { parsed = { mapping: [] } }
    return res.json(parsed)
  } catch (e: any) {
    console.error('fillPlan error', e)
    return res.status(500).json({ mapping: [], error: 'plan_failed' })
  }
} 