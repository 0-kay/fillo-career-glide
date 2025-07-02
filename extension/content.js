// Fillo Auto-Fill Extension - Content Script
// Simplified version focusing on form filling functionality

console.log('🔧 Fillo Auto-Fill: Content script loaded on', window.location.href);

// Form filling functionality for job application sites
const FORM_SELECTORS = {
  firstName: [
    'input[name*="first" i][name*="name" i]',
    'input[name="firstName"]',
    'input[name="fname"]',
    'input[id*="first" i][id*="name" i]',
    'input[placeholder*="first" i][placeholder*="name" i]',
    'input[data-automation-id*="firstName"]'
  ],
  lastName: [
    'input[name*="last" i][name*="name" i]',
    'input[name="lastName"]',
    'input[name="lname"]',
    'input[id*="last" i][id*="name" i]',
    'input[placeholder*="last" i][placeholder*="name" i]',
    'input[data-automation-id*="lastName"]'
  ],
  email: [
    'input[type="email"]',
    'input[name="email"]',
    'input[name*="email" i]',
    'input[id*="email" i]',
    'input[placeholder*="email" i]',
    'input[data-automation-id*="email"]'
  ],
  phone: [
    'input[type="tel"]',
    'input[name*="phone" i]',
    'input[name*="mobile" i]',
    'input[id*="phone" i]',
    'input[placeholder*="phone" i]',
    'input[data-automation-id*="phone"]'
  ],
  address: [
    'input[name*="address" i]',
    'input[name*="street" i]',
    'input[id*="address" i]',
    'input[placeholder*="address" i]',
    'textarea[name*="address" i]'
  ],
  city: [
    'input[name*="city" i]',
    'input[id*="city" i]',
    'input[placeholder*="city" i]'
  ],
  state: [
    'input[name*="state" i]',
    'select[name*="state" i]',
    'input[name*="province" i]',
    'input[id*="state" i]'
  ],
  zipCode: [
    'input[name*="zip" i]',
    'input[name*="postal" i]',
    'input[id*="zip" i]',
    'input[placeholder*="zip" i]'
  ],
  linkedin: [
    'input[name*="linkedin" i]',
    'input[id*="linkedin" i]',
    'input[placeholder*="linkedin" i]'
  ],
  github: [
    'input[name*="github" i]',
    'input[id*="github" i]',
    'input[placeholder*="github" i]'
  ],
  portfolio: [
    'input[name*="portfolio" i]',
    'input[name*="website" i]',
    'input[id*="portfolio" i]',
    'input[placeholder*="website" i]'
  ]
};

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  try {
    console.log('📨 Content script received message:', request.action);
    
    if (request.action === 'fillForm') {
      const success = fillFormWithData(request.profileData);
      sendResponse({ success });
    } else if (request.action === 'detectFields') {
      const fields = detectFormFields();
      sendResponse({ fields });
    }
  } catch (error) {
    console.log('❌ Content script error:', error);
    sendResponse({ success: false, error: error.message });
  }
  
  return true; // Keep message channel open
});

function findField(selectors) {
  for (const selector of selectors) {
    const field = document.querySelector(selector);
    if (field && field.offsetParent !== null) { // Check if field is visible
      return field;
    }
  }
  return null;
}

function fillField(field, value) {
  if (!field || !value) return false;
  
  try {
    // Focus the field
    field.focus();
    
    // Clear existing value
    field.value = '';
    
    // Set new value
    field.value = value;
    
    // Trigger events to ensure form validation
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.dispatchEvent(new Event('blur', { bubbles: true }));
    
    // Visual feedback
    field.style.border = '2px solid #4CAF50';
    setTimeout(() => {
      field.style.border = '';
    }, 2000);
    
    console.log('✅ Filled field:', field.name || field.id, 'with:', value.substring(0, 20) + '...');
    return true;
  } catch (error) {
    console.log('❌ Error filling field:', error);
    return false;
  }
}

function fillFormWithData(profileData) {
  console.log('🔄 Starting form fill with profile data');
  let fieldsFound = 0;
  let fieldsFilled = 0;
  
  const personalDetails = profileData.personal_details || {};
  
  // Map profile data to form fields
  const fieldMappings = {
    firstName: personalDetails.first_name,
    lastName: personalDetails.last_name,
    email: personalDetails.email || personalDetails.contact_email,
    phone: personalDetails.phone,
    address: personalDetails.address,
    city: personalDetails.city,
    state: personalDetails.state,
    zipCode: personalDetails.zip_code || personalDetails.postal_code,
    linkedin: personalDetails.linkedin,
    github: personalDetails.github,
    portfolio: personalDetails.portfolio || personalDetails.website
  };
  
  // Fill each field
  for (const [fieldType, value] of Object.entries(fieldMappings)) {
    if (value && FORM_SELECTORS[fieldType]) {
      const field = findField(FORM_SELECTORS[fieldType]);
      if (field) {
        fieldsFound++;
        if (fillField(field, value)) {
          fieldsFilled++;
        }
      }
    }
  }
  
  // Show completion notification
  if (fieldsFilled > 0) {
    showNotification(`✅ Filled ${fieldsFilled} out of ${fieldsFound} detected fields`, 'success');
    console.log(`✅ Form filling complete: ${fieldsFilled}/${fieldsFound} fields filled`);
    return true;
  } else {
    showNotification('❌ No compatible form fields found on this page', 'error');
    console.log('❌ No compatible form fields found');
    return false;
  }
}

function detectFormFields() {
  const formFields = document.querySelectorAll('input, textarea, select');
  const detectedFields = [];
  
  formFields.forEach((field, index) => {
    if (field.offsetParent !== null) { // Only visible fields
      detectedFields.push({
        index,
        tag: field.tagName,
        type: field.type,
        name: field.name,
        id: field.id,
        placeholder: field.placeholder,
        className: field.className
      });
    }
  });
  
  console.log('🔍 Detected fields:', detectedFields.length);
  return detectedFields;
}

function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.innerHTML = `
    <div style="
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
      color: white;
      padding: 12px 20px;
      border-radius: 4px;
      font-family: Arial, sans-serif;
      font-size: 14px;
      z-index: 10000;
      box-shadow: 0 4px 8px rgba(0,0,0,0.3);
      max-width: 300px;
    ">
      ${message}
    </div>
  `;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    if (notification.parentNode) {
      notification.parentNode.removeChild(notification);
    }
  }, 4000);
}

console.log('✅ Fillo Auto-Fill content script ready for form filling'); 