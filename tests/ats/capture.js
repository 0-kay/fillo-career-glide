// Saves the application form on the current page as an ATS harness fixture.
//
// Paste into the DevTools console on an application page BEFORE filling anything in, or run it as
// a snippet. It downloads <host>.html; put it in tests/ats/fixtures/.
//
// - Keeps open shadow roots (SmartRecruiters, Workday web components) as declarative shadow DOM,
//   which the harness restores with setHTMLUnsafe.
// - Removes scripts, iframes, media and all stylesheets (component styles repeat in every shadow root
//   and would make a fixture ~1 MB). Visibility is what the engine depends on, so elements hidden on
//   the live page are saved with an inline display:none instead.
// - Trims very long custom lists (e.g. a 245-country phone-code dropdown built from web components)
//   to the first few items plus the ones the test profile needs (United States).
// - Clears every typed or selected value, so no personal data is saved even if fields were filled.
(() => {
  const collectRoots = (root, out = []) => {
    root.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) { out.push(el.shadowRoot); collectRoots(el.shadowRoot, out); }
    });
    return out;
  };

  const sanitize = (root) => {
    root.querySelectorAll('script, iframe, noscript, link, style, img, video, audio, source, svg, object, embed')
      .forEach((n) => n.remove());
    root.querySelectorAll('[data-fillo-hidden]').forEach((el) => {
      el.removeAttribute('data-fillo-hidden');
      el.setAttribute('style', 'display:none');
    });
    const keep = /united states|\(\+1\)/i;
    root.querySelectorAll('*').forEach((parent) => {
      const byTag = {};
      [...parent.children].forEach((c) => (byTag[c.tagName] ??= []).push(c));
      Object.entries(byTag).forEach(([tag, kids]) => {
        if (tag === 'OPTION' || kids.length <= 30) return;
        kids.slice(5).forEach((k) => {
          const text = k.textContent + ' ' + [k, ...k.querySelectorAll('*')].map((e) => e.shadowRoot?.textContent || '').join(' ');
          if (!keep.test(text)) k.remove();
        });
      });
    });
    root.querySelectorAll('input').forEach((i) => {
      const t = (i.getAttribute('type') || 'text').toLowerCase();
      // Radio/checkbox values are option ids, not user data; everything else is typed text.
      if (t !== 'radio' && t !== 'checkbox' && t !== 'submit' && t !== 'button') i.removeAttribute('value');
      i.removeAttribute('checked');
    });
    root.querySelectorAll('option').forEach((o) => o.removeAttribute('selected'));
    root.querySelectorAll('textarea').forEach((t) => { t.textContent = ''; });
    root.querySelectorAll('[aria-pressed="true"]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    root.querySelectorAll('[contenteditable]').forEach((c) => { c.textContent = ''; });
  };

  const liveRoots = [document, ...collectRoots(document)];
  const marked = [];
  liveRoots.forEach((r) => r.querySelectorAll('*').forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') { el.setAttribute('data-fillo-hidden', ''); marked.push(el); }
  }));
  const html = document.body.getHTML({ serializableShadowRoots: true, shadowRoots: collectRoots(document) });
  marked.forEach((el) => el.removeAttribute('data-fillo-hidden'));

  // Re-parse (declarative shadow roots attach), sanitize light and shadow trees, serialize again.
  const doc = Document.parseHTMLUnsafe(`<!doctype html><body>${html}</body>`);
  const roots = [doc, ...collectRoots(doc)];
  roots.forEach(sanitize);
  // Keep only shadow roots that hold a control or text of their own; pure layout wrappers
  // (typography, icons) render their light children the same without one.
  // A root is kept if it, or a shadow root nested inside it, does (dropping a root drops its subtree).
  const keepsSomething = (r) =>
    !!(r.querySelector('input, select, textarea, button, label, [role]') || r.textContent.trim() ||
      [...r.querySelectorAll('*')].some((el) => el.shadowRoot && keepsSomething(el.shadowRoot)));
  const meaningful = collectRoots(doc).filter(keepsSomething);
  roots.forEach((r) => r.querySelectorAll('[src^="M "]').forEach((el) => el.removeAttribute('src')));
  const clean = doc.body.getHTML({ shadowRoots: meaningful }).replace(/>\s+</g, '> <');

  const name = `${location.hostname.replace(/^www\./, '').split('.')[0] || 'fixture'}.html`;
  const header = `<!-- captured from ${location.origin}${location.pathname} on ${new Date().toISOString().slice(0, 10)} by tests/ats/capture.js -->\n`;
  const blob = new Blob([header + clean], { type: 'text/html' });
  // Automation sets window.__filloCaptureNoDownload and reads the returned html instead.
  if (!window.__filloCaptureNoDownload) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
  }
  console.log(`[Fillo capture] saved ${name} (${Math.round(blob.size / 1024)} KB, ${roots.length - 1} shadow roots)`);
  return { name, bytes: blob.size, shadowRoots: roots.length - 1, html: header + clean };
})();
