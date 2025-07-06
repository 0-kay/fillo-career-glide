// Fillo Auto-Fill Extension - Advanced Content Script
// Works on ALL websites with forms

console.log('🤖 Fillo Auto-Fill: Advanced content script loaded on', window.location.href);

// Global state
let currentObserver = null;
let isProcessing = false;
let mapping = null;
let isInitialized = false;

// AI Configuration - Using Supabase Edge Function for intelligent field matching
const AI_CONFIG = {
  enabled: true,
  supabaseUrl: 'https://yuojrygcrcpajiglbekd.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1b2pyeWdjcmNwYWppZ2xiZWtkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEyMzAzMjksImV4cCI6MjA2NjgwNjMyOX0.9dYnQRjtSocxmb9gCw0fOf4GfPk2mUQNcrkOqwu8Rck'
};

// Initialize extension when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeExtension);
} else {
  initializeExtension();
}

function initializeExtension() {
  if (isInitialized) return;
  
  console.log('🚀 Fillo extension initializing on:', window.location.hostname);
  
  // Check if page has forms (or could have forms added dynamically)
  const forms = document.querySelectorAll('form');
  const inputs = document.querySelectorAll('input, textarea, select');
  
  console.log(`📋 Found ${forms.length} forms and ${inputs.length} form fields`);
  
  // Always initialize - forms might be added dynamically
  Promise.all([
    loadMapping().catch(error => {
      console.warn('⚠️ Mapping load failed:', error.message);
      return []; // Return empty array on failure
    }),
    loadAIConfig().catch(error => {
      console.warn('⚠️ AI config load failed:', error.message);
    })
  ])
  .then(() => {
    console.log('✅ Fillo extension ready for form filling');
    isInitialized = true;
  })
  .catch(error => {
    console.error('⚠️ Extension initialization failed:', error);
    isInitialized = true; // Mark as initialized anyway to prevent retries
  });
}

// Load AI configuration 
async function loadAIConfig() {
  try {
    console.log('🔄 Loading intelligent field matching configuration...');
    
    // AI is enabled by default using Supabase Edge Function
    AI_CONFIG.enabled = true;
    console.log('🧠 Intelligent field matching enabled via Supabase');
    
  } catch (error) {
    console.error('⚠️ Failed to load AI config:', error);
    AI_CONFIG.enabled = false;
  }
}

// Add manual flag reset function for debugging
function resetProcessingFlag() {
  console.log('🔄 Manually resetting processing flag');
  isProcessing = false;
  return { success: true, message: 'Processing flag reset' };
}

// Make it available for debugging in browser console
window.resetFilloProcessing = resetProcessingFlag;

