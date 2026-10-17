import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { RESUME_SYSTEM_PROMPT } from "../_shared/resume/prompt.ts";

const openAIApiKey = Deno.env.get('OPENAI_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  console.log('Edge function called');
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.text();
    console.log('Raw body length:', body.length);
    
    let requestData;
    try {
      requestData = JSON.parse(body);
    } catch (e) {
      console.error('JSON parse error:', e);
      throw new Error('Invalid JSON in request');
    }

    console.log('Request data keys:', Object.keys(requestData));
    
    // Create the detailed resume parsing prompt
    const systemPrompt = RESUME_SYSTEM_PROMPT;

    let userPrompt = `Here is the resume text to parse completely:\n\n"""`;
    
    if (requestData.resumeText) {
      // Use more text for better extraction (increased from 15000 to 20000)
      const fullText = requestData.resumeText.substring(0, 20000);
      userPrompt += fullText;
      
      console.log('=== RESUME TEXT ANALYSIS ===');
      console.log('Full resume text length:', requestData.resumeText.length);
      console.log('Text being sent to OpenAI length:', fullText.length);
      console.log('Resume sections found:', {
        hasExperience: fullText.toLowerCase().includes('experience') || fullText.toLowerCase().includes('work'),
        hasEducation: fullText.toLowerCase().includes('education') || fullText.toLowerCase().includes('university') || fullText.toLowerCase().includes('college'),
        hasSkills: fullText.toLowerCase().includes('skills') || fullText.toLowerCase().includes('technologies'),
        hasProjects: fullText.toLowerCase().includes('project'),
        hasCertifications: fullText.toLowerCase().includes('certification') || fullText.toLowerCase().includes('licensed'),
        hasAwards: fullText.toLowerCase().includes('award') || fullText.toLowerCase().includes('honor'),
        hasDates: /\d{4}/.test(fullText) // Check for years
      });
    } else {
      userPrompt += `Resume file: ${requestData.fileName || 'unknown file'}`;
      console.log('WARNING: No resume text provided, only filename');
    }
    
    userPrompt += '\n"""\n\nParse this resume completely and extract ALL information following the instructions above.';

    console.log('=== OPENAI REQUEST DETAILS ===');
    console.log('OpenAI API Key present:', !!openAIApiKey);
    console.log('OpenAI API Key prefix:', openAIApiKey ? openAIApiKey.substring(0, 8) + '...' : 'NOT SET');
    console.log('Prompt length:', userPrompt.length);
    console.log('First 200 chars of user prompt:', userPrompt.substring(0, 200));
    
    const requestPayload = {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: userPrompt
        }
      ],
      temperature: 0,
      max_tokens: 4000
    };
    
    console.log('OpenAI request payload:', {
      model: requestPayload.model,
      temperature: requestPayload.temperature,
      max_tokens: requestPayload.max_tokens,
      messages_count: requestPayload.messages.length,
      system_message_length: requestPayload.messages[0].content.length,
      user_message_length: requestPayload.messages[1].content.length
    });

    const openAIResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestPayload),
      signal: AbortSignal.timeout(60_000),
    });

    console.log('=== OPENAI RESPONSE DETAILS ===');
    console.log('OpenAI response status:', openAIResponse.status);
    console.log('OpenAI response headers:', Object.fromEntries(openAIResponse.headers.entries()));

    if (!openAIResponse.ok) {
      const errorText = await openAIResponse.text();
      console.error('OpenAI error response:', {
        status: openAIResponse.status,
        statusText: openAIResponse.statusText,
        errorText: errorText
      });
      throw new Error(`OpenAI error: ${openAIResponse.status} - ${errorText}`);
    }

    const openAIData = await openAIResponse.json();
    console.log('Full OpenAI response structure:', {
      id: openAIData.id,
      object: openAIData.object,
      created: openAIData.created,
      model: openAIData.model,
      choices_count: openAIData.choices?.length || 0,
      usage: openAIData.usage,
      system_fingerprint: openAIData.system_fingerprint
    });
    
    const content = openAIData.choices?.[0]?.message?.content || '{}';
    console.log('OpenAI response content length:', content.length);
    console.log('First 300 chars of OpenAI response:', content.substring(0, 300));
    console.log('Last 300 chars of OpenAI response:', content.substring(Math.max(0, content.length - 300)));

    // Simple fallback data matching the new structure
    const fallbackData = {
      personalInfo: {
        fullName: requestData.fileName?.replace(/\.[^/.]+$/, '') || 'Resume'
      },
      skills: { technical: [] },
      experience: [],
      education: []
    };

    let result = fallbackData;
    
    // Clean the response to extract just the JSON
    const cleanedContent = content.replace(/```json|```/g, '').trim();
    console.log('=== JSON PARSING ===');
    console.log('Cleaned content for parsing (first 500 chars):', cleanedContent.substring(0, 500));
    
    try {
      const parsed = JSON.parse(cleanedContent);
      console.log('Successfully parsed OpenAI response. Keys:', Object.keys(parsed));
      console.log('Parsed data structure:', {
        hasPersonalInfo: !!parsed.personalInfo,
        hasSkills: !!parsed.skills,
        experienceCount: parsed.experience?.length || 0,
        educationCount: parsed.education?.length || 0,
        certificationsCount: parsed.certifications?.length || 0
      });
      
      if (parsed && typeof parsed === 'object') {
        result = parsed;
        console.log('Using parsed data from OpenAI');
      } else {
        console.log('Parsed result is not a valid object, using fallback');
      }
    } catch (parseError) {
      console.log('=== JSON PARSE ERROR ===');
      console.log('Parse error message:', parseError.message);
      console.log('Content that failed to parse:', cleanedContent);
      console.log('Using fallback data due to parse error');
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Function error:', error.message);
    
    const errorResponse = {
      personalInfo: { fullName: 'Error Processing Resume' },
      skills: { technical: [] },
      experience: [],
      education: [],
      error: error.message
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
