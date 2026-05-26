(function(ns){
  const detectorNS = ns.domainDetector = {};

  // Cache for detected platform
  let cachedPlatform = null;
  let cachedHostname = null;

  /**
   * Match a hostname against a domain pattern with wildcard support
   * @param {string} hostname - The hostname to match (e.g., "company.myworkdayjobs.com")
   * @param {string} pattern - The pattern to match against (e.g., "*.myworkdayjobs.com")
   * @returns {boolean} - True if the hostname matches the pattern
   */
  detectorNS.matchDomainPattern = function(hostname, pattern) {
    if (!hostname || !pattern) return false;

    // Exact match
    if (pattern === hostname) return true;

    // Wildcard match (*.example.com)
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2); // Remove "*."
      return hostname.endsWith(suffix) || hostname === suffix;
    }

    return false;
  };

  /**
   * Get all known domain patterns from the Supabase match table.
   * @returns {Object} - Object mapping domain patterns to platform info
   */
  detectorNS.getDomainPatterns = async function() {
    try {
      const loaded = await ns.utils.loadMatchTableConfig({ mode: 'raw' });
      if (!loaded) return {};

      const { row, parsed } = loaded;
      if (!parsed) return {};

      if (parsed.domains) {
        return parsed.domains;
      }

      const domains = {};
      const patterns = [
        row?.domain_pattern,
        row?.domain,
        row?.hostname_pattern,
        row?.pattern,
        parsed.domain_pattern,
        parsed.domain,
        parsed.hostname_pattern,
        parsed.pattern,
      ].filter(Boolean);

      for (const pattern of patterns) {
        domains[pattern] = parsed;
      }

      return domains;
    } catch (e) {
      console.warn('[Fillo] Error loading domain patterns from match table:', e);
      return {};
    }
  };

  /**
   * Detect the platform based on current hostname
   * @returns {Promise<string|null>} - Platform identifier or null if unknown
   */
  detectorNS.detectPlatform = async function() {
    const hostname = window.location.hostname;

    // Return cached result if hostname hasn't changed
    if (cachedHostname === hostname && cachedPlatform !== null) {
      return cachedPlatform;
    }

    cachedHostname = hostname;

    try {
      const domainPatterns = await detectorNS.getDomainPatterns();

      // Check for exact matches first
      for (const [pattern, config] of Object.entries(domainPatterns)) {
        if (pattern === hostname) {
          cachedPlatform = config.platform;
          console.log(`[Fillo] Detected platform: ${cachedPlatform} (exact match: ${pattern})`);
          return cachedPlatform;
        }
      }

      // Check for wildcard matches
      for (const [pattern, config] of Object.entries(domainPatterns)) {
        if (detectorNS.matchDomainPattern(hostname, pattern)) {
          cachedPlatform = config.platform;
          console.log(`[Fillo] Detected platform: ${cachedPlatform} (pattern match: ${pattern})`);
          return cachedPlatform;
        }
      }

      // No match found
      cachedPlatform = null;
      console.log(`[Fillo] No platform detected for domain: ${hostname}`);
      return null;
    } catch (e) {
      console.error('[Fillo] Error detecting platform:', e);
      cachedPlatform = null;
      return null;
    }
  };

  /**
   * Clear the platform detection cache (useful for testing)
   */
  detectorNS.clearCache = function() {
    cachedPlatform = null;
    cachedHostname = null;
  };

})(window.__Fillo);