// Helper function for fetch with timeout
async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout}ms`);
    }
    throw error;
  }
}

// AI-powered field analysis via Supabase Edge Function (with 10s timeout)
async function analyzeFieldWithAI(fieldInfo, profileData) {
  if (!AI_CONFIG.enabled) {
    console.log('🧠 AI not enabled, skipping analysis');
    return null;
  }

  const startTime = Date.now();
  console.log('🧠 Starting enhanced AI analysis for field:', fieldInfo.name);
  console.log('🔍 Field context:', fieldInfo);
  console.log('📊 Profile data keys:', Object.keys(profileData || {}));

  try {
    // Get mapping configuration for AI context
    let mappingConfig = [];
    try {
      mappingConfig = await loadMapping();
      console.log('🧠 Including mapping config with', mappingConfig.length, 'field mappings for AI context');
    } catch (error) {
      console.warn('⚠️ Could not load mapping config for AI context:', error.message);
    }

    const response = await fetchWithTimeout(
      `${AI_CONFIG.supabaseUrl}/functions/v1/ai-field-analysis`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AI_CONFIG.supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fieldInfo: fieldInfo,
          profileData: profileData,
          mappingConfig: mappingConfig, // Include mapping config for AI context
          fieldVariations: await getRawMappingConfig() // Include raw field variations
        })
      },
      10000 // 10 second timeout
    );

    const duration = Date.now() - startTime;
    console.log(`🧠 AI response received in ${duration}ms`);

    if (!response.ok) {
      throw new Error(`Supabase AI function error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.success && data.analysis) {
      const aiResponse = data.analysis;
      
      if (aiResponse.shouldFill && aiResponse.confidence > 60) {
        console.log(`🧠 ✅ Enhanced AI Match: ${fieldInfo.name} → "${aiResponse.value}" (${aiResponse.confidence}% confidence)`);
        console.log(`🧠 📝 AI Reasoning: ${aiResponse.reasoning}`);
        console.log(`🧠 📍 Data Path: ${aiResponse.dataPath || 'not specified'}`);
        console.log(`🧠 🏷️ Field Type: ${aiResponse.fieldType || 'auto-detected'}`);
        
        return {
          value: aiResponse.value,
          confidence: aiResponse.confidence,
          reasoning: aiResponse.reasoning,
          source: 'enhanced_ai',
          dataPath: aiResponse.dataPath,
          fieldType: aiResponse.fieldType
        };
      } else {
        console.log(`🧠 ❌ AI suggested no fill: confidence ${aiResponse.confidence || 0}% (threshold: 60%)`);
        if (aiResponse.reasoning) {
          console.log(`🧠 💭 AI reasoning: ${aiResponse.reasoning}`);
        }
      }
    } else {
      console.log('🧠 AI analysis returned no valid response');
    }
    
    return null;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ AI analysis failed after ${duration}ms:`, error.message);
    
    // Reset processing flag if AI is hanging the process
    if (error.message.includes('timed out')) {
      console.warn('⚠️ AI timeout detected - this was likely causing the hanging issue');
    }
    
    return null;
  }
}

// Enhanced field context extraction
function getEnhancedFieldContext(element) {
  // Get surrounding text for better context
  const container = element.closest('div, fieldset, section') || element.parentElement;
  const containerText = container ? container.textContent?.toLowerCase() || '' : '';
  
  // Look for nearby labels, spans, or divs that might provide context
  const siblings = Array.from(element.parentElement?.children || []);
  const siblingText = siblings
    .filter(el => el !== element && el.textContent)
    .map(el => el.textContent.toLowerCase())
    .join(' ');

  return {
    name: element.name?.toLowerCase() || '',
    id: element.id?.toLowerCase() || '',
    placeholder: element.placeholder?.toLowerCase() || '',
    label: getFieldLabel(element)?.toLowerCase() || '',
    type: element.type?.toLowerCase() || '',
    className: element.className?.toLowerCase() || '',
    context: containerText.substring(0, 200), // First 200 chars of context
    siblingText: siblingText.substring(0, 100), // Nearby text
    required: element.required || element.hasAttribute('required'),
    maxLength: element.maxLength > 0 ? element.maxLength : null
  };
}

// Load the raw mapping configuration (for AI context)
async function getRawMappingConfig() {
  try {
    const response = await fetch(chrome.runtime.getURL('matching_fields.json'));
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const config = await response.json();
    return config;
  } catch (error) {
    console.warn('⚠️ Failed to load raw mapping configuration for AI:', error);
    return {};
  }
}

// Load the mapping configuration
async function loadMapping() {
  if (mapping) return mapping;
  
  try {
    console.log('🔄 Loading mapping configuration...');
    const response = await fetch(chrome.runtime.getURL('matching_fields.json'));
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const config = await response.json();
    mapping = flattenMapping(config);
    
    if (mapping.length === 0) {
      throw new Error('Mapping configuration is empty');
    }
    
    console.log('✅ Loaded mapping configuration:', mapping.length, 'field mappings');
    return mapping;
  } catch (error) {
    console.error('❌ Failed to load mapping configuration:', error);
    
    // Don't return empty array - throw the error so it can be handled properly
    throw new Error(`Mapping load failed: ${error.message}`);
  }
}

// Flatten the mapping configuration
function flattenMapping(config) {
  const flat = [];
  
  function walk(obj, parentKey = '') {
    for (const [key, val] of Object.entries(obj)) {
      const fullKey = parentKey ? `${parentKey}.${key}` : key;
      
      if (Array.isArray(val)) {
        const isArrayField = shouldBeArrayField(fullKey);
        flat.push({
          path: isArrayField ? `${fullKey}[]` : fullKey,
          variants: val,
          isArray: isArrayField
        });
      } else if (typeof val === 'object' && val !== null) {
        walk(val, fullKey);
      }
    }
  }
  
  walk(config);
  return flat;
}

// Determine if a field should be treated as an array
function shouldBeArrayField(path) {
  const arrayPatterns = [
    'work_experience', 'education_history', 'projects', 'certifications',
    'languages', 'volunteer_experience', 'awards_honors', 'technical_skills', 'soft_skills', 'tools_technologies',
    'references', 'publications', 'skills_detailed', 'reference_contacts'
  ];
  
  return arrayPatterns.some(pattern => 
    path.includes(pattern) && !path.includes('.')
  );
}

// Main message listener
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  try {
    console.log('📨 Content script received message:', request.action);
    
    // Ensure extension is initialized
    if (!isInitialized) {
      console.log('🔄 Extension not initialized, initializing now...');
      initializeExtension();
      
      // Wait a moment for initialization
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    if (request.action === 'fillForm') {
      console.log('🔄 Filling form with profile data:', request.profileData);
      const result = await handleFillForm(request.profileData, request.useAI);
      sendResponse({ success: true, ...result });
    } else if (request.action === 'detectFields') {
      const result = await handleDetectFields();
      sendResponse({ success: true, ...result });
    } else if (request.action === 'stopObservation') {
      handleStopObservation();
      sendResponse({ success: true });
    } else if (request.action === 'reloadAIConfig') {
      // Reload AI configuration when user updates their API key
      await loadAIConfig();
      sendResponse({ success: true, message: 'AI configuration reloaded' });
    } else {
      sendResponse({ success: false, error: 'Unknown action' });
    }
  } catch (error) {
    console.error('❌ Content script error:', error);
    sendResponse({ success: false, error: error.message });
  }
  
  return true; // Keep message channel open
});

// Handle form filling
async function handleFillForm(profileData, useAI = false) {
  // if (isProcessing) {
  //   console.log('⏳ Already processing a fill request');
  //   return { filled: 0, message: 'Already processing' };
  // }
  
  // isProcessing = true;
  
  try {
    console.log('🚀 Starting advanced form filling with intelligent field matching');
    console.log('📋 Profile data keys:', Object.keys(profileData || {}));
    console.log('🧠 AI enabled for this request:', useAI);
    
    // Load mapping configuration
    console.log('🔄 Loading mapping configuration for form filling...');
    let mappingConfig = [];
    try {
      mappingConfig = await loadMapping();
      console.log('✅ Mapping configuration loaded:', mappingConfig.length, 'field mappings');
    } catch (error) {
      console.warn('⚠️ Failed to load mapping configuration:', error.message);
      console.log('🔄 Falling back to enhanced pattern matching only');
      mappingConfig = [];
    }
    
    // Stop any existing observer
    if (currentObserver) {
      currentObserver.disconnect();
      currentObserver = null;
    }
    
    // Process each mapping
    let totalFilled = 0;
    let totalAttempted = 0;
    
    if (mappingConfig.length > 0) {
      console.log('📋 Processing configured field mappings...');
      
      for (const { path, variants, isArray } of mappingConfig) {
        totalAttempted++;
        console.log(`🔄 Processing mapping ${totalAttempted}/${mappingConfig.length}: ${path}`);
        
        try {
          const keys = path.replace('[]', '').split('.');
          const value = getValue(profileData, keys);
          console.log(`🔍 Looking for profile data at path "${path}":`, value);
          
          if (value == null) {
            console.log(`⏭️ Skipping ${path} - no data available`);
            continue;
          }
          
          console.log(`🎯 Found data for ${path}:`, { isArray, hasData: !!value, variants: variants.slice(0, 3) });
          
          if (isArray && Array.isArray(value)) {
            console.log(`📝 Processing array field: ${path} with ${value.length} items`);
            const success = await processArrayField(path, variants, value);
            if (success) {
              totalFilled++;
              console.log(`✅ Successfully filled array field: ${path}`);
            }
          } else if (!isArray) {
            console.log(`📝 Processing single field: ${path} with value:`, String(value).substring(0, 50));
            const success = await processSingleField(path, variants, value);
            if (success) {
              totalFilled++;
              console.log(`✅ Successfully filled single field: ${path}`);
            }
          }
          
          // Small delay between fields
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (error) {
          console.error(`❌ Error processing mapping ${path}:`, error);
        }
      }
      
      console.log(`📋 Mapping processing complete: ${totalFilled}/${totalAttempted} mappings filled`);
    } else {
      console.log('📋 No field mappings available, skipping mapping phase');
    }
    
    // Run enhanced fallback matching with AI preference
    const fallbackResult = await enhancedFallbackMatch(profileData, mappingConfig, useAI);
    const fallbackFilled = fallbackResult.filled || 0;
    const aiMatches = fallbackResult.aiMatches || 0;
    
    // Set up dynamic observation
    currentObserver = observeDynamic(profileData, mappingConfig, useAI);
    
    console.log(`✅ Form filling complete: ${totalFilled}/${totalAttempted} mappings + ${fallbackFilled} fallback (${aiMatches} AI matches)`);
    
    // Show notification
    const aiStatus = useAI ? ` with AI (${aiMatches} AI matches)` : '';
    showNotification(`⚡ Filled ${totalFilled + fallbackFilled} fields${aiStatus}`, 'success');
    
    return {
      filled: totalFilled + fallbackFilled,
      attempted: totalAttempted,
      aiMatches: aiMatches,
      message: `Form filling completed: ${totalFilled} mappings + ${fallbackFilled} fallback${aiStatus}`
    };
    
  } catch (error) {
    console.error('❌ Error in form filling:', error);
    showNotification('❌ Form filling failed: ' + error.message, 'error');
    throw error;
  } finally {
    isProcessing = false;
  }
}

// Enhanced fallback matching with batch AI processing
async function enhancedFallbackMatch(profileData, mappingConfig, useAI = false) {
  const startTime = Date.now();
  console.log('🔍 Starting enhanced fallback matching...');
  
  // Get all form elements
  const formElements = document.querySelectorAll('input, select, textarea');
  console.log(`📋 Found ${formElements.length} form elements to process`);
  
  let filledCount = 0;
  let totalMatches = 0;
  let aiFilledCount = 0;
  let batchAIFields = [];
  
  // First pass: try standard mapping for all fields
  for (const element of formElements) {
    if (!isElementVisible(element)) continue;
    
    const fieldInfo = {
      element: element,
      name: element.name || '',
      id: element.id || '',
      type: element.type || 'text',
      placeholder: element.placeholder || '',
      label: getFieldLabel(element) || '',
      className: element.className || '',
      context: getElementContext(element),
      required: element.required || element.hasAttribute('required'),
      maxLength: element.maxLength > 0 ? element.maxLength : null
    };
    
    let matched = false;
    
    // Try standard mapping first
    for (const mapping of mappingConfig) {
      // Debug: Log mapping structure for first few mappings
      if (filledCount < 3) {
        console.log('🔍 Debug mapping structure:', {
          path: mapping.path,
          variants: mapping.variants,
          variantsType: typeof mapping.variants,
          variantsLength: mapping.variants?.length
        });
      }
      
      // Check each variant in the mapping and get the highest score
      let bestScore = 0;
      const variants = mapping.variants || [];
      
      // Safety check: ensure variants is an array
      if (!Array.isArray(variants)) {
        console.warn('⚠️ mapping.variants is not an array:', typeof variants, variants);
        continue;
      }
      
      for (const variant of variants) {
        // Safety check: ensure variant is a string
        if (typeof variant !== 'string') {
          console.warn('⚠️ variant is not a string:', typeof variant, variant);
          continue;
        }
        
        const score = computeScore(element, variant);
        if (score > bestScore) {
          bestScore = score;
        }
      }
      
      if (bestScore > 0.6) {
        const value = getValue(profileData, mapping.path.replace('[]', '').split('.'));
        if (value !== undefined && value !== null && value !== '') {
          await processSingleField(mapping.path, mapping.variants, value);
          filledCount++;
          totalMatches++;
          matched = true;
          console.log(`✅ Standard mapping: ${fieldInfo.name || fieldInfo.id} → "${value}" (score: ${bestScore.toFixed(2)})`);
          break;
        }
      }
    }
    
    // If no standard mapping found, add to batch AI queue
    if (!matched && useAI && AI_CONFIG.enabled) {
      batchAIFields.push({
        ...fieldInfo,
        context: getEnhancedFieldContext(element)
      });
      console.log(`🧠 Added to AI batch queue: ${fieldInfo.name || fieldInfo.id || 'unnamed'}`);
    }
    
    // If no mapping and no AI, try semantic pattern matching
    if (!matched && !useAI) {
      const semanticMatch = findSemanticMatch(getElementContext(element), profileData);
      if (semanticMatch) {
        fillElement(element, semanticMatch.value);
        filledCount++;
        totalMatches++;
        console.log(`🎯 Semantic match: ${fieldInfo.name || fieldInfo.id} → "${semanticMatch.value}" (${semanticMatch.confidence}%)`);
      }
    }
  }
  
  // Process batch AI if we have fields to analyze
  if (batchAIFields.length > 0 && useAI && AI_CONFIG.enabled) {
    console.log(`🧠 Processing ${batchAIFields.length} fields with batch AI...`);
    
    try {
      const batchResults = await analyzeBatchFieldsWithAI(batchAIFields, profileData, mappingConfig);
      console.log('🧠 Batch AI Results:', batchResults);
      
      if (batchResults && batchResults.length > 0) {
        for (const result of batchResults) {
          if (result && result.shouldFill && result.fieldIndex < batchAIFields.length) {
            const fieldInfo = batchAIFields[result.fieldIndex];
            const element = fieldInfo.element;
            
            console.log(`🧠 ✅ AI Batch Fill: ${fieldInfo.name || fieldInfo.id} → "${result.value}" (${result.confidence}%)`);
            console.log(`🧠 📝 AI Reasoning: ${result.reasoning}`);
            console.log(`🧠 📍 Data Path: ${result.dataPath || 'not specified'}`);
            
            try {
              fillElement(element, result.value);
              filledCount++;
              aiFilledCount++;
              totalMatches++;
            } catch (fillError) {
              console.error(`❌ Failed to fill element:`, fillError);
            }
          }
        }
      }
    } catch (aiError) {
      console.error('❌ Batch AI processing failed:', aiError);
    }
  }
  
  const duration = Date.now() - startTime;
  console.log(`🎉 Enhanced fallback matching completed in ${duration}ms:`);
  console.log(`   📊 Total elements: ${formElements.length}`);
  console.log(`   ✅ Filled: ${filledCount}`);
  console.log(`   🧠 AI filled: ${aiFilledCount}`);
  console.log(`   📈 Success rate: ${((filledCount / formElements.length) * 100).toFixed(1)}%`);
  
  return { filled: filledCount, total: formElements.length, aiMatches: aiFilledCount };
}

// New batch AI analysis function
async function analyzeBatchFieldsWithAI(fields, profileData, mappingConfig) {
  const startTime = Date.now();
  console.log(`🧠 Starting batch AI analysis for ${fields.length} fields...`);
  
  try {
    // Load field variations for AI context
    const fieldVariations = await getRawMappingConfig();
    
    // Prepare the batch request
    const requestData = {
      fields: fields.map(f => ({
        name: f.name,
        id: f.id,
        type: f.type,
        placeholder: f.placeholder,
        label: f.label,
        className: f.className,
        context: f.context,
        required: f.required,
        maxLength: f.maxLength
      })),
      profileData: profileData,
      mappingConfig: mappingConfig,
      fieldVariations: fieldVariations
    };
    
    console.log('🧠 Batch AI Request Data:', {
      fieldsCount: requestData.fields.length,
      fieldNames: requestData.fields.map(f => f.name || f.id || 'unnamed'),
      profileDataKeys: Object.keys(profileData)
    });
    
    // Call the batch AI function
    const response = await fetchWithTimeout(
      `${AI_CONFIG.supabaseUrl}/functions/v1/ai-batch-analysis`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AI_CONFIG.supabaseKey}`
        },
        body: JSON.stringify(requestData)
      },
      15000 // 15 second timeout for batch processing
    );
    
    if (!response.ok) {
      throw new Error(`Batch AI HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    const duration = Date.now() - startTime;
    
    console.log(`🧠 Batch AI completed in ${duration}ms`);
    console.log('🧠 Raw Batch AI Response:', data);
    
    if (data.success && data.results) {
      console.log('🧠 Batch AI Analysis Summary:', {
        totalFields: data.debug?.totalFields || fields.length,
        processedResults: data.debug?.processedResults || data.results.length,
        fieldsToFill: data.debug?.fieldsToFill || data.results.filter(r => r && r.shouldFill).length,
        averageConfidence: data.results.length > 0 ? 
          data.results.reduce((sum, r) => sum + (r?.confidence || 0), 0) / data.results.length : 0
      });
      
      // Log detailed results
      data.results.forEach((result, index) => {
        if (result && result.shouldFill) {
          const fieldInfo = fields[result.fieldIndex] || fields[index];
          console.log(`🧠 ✅ AI will fill: ${fieldInfo?.name || fieldInfo?.id || `Field #${index}`} → "${result.value}" (${result.confidence}%)`);
        } else if (result) {
          const fieldInfo = fields[result.fieldIndex] || fields[index];
          console.log(`🧠 ❌ AI skipped: ${fieldInfo?.name || fieldInfo?.id || `Field #${index}`} (${result.confidence}%)`);
        }
      });
      
      return data.results;
    } else {
      console.log('🧠 Batch AI returned no valid results');
      return [];
    }
    
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ Batch AI analysis failed after ${duration}ms:`, error.message);
    
    // Reset processing flag if AI is hanging the process
    if (error.message.includes('timed out')) {
      console.warn('⚠️ Batch AI timeout detected - falling back to standard matching');
    }
    
    return [];
  }
}

