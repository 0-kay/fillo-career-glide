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

    // First check if suggestion exists
    const { data: existingData, error: checkError } = await supabaseClient
      .from('missed_fields')
      .select('id, profile_id')
      .eq('id', suggestionId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (checkError) {
      console.error('Error checking suggestion:', checkError)
      throw checkError
    }

    if (!existingData) {
      console.warn(`Suggestion ${suggestionId} not found for user ${user.id}`)
      throw new Error('Suggestion not found or you do not have permission to modify it')
    }

    // Now update it
    const { error: updateError, data: updatedSuggestion } = await supabaseClient
      .from('missed_fields')
      .update({
        status: status,
        resolved_at: new Date().toISOString(),
        resolved_note: note || null
      })
      .eq('id', suggestionId)
      .eq('user_id', user.id)
      .select()
      .maybeSingle()

    if (updateError) {
      console.error('Error updating suggestion:', updateError)
      throw updateError
    }

    if (!updatedSuggestion) {
      console.error('Update returned no rows - possible RLS issue')
      throw new Error('Failed to update suggestion - permission denied or record not found')
    }

    console.log('✅ Updated suggestion:', updatedSuggestion.id)

    // If user provided updated data, update the profile
    if (updatedData && existingData.profile_id) {
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
