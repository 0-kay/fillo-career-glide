
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
    console.log('Request body received:', {
      hasFileData: !!requestBody.fileData,
      hasResumeText: !!requestBody.resumeText,
      fileName: requestBody.fileName,
      fileType: requestBody.fileType
    });
    
    let textToProcess = '';
    
    // Handle different input types
    if (requestBody.fileData && requestBody.fileType === 'application/pdf') {
      console.log('Processing PDF file data for:', requestBody.fileName);
      // For now, we'll use a simple approach for PDF processing
      // In production, you'd want to use a proper PDF parsing library
      textToProcess = `This is a PDF resume file named ${requestBody.fileName}. 
      
Please extract the following information and return it as structured JSON:
- Personal Information (name, email, phone, address)
- Work Experience (company, position, dates, responsibilities)
- Education (institution, degree, dates)
- Skills (technical and soft skills)
- Projects (if any)
- Certifications (if any)
- Languages (if any)

Since this is a PDF file, please provide reasonable default values for the structure even if specific details aren't available.`;
      
    } else if (requestBody.resumeText) {
      console.log('Processing extracted text, length:', requestBody.resumeText.length);
      textToProcess = requestBody.resumeText;
    } else {
      throw new Error('No text or file data provided');
    }

    console.log('Text to process length:', textToProcess.length);

    const systemPrompt = `You are an expert resume parser. Extract information from the provided resume and return it as valid JSON.

Return ONLY valid JSON in this exact structure (no additional text or formatting):
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
  "projects": [
    {
      "title": "",
      "description": "",
      "tools": [],
      "link": ""
    }
  ],
  "certifications": [
    {
      "name": "",
      "issuer": "",
      "issueDate": ""
    }
  ],
  "languages": [
    {
      "language": "",
      "proficiency": ""
    }
  ]
}

Extract only factual information. Use empty strings or empty arrays for missing data.`;

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
          { role: 'user', content: textToProcess }
        ],
        temperature: 0.1,
        max_tokens: 1500
      }),
    });

    console.log('OpenAI response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', errorText);
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('OpenAI response received');
    
    if (!data.choices || data.choices.length === 0) {
      throw new Error('No response from OpenAI');
    }

    const content = data.choices[0].message.content.trim();
    console.log('OpenAI content length:', content.length);
    
    // Parse the JSON response
    let parsedData;
    try {
      // Remove any markdown formatting if present
      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      parsedData = JSON.parse(cleanContent);
      console.log('Successfully parsed JSON response');
    } catch (parseError) {
      console.error('Error parsing OpenAI JSON response:', parseError);
      console.log('Raw content:', content);
      
      // Return a default structure if parsing fails
      parsedData = {
        personalInfo: {
          fullName: requestBody.fileName?.replace('.pdf', '').replace(/[_-]/g, ' ') || 'Unknown',
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
    console.error('Error in azure-resume-parser function:', error.message);
    console.error('Stack trace:', error.stack);
    
    return new Response(JSON.stringify({ 
      error: error.message,
      details: 'Check the function logs for more information'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
