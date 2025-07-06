import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { fieldInfo, profileData } = await req.json()
    
    console.log('🧠 AI Field Analysis Request:', { fieldInfo, profileData })
    
    // Get OpenAI API key from environment
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiApiKey) {
      throw new Error('OpenAI API key not configured')
    }

    // Prepare the AI prompt
    const prompt = `
You are an intelligent form-filling assistant. Analyze this form field and determine what profile data should fill it.

FORM FIELD INFO:
- Name: "${fieldInfo.name}"
- ID: "${fieldInfo.id}" 
- Type: "${fieldInfo.type}"
- Placeholder: "${fieldInfo.placeholder}"
- Label: "${fieldInfo.label}"
- Class: "${fieldInfo.className}"
- Context: "${fieldInfo.context}"

AVAILABLE PROFILE DATA:
${JSON.stringify({
  personal: {
    first_name: profileData.first_name,
    last_name: profileData.last_name,
    full_name: profileData.full_name,
    email: profileData.personal_details?.email,
    phone: profileData.personal_details?.phone,
    address: profileData.personal_details?.address,
    linkedin: profileData.personal_details?.linkedin,
    github: profileData.personal_details?.github,
    summary: profileData.personal_details?.summary
  },
  preferences: profileData.job_preferences,
  willing_to_relocate: profileData.willing_to_relocate,
  background_check_consent: profileData.background_check_consent,
  drug_test_consent: profileData.drug_test_consent
}, null, 2)}

TASK: Respond with JSON only. If this field should be filled, provide the exact value and confidence (0-100). If not, return null.

RESPONSE FORMAT:
{
  "shouldFill": true/false,
  "value": "exact value to fill" or null,
  "confidence": 85,
  "reasoning": "why this match makes sense"
}

RULES:
- Only suggest filling if confidence > 70
- For boolean fields (checkboxes), use true/false
- For text fields, provide the exact string
- Consider field context and surrounding elements
- Don't fill sensitive fields like passwords or payment info
`

    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.1
      })
    })

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`)
    }

    const data = await response.json()
    const aiResponse = JSON.parse(data.choices[0].message.content)
    
    console.log('🧠 AI Analysis Result:', aiResponse)
    
    // Return the AI analysis result
    return new Response(
      JSON.stringify({
        success: true,
        analysis: aiResponse
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('❌ AI Field Analysis Error:', error)
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
}) 