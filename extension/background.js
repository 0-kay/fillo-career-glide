// Fillo Auto-Fill Extension - Background Script
// Simple background script with minimal functionality

console.log('🚀 Fillo Auto-Fill: Background script started');

const SUPABASE_URL = 'https://yuojrygcrcpajiglbekd.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1b2pyeWdjcmNwYWppZ2xiZWtkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEyMzAzMjksImV4cCI6MjA2NjgwNjMyOX0.9dYnQRjtSocxmb9gCw0fOf4GfPk2mUQNcrkOqwu8Rck';

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('✅ Fillo Auto-Fill extension installed');
});

// Content scripts (the floating widget) can't call chrome.tabs/chrome.scripting
// directly, so they route profile fetches and fill requests through here.
async function handleWidgetGetProfiles() {
  const { FILLO_AUTH_TOKEN } = await chrome.storage.local.get(['FILLO_AUTH_TOKEN']);
  if (!FILLO_AUTH_TOKEN) return { success: false, error: 'not_authenticated' };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/application_profiles?select=*`, {
      headers: {
        Authorization: `Bearer ${FILLO_AUTH_TOKEN}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) return { success: false, error: `API error ${res.status}` };
    const profiles = await res.json();
    if (!Array.isArray(profiles)) return { success: false, error: 'Unexpected response' };
    const readyProfiles = profiles.filter((p) => (p.completeness || 0) >= 75);
    return { success: true, profiles: readyProfiles };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function handleWidgetFill(profile, tabId) {
  if (!tabId) return { success: false, error: 'No active tab' };
  if (!profile) return { success: false, error: 'No profile selected' };

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: async (profileData) => {
        const ns = window.__Fillo;
        if (ns && ns.engine && ns.engine.handleFillForm) {
          return await ns.engine.handleFillForm(profileData, false, { fromObserver: false });
        }
        return { success: false, error: 'Content script not ready', filled: 0 };
      },
      args: [profile],
    });

    let totalFilled = 0;
    let anySuccess = false;
    let lastError = '';
    for (const r of results) {
      if (r.result?.success) {
        anySuccess = true;
        totalFilled += r.result.filled || 0;
      } else if (r.result?.error && r.result.error !== 'Content script not ready') {
        lastError = r.result.error;
      }
    }

    return {
      success: anySuccess,
      filled: totalFilled,
      error: anySuccess ? null : lastError || 'No fillable fields found',
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.action === 'FILLO_WIDGET_GET_PROFILES') {
    handleWidgetGetProfiles().then(sendResponse);
    return true;
  }

  if (request && request.action === 'FILLO_WIDGET_FILL') {
    handleWidgetFill(request.profile, sender.tab?.id).then(sendResponse);
    return true;
  }

  console.log('📨 Background received message:', request);

  // Simple echo response for any other messages
  sendResponse({ status: 'received' });
  return true;
});


const ALLOWED_EXTERNAL_ORIGINS = [
  'https://www.fylloai.com',
  'http://localhost:5173',
  'http://localhost:8080'
];

chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  if (ALLOWED_EXTERNAL_ORIGINS.includes(sender.origin)) {
    console.log('Received message:', request);
    chrome.storage.local.set({ FILLO_AUTH_TOKEN: request.accessToken })

    sendResponse({ success: true, result: 'token sent' });
  }
  return true;
});


console.log('✅ Fillo Auto-Fill: Background script ready'); 
