// Fillo Auto-Fill Extension - Popup Script
// Handles auth, profile selection, and robust content injection

const SUPABASE_URL = "https://yuojrygcrcpajiglbekd.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1b2pyeWdjcmNwYWppZ2xiZWtkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEyMzAzMjksImV4cCI6MjA2NjgwNjMyOX0.9dYnQRjtSocxmb9gCw0fOf4GfPk2mUQNcrkOqwu8Rck";

// ---------- Helpers ----------
function isForbiddenUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    return url.protocol === "chrome:" || url.protocol === "chrome-extension:";
  } catch {
    return false;
  }
}

async function ensureContentReady(tabId) {
  // Ping once
  try {
    const ping = await chrome.tabs.sendMessage(tabId, { action: "ping" });
    console.log("✅ Content script responded:", ping);
    return true;
  } catch (_) {
    console.log("ℹ️ No ping response — injecting modules...");
  }

  // Inject all content scripts across all frames
  const files = [
    "content/namespace.js",
    "content/config.js",
    "content/utils.js",
    "content/mapping.js",
    "content/ai.js",
    "content/planner.js",
    "content/engine.js",
    "content/messaging.js",
  ];

  for (const file of files) {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [file],
    });
    console.log("✅ Injected:", file);
  }

  await new Promise((r) => setTimeout(r, 800));

  const ping2 = await chrome.tabs.sendMessage(tabId, { action: "ping" });
  console.log("✅ Content script initialized:", ping2);
  return true;
}

// ---------- Popup Core ----------
class FilloPopup {
  constructor() {
    this.authToken = null;
    this.profiles = [];
    this.selectedProfileId = null;
    this.pastMisses = [];
    this.elements = {};
  }

  async initialize() {
    console.log("🚀 Fillo Auto-Fill: Initializing popup...");
    this.initElements();
    this.attachListeners();
    await this.checkForToken();
  }

  initElements() {
    this.elements = {
      authSection: document.getElementById("auth-section"),
      mainSection: document.getElementById("main-section"),
      aiConfigSection: document.getElementById("ai-config-section"),
      profileSelect: document.getElementById("profile-select"),
      profilePreview: document.getElementById("profile-preview"),
      fillBtn: document.getElementById("fill-btn"),
      detectBtn: document.getElementById("detect-btn"),
      signinBtn: document.getElementById("signin-btn"),
      refreshBtn: document.getElementById("refresh-btn"),
      footerRefreshBtn: document.getElementById("footer-refresh-btn"),
      helpBtn: document.getElementById("help-btn"),
      aiSettingsBtn: document.getElementById("ai-settings-btn"),
      status: document.getElementById("status"),
      previewName: document.getElementById("preview-name"),
      previewEmail: document.getElementById("preview-email"),
      previewCompleteness: document.getElementById("preview-completeness"),
      backToMain: document.getElementById("back-to-main"),
      aiStatus: document.getElementById("ai-status"),
    };
  }

  attachListeners() {
    this.elements.profileSelect.addEventListener("change", (e) =>
      this.handleProfileSelection(e.target.value)
    );
    this.elements.fillBtn.addEventListener("click", () => this.fillForm());
    this.elements.detectBtn.addEventListener("click", () =>
      this.detectFields()
    );
    this.elements.signinBtn.addEventListener("click", () => this.openWebApp());
    this.elements.refreshBtn.addEventListener("click", () =>
      this.checkForToken()
    );
    this.elements.footerRefreshBtn.addEventListener("click", () =>
      this.checkForToken()
    );
    this.elements.helpBtn.addEventListener("click", () => this.showHelp());
    this.elements.aiSettingsBtn.addEventListener("click", () =>
      this.showAIConfig()
    );
    this.elements.backToMain.addEventListener("click", () => this.showMain());
  }

  // ---------- Authentication ----------
  async checkForToken() {
    console.log("🔍 Checking for FILLO_AUTH_TOKEN...");
    try {
      const result = await chrome.storage.local.get(["FILLO_AUTH_TOKEN"]);
      if (result.FILLO_AUTH_TOKEN) {
        console.log("✅ Found token");
        this.authToken = result.FILLO_AUTH_TOKEN;
        await this.loadProfiles();
      } else {
        console.log("❌ No auth token found");
        this.showAuth("Please sign in to access your resume profiles");
      }
    } catch (error) {
      console.error("❌ Token check error:", error);
      this.showAuth("Error checking authentication. Please try again.");
    }
  }

