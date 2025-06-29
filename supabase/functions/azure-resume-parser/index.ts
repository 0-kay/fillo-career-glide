
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { resumeText, fileName } = await req.json();
    
    if (!resumeText) {
      throw new Error('No resume text provided');
    }

    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');

    if (!openaiApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const systemPrompt = `You are an expert resume parser. Extract comprehensive information from the resume text and return it in the following JSON structure. Be thorough and accurate:

{
  "personal_details": {
    "full_name": { "first": "", "middle": "", "last": "" },
    "preferred_name": "",
    "date_of_birth": "",
    "gender": "",
    "phone": "",
    "email": "",
    "linkedin_url": "",
    "github_url": "",
    "portfolio_url": "",
    "address": { "street": "", "city": "", "state": "", "zip": "", "country": "" },
    "work_authorization": ""
  },
  "education_history": [
    {
      "institution": "",
      "degree": "",
      "major": "",
      "gpa": "",
      "start_date": "",
      "end_date": "",
      "honors": [],
      "activities": []
    }
  ],
  "work_experience": [
    {
      "company": "",
      "title": "",
      "location": "",
      "start_date": "",
      "end_date": "",
      "description": "",
      "achievements": [],
      "reason_for_leaving": ""
    }
  ],
  "technical_skills": [
    {
      "skill": "",
      "category": "",
      "proficiency": "Beginner|Intermediate|Advanced|Expert"
    }
  ],
  "soft_skills": [
    {
      "skill": "",
      "proficiency": "Basic|Good|Excellent"
    }
  ],
  "tools_technologies": [
    {
      "name": "",
      "category": "",
      "proficiency": "Beginner|Intermediate|Advanced|Expert"
    }
  ],
  "certifications_licenses": [
    {
      "name": "",
      "issuing_organization": "",
      "issue_date": "",
      "expiration_date": "",
      "credential_id": "",
      "credential_url": ""
    }
  ],
  "awards_honors": [
    {
      "title": "",
      "organization": "",
      "description": "",
      "date_received": ""
    }
  ],
  "projects": [
    {
      "title": "",
      "description": "",
      "technologies": [],
      "link": "",
      "start_date": "",
      "end_date": ""
    }
  ],
  "languages": [
    {
      "language": "",
      "proficiency": "Basic|Conversational|Fluent|Native"
    }
  ],
  "volunteer_experience": [
    {
      "organization": "",
      "role": "",
      "description": "",
      "start_date": "",
      "end_date": ""
    }
  ],
  "job_preferences": {
    "desired_titles": [],
    "industries": [],
    "employment_type": [],
    "willing_to_relocate": false,
    "desired_locations": [],
    "salary_expectations": "",
    "availability": ""
  },
  "resume_metadata": {
    "name": "",
    "file_name": "",
    "parsing_status": "Complete|Needs Review|Incomplete",
    "version": "1.0",
    "upload_date": ""
  }
}

Important instructions:
1. Extract ALL available information, don't leave fields empty if data exists
2. Infer reasonable proficiency levels for skills based on context
3. Parse dates into consistent formats (YYYY-MM-DD or YYYY-MM or YYYY)
4. Categorize skills appropriately (Programming, Framework, Database, etc.)
5. Extract achievements and accomplishments from job descriptions
6. Identify and extract project details including technologies used
7. Return only valid JSON, no additional text or explanations`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Parse this resume:\n\n${resumeText}` }
        ],
        temperature: 0.1,
        max_tokens: 4000,
        response_format: { type: "json_object" }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const parsedData = JSON.parse(data.choices[0].message.content);
    
    // Set metadata
    parsedData.resume_metadata = {
      ...parsedData.resume_metadata,
      name: `${parsedData.personal_details.full_name.first} ${parsedData.personal_details.full_name.last}'s Resume`,
      file_name: fileName,
      parsing_status: 'Complete',
      version: '1.0',
      upload_date: new Date().toISOString()
    };

    return new Response(JSON.stringify(parsedData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in azure-resume-parser function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
