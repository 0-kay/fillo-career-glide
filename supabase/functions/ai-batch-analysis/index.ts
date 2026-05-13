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
    const { fields, profileData, mappingConfig = [], fieldVariations = {} } = await req.json()
    
    console.log('🧠 Batch AI Field Analysis Request:', { 
      fieldsCount: fields.length,
      fieldNames: fields.map(f => f.name || f.id || 'unnamed'),
      mappingCount: mappingConfig.length,
      variationKeys: Object.keys(fieldVariations).slice(0, 10) // Show first 10 keys
    })
    
    // Get OpenAI API key from environment
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiApiKey) {
      throw new Error('OpenAI API key not configured')
    }

    // Helper function to get field variations for all fields
    const getFieldVariationsForAll = (fields) => {
      const allVariations = new Map()
      
      fields.forEach((fieldInfo, index) => {
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
            if (searchTerms.some(term => 
              value.some(v => v.toLowerCase().includes(term.toLowerCase()) || 
                             term.toLowerCase().includes(v.toLowerCase()))
            )) {
              value.forEach(v => variations.add(v))
            }
          } else if (typeof value === 'object' && value !== null) {
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

        allVariations.set(index, Array.from(variations))
      })

      return allVariations
    }

    const allFieldVariations = getFieldVariationsForAll(fields)

    // Prepare comprehensive batch AI prompt
    const fieldsAnalysis = fields.map((field, index) => `
FIELD #${index}:
- Name: "${field.name}"
- ID: "${field.id}"
- Type: "${field.type}"
- Placeholder: "${field.placeholder}"
- Label: "${field.label}"
- CSS Classes: "${field.className}"
- Context: "${field.context?.substring(0, 100)}"
- Required: ${field.required}
- Max Length: ${field.maxLength}
- Known Variations: ${allFieldVariations.get(index)?.join(', ') || 'none'}
`).join('\n')

    const prompt = `
You are an expert form-filling AI assistant. Analyze ALL these form fields at once and determine what profile data should fill each field.

COMPLETE PROFILE DATA AVAILABLE:
${JSON.stringify(profileData, null, 2)}

FORM FIELDS TO ANALYZE:
${fieldsAnalysis}

INTELLIGENT MATCHING RULES:
1. Analyze field semantics, not just exact name matches
2. Consider context clues from labels, placeholders, and surrounding text
3. Handle variations like "firstName" vs "first_name" vs "fname"
4. Support all data types: text, email, phone, dates, booleans, arrays
5. Be flexible with date formats and phone number formats
6. Consider conditional logic (e.g., "Do you have experience?" → yes if work_experience exists)
7. Handle array data intelligently (use first item, count, or summary)
8. Support both US and international formats
9. ONLY fill fields with confidence >= 60%

SPECIAL FIELD TYPES TO HANDLE:
- Names: Use full_name, first_name, last_name appropriately
- Contact: email, phone, address, linkedin, github, portfolio
- Dates: Format as MM/DD/YYYY or YYYY-MM-DD as needed
- Experience: years_of_experience, job_title, company, description
- Education: degree, school, gpa, major
- Skills: technical_skills, soft_skills, languages, certifications
- Preferences: salary, location, job_type, remote_work
- Consent: Use true/false for checkboxes
- Arrays: Use first item or aggregate appropriately

RESPONSE FORMAT (JSON ARRAY ONLY):
[
  {
    "fieldIndex": 0,
    "shouldFill": true,
    "value": "exact value to fill",
    "confidence": 85,
    "reasoning": "detailed explanation",
    "dataPath": "path.to.data.used",
    "fieldType": "detected field type"
  },
  {
    "fieldIndex": 1,
    "shouldFill": false,
    "value": null,
    "confidence": 30,
    "reasoning": "not enough confidence or no matching data",
    "dataPath": null,
    "fieldType": "unknown"
  }
]

CRITICAL GUIDELINES:
- Return exactly one result per field in order (fieldIndex 0, 1, 2, etc.)
- Only suggest filling if confidence >= 60
- For boolean/checkbox fields, use true/false
- For dates, use appropriate format
- For arrays, use first item or aggregate appropriately
- For numbers, provide clean numeric values
- Never fill passwords, payment info, or sensitive data
- Be smart about field relationships and semantics
- MUST return valid JSON array format
`

    console.log('🧠 Sending batch request to OpenAI with', fields.length, 'fields')

    // Call OpenAI API with batch context
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1500, // Increased for batch processing
        temperature: 0.1
      })
    })

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    let aiResults
    
    console.log('🧠 Raw AI Response:', data.choices[0].message.content)
    
    try {
      aiResults = JSON.parse(data.choices[0].message.content)
    } catch (parseError) {
      console.error('❌ Failed to parse AI batch response:', data.choices[0].message.content)
      throw new Error('Invalid AI response format')
    }
    
    // Validate the batch response format
    if (!Array.isArray(aiResults)) {
      console.error('❌ AI response is not an array:', aiResults)
      throw new Error('AI response must be an array')
    }
    
    if (aiResults.length !== fields.length) {
      console.warn('⚠️ AI response length mismatch:', { 
        expected: fields.length, 
        received: aiResults.length 
      })
    }
    
    // Validate and sanitize each result
    const sanitizedResults = aiResults.map((result, index) => {
      const field = fields[index]
      if (!field) return null
      
      // Validate response structure
      if (!result || typeof result !== 'object') {
        console.warn(`⚠️ Invalid result structure for field #${index}:`, result)
        return null
      }
      
      // Validate confidence is a number
      const confidence = typeof result.confidence === 'number' ? result.confidence : 0
      
      // Validate and sanitize the value based on field type
      let sanitizedValue = result.value
      
      if (result.shouldFill && confidence >= 60) {
        // Type-specific validation and conversion
        if (field.type === 'email') {
          if (typeof sanitizedValue === 'string' && sanitizedValue.includes('@')) {
            // Valid email format
          } else {
            console.warn(`⚠️ AI returned invalid email format for field #${index}:`, sanitizedValue)
            return null
          }
        } else if (field.type === 'tel') {
          sanitizedValue = String(sanitizedValue).replace(/[^\d\+\-\(\)\s]/g, '')
        } else if (field.type === 'number') {
          const numValue = parseFloat(sanitizedValue)
          if (isNaN(numValue)) {
            console.warn(`⚠️ AI returned non-numeric value for number field #${index}:`, sanitizedValue)
            return null
          }
          sanitizedValue = numValue
        } else if (field.type === 'checkbox' || field.type === 'radio') {
          sanitizedValue = Boolean(sanitizedValue === true || sanitizedValue === 'true' || sanitizedValue === 1)
        } else {
          // Convert to string for text fields
          sanitizedValue = String(sanitizedValue || '')
        }
      }
      
      return {
        fieldIndex: index,
        shouldFill: result.shouldFill && confidence >= 60,
        value: sanitizedValue,
        confidence: confidence,
        reasoning: result.reasoning || 'AI batch analysis',
        dataPath: result.dataPath,
        fieldType: result.fieldType,
        source: 'batch_ai'
      }
    }).filter(Boolean) // Remove null results
    
    console.log('🧠 Batch AI Analysis Results:', {
      totalFields: fields.length,
      processedResults: sanitizedResults.length,
      fieldsToFill: sanitizedResults.filter(r => r && r.shouldFill).length,
      averageConfidence: sanitizedResults.length > 0 ? sanitizedResults.reduce((sum, r) => sum + (r?.confidence || 0), 0) / sanitizedResults.length : 0
    })
    
    // Log each result for debugging
    sanitizedResults.forEach((result) => {
      if (result && result.shouldFill) {
        console.log(`🧠 ✅ Field #${result.fieldIndex} (${fields[result.fieldIndex]?.name || 'unnamed'}): "${result.value}" (${result.confidence}%)`)
      } else if (result) {
        console.log(`🧠 ❌ Field #${result.fieldIndex} (${fields[result.fieldIndex]?.name || 'unnamed'}): skipped (${result.confidence}%)`)
      }
    })
    
    // Return the batch analysis results
    return new Response(
      JSON.stringify({
        success: true,
        results: sanitizedResults,
        debug: {
          totalFields: fields.length,
          processedResults: sanitizedResults.length,
          fieldsToFill: sanitizedResults.filter(r => r && r.shouldFill).length,
          rawAIResponse: data.choices[0].message.content
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('❌ Batch AI Field Analysis Error:', error)
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        results: []
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    )
  }
}) 