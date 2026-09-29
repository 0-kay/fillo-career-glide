// Fillo - ATS account screens (Workday, iCIMS).
//
// Every Workday company and every iCIMS portal runs its own candidate accounts, so applying to
// 20 employers means 20 sign-ups. This script recognises the account screens and, on request,
// fills them: the email from the profile and, for a new account, a password the background
// worker generated (extension/lib/password.js).
//
// Fyllo fills; the applicant clicks. It never ticks a terms box, never clicks Create Account /
// Sign In / social sign-in buttons, and never touches CAPTCHAs: account creation stays the
// applicant's own action, and the site's own markup (autocomplete="new-password") lets any
// browser password manager save the password.
//
// Runs in every frame (iCIMS renders its login inside an iframe) and reports the screen to the
// background script, which relays it to the floating widget in the top frame.
(function (ns) {
  if (!ns || ns.atsAuth) return;
  const auth = (ns.atsAuth = {});

  // Only these hosts run candidate-account screens; everywhere else this script stays inert.
  auth.HOSTS = /(^|\.)(myworkdayjobs|myworkdaysite|myworkday)\.com$|\.icims\.com$/i;
  auth.hostname = () => location.hostname.toLowerCase(); // tests override this
  const active = auth.HOSTS.test(auth.hostname());

  const q = (sel, root = document) => root.querySelector(sel);
  const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const visible = (el) => !!el && ns.utils.isElementVisible(el) && !el.disabled;
  const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

  // ---------- Tenant ----------

  /** Workday accounts belong to the company tenant (host); iCIMS accounts to the portal (host). */
  auth.tenantFor = function () {
    const host = auth.hostname();
    const first = host.split('.')[0].replace(/^careers-/, '').replace(/-/g, ' ');
    return {
      key: host,
      name: first.replace(/\b\w/g, (c) => c.toUpperCase()),
    };
  };

  // ---------- Detection ----------

  const SSO = [
    { provider: 'google', re: /google/i },
    { provider: 'linkedin', re: /linked\s*in/i },
    { provider: 'microsoft', re: /microsoft|outlook/i },
    { provider: 'apple', re: /apple/i },
    { provider: 'facebook', re: /facebook/i },
    { provider: 'indeed', re: /indeed/i },
  ];

  function ssoButtons(root) {
    return qa('button, a, [role="button"]', root)
      .filter(visible)
      .map((el) => {
        const label = `${el.getAttribute('aria-label') || ''} ${text(el)} ${el.getAttribute('data-automation-id') || ''}`;
        if (!/sign\s*in|log\s*in|continue|apply/i.test(label)) return null;
        const hit = SSO.find((s) => s.re.test(label));
        return hit ? { provider: hit.provider, el } : null;
      })
      .filter(Boolean);
  }

  const VERIFY_RE = /verify your (email|account)|check your (email|inbox)|verification (email|link)|we('ve| have) sent (you )?an? (email|link)|confirm your email/i;

  function detectWorkday() {
    const content = q('[data-automation-id="signInContent"]');
    const page = q('[data-automation-id="applyFlowPage"]') || document.body;
    if (!content) {
      // Workday shows the verification notice outside signInContent on some tenants.
      return VERIFY_RE.test(text(page)) && /myworkday/.test(auth.hostname())
        ? { platform: 'workday', screen: 'verify-email', fields: {} }
        : null;
    }
    const email = q('input[data-automation-id="email"]', content);
    const password = q('input[data-automation-id="password"]', content);
    const confirm = q('input[data-automation-id="verifyPassword"]', content);
    const sso = ssoButtons(content);
    const resetting = q('[data-automation-id*="resetPassword"], [data-automation-id*="changePassword"]', content);
    let screen = null;
    if (visible(confirm)) screen = resetting ? 'reset-password' : 'create-account';
    else if (visible(password)) screen = 'sign-in';
    else if (visible(email) && q('[data-automation-id="resetPasswordSubmitButton"], [data-automation-id="forgotPasswordSubmitButton"]', content)) screen = 'forgot-password';
    else if (q('[data-automation-id="SignInWithEmailButton"]', content) || sso.length) screen = 'chooser';
    else if (VERIFY_RE.test(text(content))) screen = 'verify-email';
    if (!screen) return null;
    return {
      platform: 'workday',
      screen,
      fields: { email, password, confirm },
      submit: q('[data-automation-id="createAccountSubmitButton"], [data-automation-id="signInSubmitButton"], [data-automation-id*="resetPasswordSubmit"], [data-automation-id*="changePasswordSubmit"]', content),
      emailChoice: q('[data-automation-id="SignInWithEmailButton"]', content),
      sso,
      rules: text(q('[data-automation-id="passwordRulesList"]', content)),
    };
  }

  // iCIMS: step 1 asks only for an email (then decides new vs returning); later steps are a
  // password (returning) or password + confirm (new). Detected by structure, not ids, because
  // portals are configured differently.
  function detectIcims() {
    if (!/\.icims\.com$/.test(auth.hostname())) return null;
    const passwords = qa('input[type="password"]').filter(visible);
    const email = qa('input[type="email"], input[name="css_loginName"], input[autocomplete="email"], input[autocomplete="username"]').find(visible) || null;
    const sso = ssoButtons(document);
    let screen = null;
    if (passwords.length >= 2) screen = 'create-account';
    else if (passwords.length === 1) screen = 'sign-in';
    else if (email && q('#enterEmailSubmitButton, input[type="submit"], button[type="submit"]')) screen = 'enter-email';
    else if (VERIFY_RE.test(text(document.body))) screen = 'verify-email';
    if (!screen) return null;
    return {
      platform: 'icims',
      screen,
      fields: { email, password: passwords[0] || null, confirm: passwords[1] || null },
      submit: q('#enterEmailSubmitButton') || qa('button[type="submit"], input[type="submit"]').find(visible) || null,
      sso,
      rules: '',
    };
  }

  auth.detect = function () {
    return detectWorkday() || detectIcims();
  };

  /** The serialisable part of a detection, for messaging. */
  auth.describe = function (d) {
    if (!d) return null;
    const tenant = auth.tenantFor();
    return {
      platform: d.platform,
      screen: d.screen,
      tenant: tenant.key,
      tenantName: tenant.name,
      sso: [...new Set((d.sso || []).map((s) => s.provider))],
      hasEmailField: visible(d.fields.email),
      hasPasswordField: visible(d.fields.password),
      hasConfirmField: visible(d.fields.confirm),
      emailChoice: !!d.emailChoice,
    };
  };

  // ---------- Filling ----------

  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    el.focus();
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
  }

  /** Password managers pair fields by these hints; only add them where the site left them out. */
  function hint(el, token) {
    if (el && !el.getAttribute('autocomplete')) el.setAttribute('autocomplete', token);
  }

  /**
   * Fills the current account screen. `password` is only used on create-account / sign-in screens.
   * Returns what was filled; never submits.
   */
  auth.fill = function ({ email, password } = {}) {
    const d = auth.detect();
    if (!d) return { ok: false, reason: 'no_account_screen' };
    const filled = [];
    const { email: emailEl, password: pwEl, confirm: confirmEl } = d.fields;
    const creating = d.screen === 'create-account' || d.screen === 'reset-password';

    if (email && visible(emailEl) && !emailEl.value) {
      hint(emailEl, creating ? 'email' : 'username');
      setValue(emailEl, email);
      filled.push('email');
    }
    if (password && (creating || d.screen === 'sign-in')) {
      if (visible(pwEl)) {
        hint(pwEl, creating ? 'new-password' : 'current-password');
        setValue(pwEl, password);
        filled.push('password');
      }
      if (creating && visible(confirmEl)) {
        hint(confirmEl, 'new-password');
        setValue(confirmEl, password);
        filled.push('confirm');
      }
    }
    return { ok: filled.length > 0, filled, screen: d.screen };
  };

  /** Draws attention to a control the applicant should click (never clicks it). */
  auth.highlight = function (target) {
    const d = auth.detect();
    if (!d) return false;
    const el = target === 'submit' ? d.submit
      : target === 'email-choice' ? d.emailChoice
      : (d.sso || []).find((s) => `sso:${s.provider}` === target)?.el;
    if (!el) return false;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const prev = el.style.outline;
    el.style.outline = '3px solid #6366f1';
    el.style.outlineOffset = '2px';
    setTimeout(() => { el.style.outline = prev; }, 4000);
    return true;
  };

  // ---------- Reporting ----------

  let lastSent = 'null';
  function report() {
    let state = null;
    try { state = auth.describe(auth.detect()); } catch (_) { /* never break the page */ }
    const sig = JSON.stringify(state);
    if (sig === lastSent) return;
    lastSent = sig;
    try { chrome.runtime.sendMessage({ action: 'FILLO_AUTH_SCREEN', state }); } catch (_) { /* extension reloaded */ }
  }

  if (!active) return;

  // The applicant clicked the site's own Create Account / Sign In: record the account (no secret).
  document.addEventListener('click', (e) => {
    const d = auth.detect();
    if (!d?.submit || !e.composedPath().includes(d.submit)) return;
    const s = auth.describe(d);
    try {
      chrome.runtime.sendMessage({
        action: 'FILLO_AUTH_SUBMITTED',
        screen: s.screen,
        platform: s.platform,
        tenant: s.tenant,
        email: d.fields.email?.value || null,
      });
    } catch (_) { /* extension reloaded */ }
  }, true);

  chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
    if (req?.action === 'FILLO_AUTH_FILL') { sendResponse(auth.fill(req)); return; }
    if (req?.action === 'FILLO_AUTH_HIGHLIGHT') { sendResponse({ ok: auth.highlight(req.target) }); return; }
  });

  // Workday and iCIMS are single-page apps: re-check after DOM changes, debounced.
  let timer = null;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(report, 400); };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'aria-hidden'] });
  schedule();
})(window.__Fillo);
