(function(ns){
  function initialize(){
    if (ns.state.isInitialized) return;
    ns.state.isInitialized = true;
    console.log('✅ Fillo Advanced Form Filler ready');
    window.addEventListener('beforeunload', () => { if (ns.state.currentObserver) ns.state.currentObserver.disconnect(); });
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    (async () => {
      try{
        if (!ns.state.isInitialized) initialize();
        switch (request.action){
          case 'ping':
            // Simple readiness check
            sendResponse({ success: true, ready: true });
            break;
          case 'fillForm':
            console.log('📩 Received fillForm request:', request);
            try {
              const result = await Promise.race([
                ns.engine.handleFillForm(request.profileData, request.useAI, request.pastMisses),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Engine timeout (300s)')), 300000))
              ]);
              console.log('✅ FillForm complete:', result);
              sendResponse({ success: true, ...result });
            } catch (err) {
              console.error('❌ FillForm error:', err);
              sendResponse({ success: false, error: err.message });
            }
            return true; // keep port open
          case 'detectFields':
            // Optional: implement detect if needed
            sendResponse({ success:true, message:'Fields detected (not implemented in split version)' });
            break;
          case 'stopObservation':
            if (ns.state.currentObserver){ ns.state.currentObserver.disconnect(); ns.state.currentObserver = null; }
            sendResponse({ success:true });
            break;
          case 'reloadAIConfig':
            // Static config for now; placeholder for future dynamic reloads
            sendResponse({ success:true, message:'AI configuration reloaded' });
            break;
          default:
            sendResponse({ success:false, error:'Unknown action' });
        }
      } catch (e){
        console.error('Content script error:', e);
        sendResponse({ success:false, error: e.message });
      }
    })();
    return true; // keep message channel open
  });

  initialize();
})(window.__Fillo);