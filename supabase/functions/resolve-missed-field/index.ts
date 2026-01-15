import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const { suggestionId, status, note, updatedData } = await req.json()

    // Get user from token
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) throw new Error('Unauthorized')

    console.log(`📝 Resolving suggestion ${suggestionId} with status: ${status}`)

    // Validate status
    if (!['resolved', 'dismissed', 'wont_fix'].includes(status)) {
      throw new Error('Invalid status. Must be resolved, dismissed, or wont_fix')
    }

    // Update suggestion status
    const { error: updateError, data: updatedSuggestion } = await supabaseClient
      .from('missed_fields')
      .update({
        status: status,
        resolved_at: new Date().toISOString(),
        resolved_note: note || null
      })
      .eq('id', suggestionId)
      .eq('user_id', user.id) // Ensure user owns this suggestion
      .select()
      .single()

    if (updateError) throw updateError

    // If user provided updated data, update the profile
    if (updatedData && updatedSuggestion.profile_id) {
      const { error: profileError } = await supabaseClient
        .from('application_profiles')
        .update(updatedData)
        .eq('id', updatedSuggestion.profile_id)
        .eq('user_id', user.id)

      if (profileError) {
        console.error('Failed to update profile:', profileError)
        // Don't throw - suggestion is still resolved even if profile update fails
      } else {
        console.log('✅ Updated profile with new data')
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        suggestion: updatedSuggestion,
        profileUpdated: !!updatedData
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    console.error('❌ Resolve Suggestion Error:', error)
    return new Response(
      JSON.stringify({ success: false, error: (error as any).message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
