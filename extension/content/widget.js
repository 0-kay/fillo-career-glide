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
      <div class="fillo-bubble" id="bubble" role="button" tabindex="0" aria-label="Open Fillo">
        <img src="${chrome.runtime.getURL('icons/icon48.png')}" alt="" />
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

  // ---------- Render ----------
  function renderMainPanel(state = {}) {
    if (!shadow) return;
    const panel = shadow.getElementById('panel');

    if (state.loading) {
      panel.innerHTML = panelShell('<div class="fillo-loading">Loading your profiles…</div>');
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
      ${profiles.length > 0
        ? `<label class="fillo-label">Profile</label><select class="fillo-select" id="profile-select">${options}</select>`
        : '<div class="fillo-error">No profile is ready yet (needs 75% completeness).</div>'}
      <button class="fillo-fill-btn" id="fill-btn" ${profiles.length === 0 || state.filling ? 'disabled' : ''}>
        ${state.filling ? 'Filling…' : 'Fill this form'}
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

    attachLogoutHandler();
  }

  function panelShell(body, { footer = '' } = {}) {
    return `
      <div class="fillo-panel-header">
        <span>Fillo</span>
        <button class="fillo-close" id="close-btn" aria-label="Close">&times;</button>
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
      <div class="fillo-panel-header">
        <span>Log out?</span>
        <button class="fillo-close" id="close-btn" aria-label="Close">&times;</button>
      </div>
      <div class="fillo-panel-body">
        <div class="fillo-warning">
          This signs the extension out. The Fillo button will disappear from every page until you sign in again from the dashboard.
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

  const WIDGET_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .fillo-bubble {
      width: 52px; height: 52px; border-radius: 50%;
      background: #111827; box-shadow: 0 4px 16px rgba(0,0,0,0.25);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; transition: transform 0.15s ease;
    }
    .fillo-bubble:hover { transform: scale(1.06); }
    .fillo-bubble img { width: 28px; height: 28px; border-radius: 6px; }
    .fillo-panel {
      position: absolute; bottom: 64px; right: 0;
      width: 260px; background: #fff; border-radius: 12px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.2); overflow: hidden;
      font-size: 13px; color: #111827;
    }
    .fillo-panel.hidden { display: none; }
    .fillo-panel-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px; font-weight: 600; border-bottom: 1px solid #f0f0f0;
    }
    .fillo-close { background: none; border: none; font-size: 18px; line-height: 1; cursor: pointer; color: #9ca3af; }
    .fillo-close:hover { color: #111827; }
    .fillo-panel-body { padding: 14px; }
    .fillo-label { display: block; margin-bottom: 6px; color: #6b7280; font-size: 12px; }
    .fillo-select {
      width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid #e5e7eb;
      margin-bottom: 10px; font-size: 13px;
    }
    .fillo-fill-btn {
      width: 100%; padding: 9px 10px; border-radius: 8px; border: none;
      background: #111827; color: #fff; font-weight: 600; cursor: pointer; font-size: 13px;
    }
    .fillo-fill-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .fillo-fill-btn:not(:disabled):hover { background: #000; }
    .fillo-status { margin-top: 10px; font-size: 12px; }
    .fillo-status.success { color: #059669; }
    .fillo-status.error { color: #dc2626; }
    .fillo-error { color: #dc2626; font-size: 12px; }
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
