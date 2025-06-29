
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const openAIApiKey = Deno.env.get('OPENAI_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  console.log('Edge function called with method:', req.method);
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const requestBody = await req.json();
    console.log('Request received:', {
      hasFileData: !!requestBody.fileData,
      hasResumeText: !!requestBody.resumeText,
      fileName: requestBody.fileName
    });
    
    let textContent = '';
    
    if (requestBody.resumeText) {
      textContent = requestBody.resumeText;
    } else if (requestBody.fileData) {
      // For PDF files, we'll use a simple approach
      textContent = `Resume file: ${requestBody.fileName}. Please extract comprehensive information and structure it as JSON.`;
    } else {
      throw new Error('No content provided');
    }

    console.log('Processing text of length:', textContent.length);

    const systemPrompt = `Extract resume information and return ONLY valid JSON in this structure:
{
  "personalInfo": {
    "fullName": "",
    "email": "",
    "phone": "",
    "address": "",
    "linkedin": "",
    "portfolio": ""
  },
  "experience": [
    {
      "jobTitle": "",
      "company": "",
      "location": "",
      "startDate": "",
      "endDate": "",
      "description": "",
      "achievements": []
    }
  ],
  "education": [
    {
      "institution": "",
      "degree": "",
      "fieldOfStudy": "",
      "startDate": "",
      "endDate": "",
      "gpa": ""
    }
  ],
  "skills": {
    "technical": [],
    "soft": [],
    "tools": []
  },
  "projects": [],
  "certifications": [],
  "languages": []
}`;

    console.log('Calling OpenAI API...');
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: textContent }
        ],
        temperature: 0.1,
        max_tokens: 1000
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || '{}';
    
    console.log('OpenAI response received, parsing JSON...');
    
    let parsedData;
    try {
      // Clean the content and parse
      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsedData = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      // Return minimal valid structure
      parsedData = {
        personalInfo: {
          fullName: requestBody.fileName?.replace(/\.[^/.]+$/, '') || 'Unknown',
          email: '',
          phone: '',
          address: '',
          linkedin: '',
          portfolio: ''
        },
        experience: [],
        education: [],
        skills: { technical: [], soft: [], tools: [] },
        projects: [],
        certifications: [],
        languages: []
      };
    }

    console.log('Returning parsed data');
    return new Response(JSON.stringify(parsedData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in function:', error);
    
    return new Response(JSON.stringify({ 
      error: 'Failed to process resume',
      message: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