// Legacy individual AI function (kept for fallback)
async function analyzeFieldWithAI(fieldInfo, profileData) {
  console.warn('⚠️ Using legacy individual AI analysis - consider switching to batch processing');
  const startTime = Date.now();
  
  try {
    // Load field variations for AI context
    const fieldVariations = await getRawMappingConfig();
    const mappingConfig = await loadMapping();
    
    const requestData = {
      fieldInfo: getEnhancedFieldContext(fieldInfo.element),
      profileData: profileData,
      mappingConfig: mappingConfig,
      fieldVariations: fieldVariations
    };
    
    console.log('🧠 Individual AI Request:', fieldInfo.name || fieldInfo.id);
    
    const response = await fetchWithTimeout(
      'https://yuojrygcrcpajiglbekd.supabase.co/functions/v1/ai-field-analysis',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AI_CONFIG.supabaseKey}`
        },
        body: JSON.stringify(requestData)
      },
      10000
    );
    
    if (!response.ok) {
      throw new Error(`AI HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    const duration = Date.now() - startTime;
    
    console.log(`🧠 Individual AI completed in ${duration}ms for ${fieldInfo.name || fieldInfo.id}`);
    console.log('🧠 Individual AI Response:', data);
    
    if (data.success && data.analysis) {
      const aiResponse = data.analysis;
      
      // Validate AI response structure
      if (!aiResponse || typeof aiResponse !== 'object') {
        console.warn('🧠 ⚠️ Invalid AI response structure:', aiResponse);
        return null;
      }
      
      // Validate confidence is a number
      const confidence = typeof aiResponse.confidence === 'number' ? aiResponse.confidence : 0;
      
      // Updated confidence threshold to 60%
      if (aiResponse.shouldFill && confidence >= 60) {
        console.log(`🧠 ✅ Individual AI Match: ${fieldInfo.name} → "${aiResponse.value}" (${confidence}%)`);
        console.log(`🧠 📝 AI Reasoning: ${aiResponse.reasoning || 'no reasoning provided'}`);
        console.log(`🧠 📍 Data Path: ${aiResponse.dataPath || 'not specified'}`);
        
        return {
          value: aiResponse.value,
          confidence: confidence,
          reasoning: aiResponse.reasoning || 'AI match',
          source: 'individual_ai',
          dataPath: aiResponse.dataPath,
          fieldType: aiResponse.fieldType
        };
      } else {
        console.log(`🧠 ❌ Individual AI suggested no fill: confidence ${confidence}% < 60%`);
        if (aiResponse.reasoning) {
          console.log(`🧠 💭 AI reasoning: ${aiResponse.reasoning}`);
        }
      }
    } else {
      console.log('🧠 Individual AI analysis returned no valid response structure');
    }
    
    return null;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`❌ Individual AI analysis failed after ${duration}ms:`, error.message);
    
    return null;
  }
}

