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
    const { fieldInfo, profileData, mappingConfig = [], fieldVariations = {} } = await req.json()

    console.log('🧠 Enhanced AI Field Analysis Request:', {
      fieldInfo: fieldInfo.name,
      mappingCount: mappingConfig.length,
      variationKeys: Object.keys(fieldVariations)
    })

    // Get OpenAI API key from environment
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiApiKey) {
      throw new Error('OpenAI API key not configured')
    }

    // Helper function to get all related field variations
    const getFieldVariations = (fieldInfo) => {
      const variations = new Set()
      const searchTerms = [
        fieldInfo.name,
        fieldInfo.id,
        fieldInfo.placeholder,
        fieldInfo.label,
        ...fieldInfo.className.split(' ')
      ].filter(Boolean)

      // Find matching variations from our field mapping
      for (const [key, value] of Object.entries(fieldVariations || {})) {
        if (Array.isArray(value)) {
          // Direct array of variations
          if (searchTerms.some(term =>
            value.some(v => v.toLowerCase().includes(term.toLowerCase()) ||
                           term.toLowerCase().includes(v.toLowerCase()))
          )) {
            value.forEach(v => variations.add(v))
          }
        } else if (typeof value === 'object' && value !== null) {
          // Nested object with variations
          for (const [subKey, subValue] of Object.entries(value as Record<string, any>)) {
            if (Array.isArray(subValue)) {
              if (searchTerms.some(term =>
                subValue.some(v => v.toLowerCase().includes(term.toLowerCase()) ||
                               term.toLowerCase().includes(v.toLowerCase()))
              )) {
                subValue.forEach(v => variations.add(v))
              }
            }
          }
        }
      }

      return Array.from(variations)
    }

    const relatedVariations = getFieldVariations(fieldInfo)

    // Prepare comprehensive AI prompt
    const prompt = `
You are an expert form-filling AI assistant. Analyze this form field and determine what profile data should fill it.

FORM FIELD ANALYSIS:
- Name Attribute: "${fieldInfo.name}"
- ID Attribute: "${fieldInfo.id}"
- Type: "${fieldInfo.type}"
- Placeholder: "${fieldInfo.placeholder}"
- Label Text: "${fieldInfo.label}"
- CSS Classes: "${fieldInfo.className}"
- Context Text: "${fieldInfo.context}"
- Sibling Text: "${fieldInfo.siblingText}"
- Required: ${fieldInfo.required}
- Max Length: ${fieldInfo.maxLength}

KNOWN FIELD VARIATIONS:
${relatedVariations.length > 0 ?
  `These field names are known to be related: ${relatedVariations.join(', ')}` :
  'No direct variations found in mapping database'
}

COMPLETE PROFILE DATA AVAILABLE:
${JSON.stringify(profileData, null, 2)}

INTELLIGENT MATCHING RULES:
1. Analyze field semantics, not just exact name matches
2. Consider context clues from labels, placeholders, and surrounding text
3. Handle variations like "firstName" vs "first_name" vs "fname"
4. Support all data types: text, email, phone, dates, booleans, etc.
5. Be flexible with date formats and phone number formats
6. Consider conditional logic (e.g., "Do you have experience?" → yes if work_experience exists)
7. Handle array data intelligently (use first item, count, or summary)
8. Support both US and international formats

SPECIAL FIELD TYPES TO HANDLE:
- Names: first_name, last_name, full_name, middle_name
- Contact: email, phone, address, linkedin, github, portfolio
- Dates: start_date, end_date, graduation_date (format as needed)
- Experience: years_of_experience, job_title, company, description
- Education: degree, school, gpa, major
- Skills: technical_skills, soft_skills, languages, certifications
- Preferences: salary, location, job_type, remote_work
- Consent: background_check, drug_test, willing_to_relocate
- Arrays: work_experience[], education_history[], projects[]

RESPONSE FORMAT (JSON ONLY):
{
  "shouldFill": true/false,
  "value": "exact value to fill",
  "confidence": 85,
  "reasoning": "detailed explanation of why this match makes sense",
  "dataPath": "path.to.data.used",
  "fieldType": "detected field type"
}

CRITICAL GUIDELINES:
- Only suggest filling if confidence > 70
- For boolean/checkbox fields, use true/false
- For dates, use appropriate format (MM/DD/YYYY or YYYY-MM-DD)
- For arrays, use first item or aggregate appropriately
- For numbers, provide clean numeric values
- Consider field context to avoid mismatches
- Never fill passwords, payment info, or sensitive data
- Be smart about field relationships and semantics
`

    // Call OpenAI API with enhanced context
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.1
      })
    })

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`)
    }

    const data = await response.json()
    let aiResponse

    try {
      aiResponse = JSON.parse(data.choices[0].message.content)
    } catch (parseError) {
      console.error('❌ Failed to parse AI response:', data.choices[0].message.content)
      throw new Error('Invalid AI response format')
    }

    console.log('🧠 Enhanced AI Analysis Result:', aiResponse)

    // Return the AI analysis result
    return new Response(
      JSON.stringify({
        success: true,
        analysis: aiResponse,
        debug: {
          fieldVariations: relatedVariations,
          profileDataKeys: Object.keys(profileData)
        }
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