import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: any) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const { targetValue, options = [] } = await req.json();

    console.log("🧠 AI Match Option Request:", {
      targetValue,
      optionsCount: options.length,
    });

    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiApiKey) throw new Error("OpenAI API key not configured");

    const prompt = `
You are an expert form-filling AI assistant. Your task is to match the user's intended value against a strict list of available dropdown options on a webpage.

USER'S INTENDED VALUE (from database):
"${targetValue}"

AVAILABLE DROPDOWN OPTIONS:
${JSON.stringify(options, null, 2)}

INSTRUCTIONS:
1. Find the single best semantic match from the available options.
2. Consider abbreviations, acronyms, and common aliases (e.g., "B.Sc." = "Bachelor of Science", "CA" = "California").
3. If no option is a reasonable match, return null.

RESPONSE FORMAT (JSON ONLY):
{
  "matchedOptionIndex": 5, // The exact integer array index of the matched option
  "confidence": 95, // Integer 0-100 indicating confidence
  "reasoning": "Brief explanation of why this option matches"
}
`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 150,
        temperature: 0.1,
      }),
    });

    if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);

    const data = await response.json();
    let aiResponse;
    try {
      aiResponse = JSON.parse(data.choices[0].message.content);
    } catch (e) {
      throw new Error("Invalid AI response format");
    }

    return new Response(JSON.stringify({ success: true, match: aiResponse }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: any) {
    console.error("❌ AI Match Option Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});
