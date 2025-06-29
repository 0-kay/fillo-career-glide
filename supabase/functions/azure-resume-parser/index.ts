
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
    
    // Create a simple text prompt
    let promptText = `Please extract resume information from: ${requestData.fileName || 'unknown file'}`;
    
    if (requestData.resumeText) {
      promptText = requestData.resumeText.substring(0, 2000); // Limit text length
    }

    console.log('Calling OpenAI with prompt length:', promptText.length);

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
            content: 'Extract resume info and return JSON with: personalInfo{fullName,email,phone}, experience[], education[], skills{technical:[]}'
          },
          {
            role: 'user',
            content: promptText
          }
        ],
        temperature: 0,
        max_tokens: 500
      }),
    });

    if (!openAIResponse.ok) {
      throw new Error(`OpenAI error: ${openAIResponse.status}`);
    }

    const openAIData = await openAIResponse.json();
    const content = openAIData.choices?.[0]?.message?.content || '{}';
    
    console.log('OpenAI response length:', content.length);

    // Simple fallback data
    const fallbackData = {
      personalInfo: {
        fullName: requestData.fileName?.replace(/\.[^/.]+$/, '') || 'Resume',
        email: '',
        phone: ''
      },
      experience: [],
      education: [],
      skills: { technical: [] }
    };

    let result = fallbackData;
    
    try {
      const parsed = JSON.parse(content.replace(/```json|```/g, ''));
      if (parsed && typeof parsed === 'object') {
        result = { ...fallbackData, ...parsed };
      }
    } catch (parseError) {
      console.log('Using fallback data due to parse error');
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Function error:', error.message);
    
    const errorResponse = {
      personalInfo: { fullName: 'Error Processing Resume', email: '', phone: '' },
      experience: [],
      education: [],
      skills: { technical: [] },
      error: error.message
    };

    return new Response(JSON.stringify(errorResponse), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
