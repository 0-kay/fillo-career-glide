// 🔍 Token Extraction Script
// Run this in console on localhost:8080 to see exactly where your token is

console.log('🔍 === TOKEN EXTRACTION SCRIPT ===');

// Function to safely preview a token
function previewToken(token, source) {
  if (!token || typeof token !== 'string') return null;
  
  return {
    source: source,
    length: token.length,
    preview: token.substring(0, 20) + '...' + token.substring(token.length - 10),
    isJWT: token.includes('.') && token.length > 100,
    startsWithEyJ: token.startsWith('eyJ')
  };
}

// Check all possible locations
const locations = [];

// 1. Check direct Supabase key
const supabaseKey = 'sb-yuojrygcrcpajiglbekd-auth-token';
const supabaseData = localStorage.getItem(supabaseKey);
if (supabaseData) {
  try {
    const parsed = JSON.parse(supabaseData);
    if (parsed.access_token) {
      locations.push(previewToken(parsed.access_token, `localStorage.${supabaseKey}.access_token`));
    }
  } catch (e) {
    if (supabaseData.length > 50) {
      locations.push(previewToken(supabaseData, `localStorage.${supabaseKey} (direct)`));
    }
  }
}

// 2. Check all auth-related localStorage keys
Object.keys(localStorage).forEach(key => {
  if (key.includes('auth') || key.includes('token') || key.includes('supabase')) {
    const value = localStorage.getItem(key);
    if (value) {
      try {
        const parsed = JSON.parse(value);
        // Look for access_token in parsed object
        const findTokenRecursive = (obj, path = '') => {
          if (typeof obj !== 'object') return;
          
          Object.keys(obj).forEach(subKey => {
            const fullPath = path ? `${path}.${subKey}` : subKey;
            const subValue = obj[subKey];
            
            if (subKey === 'access_token' && typeof subValue === 'string' && subValue.length > 50) {
              locations.push(previewToken(subValue, `localStorage.${key}.${fullPath}`));
            } else if (typeof subValue === 'object' && subValue !== null) {
              findTokenRecursive(subValue, fullPath);
            }
          });
        };
        
        findTokenRecursive(parsed);
      } catch (e) {
        // Not JSON, check if it's a direct token
        if (value.includes('.') && value.length > 100) {
          locations.push(previewToken(value, `localStorage.${key} (direct JWT)`));
        }
      }
    }
  }
});

// 3. Check extension storage (if available)
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
  chrome.storage.local.get().then(extensionData => {
    console.log('\n🤖 EXTENSION STORAGE:');
    console.log('All keys:', Object.keys(extensionData));
    
    if (extensionData.authToken) {
      console.log('✅ Extension auth token found!');
      console.log(previewToken(extensionData.authToken, 'chrome.storage.local.authToken'));
    } else {
      console.log('❌ No auth token in extension storage');
    }
  });
}

// Display results
console.log('\n🎯 TOKENS FOUND:');
if (locations.length === 0) {
  console.log('❌ No tokens found in any location');
} else {
  locations.forEach((loc, index) => {
    console.log(`\n${index + 1}. 📍 ${loc.source}`);
    console.log(`   📏 Length: ${loc.length}`);
    console.log(`   🔗 Preview: ${loc.preview}`);
    console.log(`   ✅ Valid JWT: ${loc.isJWT ? 'YES' : 'NO'}`);
    console.log(`   🎯 Starts with eyJ: ${loc.startsWithEyJ ? 'YES' : 'NO'}`);
  });
}

// Copy the first valid token to clipboard (if possible)
const validToken = locations.find(loc => loc.isJWT && loc.startsWithEyJ);
if (validToken && navigator.clipboard) {
  // Extract the actual token (remove preview formatting)
  const fullToken = localStorage.getItem(validToken.source.split('.')[1]);
  if (fullToken) {
    try {
      const parsed = JSON.parse(fullToken);
      const actualToken = parsed.access_token;
      
      navigator.clipboard.writeText(actualToken).then(() => {
        console.log('\n📋 COPIED TO CLIPBOARD: First valid token copied!');
      }).catch(() => {
        console.log('\n📋 Token found but clipboard copy failed');
      });
    } catch (e) {
      console.log('\n📋 Token found but extraction failed');
    }
  }
}

console.log('\n🔍 === END TOKEN EXTRACTION ===');

// Return summary
return {
  totalFound: locations.length,
  validJWTs: locations.filter(loc => loc.isJWT && loc.startsWithEyJ).length,
  locations: locations
}; 