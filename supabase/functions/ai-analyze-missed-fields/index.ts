import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const { missedFields, profileId, profileData, pageUrl } = await req.json()

    // Get user from token
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) throw new Error('Unauthorized')

    console.log(`🧠 Analyzing ${missedFields.length} missed fields for user ${user.id}`)

    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiApiKey) throw new Error('OpenAI API key not configured')

    // Enhanced AI prompt for structured output
    const prompt = `
You are a career profile expert. Analyze the following fields that could NOT be filled automatically on a job application.

FORM FIELDS MISSED:
${missedFields.map((f: any) => `- Label: "${f.label}", Placeholder: "${f.placeholder}", Name: "${f.name}", Type: "${f.type}"`).join('\n')}

CURRENT PROFILE DATA (EXCERPT):
${JSON.stringify(profileData, null, 2).substring(0, 2000)}

PAGE URL: ${pageUrl}

TASK:
Provide a structured analysis of what's missing. Return a JSON object with:
1. category: one of ["education", "experience", "skills", "personal", "certifications", "other"]
2. priority: one of ["high", "medium", "low"] based on how common/important this field is
3. suggestion: concise text (max 2 sentences) on what to add
4. targetPath: the JSON path in the profile where data should be added (e.g., "education_history[0].graduation_date")
5. missingDataType: one of ["text", "date", "boolean", "array", "number"]
6. exampleValue: a realistic example value for this field

RESPONSE FORMAT (JSON only, no markdown):
{
  "category": "education",
  "priority": "high",
  "suggestion": "Add graduation date to your MIT Computer Science degree.",
  "targetPath": "education_history[0].graduation_date",
  "missingDataType": "date",
  "exampleValue": "06/2020"
}
`

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.3
      })
    })

    if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`)

    const aiData = await response.json()
    let structuredSuggestion

    try {
      const content = aiData.choices[0].message.content.trim()
      // Remove markdown code blocks if present
      const jsonContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      structuredSuggestion = JSON.parse(jsonContent)
    } catch (parseError) {
      console.error('Failed to parse AI response:', aiData.choices[0].message.content)
      // Fallback to basic structure
      structuredSuggestion = {
        category: 'other',
        priority: 'medium',
        suggestion: aiData.choices[0].message.content.trim(),
        targetPath: null,
        missingDataType: 'text',
        exampleValue: null
      }
    }

    // Create field signature for deduplication
    const fieldSignature = `${structuredSuggestion.category}_${structuredSuggestion.targetPath || 'unknown'}`

    // Check for duplicates in last 7 days
    const { data: existingSuggestions } = await supabaseClient
      .from('missed_fields')
      .select('id, status, created_at')
      .eq('profile_id', profileId)
      .eq('field_signature', fieldSignature)
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false })
      .limit(1)

    if (existingSuggestions && existingSuggestions.length > 0) {
      const existing = existingSuggestions[0]

      // If already resolved, don't create new suggestion
      if (existing.status === 'resolved') {
        console.log('✅ Similar suggestion already resolved, skipping')
        return new Response(
          JSON.stringify({
            success: true,
            isDuplicate: true,
            message: 'Similar suggestion already resolved'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }

      // If still pending, just update timestamp
      if (existing.status === 'pending') {
        await supabaseClient
          .from('missed_fields')
          .update({ created_at: new Date().toISOString() })
          .eq('id', existing.id)

        console.log('🔄 Updated timestamp on existing pending suggestion')
        return new Response(
          JSON.stringify({
            success: true,
            isDuplicate: true,
            updated: true
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }
    }

    // Store in database with enhanced data
    const { error: dbError, data: insertedData } = await supabaseClient
      .from('missed_fields')
      .insert({
        user_id: user.id,
        profile_id: profileId,
        field_data: missedFields,
        page_url: pageUrl,
        ai_suggestion: structuredSuggestion.suggestion,
        status: 'pending',
        field_category: structuredSuggestion.category,
        priority: structuredSuggestion.priority,
        suggested_action: {
          targetPath: structuredSuggestion.targetPath,
          missingDataType: structuredSuggestion.missingDataType,
          exampleValue: structuredSuggestion.exampleValue
        },
        field_signature: fieldSignature
      })
      .select()
      .single()

    if (dbError) throw dbError

    console.log('✅ Created new suggestion:', insertedData.id)

    return new Response(
      JSON.stringify({
        success: true,
        suggestion: structuredSuggestion,
        isDuplicate: false,
        id: insertedData.id
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error('❌ AI Missed Fields Analysis Error:', error)
    return new Response(
      JSON.stringify({ success: false, error: (error as any).message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