// Handle field detection
async function handleDetectFields() {
  console.log('🔍 Detecting form fields');
  
  const formElements = document.querySelectorAll('input, textarea, select');
  const detectedFields = [];
  
  formElements.forEach((element, index) => {
    if (isElementVisible(element)) {
      const fieldInfo = getEnhancedFieldContext(element);
      
      detectedFields.push({
        index,
        ...fieldInfo,
        hasValue: !!element.value?.trim()
      });
    }
  });
  
  console.log(`✅ Detected ${detectedFields.length} visible form fields`);
  
  return {
    totalFields: formElements.length,
    visibleFields: detectedFields.length,
    filledFields: detectedFields.filter(f => f.hasValue).length,
    fields: detectedFields,
    url: window.location.href,
    title: document.title
  };
}

function handleStopObservation() {
  console.log('🛑 Stopping dynamic observation');
  
  if (currentObserver) {
    currentObserver.disconnect();
    currentObserver = null;
    console.log('✅ Observer stopped');
  } else {
    console.log('ℹ️ No observer was running');
  }
}

async function processSingleField(path, variants, value) {
  for (const variant of variants) {
    const selectors = buildSelectors(variant);
    
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      
      for (const element of elements) {
        if (!isElementVisible(element) || element.value?.trim()) continue;
        
        const score = computeScore(element, variant);
        
        if (score >= 5) {
          if (fillElement(element, value)) {
            console.log(`✅ Filled ${path}: ${selector} (score: ${score})`);
            return true;
          }
        }
      }
    }
  }
  
  return false;
}

