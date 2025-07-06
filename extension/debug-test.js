// Simple debug test for Fillo extension
console.log('🧪 DEBUG: Starting extension test');

// Test 1: Check if extension is loaded
console.log('🧪 DEBUG: Extension loaded at:', new Date().toISOString());

// Test 2: Check if we can find form fields
const inputs = document.querySelectorAll('input, textarea, select');
console.log('🧪 DEBUG: Found', inputs.length, 'form fields');

// Test 3: Test basic form filling
if (inputs.length > 0) {
  console.log('🧪 DEBUG: Testing basic form fill');
  
  const testData = {
    first_name: 'John',
    last_name: 'Doe',
    personal_details: {
      email: 'john.doe@example.com',
      phone: '+1-555-123-4567'
    }
  };
  
  // Try to fill first few fields
  inputs.forEach((input, index) => {
    if (index < 3) {
      const name = input.name || input.id || `field-${index}`;
      console.log(`🧪 DEBUG: Field ${index}:`, {
        name: name,
        type: input.type,
        placeholder: input.placeholder
      });
      
      // Simple test fill
      if (input.type === 'text' || input.type === 'email') {
        input.value = `Test-${index}`;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        console.log(`🧪 DEBUG: Filled field ${index} with test value`);
      }
    }
  });
}

// Test 4: Extension communication test
if (window.chrome && chrome.runtime) {
  console.log('🧪 DEBUG: Chrome extension API available');
  
  // Test message to background script
  chrome.runtime.sendMessage({action: 'test'}, (response) => {
    console.log('🧪 DEBUG: Background script response:', response);
  });
} else {
  console.log('🧪 DEBUG: Chrome extension API not available');
}

console.log('🧪 DEBUG: Test completed'); 