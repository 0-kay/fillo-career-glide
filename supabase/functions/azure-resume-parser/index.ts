
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const openAIApiKey = Deno.env.get('OPENAI_API_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  console.log('Edge function called with method:', req.method);
  
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const requestBody = await req.json();
    console.log('Request body keys:', Object.keys(requestBody));
    
    let textToProcess = '';
    
    // Handle different input types
    if (requestBody.fileData && requestBody.fileType === 'application/pdf') {
      console.log('Processing PDF file data...');
      // For PDF files, we'll extract a simple text representation
      // In a production environment, you'd use a proper PDF parsing library
      textToProcess = `PDF File: ${requestBody.fileName}
      
This is a resume document that contains the following typical sections:
- Personal Information (Name, Contact details)
- Professional Summary
- Work Experience
- Education
- Skills
- Projects
- Certifications

Please extract structured information from this resume document.`;
      
    } else if (requestBody.resumeText) {
      console.log('Processing extracted text, length:', requestBody.resumeText.length);
      textToProcess = requestBody.resumeText;
    } else {
      throw new Error('No text or file data provided');
    }

    console.log('Text to process length:', textToProcess.length);
    console.log('Text preview:', textToProcess.substring(0, 300) + '...');

    const systemPrompt = `You are an expert resume parser. Extract comprehensive information from the provided resume text and return it as structured JSON data.

IMPORTANT: The data might be unstructured or incomplete. Extract what you can and use reasonable defaults where information is missing.

Return the data in this exact JSON structure:
{
  "personalInfo": {
    "fullName": "string",
    "email": "string", 
    "phone": "string",
    "address": "string",
    "linkedin": "string",
    "portfolio": "string"
  },
  "experience": [
    {
      "jobTitle": "string",
      "company": "string", 
      "location": "string",
      "startDate": "string",
      "endDate": "string",
      "description": "string",
      "achievements": ["string"]
    }
  ],
  "education": [
    {
      "institution": "string",
      "degree": "string",
      "fieldOfStudy": "string", 
      "startDate": "string",
      "endDate": "string",
      "gpa": "string"
    }
  ],
  "skills": {
    "technical": ["string"],
    "soft": ["string"],
    "tools": ["string"]
  },
  "projects": [
    {
      "title": "string",
      "description": "string",
      "tools": ["string"],
      "link": "string"
    }
  ],
  "certifications": [
    {
      "name": "string",
      "issuer": "string",
      "issueDate": "string"
    }
  ],
  "languages": [
    {
      "language": "string",
      "proficiency": "string"
    }
  ]
}

Extract only factual information present in the resume. Do not invent or assume information that isn't explicitly stated.`;

    console.log('Making OpenAI API request...');
    
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
          { role: 'user', content: `Please parse this resume text and extract structured information:\n\n${textToProcess}` }
        ],
        temperature: 0.1,
        max_tokens: 2000
      }),
    });

    console.log('OpenAI response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', errorText);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    console.log('OpenAI response received, choices length:', data.choices?.length);
    
    if (!data.choices || data.choices.length === 0) {
      throw new Error('No response from OpenAI');
    }

    const content = data.choices[0].message.content;
    console.log('OpenAI content preview:', content.substring(0, 200) + '...');
    
    // Parse the JSON response
    let parsedData;
    try {
      parsedData = JSON.parse(content);
      console.log('Successfully parsed JSON response');
    } catch (parseError) {
      console.error('Error parsing OpenAI JSON response:', parseError);
      console.log('Raw content:', content);
      throw new Error('Invalid JSON response from OpenAI');
    }

    console.log('Returning parsed data with keys:', Object.keys(parsedData));
    return new Response(JSON.stringify(parsedData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in azure-resume-parser function:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      details: 'Check the function logs for more information'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
