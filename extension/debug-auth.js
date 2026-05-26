// 🔍 Fillo Authentication Debug Script
// Paste this into your browser console on localhost:8080 while signed in

console.log('🔍 === FILLO AUTH DEBUG ===');

// Get all localStorage items
const allItems = {};
for (let i = 0; i < localStorage.length; i++) {
  const key = localStorage.key(i);
  const value = localStorage.getItem(key);
  allItems[key] = value;
}

console.log('📋 Total localStorage items:', localStorage.length);
console.log('🗂️ All localStorage keys:', Object.keys(allItems));

// Filter for auth-related items
const authKeys = Object.keys(allItems).filter(key => 
  key.toLowerCase().includes('auth') || 
  key.toLowerCase().includes('token') || 
  key.toLowerCase().includes('session') ||
  key.toLowerCase().includes('supabase') ||
  key.toLowerCase().includes('sb-')
);

console.log('🔑 Auth-related keys found:', authKeys);

// Examine each auth-related item
authKeys.forEach(key => {
  const value = allItems[key];
  console.log(`\n📋 Key: "${key}"`);
  console.log('📄 Raw value:', value);
  
  if (value) {
    try {
      const parsed = JSON.parse(value);
      console.log('🔍 Parsed structure:', Object.keys(parsed));
      
      // Look for access tokens
      if (parsed.access_token) {
        console.log('🎯 FOUND ACCESS TOKEN:', parsed.access_token.substring(0, 50) + '...');
      }
      
      if (parsed.session?.access_token) {
        console.log('🎯 FOUND SESSION ACCESS TOKEN:', parsed.session.access_token.substring(0, 50) + '...');
      }
      
      if (parsed.user) {
        console.log('👤 User info found:', {
          id: parsed.user.id,
          email: parsed.user.email
        });
      }
      
      // Look deeper into nested objects
      if (typeof parsed === 'object') {
        Object.keys(parsed).forEach(subKey => {
          const subValue = parsed[subKey];
          if (subValue && typeof subValue === 'object' && subValue.access_token) {
            console.log(`🎯 FOUND NESTED ACCESS TOKEN in ${subKey}:`, subValue.access_token.substring(0, 50) + '...');
          }
        });
      }
      
    } catch (e) {
      console.log('❌ Not JSON, raw string length:', value.length);
      
      // Check if it might be a JWT token
      if (value.includes('.') && value.length > 100) {
        console.log('🎯 POSSIBLE DIRECT JWT TOKEN:', value.substring(0, 50) + '...');
      }
    }
  }
});

// Also check specific Supabase patterns based on project ID
const projectId = 'yuojrygcrcpajiglbekd';
const possibleKeys = [
  `sb-${projectId}-auth-token`,
  `sb-${projectId}-auth-token-code-verifier`,
  `sb-${projectId}-auth-token-code-challenge`,
  'supabase.auth.token',
  'supabase.session',
  'auth-token',
  'session'
];

console.log('\n🔍 Checking specific Supabase patterns:');
possibleKeys.forEach(key => {
  const value = localStorage.getItem(key);
  if (value) {
    console.log(`✅ Found: ${key} = ${value.substring(0, 100)}...`);
  } else {
    console.log(`❌ Not found: ${key}`);
  }
});

// Check if extension communication is working
console.log('\n🤖 Testing extension communication:');
if (typeof window.filloExtensionNotifyAuth === 'function') {
  console.log('✅ Extension communication function available');
} else {
  console.log('❌ Extension communication function NOT available');
  console.log('Available window functions:', Object.keys(window).filter(k => k.includes('fillo')));
}

console.log('\n🔍 === END DEBUG ===');

// Return summary for easy copying
return {
  totalItems: localStorage.length,
  allKeys: Object.keys(allItems),
  authKeys: authKeys,
  authValues: authKeys.map(key => ({
    key: key,
    hasValue: !!allItems[key],
    valueLength: allItems[key]?.length || 0,
    isJSON: (() => {
      try {
        JSON.parse(allItems[key]);
        return true;
      } catch {
        return false;
      }
    })()
  }))
}; 