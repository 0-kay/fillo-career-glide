
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
    console.log('=== EDGE FUNCTION CALLED ===');
    console.log('Request method:', req.method);
    console.log('Request headers:', Object.fromEntries(req.headers.entries()));
    
    const requestBody = await req.json();
    console.log('Request body received:', JSON.stringify(requestBody, null, 2));
    
    const { resumeText, fileName } = requestBody;
    
    if (!resumeText) {
      console.error('No resume text provided in request');
      throw new Error('No resume text provided');
    }

    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');

    if (!openaiApiKey) {
      console.error('OpenAI API key not found in environment');
      throw new Error('OpenAI API key not configured');
    }

    console.log('Processing resume text length:', resumeText.length);
    console.log('Resume text preview:', resumeText.substring(0, 500) + '...');
    console.log('File name:', fileName);

    const systemPrompt = `You are a resume parser. Your job is to extract structured data from resumes, no matter how the text is formatted, and return it in JSON.

The resumes may include multiple sections (e.g., education, experience, skills), in various layouts and tones — bullet points, paragraphs, one-pagers, etc. Some fields may be missing — that's okay. The data you receive may be unstructured, with inconsistent formatting, missing sections, or mixed content.

Return the extracted information in this structured JSON format:

{
  "personalInfo": {
    "fullName": "",
    "email": "",
    "phone": "",
    "linkedin": "",
    "portfolio": "",
    "address": "",
    "workAuthorization": "",
    "preferredName": ""
  },
  "education": [
    {
      "institution": "",
      "degree": "",
      "fieldOfStudy": "",
      "startDate": "",
      "endDate": "",
      "gpa": "",
      "honors": ""
    }
  ],
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
  "skills": {
    "technical": [],
    "soft": [],
    "tools": []
  },
  "certifications": [
    {
      "name": "",
      "issuer": "",
      "issueDate": "",
      "expirationDate": "",
      "credentialId": "",
      "credentialUrl": ""
    }
  ],
  "projects": [
    {
      "title": "",
      "description": "",
      "tools": [],
      "link": "",
      "startDate": "",
      "endDate": ""
    }
  ],
  "languages": [
    {
      "language": "",
      "proficiency": ""
    }
  ],
  "volunteer": [
    {
      "organization": "",
      "role": "",
      "description": "",
      "startDate": "",
      "endDate": ""
    }
  ],
  "preferences": {
    "desiredTitles": [],
    "industries": [],
    "locationPreferences": [],
    "employmentType": "",
    "relocationWillingness": "",
    "availability": "",
    "salaryExpectation": ""
  }
}

Rules:
- Fill in as many fields as possible, even if the section headers are missing.
- Normalize data (e.g., "Sep 2021 – Present" → "2021-09" and "Present").
- If a field is not found, use an empty string or empty list (never omit the field).
- Extract skills from anywhere (bullets, summaries, job descriptions).
- If education or experience appears multiple times, extract each entry.
- Handle unstructured data gracefully - the text may not have clear sections or formatting.
- Look for patterns and context clues to identify information even if it's not clearly labeled.

Return only the JSON.`;

    const openaiPayload = {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { 
          role: 'user', 
          content: `Now here is the resume text (note: this may be unstructured data):\n---\n${resumeText}\n---\nReturn only the JSON.` 
        }
      ],
      temperature: 0.1,
      max_tokens: 4000,
      response_format: { type: "json_object" }
    };

    console.log('=== SENDING TO OPENAI ===');
    console.log('OpenAI payload:', JSON.stringify(openaiPayload, null, 2));

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(openaiPayload),
    });

    console.log('OpenAI response status:', response.status);
    console.log('OpenAI response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error response:', errorText);
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('=== OPENAI RESPONSE ===');
    console.log('Full OpenAI response:', JSON.stringify(data, null, 2));
    
    const parsedData = JSON.parse(data.choices[0].message.content);
    console.log('=== PARSED RESUME DATA ===');
    console.log('Parsed resume data:', JSON.stringify(parsedData, null, 2));
    
    // Add metadata for compatibility with existing system
    parsedData.resume_metadata = {
      name: `${parsedData.personalInfo?.fullName || 'Unknown'}'s Resume`,
      file_name: fileName,
      parsing_status: 'Complete',
      version: '1.0',
      upload_date: new Date().toISOString()
    };

    console.log('=== FINAL RESPONSE ===');
    console.log('Final response data:', JSON.stringify(parsedData, null, 2));

    return new Response(JSON.stringify(parsedData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('=== ERROR IN EDGE FUNCTION ===');
    console.error('Error details:', error);
    console.error('Error stack:', error.stack);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
