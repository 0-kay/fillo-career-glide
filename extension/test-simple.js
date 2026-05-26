// Simple Test Script for Fillo Extension
// Run this in browser console on localhost:8080 to test the authentication flow

console.log('🧪 SIMPLE FILLO EXTENSION TEST');
console.log('==============================');

async function testSimpleAuth() {
  console.log('🔍 Testing simple authentication flow...');
  
  // Check if Chrome extension API is available
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    console.log('❌ Chrome extension API not available');
    console.log('💡 Make sure you have the Fillo extension installed and reload it');
    return;
  }
  
  console.log('✅ Chrome extension API available');
  
  // Check if user is logged into Fillo
  const supabaseKey = 'sb-yuojrygcrcpajiglbekd-auth-token';
  const authData = localStorage.getItem(supabaseKey);
  
  if (!authData) {
    console.log('❌ Not logged into Fillo');
    console.log('💡 Please log into your Fillo account first!');
    return;
  }
  
  let accessToken;
  try {
    const parsed = JSON.parse(authData);
    accessToken = parsed.access_token;
    if (!accessToken) {
      console.log('❌ No access token found');
      return;
    }
    console.log('✅ Found Fillo auth token');
  } catch (e) {
    console.log('❌ Error parsing auth data:', e.message);
    return;
  }
  
  // Save token to Chrome storage with simple key
  console.log('💾 Saving token to Chrome storage...');
  try {
    await chrome.storage.local.set({
      FILLO_AUTH_TOKEN: accessToken
    });
    console.log('✅ Token saved successfully');
  } catch (e) {
    console.log('❌ Error saving token:', e.message);
    return;
  }
  
  // Verify it was saved
  console.log('🔍 Verifying token was saved...');
  try {
    const result = await chrome.storage.local.get(['FILLO_AUTH_TOKEN']);
    if (result.FILLO_AUTH_TOKEN) {
      console.log('✅ Token verified in Chrome storage');
      console.log(`🔑 Token: ${result.FILLO_AUTH_TOKEN.substring(0, 50)}...`);
    } else {
      console.log('❌ Token not found after save');
      return;
    }
  } catch (e) {
    console.log('❌ Error verifying token:', e.message);
    return;
  }
  
  // Test API call
  console.log('📡 Testing API call with stored token...');
  try {
    const response = await fetch('https://yuojrygcrcpajiglbekd.supabase.co/rest/v1/profiles?select=*', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1b2pyeWdjcmNwYWppZ2xiZWtkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTk2ODMzNDQsImV4cCI6MjAzNTI1OTM0NH0.Y_jZMl-QU5pqE_Gj6h02Wz5J9lNh5Kn1bgSqI-Q_8xI',
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const profiles = await response.json();
      console.log(`✅ API test successful! Found ${profiles.length} profiles`);
      
      if (profiles.length > 0) {
        console.log(`👤 First profile: ${profiles[0].name || 'Unnamed'}`);
      }
    } else {
      console.log(`❌ API test failed: ${response.status} ${response.statusText}`);
      return;
    }
  } catch (e) {
    console.log('❌ API test error:', e.message);
    return;
  }
  
  console.log('\n🎉 SUCCESS! Everything is working!');
  console.log('\n📋 Next steps:');
  console.log('1. Click the Fillo extension icon');
  console.log('2. Extension should find the token and show your profiles');
  console.log('3. Select a profile and try filling a form');
  console.log('\n💡 If the extension still shows "sign in", make sure it\'s reloaded at chrome://extensions');
}

// Clear everything and start fresh
async function clearAndTest() {
  console.log('🧹 Clearing all Chrome storage first...');
  try {
    await chrome.storage.local.clear();
    console.log('✅ Chrome storage cleared');
    
    // Wait a moment then test
    setTimeout(() => {
      testSimpleAuth();
    }, 1000);
  } catch (e) {
    console.log('❌ Error clearing storage:', e.message);
  }
}

// Run the test
clearAndTest(); 