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
      const res = await fetch(chrome.runtime.getURL('matching_fields.json'));
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return await res.json();
    }catch(e){ console.warn('Failed to load raw mapping config:', e); return {}; }
  };

  let cache = null;
  mappingNS.loadMapping = async function(){
    if (cache) return cache;
    const res = await fetch(chrome.runtime.getURL('matching_fields.json'));
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const cfg = await res.json();
    cache = mappingNS.flattenMapping(cfg);
    if (!cache.length) throw new Error('Mapping configuration is empty');
    return cache;
  };
})(window.__Fillo);