  async loadProfiles() {
    if (!this.authToken) {
      this.showAuth("No authentication token available");
      return;
    }
    try {
      console.log("📡 Fetching profiles from Supabase...");
      this.showStatus("Loading profiles...", "info");

      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/application_profiles?select=*`,
        {
          headers: {
            Authorization: `Bearer ${this.authToken}`,
            apikey: SUPABASE_ANON_KEY,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("📡 Supabase response status:", res.status);
      const profiles = await res.json();

      console.group("🧠 Supabase Profiles");
      console.log(profiles);
      console.groupEnd();

      if (!res.ok)
        throw new Error(`API Error: ${res.status} ${res.statusText}`);
      if (!Array.isArray(profiles) || profiles.length === 0) {
        this.showAuth(
          "No profiles found. Please create one in your Fillo account."
        );
        return;
      }

      this.profiles = profiles;
      this.populateProfiles();
      this.showMain();
      this.hideStatus();
    } catch (err) {
      console.error("❌ Failed to load profiles:", err);
      this.showAuth("Failed to load profiles. Please sign in again.");
    }
  }

  // ---------- Profiles ----------
  populateProfiles() {
    this.elements.profileSelect.innerHTML =
      '<option value="">Select a profile...</option>';
    this.profiles.forEach((profile) => {
      const opt = document.createElement("option");
      opt.value = profile.id;
      opt.textContent =
        profile.name ||
        profile.full_name ||
        `${profile.personal_details?.first_name || ""} ${
          profile.personal_details?.last_name || ""
        }`.trim() ||
        "Unnamed Profile";
      this.elements.profileSelect.appendChild(opt);
    });
  }

  async handleProfileSelection(profileId) {
    this.selectedProfileId = profileId;
    if (profileId) {
      const profile = this.profiles.find((p) => p.id === profileId);
      if (profile) {
        this.updateProfilePreview(profile);
        this.elements.fillBtn.disabled = false;
        await this.fetchPastMisses(profileId);
      }
    } else {
      this.clearProfilePreview();
      this.elements.fillBtn.disabled = true;
      this.pastMisses = [];
    }
  }

  async fetchPastMisses(profileId) {
    if (!this.authToken) return;
    try {
      console.log(`📡 Fetching past misses for profile ${profileId}...`);
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/missed_fields?profile_id=eq.${profileId}&select=ai_suggestion,page_url,created_at&order=created_at.desc&limit=10`,
        {
          headers: {
            Authorization: `Bearer ${this.authToken}`,
            apikey: SUPABASE_ANON_KEY,
            "Content-Type": "application/json",
          },
        }
      );

      if (res.ok) {
        this.pastMisses = await res.json();
        console.log(`🧠 Loaded ${this.pastMisses.length} past misses for context.`);
      }
    } catch (err) {
      console.warn("⚠️ Failed to fetch past misses:", err);
    }
  }

  updateProfilePreview(profile) {
    const details = profile.personal_details || {};
    const profileName = profile.name || details.fullName || "Unknown Name";
    const email =
      profile.email ||
      details.email ||
      details.contact_email ||
      "No email provided";
    const filledFields = [
      details.first_name,
      details.last_name,
      details.email,
      details.phone,
      details.address,
    ].filter(Boolean).length;
    const completeness = Math.round((filledFields / 5) * 100);
    this.elements.previewName.textContent = profileName;
    this.elements.previewEmail.textContent = email;
    this.elements.previewCompleteness.textContent = `${completeness}% complete`;
    this.elements.profilePreview.classList.remove("hidden");
  }

  clearProfilePreview() {
    this.elements.profilePreview.classList.add("hidden");
  }

  // ---------- Fill Logic ----------
  async fillForm() {
    console.log("🔄 Starting fillForm...");
    if (!this.selectedProfileId)
      return this.showStatus("Please select a profile first", "error");

    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) return this.showStatus("No active tab found", "error");
      if (isForbiddenUrl(tab.url))
        return this.showStatus(
          "❌ Extension cannot run on browser internal pages.",
          "error"
        );

      const profile = this.profiles.find(
        (p) => p.id === this.selectedProfileId
      );
      console.group("📦 Profile Data");
      console.log(JSON.stringify(profile, null, 2));
      console.groupEnd();

      this.showStatus("Filling form...", "info");
      await ensureContentReady(tab.id);

      console.log("🚀 Sending fillForm message...");
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: "fillForm",
        profileData: profile,
        useAI: true,
        pastMisses: this.pastMisses
      });

      console.log("✅ Content script response:", response);
      if (response?.success) {
        this.showStatus(
          `✅ Filled ${response.filled || 0}/${response.attempted || 0} fields${
            typeof response.aiMatches === "number"
              ? ` (${response.aiMatches} via AI)`
              : ""
          }`,
          "success"
        );
      } else {
        this.showStatus(
          `❌ ${response?.error || "No fillable fields found"}`,
          "error"
        );
      }
    } catch (err) {
      console.error("❌ Fill form failed:", err);
      if (err.message.includes("Cannot access"))
        this.showStatus(
          "❌ Cannot access this page. Try a different site.",
          "error"
        );
      else
        this.showStatus(
          "❌ Fill failed. Please refresh the page and retry.",
          "error"
        );
    }
  }

  async detectFields() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => {
          try {
            const formFields = document.querySelectorAll(
              "input, textarea, select"
            );
            return {
              totalFields: formFields.length,
              url: window.location.href,
            };
          } catch (e) {
            return { totalFields: 0, error: e?.message };
          }
        },
      });
      const total = results.reduce(
        (sum, r) => sum + (r.result?.totalFields || 0),
        0
      );
      this.showStatus(
        `Found ${total} form fields across ${results.length} frame(s)`,
        "success"
      );
    } catch (err) {
      console.error("❌ Field detection failed:", err);
      this.showStatus("Field detection failed: " + err.message, "error");
    }
  }

  async openWebApp() {
    console.log("🌐 Opening Fillo web app...");
    await chrome.tabs.create({ url: "http://localhost:8080" });
    this.showStatus("Please sign in, then click refresh.", "info");
  }



  showHelp() {
    chrome.tabs.create({ url: chrome.runtime.getURL("test-ai-form.html") });
  }

  // ---------- UI ----------
  showAuth(msg = "Please sign in to access your profiles") {
    this.elements.authSection.classList.remove("hidden");
    this.elements.mainSection.classList.add("hidden");
    document.getElementById("auth-message").textContent = msg;
  }

  showMain() {
    this.elements.authSection.classList.add("hidden");
    this.elements.mainSection.classList.remove("hidden");
  }

  showStatus(msg, type = "info") {
    this.elements.status.textContent = msg;
    this.elements.status.className = `status ${type}`;
    this.elements.status.classList.remove("hidden");
    if (["success", "error"].includes(type))
      setTimeout(() => this.hideStatus(), 3000);
  }

  hideStatus() {
    this.elements.status.classList.add("hidden");
  }

  showAIConfig() {
    this.elements.authSection.classList.add("hidden");
    this.elements.mainSection.classList.add("hidden");
    this.elements.aiConfigSection.classList.remove("hidden");
  }
}

// ---------- Initialize ----------
function initializePopup() {
  console.log("📱 Initializing popup...");
  // Listen for relayed logs from content scripts
  try {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.action === "relayLog") {
        const level = msg.level || "log";
        const args = Array.isArray(msg.args) ? msg.args : [msg.message || ""];
        try {
          (console[level] || console.log).apply(console, [
            "[Fillo Relay]",
            ...args,
          ]);
        } catch {
          console.log("[Fillo Relay]", ...args);
        }
      }
    });
  } catch (_) {}
  const popup = new FilloPopup();
  popup
    .initialize()
    .catch((err) => console.error("❌ Popup init failed:", err));
}

if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", initializePopup);
else initializePopup();
