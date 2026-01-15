// Fillo Auto-Fill Extension - Background Script
// Simple background script with minimal functionality

console.log("🚀 Fillo Auto-Fill: Background script started");

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log("✅ Fillo Auto-Fill extension installed");
});

// Keep service worker alive
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("📨 Background received message:", request);

  if (request.action === "SYNC_AUTH_TOKEN") {
    console.log("🔑 Background: Syncing auth token");
    chrome.storage.local.set({ FILLO_AUTH_TOKEN: request.token }, () => {
      sendResponse({ success: true, message: "token synced" });
    });
    return true;
  }

  if (request.action === "SAVE_MISSED_FIELDS") {
    console.log("📝 Background: Saving missed fields for analysis", request.missedFields.length);

    const SUPABASE_URL = "https://yuojrygcrcpajiglbekd.supabase.co";

    chrome.storage.local.get(["FILLO_AUTH_TOKEN"], async (result) => {
      const token = result.FILLO_AUTH_TOKEN;
      if (!token) {
        console.warn("⚠️ No auth token available for missed fields analysis");
        sendResponse({ success: false, error: "no_token" });
        return;
      }

      try {
        const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-analyze-missed-fields`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            missedFields: request.missedFields,
            profileId: request.profileId,
            profileData: request.profileData,
            pageUrl: request.pageUrl
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP error ${response.status}`);
        }

        const data = await response.json();
        console.log("✅ Background: AI analysis complete", data);
        sendResponse({ success: true, suggestion: data.suggestion });
      } catch (err) {
        console.error("❌ Background: AI analysis failed", err);
        sendResponse({ success: false, error: err.message });
      }
    });
    return true; // Keep message channel open for async fetch
  }

  // Simple echo response for any messages
  sendResponse({ status: "received" });
  return true;
});

chrome.runtime.onMessageExternal.addListener(
  (request, sender, sendResponse) => {
    // Also allow external sync if origin matches
    if (sender.origin === "http://localhost:8080" || sender.origin?.includes("fillo")) {
      console.log("Received external message:", request);
      if (request.accessToken) {
        chrome.storage.local.set({ FILLO_AUTH_TOKEN: request.accessToken });
        sendResponse({ success: true, result: "token saved" });
      }
    }
    return true;
  }
);

console.log("✅ Fillo Auto-Fill: Background script ready");

// getting all the inputs from web page during initial page load
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;

  (async () => {
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          return {
            title: document.title,
            inputs: Array.from(
              document.querySelectorAll("input, textarea, select"),
              (el) => el.id || el.name || "unnamed"
            ),
          };
        },
      });
      console.log("background got", result);

          const response = await fetch(
            chrome.runtime.getURL("match.json")
          );

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const config = await response.json();
          mapping = flattenMapping(config);

          if (mapping.length === 0) {
            throw new Error("Mapping configuration is empty");
          }

      mapping.forEach(field => {

          })
    } catch (e) {
      console.warn("could not inject", e);
    }
  })();
});