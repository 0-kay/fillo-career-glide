(function(ns){
  const utils = ns.utils;

  utils.fetchWithTimeout = async function(url, options = {}, timeout = 10000){
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      return res;
    } catch (e) {
      clearTimeout(id);
      if (e?.name === 'AbortError') throw new Error(`Request timed out after ${timeout}ms`);
      throw e;
    }
  };

  utils.getValue = function(obj, keys){
    let cur = obj; for (const k of keys){ if (cur == null) return undefined; cur = cur[k]; } return cur;
  };

  utils.isElementVisible = function(el){
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
  };

  utils.getFieldLabel = function(element){
    if (element.id){ const label = document.querySelector(`label[for="${element.id}"]`); if (label?.textContent) return label.textContent.trim(); }
    const parentLabel = element.closest('label'); if (parentLabel?.textContent) return parentLabel.textContent.replace(element.value || '', '').trim();
    const prev = element.previousElementSibling; if (prev?.tagName === 'LABEL') return prev.textContent?.trim() || '';
    return '';
  };

  // Relay logs both to the page console and to the extension runtime (popup/background) if open
  utils.relayLog = function(level = 'log', ...args){
    try {
      // Always log locally with a prefix
      const method = console[level] || console.log;
      method.apply(console, ['[Fillo]', ...args]);
    } catch(_){}
    try {
      // Best-effort send to extension runtime; popup/background can print it
      chrome?.runtime?.sendMessage?.({ action: 'relayLog', level, args: args.map(a => {
        try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); }
      }) });
    } catch(_){}
  };

  utils.showNotification = function(message, type='info'){
    try{
      const n = document.createElement('div');
      n.style.cssText = `position:fixed;top:20px;right:20px;background:${type==='success'?'#10b981':type==='error'?'#ef4444':'#3b82f6'};color:#fff;padding:12px 20px;border-radius:8px;z-index:10000;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.2);max-width:300px;word-wrap:break-word;`;
      n.textContent = message; document.body.appendChild(n);
      setTimeout(()=> n.parentNode && n.parentNode.removeChild(n), 4000);
    }catch(e){ console.error('Failed to show notification:', e); }
  };
})(window.__Fillo);