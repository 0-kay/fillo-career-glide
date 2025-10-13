(function(ns){
  const { AI_CONFIG } = ns.config;
  const { fetchWithTimeout, relayLog } = ns.utils;
  const { getRawMappingConfig, loadMapping } = ns.mapping;

  ns.ai.analyzeBatchFieldsWithAI = async function(fields, profileData, mappingConfig){
    try{
      const fieldVariations = await getRawMappingConfig();
      const payload = {
        fields: fields.map((f, idx) => ({
          name: f.name,
          id: f.id,
          type: f.type,
          placeholder: f.placeholder,
          label: f.label,
          className: f.className || '',
          // Ensure context is a string so the Edge Function can safely substring it
          context: typeof f.context === 'string' ? f.context : JSON.stringify(f.context || {}),
          required: Boolean(f.required),
          maxLength: typeof f.maxLength === 'number' ? f.maxLength : null,
          // Keep a local index reference just in case (not required by the function)
          _clientIndex: idx
        })),
        profileData,
        mappingConfig,
        fieldVariations
      };
      relayLog('log', '🧠 Sending batch AI request...', { fields: fields.length });
      const r = await fetch(`${AI_CONFIG.supabaseUrl}/functions/v1/ai-batch-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${AI_CONFIG.supabaseKey}` },
        body: JSON.stringify(payload)
      });
      if (!r.ok) throw new Error(`Batch AI HTTP ${r.status}: ${r.statusText}`);
      const data = await r.json();
      // Log the raw response coming back from Supabase Edge Function (batch)
      try {
        const resultsCount = Array.isArray(data?.results) ? data.results.length : 0;
        console.log('🧠 Batch AI raw response:', {
          success: data?.success,
          resultsCount,
          debug: data?.debug || null,
          sample: Array.isArray(data?.results) ? data.results.slice(0, 3) : data?.results
        });
        relayLog('log', '🧠 Batch AI raw response summary:', { success: data?.success, resultsCount });
      } catch (logErr) {
        console.warn('⚠️ Failed to log Batch AI raw response:', logErr?.message || logErr);
      }
      // Normalize results to a consistent shape the engine expects
      const rawResults = (data && data.success && Array.isArray(data.results)) ? data.results : [];
      const normalized = rawResults
        .map(r => {
          if (!r) return null;
          const fieldIndex = typeof r.fieldIndex === 'number' ? r.fieldIndex : (typeof r.index === 'number' ? r.index : null);
          if (fieldIndex == null) return null;
          const shouldFill = typeof r.shouldFill === 'boolean' ? r.shouldFill : (r.shouldFill === 'true' || r.fill === true);
          const value = r.value != null ? r.value : (r.fillValue != null ? r.fillValue : r.text);
          const confidence = typeof r.confidence === 'number' ? r.confidence : (typeof r.confidence === 'string' ? parseFloat(r.confidence) : undefined);
          return { fieldIndex, shouldFill, value, confidence };
        })
        .filter(Boolean);
      // Log the normalized results we will use downstream
      try {
        console.log('🧠 Batch AI normalized results:', normalized);
        relayLog('log', '🧠 Batch AI normalized results count:', normalized.length);
      } catch (logErr) {
        console.warn('⚠️ Failed to log normalized Batch AI results:', logErr?.message || logErr);
      }
      // Attach debug info if present
      if (data && data.debug) {
        console.debug('🧠 AI debug:', data.debug);
        relayLog('info', '🧠 AI debug meta:', data.debug);
      }
      return normalized;
    }catch(e){ console.error('Batch AI failed:', e.message); relayLog('error', 'Batch AI failed:', e.message); return []; }
  };

  ns.ai.analyzeSingleFieldWithAI = async function(fieldInfo, profileData){
    try{
      const [fieldVariations, mappingConfig] = await Promise.all([getRawMappingConfig(), loadMapping().catch(()=>[]) ]);
      const payload = { fieldInfo: {
        ...fieldInfo,
        context: typeof fieldInfo.context === 'string' ? fieldInfo.context : JSON.stringify(fieldInfo.context || {})
      }, profileData, mappingConfig, fieldVariations };
      const r = await fetchWithTimeout(`${AI_CONFIG.supabaseUrl}/functions/v1/ai-field-analysis`, {
        method:'POST', headers:{ 'Content-Type':'application/json', 'Authorization': `Bearer ${AI_CONFIG.supabaseKey}` }, body: JSON.stringify(payload)
      }, 10000);
      if (!r.ok) throw new Error(`AI HTTP ${r.status}: ${r.statusText}`);
      const data = await r.json();
      return (data && data.success) ? data.analysis : null;
    }catch(e){ console.error('Single AI failed:', e.message); relayLog('error', 'Single AI failed:', e.message); return null; }
  };
})(window.__Fillo);