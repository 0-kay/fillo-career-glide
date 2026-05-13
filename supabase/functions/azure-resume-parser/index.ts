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
    const systemPrompt = `You are an expert resume parser. Extract ALL information with MAXIMUM ACCURACY and COMPLETENESS.

CRITICAL PARSING RULES:
1. READ EVERY WORD - don't skip any sections
2. EXTRACT ALL DATES - even if partial (e.g., "2020", "Spring 2019", "Present")
3. CAPTURE FULL DESCRIPTIONS - preserve all bullet points and details
4. IDENTIFY ALL SKILLS - technical, soft, tools, frameworks, languages
5. FIND ALL EXPERIENCES - including internships, freelance, part-time work
6. DETECT ALL LINKS - URLs, GitHub repos, portfolios, LinkedIn profiles, project demos

DATE FORMATS TO RECOGNIZE:
- "Jan 2020 - Dec 2022", "2020-2022", "2020 to 2022"
- "Spring 2019", "Fall 2021", "Q1 2020"
- "Present", "Current", "Now"
- Even single years like "2020" or "Graduated 2019"

LINK DETECTION & FORMATTING:
- Extract full URLs: https://github.com/user/repo, https://portfolio.com, https://linkedin.com/in/user
- Detect common patterns: github.com/username, linkedin.com/in/username, portfolio-site.com
- For projects: look for "Demo:", "Live:", "GitHub:", "Code:", "Link:", "URL:" labels
- Create proper labels: "GitHub Repository", "Live Demo", "Portfolio", "LinkedIn Profile"
- Include both the label and the full URL for frontend display

RETURN THIS EXACT JSON STRUCTURE:

{
  "personalInfo": {
    "fullName": "Extract exact full name",
    "firstName": "Extract first namen from the full name",
    "lastName": "Extract last name from the full name",
    "email": "Extract email address",
    "phone": "Phone number with country code, no spaces or extension (e.g. +12125551234)",
    "address": {
      "line1": "Street address / house number (e.g. 123 Main St)",
      "line2": "Apartment, suite, unit, floor (e.g. Apt 4B)",
      "city": "City name",
      "state": "State or province",
      "postalCode": "Zip or postal code",
      "country": "Country name or code"
    },
    "phoneExtension": "Phone extension number if present, otherwise return \"\"",
    "linkedin": "Extract full LinkedIn URL (https://linkedin.com/in/username or linkedin.com/in/username)",
    "github": "Extract full GitHub URL (https://github.com/username or github.com/username)", 
    "portfolio": "Extract portfolio/website URL",
    "additionalLinks": [
      {
        "label": "Website",
        "url": "https://personal-website.com"
      },
      {
        "label": "Blog",
        "url": "https://blog-site.com"
      }
    ]
  },
  "summary": "Extract complete professional summary/objective - include all details",
  "skills": {
    "technical": ["Programming languages", "Frameworks", "Databases", "Cloud platforms", "etc"],
    "soft": ["Leadership", "Communication", "Problem-solving", "etc"],
    "tools": ["Software", "IDEs", "Project management tools", "etc"]
  },
  "experience": [
    {
      "jobTitle": "Exact job title",
      "company": "Company name",
      "location": "City, State/Country if mentioned",
             "startDate": "Start date as MM/YYYY (e.g. 08/2023). If only year found, use 01/YYYY",
       "endDate": "End date as MM/YYYY (e.g. 12/2024), or 'Present' if current",
       "description": "COMPLETE description - all bullet points, achievements, responsibilities. Include numbers, metrics, technologies used. Examples: 'Managed over 10,000+ tickets', 'Achieved 99% uptime', 'Improved efficiency by 35%', 'Led development using Java and React'"
    }
  ],
  "education": [
    {
      "degree": "Full degree name (Bachelor of Science, Master of Arts, etc)",
      "school": "Full institution name",
      "location": "City, State/Country if mentioned", 
      "startDate": {"year": "Start year as YYYY (e.g. 2019)", "month": "Start month as MM (e.g. 09). Use empty string if not mentioned"},
      "endDate": {"year": "End/graduation year as YYYY (e.g. 2023)", "month": "Graduation month as MM (e.g. 05). Use empty string if not mentioned"},
      "gpa": "GPA if mentioned (e.g. 3.8)",
      "description": "Honors, relevant coursework, thesis, etc"
    }
  ],
  "certifications": [
    {
      "name": "Full certification name",
      "issuingOrganization": "Issuing body/company",
      "dateIssued": "Date obtained or 'Valid through X'",
      "credentialId": "Credential ID if available",
      "expirationDate": "Expiration date if applicable"
    }
  ],
  "languages": ["English", "Spanish", "etc - include proficiency if mentioned"],
  "projects": [
    {
      "name": "Project name",
      "description": "DETAILED project description, what it does, your role, impact",
      "technologies": ["All tech stack mentioned for this project"],
      "role": "Your specific role in the project",
      "duration": "Project duration if mentioned",
      "url": "Project URL if available",
      "githubUrl": "GitHub repository URL if available",
      "demoUrl": "Live demo URL if available",
      "links": [
        {
          "label": "GitHub Repository",
          "url": "https://github.com/user/project"
        },
        {
          "label": "Live Demo", 
          "url": "https://project-demo.com"
        }
      ],
      "impact": "Impact or results achieved"
    }
  ],
  "awards": [
    {
      "title": "Award/honor name",
      "issuer": "Who gave the award",
      "date": "When received",
      "description": "Why awarded, significance"
    }
  ],
  "volunteer": [
    {
      "organization": "Organization name",
      "role": "Volunteer position/title",
      "location": "Location if mentioned",
      "startDate": "Start date",
      "endDate": "End date or 'Present'",
      "description": "What you did, impact, responsibilities",
      "impact": "Specific achievements or results"
    }
  ]
}

EXTRACTION PRIORITY:
1. Personal contact information
2. Work experience (ALL entries with full details)
3. Education (degrees, certifications, courses)
4. Technical skills and tools
5. Projects with technologies used
6. Languages, awards, additional sections

QUALITY CHECKS:
- If you see bullet points (•, -, *), capture each one separately
- If you see dates anywhere, extract them exactly as written ("Aug 2023 – present", "Dec 2021 – Jan 2023", "May 2021", etc.)
- If you see percentages, numbers, metrics - include them ("99% uptime", "35% improvement", "10,000+ tickets")
- If you see technology stacks, frameworks - list them all (Java, React, PostgreSQL, Docker, Azure DevOps, etc.)
- If you see specific software/tools - capture all (Adobe Premiere Pro, Canva, Google Analytics, JIRA, etc.)
- If you see credential IDs, certificate numbers - include them
- If you see company names, show titles, project names - capture exactly
- If you see locations (cities, states, countries) - include them
- If you see URLs or web addresses - extract them completely with proper protocol (https://)
- If you see partial URLs (github.com/user, linkedin.com/in/user) - convert to full URLs
- Look for link indicators: "GitHub:", "Demo:", "Live:", "Portfolio:", "Website:", "Link:"
- For projects, capture ALL links mentioned (code repository, live demo, documentation)
- Don't abbreviate or summarize - capture complete information with all details

Return ONLY valid JSON with no additional text or markdown.`;

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
