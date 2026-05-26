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

// AI-powered field analysis via Supabase Edge Function
async function analyzeFieldWithAI(fieldInfo, profileData) {
  if (!AI_CONFIG.enabled) {
    return null;
  }

  try {
    const response = await fetch(`${AI_CONFIG.supabaseUrl}/functions/v1/ai-field-analysis`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AI_CONFIG.supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fieldInfo: fieldInfo,
        profileData: profileData
      })
    });

    if (!response.ok) {
      throw new Error(`Supabase AI function error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.success && data.analysis) {
      const aiResponse = data.analysis;
      
      if (aiResponse.shouldFill && aiResponse.confidence > 70) {
        console.log(`🧠 Intelligent Match: ${fieldInfo.name} → ${aiResponse.value} (${aiResponse.confidence}% confidence)`);
        return {
          value: aiResponse.value,
          confidence: aiResponse.confidence,
          reasoning: aiResponse.reasoning,
          source: 'intelligent'
        };
      }
    }
    
    return null;
  } catch (error) {
    console.error('❌ Intelligent field analysis failed:', error);
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
      const result = await handleFillForm(request.profileData);
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
  if (isProcessing) {
    console.log('⏳ Already processing a fill request');
    return { filled: 0, message: 'Already processing' };
  }
  
  isProcessing = true;
  
  try {
    console.log('🚀 Starting advanced form filling with intelligent field matching');
    console.log('📋 Profile data keys:', Object.keys(profileData || {}));
    console.log('🧠 AI enabled:', useAI);
    
    // Load mapping configuration
    let mappingConfig;
    try {
      mappingConfig = await loadMapping();
      console.log('🗺️ Loaded mapping configuration:', mappingConfig.length, 'field mappings');
      
      if (!mappingConfig || mappingConfig.length === 0) {
        console.warn('⚠️ No field mappings available, using fallback only');
        mappingConfig = []; // Use empty array for fallback-only mode
      }
    } catch (error) {
      console.error('⚠️ Mapping load failed, using fallback mode:', error.message);
      mappingConfig = []; // Continue with fallback matching only
    }
    
    // Update AI config based on useAI flag
    AI_CONFIG.enabled = useAI;
    
    // Stop any existing observer
    if (currentObserver) {
      currentObserver.disconnect();
      currentObserver = null;
    }
    
    // Process each mapping
    let totalFilled = 0;
    let totalAttempted = 0;
    
    for (const { path, variants, isArray } of mappingConfig) {
      totalAttempted++;
      console.log('🔄 Processing: ', path);
      
      try {
        const keys = path.replace('[]', '').split('.');
        const value = getValue(profileData, keys);
        console.log('🔄 Processing: ', path, 'with value:', value);
        
        if (value == null) {
          console.log(`⏭️ Skipping ${path} - no data`);
          continue;
        }
        
        console.log(`🔄 Processing: ${path}`, { isArray, hasData: !!value });
        
        if (isArray && Array.isArray(value)) {
          const success = await processArrayField(path, variants, value);
          if (success) totalFilled++;
        } else if (!isArray) {
          const success = await processSingleField(path, variants, value);
          if (success) totalFilled++;
        }
        
        // Small delay between fields
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`❌ Error processing ${path}:`, error);
      }
    }
    
    // Run enhanced fallback matching
    const fallbackFilled = await enhancedFallbackMatch(profileData, mappingConfig, useAI);
    
    // Set up dynamic observation
    currentObserver = observeDynamic(profileData, mappingConfig);
    
    console.log(`✅ Form filling complete: ${totalFilled}/${totalAttempted} fields + ${fallbackFilled} smart fallback`);
    
    // Show notification
    showNotification(`⚡ Filled ${totalFilled + fallbackFilled} fields`, 'success');
    
    return {
      filled: totalFilled + fallbackFilled,
      attempted: totalAttempted,
      message: 'Form filling completed with intelligent field matching and dynamic observation'
    };
    
  } catch (error) {
    console.error('❌ Error in form filling:', error);
    showNotification('❌ Form filling failed: ' + error.message, 'error');
    throw error;
  } finally {
    isProcessing = false;
  }
}

// Enhanced fallback matching with intelligent analysis
async function enhancedFallbackMatch(profileData, mappingConfig, useAI = false) {
  console.log('🧠 Running enhanced fallback matching with intelligent analysis');
  console.log('🧠 AI enabled for fallback:', useAI);
  
  let filled = 0;
  const processedElements = new Set();
  
  // Safety check for DOM access
  if (!document || !document.querySelectorAll) {
    console.warn('⚠️ DOM not available for fallback matching');
    return 0;
  }
  
  const formElements = document.querySelectorAll('input, textarea, select');
  console.log(`🔍 Found ${formElements.length} form elements to process`);
  
  for (const element of formElements) {
    if (processedElements.has(element)) {
      console.log('⏭️ Element already processed, skipping');
      continue;
    }
    
    if (element.value?.trim()) {
      console.log('⏭️ Element already has value, skipping:', element.value);
      continue;
    }
    
    if (!isElementVisible(element)) {
      console.log('⏭️ Element not visible, skipping');
      continue;
    }
    
    console.log('🔄 Processing element:', element.name || element.id || element.type);
    
    const fieldInfo = getEnhancedFieldContext(element);
    console.log('🔍 Field info:', fieldInfo);
    
    // First try intelligent matching if available
    if (useAI && AI_CONFIG.enabled) {
      console.log('🧠 Trying AI matching for field:', fieldInfo.name);
      try {
        const intelligentMatch = await analyzeFieldWithAI(fieldInfo, profileData);
        if (intelligentMatch) {
          console.log('🧠 AI suggested match:', intelligentMatch);
          if (fillElement(element, intelligentMatch.value)) {
            filled++;
            processedElements.add(element);
            console.log(`🧠 Intelligent match: ${fieldInfo.name} with confidence ${intelligentMatch.confidence}%`);
            continue;
          }
        } else {
          console.log('🧠 AI did not suggest a match for:', fieldInfo.name);
        }
      } catch (error) {
        console.error('❌ Intelligent matching failed for field:', fieldInfo.name, error);
      }
    } else {
      console.log('🧠 AI matching disabled');
    }
    
    // Fallback to semantic pattern matching
    console.log('📋 Trying semantic pattern matching for field:', fieldInfo.name);
    const semanticMatch = findSemanticMatch(fieldInfo, profileData);
    if (semanticMatch) {
      console.log('📋 Pattern match found:', semanticMatch);
      if (fillElement(element, semanticMatch.value)) {
        filled++;
        processedElements.add(element);
        console.log(`📋 Pattern filled: ${fieldInfo.name}`);
      } else {
        console.log('❌ Failed to fill element with value:', semanticMatch.value);
      }
    } else {
      console.log('📋 No semantic match found for field:', fieldInfo.name);
    }
  }
  
  console.log(`✅ Enhanced fallback filled ${filled} additional fields`);
  return filled;
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
  let score = 0;
  const name = element.name?.toLowerCase() || '';
  const id = element.id?.toLowerCase() || '';
  const placeholder = element.placeholder?.toLowerCase() || '';
  const className = element.className?.toLowerCase() || '';
  
  // Exact matches get highest score
  if (name === variant || id === variant) score += 10;
  
  // Partial matches
  if (name.includes(variant) || id.includes(variant)) score += 7;
  
  // Data attributes
  if (element.getAttribute('data-testid') === variant) score += 6;
  if (element.getAttribute('data-automation-id') === variant) score += 6;
  
  // Class names
  if (className.includes(variant)) score += 5;
  
  // Placeholder text
  if (placeholder.includes(variant)) score += 4;
  
  // Label association
  const label = getFieldLabel(element)?.toLowerCase() || '';
  if (label.includes(variant)) score += 3;
  
  // Type-specific bonuses
  if (element.type === 'email' && variant.includes('email')) score += 2;
  if (element.type === 'tel' && variant.includes('phone')) score += 2;
  if (element.type === 'url' && (variant.includes('website') || variant.includes('url'))) score += 2;
  
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
function observeDynamic(profileData, mappingConfig) {
  console.log('👁️ Setting up dynamic observation');
  
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
        await handleFillForm(profileData);
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
          const result = await handleDetectFields();
          sendResponse({ success: true, ...result });
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