async function processArrayField(path, variants, values) {
  console.log(`🔄 Processing array field: ${path} with ${values.length} items`);
  
  // For now, just fill the first item's data into single fields
  if (values.length > 0) {
    const firstItem = values[0];
    
    for (const [key, value] of Object.entries(firstItem)) {
      if (value && typeof value === 'string') {
        const fieldPath = `${path.replace('[]', '')}.${key}`;
        const fieldVariants = variants.map(v => `${v}_${key}`);
        
        await processSingleField(fieldPath, fieldVariants, value);
      }
    }
  }
  
  return true;
}

function buildSelectors(variant) {
  return [
    `[name="${variant}"]`,
    `[id="${variant}"]`,
    `[name*="${variant}"]`,
    `[id*="${variant}"]`,
    `[data-testid="${variant}"]`,
    `[data-automation-id="${variant}"]`,
    `[placeholder*="${variant}"]`,
    `.${variant}`
  ];
}

function computeScore(element, variant) {
  // Safety check: ensure variant is a string
  if (typeof variant !== 'string') {
    console.warn('⚠️ computeScore called with non-string variant:', typeof variant, variant);
    return 0;
  }
  
  let score = 0;
  const name = element.name?.toLowerCase() || '';
  const id = element.id?.toLowerCase() || '';
  const placeholder = element.placeholder?.toLowerCase() || '';
  const className = element.className?.toLowerCase() || '';
  
  // Convert variant to lowercase for comparison
  const variantLower = variant.toLowerCase();
  
  // Exact matches get highest score
  if (name === variantLower || id === variantLower) score += 10;
  
  // Partial matches
  if (name.includes(variantLower) || id.includes(variantLower)) score += 7;
  
  // Data attributes
  if (element.getAttribute('data-testid') === variantLower) score += 6;
  if (element.getAttribute('data-automation-id') === variantLower) score += 6;
  
  // Class names
  if (className.includes(variantLower)) score += 5;
  
  // Placeholder text
  if (placeholder.includes(variantLower)) score += 4;
  
  // Label association
  const label = getFieldLabel(element)?.toLowerCase() || '';
  if (label.includes(variantLower)) score += 3;
  
  // Type-specific bonuses
  if (element.type === 'email' && variantLower.includes('email')) score += 2;
  if (element.type === 'tel' && variantLower.includes('phone')) score += 2;
  if (element.type === 'url' && (variantLower.includes('website') || variantLower.includes('url'))) score += 2;
  
  return score;
}

