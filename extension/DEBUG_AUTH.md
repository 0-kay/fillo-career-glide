# 🐛 Authentication Debug Guide

If the extension isn't detecting your authentication automatically, here are manual debugging steps:

## Step 1: Check Extension Console

1. **Right-click the extension icon** → "Inspect popup"
2. **Look for detailed logs:**
   ```
   🔍 Detecting authentication...
   🔍 Looking for Fillo app tab...
   ✅ Found Fillo app tab, checking for session
   📋 All localStorage items: [list of keys]
   🔍 Trying auth patterns: [list of patterns]
   ```

3. **If you see "No valid token found"**, proceed to Step 2

## Step 2: Manual Token Extraction

1. **Go to your Fillo app:** `http://localhost:8080`
2. **Open browser console:** Press F12
3. **Run this script to find auth tokens:**

```javascript
// Scan for all auth-related items
console.log('=== FILLO AUTH DEBUG ===');

const authKeys = Object.keys(localStorage).filter(k => 
  k.includes('auth') || k.includes('token') || k.includes('supabase') || k.includes('session')
);

console.log('🔍 Auth-related keys found:', authKeys);

authKeys.forEach(key => {
  const value = localStorage.getItem(key);
  console.log(`📋 ${key}:`, value?.substring(0, 200) + '...');
  
  try {
    const parsed = JSON.parse(value);
    if (parsed.access_token) {
      console.log(`🎯 FOUND TOKEN in ${key}:`, parsed.access_token);
    }
    if (parsed.session?.access_token) {
      console.log(`🎯 FOUND SESSION TOKEN in ${key}:`, parsed.session.access_token);
    }
  } catch (e) {
    // Not JSON, check if it's a direct token
    if (value && value.includes('.') && value.length > 100) {
      console.log(`🎯 POSSIBLE DIRECT TOKEN in ${key}:`, value);
    }
  }
});
```

4. **Copy any token that appears** (starts with `eyJ` usually)

## Step 3: Use Manual Token

1. **In the extension popup**, if you see "Authentication Required"
2. **Scroll down to the "Debug Mode" section**
3. **Paste the token** in the input field
4. **Click "Use Manual Token"**
5. **Extension should now load your profiles!**

## Step 4: Common Token Locations

Check these specific localStorage keys:

```javascript
// Try these specific keys
const tokenKeys = [
  'sb-yuojrygcrcpajiglbekd-auth-token',
  'supabase.auth.token',
  'sb-session',
  'auth-token'
];

tokenKeys.forEach(key => {
  const value = localStorage.getItem(key);
  if (value) {
    console.log(`Found ${key}:`, value);
  }
});
```

## Step 5: Network Tab Method

1. **Open Network tab** in F12
2. **Reload your Fillo app** (`http://localhost:8080`)
3. **Look for API calls to** `yuojrygcrcpajiglbekd.supabase.co`
4. **Check the Authorization header** in any request
5. **Copy the Bearer token** (after "Bearer ")

## Troubleshooting

### ❌ "No Fillo app tab found"
- Make sure `http://localhost:8080` is open in a tab
- Extension needs permission to access localhost

### ❌ "No valid token found"
- You might not be signed in to your Fillo account
- Try signing out and back in
- Check if you have profiles created

### ❌ "Invalid token"
- Token might be expired
- Try refreshing your Fillo app and getting a new token
- Make sure you copied the complete token

## Success Indicators

✅ **Working correctly:**
```
✅ Found auth token from "sb-yuojrygcrcpajiglbekd-auth-token" (access_token)
📡 Loading profiles from API...
✅ Loaded profiles: 3
```

✅ **Extension shows:**
- Your real profile names in dropdown
- Profile preview with your actual data
- No "Authentication Required" screen 