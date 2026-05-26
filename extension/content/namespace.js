(function(){
  if (!window.__Fillo) {
    window.__Fillo = {
      state: {
        currentObserver: null,
        isProcessing: false,
        isInitialized: false
      },
      config: {},
      utils: {},
      domainDetector: {},
      mapping: {},
      ai: {},
      planner: {},
      engine: {},
      messaging: {}
    };
  }
})();