function fillElement(element, value) {
  try {
    if (!element || value == null) return false;
    
    const tagName = element.tagName.toLowerCase();
    const type = element.type?.toLowerCase();
    
    // Handle different input types
    if (tagName === 'select') {
      // Try to find matching option
      const options = element.querySelectorAll('option');
      for (const option of options) {
        if (option.value === value || option.textContent.trim() === value) {
          element.value = option.value;
          break;
        }
      }
    } else if (type === 'checkbox' || type === 'radio') {
      element.checked = Boolean(value);
    } else if (type === 'file') {
      // Skip file inputs
      return false;
    } else {
      element.value = String(value);
    }
    
    // Trigger events to notify the page
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
    
    return true;
  } catch (error) {
    console.error('❌ Error filling element:', error);
    return false;
  }
}

// Get element context for matching
function getElementContext(element) {
  return {
    name: element.name?.toLowerCase() || '',
    id: element.id?.toLowerCase() || '',
    placeholder: element.placeholder?.toLowerCase() || '',
    label: getFieldLabel(element)?.toLowerCase() || '',
    type: element.type?.toLowerCase() || ''
  };
}

// Find semantic matches (legacy pattern matching)
function findSemanticMatch(context, profileData) {
  const patterns = [
    // Personal Information
    { keywords: ['email'], getValue: () => profileData.personal_details?.email },
    { keywords: ['first', 'fname'], getValue: () => profileData.first_name },
    { keywords: ['last', 'lname'], getValue: () => profileData.last_name },
    { keywords: ['name', 'fullname'], getValue: () => profileData.personal_details?.fullName || `${profileData.first_name || ''} ${profileData.last_name || ''}`.trim() },
    { keywords: ['phone', 'tel'], getValue: () => profileData.personal_details?.phone },
    { keywords: ['address', 'street'], getValue: () => profileData.personal_details?.address },
    
    // Social Links
    { keywords: ['linkedin'], getValue: () => profileData.personal_details?.linkedin },
    { keywords: ['github'], getValue: () => profileData.personal_details?.github },
    { keywords: ['portfolio', 'website'], getValue: () => profileData.personal_details?.portfolio },
    
    // Professional Summary
    { keywords: ['summary', 'about'], getValue: () => profileData.personal_details?.summary },
    
    // Skills (flatten arrays for simple fields)
    { keywords: ['skill', 'technical'], getValue: () => {
      const skills = profileData.technical_skills;
      if (Array.isArray(skills)) return skills.join(', ');
      if (skills?.all) return skills.all.join(', ');
      return null;
    }},
    { keywords: ['soft'], getValue: () => {
      const skills = profileData.soft_skills;
      if (Array.isArray(skills)) return skills.join(', ');
      if (skills?.all) return skills.all.join(', ');
      return null;
    }},
    { keywords: ['tools', 'technologies'], getValue: () => {
      const tools = profileData.tools_technologies;
      if (Array.isArray(tools)) return tools.join(', ');
      return null;
    }},
    
    // Languages
    { keywords: ['language'], getValue: () => {
      const languages = profileData.languages;
      if (Array.isArray(languages)) {
        return languages.map(lang => typeof lang === 'string' ? lang : lang.language).filter(Boolean).join(', ');
      }
      return null;
    }},
    
    // Job Preferences & Consent Fields
    { keywords: ['relocate', 'relocation'], getValue: () => profileData.willing_to_relocate },
    { keywords: ['background', 'screening'], getValue: () => profileData.background_check_consent },
    { keywords: ['drug', 'test'], getValue: () => profileData.drug_test_consent },
    { keywords: ['criminal', 'conviction'], getValue: () => profileData.criminal_history },
    { keywords: ['salary', 'compensation'], getValue: () => profileData.job_preferences?.salaryExpectation },
    { keywords: ['remote', 'telecommute'], getValue: () => profileData.job_preferences?.remote }
  ];
  
  for (const pattern of patterns) {
    const matches = pattern.keywords.some(keyword => 
      context.name.includes(keyword) ||
      context.id.includes(keyword) ||
      context.label.includes(keyword) ||
      context.placeholder.includes(keyword)
    );
    
    if (matches) {
      const value = pattern.getValue();
      if (value) {
        return { value, pattern: pattern.keywords.join('|') };
      }
    }
  }
  
  return null;
}

