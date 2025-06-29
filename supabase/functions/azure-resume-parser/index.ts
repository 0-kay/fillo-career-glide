
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
    const systemPrompt = `You are a resume parser. You will be given unstructured resume text from a PDF, DOCX, or DOC file.

Your goal is to extract structured information from this resume text and return a clean, JSON-formatted response with the following keys:

{
  "personalInfo": {
    "fullName": "",
    "email": "",
    "phone": "",
    "address": "",
    "linkedin": "",
    "github": "",
    "portfolio": ""
  },
  "summary": "",
  "skills": {
    "technical": [],
    "soft": [],
    "tools": []
  },
  "experience": [
    {
      "jobTitle": "",
      "company": "",
      "location": "",
      "startDate": "",
      "endDate": "",
      "description": ""
    }
  ],
  "education": [
    {
      "degree": "",
      "school": "",
      "location": "",
      "startDate": "",
      "endDate": "",
      "description": ""
    }
  ],
  "certifications": [
    {
      "name": "",
      "issuingOrganization": "",
      "dateIssued": ""
    }
  ],
  "languages": [],
  "projects": [
    {
      "name": "",
      "description": "",
      "technologies": []
    }
  ],
  "awards": [
    {
      "title": "",
      "issuer": "",
      "date": "",
      "description": ""
    }
  ]
}

Only include keys for which data is found. Do not hallucinate or guess. If something isn't in the text, omit that field from the response entirely. Format your final output as clean JSON only.`;

    let userPrompt = `Here is the resume text:\n"""`;
    
    if (requestData.resumeText) {
      userPrompt += requestData.resumeText.substring(0, 15000); // Limit text length
    } else {
      userPrompt += `Resume file: ${requestData.fileName || 'unknown file'}`;
    }
    
    userPrompt += '\n"""';

    console.log('Calling OpenAI with prompt length:', userPrompt.length);

    const openAIResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
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
        max_tokens: 2000
      }),
    });

    if (!openAIResponse.ok) {
      const errorText = await openAIResponse.text();
      console.error('OpenAI error:', openAIResponse.status, errorText);
      throw new Error(`OpenAI error: ${openAIResponse.status}`);
    }

    const openAIData = await openAIResponse.json();
    const content = openAIData.choices?.[0]?.message?.content || '{}';
    
    console.log('OpenAI response length:', content.length);

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
    
    try {
      // Clean the response to extract just the JSON
      const cleanedContent = content.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleanedContent);
      if (parsed && typeof parsed === 'object') {
        result = parsed;
      }
    } catch (parseError) {
      console.log('Using fallback data due to parse error:', parseError.message);
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
