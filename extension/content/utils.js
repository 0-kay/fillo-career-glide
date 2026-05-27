(function(ns){
  const utils = ns.utils;

  utils.fetchWithTimeout = async function(url, options = {}, timeout = 10000){
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      return res;
    } catch (e) {
      clearTimeout(id);
      if (e?.name === 'AbortError') throw new Error(`Request timed out after ${timeout}ms`);
      throw e;
    }
  };

  utils.getSupabaseHeaders = function(authToken = null){
    const supabaseKey = ns.config?.AI_CONFIG?.supabaseKey;
    if (!supabaseKey) return null;

    return {
      apikey: supabaseKey,
      Authorization: `Bearer ${authToken || supabaseKey}`,
      'Content-Type': 'application/json',
    };
  };

  utils.parseMatchTableRow = function(row){
    if (!row) return null;

    if (row.data != null) {
      if (typeof row.data === 'string') {
        try {
          return JSON.parse(row.data);
        } catch (error) {
          console.warn('[Fillo] Failed to parse match row data JSON:', error);
          return null;
        }
      }

      if (typeof row.data === 'object') {
        return row.data;
      }
    }

    if (row.domains || row.fields || row.arrays || row.screeningQuestions) {
      return row;
    }

    return null;
  };

  utils.fetchMatchTableRows = async function({ tableName = 'matches', limit = 1, authToken = null } = {}){
    const supabaseUrl = ns.config?.AI_CONFIG?.supabaseUrl;
    const headers = utils.getSupabaseHeaders(authToken);
    if (!supabaseUrl || !headers) return [];

    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/${tableName}?select=*&limit=${limit}`, { headers });
      if (!res.ok) {
        console.warn(`[Fillo] Failed to load match table ${tableName}: ${res.status} ${res.statusText}`);
        return [];
      }

      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0) {
        console.log(`[Fillo] Loaded ${rows.length} match row(s) from Supabase table: ${tableName}`);
        return rows;
      }
    } catch (error) {
      console.warn(`[Fillo] Failed to load match table ${tableName}:`, error);
    }

    return [];
  };

  utils.loadMatchTableConfig = async function({ tableName = 'matches', limit = 25, authToken = null, platform = null, mode = 'platform' } = {}){
    const rows = await utils.fetchMatchTableRows({ tableName, limit, authToken });
    const parsedRows = rows
      .map(row => ({ row, parsed: utils.parseMatchTableRow(row) }))
      .filter(item => item.parsed);

    const getGenericMapping = config =>
      config?.mapping || config?.mappings || config?.genericMapping || config?.genericMappings ||
      config?.fieldMappings || config?.fieldsMapping || config?.matching_fields || config?.matchingFields || null;

    if (!parsedRows.length) {
      console.warn('[Fillo] No database match config found; bundled fallback is disabled');
      return null;
    }

    if (mode === 'raw') {
      const firstWithDomains = parsedRows.find(item => item.parsed?.domains) || parsedRows[0];
      return firstWithDomains;
    }

    if (mode === 'generic') {
      for (const { parsed } of parsedRows) {
        const mappingSource = getGenericMapping(parsed);
        if (mappingSource) return mappingSource;
        if (!parsed.domains && !parsed.fields && !parsed.arrays && !parsed.screeningQuestions) return parsed;
      }
      return null;
    }

    if (platform) {
      for (const { row, parsed } of parsedRows) {
        if (row.platform === platform || parsed.platform === platform) return parsed;

        const domains = parsed.domains || {};
        for (const config of Object.values(domains)) {
          if (config?.platform === platform) return config;
        }
      }

      console.warn(`[Fillo] No database match config found for platform: ${platform}`);
      return null;
    }

    const withDomains = parsedRows.find(item => item.parsed?.domains);
    if (withDomains) return withDomains.parsed;

    return parsedRows[0]?.parsed || null;
  };

  /**
   * Get value from nested object using dot-notation path
   * Handles special cases for technical_skills and array fields
   * Supports array index notation (e.g., work_experience.0.company)
   * @param {object} obj - The profile data object
   * @param {string[]} keys - Array of keys representing the path (e.g., ['personal_details', 'email'])
   * @returns {*} - The value at the path, or null if not found
   */
  utils.getValue = function(obj, keys){
    if (!obj || !keys || keys.length === 0) return null;

    let cur = obj;
    for (const k of keys) {
      if (cur == null) return null;

      // Handle array index notation (e.g., "0", "1", "2")
      if (Array.isArray(cur) && /^\d+$/.test(k)) {
        const index = parseInt(k, 10);
        cur = cur[index];
      } else {
        cur = cur[k];
      }
    }

    if (cur === undefined) {
      const path = keys.join('.');
      const pd = obj.personal_details || {};
      const address = pd.address || {};
      const aliases = {
        first_name: pd.first_name || pd.firstName || pd.full_name?.first,
        middle_name: pd.middle_name || pd.middleName || pd.full_name?.middle,
        last_name: pd.last_name || pd.lastName || pd.full_name?.last,
        'personal_details.first_name': pd.first_name || pd.firstName || pd.full_name?.first || obj.first_name,
        'personal_details.middle_name': pd.middle_name || pd.middleName || pd.full_name?.middle || obj.middle_name,
        'personal_details.last_name': pd.last_name || pd.lastName || pd.full_name?.last || obj.last_name,
        'personal_details.fullName': pd.fullName || pd.full_name?.full || [obj.first_name || pd.first_name || pd.firstName || pd.full_name?.first, obj.middle_name || pd.middle_name || pd.middleName || pd.full_name?.middle, obj.last_name || pd.last_name || pd.lastName || pd.full_name?.last].filter(Boolean).join(' '),
        'personal_details.city': pd.city || address.city,
        'personal_details.state': pd.state || address.state,
        'personal_details.country': pd.country || address.country,
        'personal_details.postalCode': pd.postalCode || pd.postal_code || address.postalCode || address.postal_code,
        'personal_details.website': pd.website || pd.portfolio,
      };
      const aliasValue = aliases[path];
      return aliasValue === undefined || aliasValue === '' ? null : aliasValue;
    }

    // Special handling for technical_skills - join "all" array if it exists
    if (keys[keys.length - 1] === 'technical_skills' && cur && typeof cur === 'object') {
      if (Array.isArray(cur.all)) {
        return cur.all.join(', ');
      }
      // If technical_skills is directly an array, join it
      if (Array.isArray(cur)) {
        return cur.map(skill => typeof skill === 'string' ? skill : (skill?.skill || skill?.name || skill?.label || '')).filter(Boolean).join(', ');
      }
      const flattened = [];
      for (const value of Object.values(cur)) {
        if (!Array.isArray(value)) continue;
        for (const skill of value) {
          const label = typeof skill === 'string' ? skill : (skill?.skill || skill?.name || skill?.label || '');
          if (label) flattened.push(label);
        }
      }
      if (flattened.length > 0) return Array.from(new Set(flattened)).join(', ');
    }

    // Special handling for array fields - return first element
    // Common array fields: work_experience, education_history, projects, etc.
    if (Array.isArray(cur) && cur.length > 0) {
      return cur[0];
    }

    return cur;
  };

  utils.isElementVisible = function(el){
    const style = window.getComputedStyle(el);
    if (el?.tagName?.toLowerCase() === 'input' && el.type === 'file') {
      return !el.disabled && style.display !== 'none' && style.visibility !== 'hidden';
    }
    return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
  };

  utils.getFieldLabel = function(element){
    if (element.id){ try { const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`); if (label?.textContent) return label.textContent.trim(); } catch(_){} }
    const parentLabel = element.closest('label'); if (parentLabel?.textContent) return parentLabel.textContent.replace(element.value || '', '').trim();
    const prev = element.previousElementSibling; if (prev?.tagName === 'LABEL') return prev.textContent?.trim() || '';
    return '';
  };

  // Relay logs both to the page console and to the extension runtime (popup/background) if open
  utils.relayLog = function(level = 'log', ...args){
    try {
      // Always log locally with a prefix
      const method = console[level] || console.log;
      method.apply(console, ['[Fillo]', ...args]);
    } catch(_){}
    try {
      // Best-effort send to extension runtime; popup/background can print it
      chrome?.runtime?.sendMessage?.({ action: 'relayLog', level, args: args.map(a => {
        try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); }
      }) });
    } catch(_){}
  };

  utils.showNotification = function(message, type='info'){
    try{
      const n = document.createElement('div');
      n.style.cssText = `position:fixed;top:20px;right:20px;background:${type==='success'?'#10b981':type==='error'?'#ef4444':'#3b82f6'};color:#fff;padding:12px 20px;border-radius:8px;z-index:10000;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.2);max-width:300px;word-wrap:break-word;`;
      n.textContent = message; document.body.appendChild(n);
      setTimeout(()=> n.parentNode && n.parentNode.removeChild(n), 4000);
    }catch(e){ console.error('Failed to show notification:', e); }
  };

})(window.__Fillo);