// Set up dynamic observation
function observeDynamic(profileData, mappingConfig, useAI = false) {
  console.log('👁️ Setting up dynamic observation');
  console.log('👁️ AI enabled for dynamic observation:', useAI);
  
  let debounceTimer = null;
  
  const observer = new MutationObserver((mutations) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    
    debounceTimer = setTimeout(async () => {
      let hasNewFields = false;
      
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node;
              if (element.querySelectorAll?.('input, textarea, select').length > 0 ||
                  element.matches?.('input, textarea, select')) {
                hasNewFields = true;
              }
            }
          });
        }
      }
      
      if (hasNewFields) {
        console.log('🔄 New fields detected, re-running filler');
        await handleFillForm(profileData, useAI);
      }
    }, 500);
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  return observer;
}

// Utility functions
function getValue(obj, keys) {
  let current = obj;
  for (const key of keys) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
}

function isElementVisible(element) {
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && 
         style.visibility !== 'hidden' && 
         element.offsetParent !== null;
}

function getFieldLabel(element) {
  // Try label[for] association
  if (element.id) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label?.textContent) return label.textContent.trim();
  }
  
  // Try parent label
  const parentLabel = element.closest('label');
  if (parentLabel?.textContent) {
    return parentLabel.textContent.replace(element.value || '', '').trim();
  }
  
  // Try sibling label
  const prevSibling = element.previousElementSibling;
  if (prevSibling?.tagName === 'LABEL') {
    return prevSibling.textContent?.trim() || '';
  }
  
  return '';
}

