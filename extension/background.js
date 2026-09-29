// Fillo Auto-Fill Extension - Background Script
// Simple background script with minimal functionality

console.log('🚀 Fillo Auto-Fill: Background script started');

importScripts('lib/password.js');

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

// ---------- ATS account screens (Workday, iCIMS) ----------
// content/ats-auth.js reports the account screen from whichever frame shows it; the widget lives
// in the top frame. State is kept per tab so the widget can ask for it when its panel opens.
const authScreens = new Map(); // tabId -> { state, frameId }

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
}

let planCache = { token: null, plan: null, at: 0 };
async function getPlan() {
  const { FILLO_AUTH_TOKEN } = await chrome.storage.local.get(['FILLO_AUTH_TOKEN']);
  if (!FILLO_AUTH_TOKEN) return null;
  if (planCache.token === FILLO_AUTH_TOKEN && Date.now() - planCache.at < 5 * 60 * 1000) return planCache.plan;
  try {
    // RLS returns only the caller's own row.
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=plan`, { headers: authHeaders(FILLO_AUTH_TOKEN) });
    const rows = res.ok ? await res.json() : [];
    const plan = rows?.[0]?.plan === 'pro' ? 'pro' : 'free';
    planCache = { token: FILLO_AUTH_TOKEN, plan, at: Date.now() };
    return plan;
  } catch (_) {
    return 'free';
  }
}

async function getKnownAccount(tenant) {
  const { FILLO_AUTH_TOKEN } = await chrome.storage.local.get(['FILLO_AUTH_TOKEN']);
  if (!FILLO_AUTH_TOKEN || !tenant) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/ats_accounts?select=email,status,created_at,last_signed_in_at&tenant=eq.${encodeURIComponent(tenant)}`,
      { headers: authHeaders(FILLO_AUTH_TOKEN) },
    );
    const rows = res.ok ? await res.json() : [];
    return rows?.[0] || null;
  } catch (_) {
    return null;
  }
}

// Passwords Fyllo generated this browser session, held only until the account exists, in case the
// applicant dismissed the password manager's save prompt. chrome.storage.session is memory-only,
// cleared when the browser closes, and not readable by content scripts.
const PW_KEY = (tenant) => `FILLO_ATS_PW:${tenant}`;
const sessionPassword = async (tenant) => (await chrome.storage.session.get(PW_KEY(tenant)))[PW_KEY(tenant)] || null;

async function handleAuthGetState(tabId) {
  const entry = authScreens.get(tabId);
  const plan = await getPlan();
  if (!entry?.state) return { success: true, state: null, plan };
  const [account, pw] = await Promise.all([getKnownAccount(entry.state.tenant), sessionPassword(entry.state.tenant)]);
  return { success: true, state: entry.state, plan, account, hasSessionPassword: !!pw };
}

async function handleAuthFill(tabId, { email, mode }) {
  const entry = authScreens.get(tabId);
  if (!entry?.state) return { ok: false, error: 'No account screen on this page' };
  if ((await getPlan()) !== 'pro') return { ok: false, error: 'pro_required' };
  const tenant = entry.state.tenant;
  let password = null;
  if (mode === 'create') {
    // Reuse this session's password if the applicant fills twice, so the two never diverge.
    password = (await sessionPassword(tenant))?.password || self.filloGeneratePassword();
    await chrome.storage.session.set({ [PW_KEY(tenant)]: { password, at: Date.now() } });
  } else if (mode === 'sign-in') {
    // Only a password Fyllo generated this session; otherwise the password manager fills it.
    password = (await sessionPassword(tenant))?.password || null;
  }
  return chrome.tabs.sendMessage(tabId, { action: 'FILLO_AUTH_FILL', email, password }, { frameId: entry.frameId });
}

async function handleAuthSubmitted(req) {
  const { FILLO_AUTH_TOKEN } = await chrome.storage.local.get(['FILLO_AUTH_TOKEN']);
  if (!FILLO_AUTH_TOKEN || !req.tenant) return;
  const creating = req.screen === 'create-account';
  const now = new Date().toISOString();
  const row = {
    tenant: req.tenant,
    platform: req.platform,
    email: req.email,
    status: creating ? 'created' : 'active',
    ...(creating ? {} : { last_signed_in_at: now }),
    updated_at: now,
  };
  try {
    // Pro-only by RLS; the user_id default comes from auth.uid().
    await fetch(`${SUPABASE_URL}/rest/v1/ats_accounts?on_conflict=user_id,tenant`, {
      method: 'POST',
      headers: { ...authHeaders(FILLO_AUTH_TOKEN), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(row),
    });
  } catch (_) { /* best effort */ }
  // Signed in: the account works, so the session copy of the password is no longer needed. (A
  // reset keeps it: the new password may exist nowhere else until the next sign-in.)
  if (req.screen === 'sign-in') await chrome.storage.session.remove(PW_KEY(req.tenant));
}

chrome.tabs.onRemoved.addListener((tabId) => authScreens.delete(tabId));

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  if (request?.action === 'FILLO_AUTH_SCREEN' && tabId != null) {
    const current = authScreens.get(tabId);
    // A frame reporting "nothing here" only clears the state it set itself.
    if (request.state || current?.frameId === sender.frameId) {
      if (request.state) authScreens.set(tabId, { state: request.state, frameId: sender.frameId });
      else authScreens.delete(tabId);
      chrome.tabs.sendMessage(tabId, { action: 'FILLO_AUTH_STATE', state: request.state || null }, { frameId: 0 }).catch(() => {});
    }
    sendResponse({ ok: true });
    return;
  }
  if (request?.action === 'FILLO_AUTH_GET_STATE' && tabId != null) {
    handleAuthGetState(tabId).then(sendResponse);
    return true;
  }
  if (request?.action === 'FILLO_AUTH_REQUEST_FILL' && tabId != null) {
    handleAuthFill(tabId, request).then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (request?.action === 'FILLO_AUTH_HIGHLIGHT' && tabId != null) {
    const entry = authScreens.get(tabId);
    if (!entry) { sendResponse({ ok: false }); return; }
    chrome.tabs.sendMessage(tabId, { action: 'FILLO_AUTH_HIGHLIGHT', target: request.target }, { frameId: entry.frameId })
      .then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  }
  if (request?.action === 'FILLO_AUTH_SHOW_PASSWORD' && tabId != null) {
    const entry = authScreens.get(tabId);
    (entry ? sessionPassword(entry.state.tenant) : Promise.resolve(null)).then((pw) => sendResponse({ password: pw?.password || null }));
    return true;
  }
  if (request?.action === 'FILLO_AUTH_SUBMITTED') {
    handleAuthSubmitted(request).finally(() => sendResponse({ ok: true }));
    return true;
  }

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
