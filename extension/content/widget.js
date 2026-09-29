// Fillo Auto-Fill Extension - Floating Widget
// An always-on-screen button (like Grammarly's) that shows up on any page
// as long as the user has an active Fillo session, and disappears the moment
// that session ends — whether from a fresh sign-in, a sign-out on the
// dashboard, or logging out from the widget itself.

(function () {
  if (window.top !== window) return; // top frame only, one widget per page

  const STORAGE_TOKEN_KEY = 'FILLO_AUTH_TOKEN';
  const STORAGE_SELECTED_PROFILE_KEY = 'FILLO_WIDGET_SELECTED_PROFILE';

  let host = null;
  let shadow = null;
  let panelOpen = false;
  let profiles = [];
  let selectedProfileId = null;
  let profilesLoaded = false;
  let hostPositioningInjected = false;
  // Workday / iCIMS account screen on this page, reported by content/ats-auth.js via background.
  let auth = { state: null, plan: null, account: null, hasSessionPassword: false, status: null, password: null };

  function getProfileName(profile) {
    return (
      profile.resume_metadata?.profile_name ||
      [profile.first_name, profile.last_name].filter(Boolean).join(' ') ||
      profile.personal_details?.fullName ||
      profile.personal_details?.full_name ||
      'Unnamed Profile'
    );
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }

  // Constructable Stylesheets (CSSStyleSheet + adoptedStyleSheets) are exempt
  // from a page's Content-Security-Policy style-src restrictions, unlike a
  // <style> tag or a style="" attribute. Enterprise ATS pages (Workday and
  // others) often ship a strict CSP, which would otherwise leave the widget
  // in the DOM but invisible/unstyled with no console error to explain why.
  function applyStylesheet(root, cssText) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(cssText);
      root.adoptedStyleSheets = [...(root.adoptedStyleSheets || []), sheet];
      return true;
    } catch (_) {
      return false;
    }
  }

  function injectHostPositioning() {
    if (hostPositioningInjected) return;
    const css = '#fillo-widget-host { all: initial; position: fixed !important; z-index: 2147483647 !important; bottom: 24px !important; right: 24px !important; }';
    if (applyStylesheet(document, css)) {
      hostPositioningInjected = true;
    } else {
      // Fallback for engines without Constructable Stylesheets support.
      host.style.cssText = 'all:initial; position:fixed; z-index:2147483647; bottom:24px; right:24px;';
    }
  }

  function injectShadowStyles() {
    if (!applyStylesheet(shadow, WIDGET_CSS)) {
      const style = document.createElement('style');
      style.textContent = WIDGET_CSS;
      shadow.prepend(style);
    }
  }

  // ---------- Mount / unmount ----------
  function mount() {
    if (host) return;

    host = document.createElement('div');
    host.id = 'fillo-widget-host';
    injectHostPositioning();
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <div class="fillo-bubble" id="bubble" role="button" tabindex="0" aria-label="Open Fyllo">
        <div class="fillo-bubble-icon"><img src="${chrome.runtime.getURL('icons/icon48.png')}" alt="" /></div>
      </div>
      <div class="fillo-panel hidden" id="panel"></div>
    `;
    injectShadowStyles();
    document.documentElement.appendChild(host);

    const bubble = shadow.getElementById('bubble');
    bubble.addEventListener('click', togglePanel);
    bubble.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        togglePanel();
      }
    });

    document.addEventListener('click', handleOutsideClick, true);

    renderMainPanel();
    refreshAuth();
  }

  function unmount() {
    if (!host) return;
    document.removeEventListener('click', handleOutsideClick, true);
    host.remove();
    host = null;
    shadow = null;
    panelOpen = false;
    profilesLoaded = false;
    profiles = [];
  }

  function handleOutsideClick(e) {
    if (!host || !panelOpen) return;
    if (!e.composedPath().includes(host)) closePanel();
  }

  function togglePanel() {
    panelOpen ? closePanel() : openPanel();
  }

  function openPanel() {
    panelOpen = true;
    shadow.getElementById('panel').classList.remove('hidden');
    if (!profilesLoaded) loadProfiles();
  }

  function closePanel() {
    panelOpen = false;
    if (shadow) shadow.getElementById('panel').classList.add('hidden');
  }

  // ---------- Data ----------
  function loadProfiles() {
    renderMainPanel({ loading: true });
    chrome.runtime.sendMessage({ action: 'FILLO_WIDGET_GET_PROFILES' }, (response) => {
      profilesLoaded = true;
      if (!response?.success) {
        renderMainPanel({ error: response?.error === 'not_authenticated'
          ? 'Not signed in.'
          : 'Could not load your profiles.' });
        return;
      }
      profiles = response.profiles || [];
      chrome.storage.local.get([STORAGE_SELECTED_PROFILE_KEY], (result) => {
        const stored = result[STORAGE_SELECTED_PROFILE_KEY];
        selectedProfileId = profiles.some((p) => p.id === stored) ? stored : profiles[0]?.id || null;
        renderMainPanel();
      });
    });
  }

  function fillCurrentPage() {
    const profile = profiles.find((p) => p.id === selectedProfileId);
    if (!profile) return;
    renderMainPanel({ filling: true });
    chrome.runtime.sendMessage({ action: 'FILLO_WIDGET_FILL', profile }, (response) => {
      if (response?.success) {
        const msg = response.filled > 0
          ? `Filled ${response.filled} field${response.filled === 1 ? '' : 's'}.`
          : 'Scanned the form — nothing new to fill.';
        renderMainPanel({ status: { type: 'success', msg } });
      } else {
        renderMainPanel({ status: { type: 'error', msg: response?.error || 'Fill failed.' } });
      }
    });
  }

  // ---------- ATS account screens ----------
  const PROVIDER_NAMES = { google: 'Google', linkedin: 'LinkedIn', microsoft: 'Microsoft', apple: 'Apple', facebook: 'Facebook', indeed: 'Indeed' };

  function selectedEmail() {
    const p = profiles.find((x) => x.id === selectedProfileId) || profiles[0];
    return p?.personal_details?.email || null;
  }

  function refreshAuth() {
    chrome.runtime.sendMessage({ action: 'FILLO_AUTH_GET_STATE' }, (res) => {
      if (!res?.success) return;
      auth = { ...auth, state: res.state, plan: res.plan, account: res.account, hasSessionPassword: res.hasSessionPassword };
      if (!res.state) auth.status = null;
      updateBadge();
      if (panelOpen) renderMainPanel();
    });
  }

  function updateBadge() {
    const bubble = shadow?.getElementById('bubble');
    if (bubble) bubble.classList.toggle('fillo-bubble--attention', !!auth.state);
  }

  function authFill(mode) {
    auth.status = { type: 'info', msg: 'Filling…' };
    renderMainPanel();
    chrome.runtime.sendMessage({ action: 'FILLO_AUTH_REQUEST_FILL', mode, email: selectedEmail() }, (res) => {
      if (res?.error === 'pro_required') auth.status = { type: 'error', msg: 'Account setup is a Pro feature.' };
      else if (!res?.ok) auth.status = { type: 'error', msg: res?.error || 'Nothing to fill on this screen.' };
      else if (mode === 'create') {
        auth.hasSessionPassword = true;
        auth.status = { type: 'success', msg: 'Filled. Tick "I agree", then click Create Account. Save the password when your browser offers.' };
        chrome.runtime.sendMessage({ action: 'FILLO_AUTH_HIGHLIGHT', target: 'submit' });
      } else {
        auth.status = { type: 'success', msg: res.filled.includes('password')
          ? 'Filled. Click Sign In.'
          : 'Email filled. Let your password manager fill the password, then click Sign In.' };
      }
      renderMainPanel();
    });
  }

  function authHighlight(target) {
    chrome.runtime.sendMessage({ action: 'FILLO_AUTH_HIGHLIGHT', target });
  }

  function authShowPassword() {
    chrome.runtime.sendMessage({ action: 'FILLO_AUTH_SHOW_PASSWORD' }, (res) => {
      auth.password = res?.password || null;
      renderMainPanel();
    });
  }

  function authCardHtml() {
    const s = auth.state;
    if (!s) return '';
    const company = escapeHtml(s.tenantName);
    const email = selectedEmail();
    const status = auth.status ? `<div class="fillo-status ${auth.status.type}">${escapeHtml(auth.status.msg)}</div>` : '';
    const sso = (s.sso || []).filter((p) => PROVIDER_NAMES[p]);
    const ssoHtml = sso.length
      ? `<div class="fillo-auth-note">Fastest: sign in with ${sso.map((p) => PROVIDER_NAMES[p]).join(' or ')} (no password or email check).</div>
         <div class="fillo-auth-row">${sso.map((p) => `<button class="fillo-auth-btn secondary" data-auth-sso="${p}" title="Point to the site's ${PROVIDER_NAMES[p]} button">${PROVIDER_NAMES[p]} sign-in</button>`).join('')}</div>`
      : '';

    if (auth.plan && auth.plan !== 'pro') {
      return `<div class="fillo-auth">
        <div class="fillo-auth-title">${company} needs a candidate account</div>
        ${ssoHtml}
        <div class="fillo-auth-note">Fyllo Pro creates these accounts for you and fills your sign-in on every employer's site.</div>
        <a class="fillo-auth-btn" href="https://www.fylloai.com/pricing" target="_blank" rel="noopener">Upgrade to Pro</a>
      </div>`;
    }

    const known = auth.account
      ? `<div class="fillo-auth-note">You created an account here${auth.account.email ? ` as ${escapeHtml(auth.account.email)}` : ''}.</div>` : '';
    let body = '';
    switch (s.screen) {
      case 'chooser':
        body = `${ssoHtml}${s.emailChoice ? `<button class="fillo-auth-btn ${sso.length ? 'secondary' : ''}" data-auth-highlight="email-choice">Use email instead</button>` : ''}`;
        break;
      case 'create-account':
      case 'reset-password':
        body = `${s.screen === 'create-account' ? known : ''}
          <div class="fillo-auth-note">Fyllo fills ${email ? escapeHtml(email) : 'your email'} and a strong password, and your browser saves it for next time.</div>
          <button class="fillo-auth-btn" data-auth-fill="create" ${email ? '' : 'disabled'}>${s.screen === 'create-account' ? 'Fill new account' : 'Fill new password'}</button>
          ${auth.hasSessionPassword ? '<button class="fillo-auth-link" data-auth-show>Show the password</button>' : ''}`;
        break;
      case 'sign-in':
        body = `${known || (s.hasConfirmField ? '' : '<div class="fillo-auth-note">No account yet? Click the site\'s Create Account link.</div>')}
          <button class="fillo-auth-btn" data-auth-fill="sign-in" ${email ? '' : 'disabled'}>Fill sign-in</button>
          ${auth.hasSessionPassword ? '<button class="fillo-auth-link" data-auth-show>Show the password</button>' : ''}
          <div class="fillo-auth-note">Forgot it? Use the site's "Forgot your password?" link and Fyllo fills a new one.</div>`;
        break;
      case 'enter-email':
      case 'forgot-password':
        body = `<button class="fillo-auth-btn" data-auth-fill="email" ${email ? '' : 'disabled'}>Fill my email</button>
          <div class="fillo-auth-note">Then click ${s.screen === 'enter-email' ? 'Next' : 'Submit'}.</div>`;
        break;
      case 'verify-email':
        body = `<div class="fillo-auth-note">${company} sent a verification link to ${email ? escapeHtml(email) : 'your email'}. Open it, then come back here to continue.</div>`;
        break;
      default:
        body = ssoHtml;
    }
    const password = auth.password
      ? `<div class="fillo-auth-password"><code>${escapeHtml(auth.password)}</code></div>` : '';
    return `<div class="fillo-auth">
      <div class="fillo-auth-title">${s.screen === 'create-account' ? `Create your ${company} account`
        : s.screen === 'reset-password' ? `Set a new ${company} password` : `Sign in to ${company}`}</div>
      ${body}${password}${status}
    </div>`;
  }

  function attachAuthHandlers() {
    shadow.querySelectorAll('[data-auth-fill]').forEach((b) => b.addEventListener('click', () => authFill(b.getAttribute('data-auth-fill'))));
    shadow.querySelectorAll('[data-auth-sso]').forEach((b) => b.addEventListener('click', () => authHighlight(`sso:${b.getAttribute('data-auth-sso')}`)));
    shadow.querySelectorAll('[data-auth-highlight]').forEach((b) => b.addEventListener('click', () => authHighlight(b.getAttribute('data-auth-highlight'))));
    shadow.querySelectorAll('[data-auth-show]').forEach((b) => b.addEventListener('click', authShowPassword));
  }

  chrome.runtime.onMessage.addListener((req) => {
    if (req?.action !== 'FILLO_AUTH_STATE' || !host) return;
    if (!req.state || req.state.screen !== auth.state?.screen) { auth.status = null; auth.password = null; }
    refreshAuth();
  });

  // ---------- Render ----------
  function renderMainPanel(state = {}) {
    if (!shadow) return;
    const panel = shadow.getElementById('panel');

    if (state.loading) {
      panel.innerHTML = panelShell('<div class="fillo-loading">Loading your profiles...</div>');
      return;
    }

    if (state.error) {
      panel.innerHTML = panelShell(`<div class="fillo-error">${escapeHtml(state.error)}</div>`, { footer: logoutFooter() });
      attachLogoutHandler();
      return;
    }

    const options = profiles
      .map((p) => `<option value="${p.id}" ${p.id === selectedProfileId ? 'selected' : ''}>${escapeHtml(getProfileName(p))}</option>`)
      .join('');

    const statusHtml = state.status
      ? `<div class="fillo-status ${state.status.type}">${escapeHtml(state.status.msg)}</div>`
      : '';

    panel.innerHTML = panelShell(`
      ${authCardHtml()}
      ${profiles.length > 0
        ? `<label class="fillo-label">Profile</label><select class="fillo-select" id="profile-select">${options}</select>`
        : '<div class="fillo-error">No profile is ready yet (needs 75% completeness).</div>'}
      <button class="fillo-fill-btn" id="fill-btn" ${profiles.length === 0 || state.filling ? 'disabled' : ''}>
        ${state.filling ? 'Filling...' : 'Fill this form'}
      </button>
      ${statusHtml}
    `, { footer: logoutFooter() });

    const select = shadow.getElementById('profile-select');
    if (select) {
      select.addEventListener('change', (e) => {
        selectedProfileId = e.target.value;
        chrome.storage.local.set({ [STORAGE_SELECTED_PROFILE_KEY]: selectedProfileId });
      });
    }
    const fillBtn = shadow.getElementById('fill-btn');
    if (fillBtn) fillBtn.addEventListener('click', fillCurrentPage);
    attachAuthHandlers();

    attachLogoutHandler();
  }

  function panelShell(body, { footer = '' } = {}) {
    return `
      <div class="fillo-panel-header">
        <button class="fillo-close" id="close-btn" aria-label="Close">&times;</button>
        <div class="fillo-panel-logo">
          <div class="fillo-panel-logo-icon"><img src="${chrome.runtime.getURL('icons/icon48.png')}" alt="" /></div>
          <span class="fillo-panel-logo-text">Fyllo</span>
        </div>
        <div class="fillo-panel-subtitle">Auto-Fill Assistant</div>
      </div>
      <div class="fillo-panel-body">${body}</div>
      ${footer}
    `;
  }

  function logoutFooter() {
    return `
      <div class="fillo-panel-footer">
        <button class="fillo-logout-btn" id="logout-btn">Log out</button>
      </div>
    `;
  }

  function attachLogoutHandler() {
    const closeBtn = shadow.getElementById('close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closePanel);

    const logoutBtn = shadow.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', renderLogoutConfirm);
  }

  function renderLogoutConfirm() {
    const panel = shadow.getElementById('panel');
    panel.innerHTML = `
      <div class="fillo-panel-header fillo-panel-header-compact">
        <button class="fillo-close" id="close-btn" aria-label="Close">&times;</button>
        <span class="fillo-panel-header-title">Log out of Fyllo?</span>
      </div>
      <div class="fillo-panel-body">
        <div class="fillo-warning">
          This signs the extension out. The Fyllo button will disappear from every page until you sign in again from the dashboard.
        </div>
      </div>
      <div class="fillo-panel-footer fillo-confirm-footer">
        <button class="fillo-cancel-btn" id="cancel-logout-btn">Cancel</button>
        <button class="fillo-logout-btn fillo-logout-confirm" id="confirm-logout-btn">Log out</button>
      </div>
    `;
    shadow.getElementById('close-btn').addEventListener('click', closePanel);
    shadow.getElementById('cancel-logout-btn').addEventListener('click', () => renderMainPanel());
    shadow.getElementById('confirm-logout-btn').addEventListener('click', () => {
      chrome.storage.local.remove([STORAGE_TOKEN_KEY, STORAGE_SELECTED_PROFILE_KEY]);
      closePanel();
      unmount();
    });
  }

  const BRAND_GRADIENT = 'linear-gradient(135deg, #8A2BE2 0%, #4B0082 100%)';

  const WIDGET_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: 'Space Grotesk', 'Poppins', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .fillo-bubble {
      width: 52px; height: 52px; border-radius: 50%;
      background: ${BRAND_GRADIENT}; box-shadow: 0 4px 16px rgba(75,0,130,0.35);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; transition: transform 0.15s ease;
    }
    .fillo-bubble:hover { transform: scale(1.06); }
    .fillo-bubble-icon {
      width: 32px; height: 32px; border-radius: 9px;
      background: rgba(255,255,255,0.25);
      display: flex; align-items: center; justify-content: center;
    }
    .fillo-bubble-icon img { width: 100%; height: 100%; object-fit: contain; border-radius: 9px; }
    .fillo-panel {
      position: absolute; bottom: 64px; right: 0;
      width: 260px; background: #fff; border-radius: 12px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.2); overflow: hidden;
      font-size: 13px; color: #111827;
    }
    .fillo-panel.hidden { display: none; }
    .fillo-panel-header {
      position: relative; text-align: center;
      padding: 18px 16px 14px; background: ${BRAND_GRADIENT}; color: #fff;
    }
    .fillo-panel-logo { display: flex; align-items: center; justify-content: center; margin-bottom: 4px; }
    .fillo-panel-logo-icon {
      width: 26px; height: 26px; border-radius: 8px;
      background: rgba(255,255,255,0.25);
      display: flex; align-items: center; justify-content: center; margin-right: 8px;
    }
    .fillo-panel-logo-icon img { width: 100%; height: 100%; object-fit: contain; }
    .fillo-panel-logo-text { font-size: 18px; font-weight: 700; color: #fff; }
    .fillo-panel-subtitle { font-size: 11px; color: rgba(255,255,255,0.85); }
    .fillo-panel-header-compact { text-align: left; padding: 14px 16px; }
    .fillo-panel-header-title { font-size: 14px; font-weight: 600; }
    .fillo-close {
      position: absolute; top: 10px; right: 10px;
      background: none; border: none; font-size: 18px; line-height: 1; cursor: pointer;
      color: rgba(255,255,255,0.8);
    }
    .fillo-close:hover { color: #fff; }
    .fillo-panel-body { padding: 14px; }
    .fillo-label { display: block; margin-bottom: 6px; color: #6b7280; font-size: 12px; }
    .fillo-select {
      width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid #e5e7eb;
      margin-bottom: 10px; font-size: 13px;
    }
    .fillo-fill-btn {
      width: 100%; padding: 9px 10px; border-radius: 8px; border: none;
      background: ${BRAND_GRADIENT}; color: #fff; font-weight: 600; cursor: pointer; font-size: 13px;
    }
    .fillo-fill-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .fillo-fill-btn:not(:disabled):hover { filter: brightness(1.08); }
    .fillo-status { margin-top: 10px; font-size: 12px; }
    .fillo-status.success { color: #059669; }
    .fillo-status.error { color: #dc2626; }
    .fillo-error { color: #dc2626; font-size: 12px; }
    .fillo-status.info { color: #6b7280; }
    .fillo-bubble--attention::after {
      content: ''; position: absolute; top: 2px; right: 2px; width: 12px; height: 12px;
      border-radius: 50%; background: #f59e0b; border: 2px solid #fff;
    }
    .fillo-bubble { position: relative; }
    .fillo-auth {
      border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; margin-bottom: 12px;
      background: #faf5ff;
    }
    .fillo-auth-title { font-weight: 600; font-size: 13px; margin-bottom: 6px; color: #111827; }
    .fillo-auth-note { font-size: 12px; color: #4b5563; line-height: 1.4; margin: 6px 0; }
    .fillo-auth-row { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
    .fillo-auth-btn {
      display: block; width: 100%; box-sizing: border-box; text-align: center; text-decoration: none;
      padding: 8px 10px; border-radius: 8px; border: none; margin-top: 6px;
      background: ${BRAND_GRADIENT}; color: #fff; font-weight: 600; cursor: pointer; font-size: 12.5px;
    }
    .fillo-auth-row .fillo-auth-btn { flex: 1; width: auto; margin-top: 0; }
    .fillo-auth-btn.secondary { background: #fff; color: #4b0082; border: 1px solid #d8b4fe; }
    .fillo-auth-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .fillo-auth-link { background: none; border: none; color: #6d28d9; font-size: 12px; cursor: pointer; padding: 6px 0 0; }
    .fillo-auth-password code {
      display: block; margin-top: 6px; padding: 6px 8px; border-radius: 6px; background: #fff;
      border: 1px dashed #c4b5fd; font-size: 12px; user-select: all; word-break: break-all;
    }
    .fillo-loading { color: #6b7280; font-size: 12px; }
    .fillo-warning { color: #374151; font-size: 12.5px; line-height: 1.4; }
    .fillo-panel-footer { padding: 8px 14px; border-top: 1px solid #f0f0f0; }
    .fillo-confirm-footer { display: flex; gap: 8px; }
    .fillo-logout-btn {
      background: none; border: none; color: #6b7280; font-size: 12px;
      cursor: pointer; padding: 4px 0;
    }
    .fillo-logout-btn:hover { color: #dc2626; }
    .fillo-logout-confirm {
      flex: 1; background: #dc2626; color: #fff; border-radius: 8px; padding: 8px; font-weight: 600;
    }
    .fillo-logout-confirm:hover { background: #b91c1c; }
    .fillo-cancel-btn {
      flex: 1; background: #f3f4f6; color: #111827; border: none; border-radius: 8px;
      padding: 8px; cursor: pointer; font-weight: 500;
    }
    .fillo-cancel-btn:hover { background: #e5e7eb; }
  `;

  // ---------- Session watching ----------
  function syncWithSession() {
    chrome.storage.local.get([STORAGE_TOKEN_KEY], (result) => {
      if (result[STORAGE_TOKEN_KEY]) mount();
      else unmount();
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(STORAGE_TOKEN_KEY in changes)) return;
    if (changes[STORAGE_TOKEN_KEY].newValue) mount();
    else unmount();
  });

  syncWithSession();
})();