function showNotification(message, type = 'info') {
  try {
  const notification = document.createElement('div');
  notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
    background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
      color: white;
      padding: 12px 20px;
    border-radius: 8px;
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 14px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      max-width: 300px;
    word-wrap: break-word;
  `;
  notification.textContent = message;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
  }, 4000);
  } catch (error) {
    console.error('Failed to show notification:', error);
  }
}

// Message listener for popup communication
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('📨 Content script received message:', request.action);
  
  // Handle fillForm action properly
  if (request.action === 'fillForm') {
    console.log('🚀 DEBUG: Fill form message received');
    console.log('🚀 DEBUG: Profile data:', request.profileData);
    console.log('🚀 DEBUG: Use AI:', request.useAI);
    
    // Run the actual form filling and wait for result
    (async () => {
      try {
        const result = await handleFillForm(request.profileData, request.useAI);
        console.log('✅ Form filling completed:', result);
        sendResponse({ 
          success: true, 
          filled: result.filled || 0, 
          message: result.message || 'Form filled successfully' 
        });
      } catch (error) {
        console.error('❌ Form filling failed:', error);
        sendResponse({ 
          success: false, 
          filled: 0, 
          error: error.message || 'Form filling failed' 
        });
      }
    })();
    
    return true; // Keep message channel open for async response
  }
  
  (async () => {
    try {
      switch (request.action) {
        case 'detectFields':
          console.log('🔍 Detecting form fields');
          await handleDetectFields();
          sendResponse({ success: true, message: 'Fields detected' });
          break;
          
        case 'stopObservation':
          console.log('⏹️ Stopping observation');
          handleStopObservation();
          sendResponse({ success: true, message: 'Observation stopped' });
          break;
          
        case 'reloadAIConfig':
          console.log('🔄 Reloading AI configuration');
          await loadAIConfig();
          sendResponse({ success: true, message: 'AI config reloaded' });
          break;
          
        default:
          console.log('❓ Unknown action:', request.action);
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      console.error('❌ Content script error:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();
  
  return true; // Keep message channel open for async response
});

// Initialize
console.log('✅ Fillo Advanced Form Filler ready');

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  if (currentObserver) {
    currentObserver.disconnect();
  }
}); 