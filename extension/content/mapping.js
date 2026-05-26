(function(ns){
  const mappingNS = ns.mapping;

  mappingNS.flattenMapping = function(config){
    const flat = [];
    function walk(obj, parent=''){
      for (const [k,v] of Object.entries(obj)){
        const full = parent ? `${parent}.${k}` : k;
        if (Array.isArray(v)){
          const isArray = mappingNS.shouldBeArrayField(full);
          flat.push({ path: isArray ? `${full}[]` : full, variants: v, isArray });
        } else if (v && typeof v === 'object') {
          walk(v, full);
        }
      }
    }
    walk(config); return flat;
  };

  mappingNS.shouldBeArrayField = function(path){
    const patterns = ['work_experience','education_history','projects','certifications','languages','volunteer_experience','awards_honors','technical_skills','soft_skills','tools_technologies','references','publications','skills_detailed','reference_contacts'];
    return patterns.some(p => path.includes(p) && !path.includes('.'));
  };

  mappingNS.getRawMappingConfig = async function(){
    try{
      const config = await ns.utils.loadMatchTableConfig({ mode: 'raw' });
      return config ? (config.parsed || config.row || {}) : {};
    }catch(e){ console.warn('Failed to load raw mapping config:', e); return {}; }
  };

  let cache = null;
  let platformCache = {};

  /**
   * Load the full platform config object from the Supabase match table.
   * This is the single source of truth — other helpers derive from this.
   * @param {string} platform - Platform identifier (e.g., "workday", "icims")
   * @returns {Promise<Object|null>} - { fields: [...], arrays: {...} } or null
   */
  mappingNS.loadPlatformConfig = async function(platform) {
    if (!platform) return null;

    // Return cached config if available
    if (platformCache[platform]) {
      return platformCache[platform];
    }

    try {
      const config = await ns.utils.loadMatchTableConfig({ platform, mode: 'platform' });
      if (config) {
        platformCache[platform] = config;
        console.log(`[Fillo] Loaded platform config for ${platform}: ${(config.fields || []).length} flat fields, ${Object.keys(config.arrays || {}).length} array type(s)`);
        return config;
      }

      console.warn(`[Fillo] No platform config found for: ${platform}`);
      return null;
    } catch (e) {
      console.error(`[Fillo] Error loading platform config for ${platform}:`, e);
      return null;
    }
  };

  /**
  * Load only the flat "fields" array from the Supabase match table for a platform.
   * Kept for backward compatibility.
   * @param {string} platform
   * @returns {Promise<Array|null>}
   */
  mappingNS.loadPlatformMapping = async function(platform) {
    const config = await mappingNS.loadPlatformConfig(platform);
    return config ? (config.fields || []) : null;
  };

  /**
   * Get platform fields with proper structure for engine.
  * Reads both "fields" (flat) and "arrays" (templates) from the match table data.
   * Array templates are expanded into profilePath entries for each profile entry.
   * @param {string} platform - Platform identifier
   * @param {Object} [profileData] - Optional profile data to expand array entries
   * @returns {Promise<Array>} - Array of field mappings with profilePath
   */
  mappingNS.getPlatformFields = async function(platform, profileData) {
    const config = await mappingNS.loadPlatformConfig(platform);
    if (!config) return [];

    const result = [];

    // 1. Add flat (non-array) fields — these already have a profilePath
    const flatFields = (config.fields || []).map(field => ({
      ...field,
      required: field.required || false
    }));
    result.push(...flatFields);

    // 2. Expand array templates into flat profilePath fields
    const arrays = config.arrays || {};
    for (const [arrayPath, arrayConfig] of Object.entries(arrays)) {
      const templateFields = arrayConfig.fields || [];
      if (templateFields.length === 0) continue;

      // Determine how many entries to expand.
      // If profileData is provided use its actual length; otherwise default to index 0 only
      // (the engine uses the index-0 template for all entries via its own loop).
      const entries = profileData ? (profileData[arrayPath] || []) : [{}];
      const count = Math.max(entries.length, 1);

      for (let i = 0; i < count; i++) {
        for (const field of templateFields) {
          result.push({
            ...field,
            profilePath: `${arrayPath}.${i}.${field.key}`,
            required: field.required || false,
            arrayPath,
            arrayIndex: i,
            sectionType: arrayConfig.sectionType
          });
        }
      }
    }

    console.log(`[Fillo] ${platform}: ${flatFields.length} flat fields + ${result.length - flatFields.length} array-expanded fields`);
    return result;
  };

  /**
  * Get raw array templates for a platform (used by engine for direct template fill).
   * @param {string} platform
   * @returns {Promise<Object>} - { work_experience: { sectionType, fields }, ... }
   */
  mappingNS.getArrayTemplates = async function(platform) {
    const config = await mappingNS.loadPlatformConfig(platform);
    return config?.arrays || {};
  };

  mappingNS.loadMapping = async function(){
    if (cache) return cache;
    const mappingSource = await ns.utils.loadMatchTableConfig({ mode: 'generic' });

    if (!mappingSource) {
      throw new Error('Generic mapping configuration is empty');
    }

    cache = mappingNS.flattenMapping(mappingSource);
    if (!cache.length) throw new Error('Mapping configuration is empty');
    return cache;
  };
})(window.__Fillo);