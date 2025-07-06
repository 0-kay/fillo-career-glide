// Fillo Auto-Fill Extension - Simple Authentication Flow
// Just check Chrome storage for FILLO_AUTH_TOKEN and use it

const SUPABASE_URL = "https://yuojrygcrcpajiglbekd.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1b2pyeWdjcmNwYWppZ2xiZWtkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEyMzAzMjksImV4cCI6MjA2NjgwNjMyOX0.9dYnQRjtSocxmb9gCw0fOf4GfPk2mUQNcrkOqwu8Rck";
class FilloPopup {
  constructor() {
    this.authToken = null;
    this.profiles = [];
    this.selectedProfileId = null;
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
      // AI Status elements
      backToMain: document.getElementById("back-to-main"),
      aiStatus: document.getElementById("ai-status"),
    };
  }

  attachListeners() {
    this.elements.profileSelect.addEventListener("change", (e) => {
      this.handleProfileSelection(e.target.value);
    });

    this.elements.fillBtn.addEventListener("click", () => {
      console.log("🔄 Filling form...");
      this.fillForm();
    });

    this.elements.detectBtn.addEventListener("click", () => {
      this.detectFields();
    });

    this.elements.signinBtn.addEventListener("click", () => {
      this.openWebApp();
    });

    this.elements.refreshBtn.addEventListener("click", () => {
      this.checkForToken();
    });

    this.elements.footerRefreshBtn.addEventListener("click", () => {
      this.checkForToken();
    });

    this.elements.helpBtn.addEventListener("click", () => {
      this.showHelp();
    });

    // AI Configuration listeners
    this.elements.aiSettingsBtn.addEventListener("click", () => {
      this.showAIConfig();
    });

    this.elements.backToMain.addEventListener("click", () => {
      this.showMain();
    });


  }

  async checkForToken() {
    console.log("🔍 Checking for FILLO_AUTH_TOKEN in Chrome storage...");

    try {
      const result = await chrome.storage.local.get(["FILLO_AUTH_TOKEN"]);
      if (result.FILLO_AUTH_TOKEN) {
        console.log("✅ Found auth token");
        this.authToken = result.FILLO_AUTH_TOKEN;
        await this.loadProfiles();
      } else {
        console.log("❌ No auth token found");
        this.showAuth("Please sign in to access your resume profiles");
      }
    } catch (error) {
      console.log("❌ Error checking for token:", error);
      this.showAuth("Error checking authentication. Please try again.");
    }
  }

  async loadProfiles() {
    if (!this.authToken) {
      this.showAuth("No authentication token available");
      return;
    }

    try {
      console.log("📡 Loading profiles from Supabase...");
      this.showStatus("Loading profiles...", "info");

      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/application_profiles?select=*`,
        {
          headers: {
            Authorization: `Bearer ${this.authToken}`,
            apikey: SUPABASE_ANON_KEY,
            "Content-Type": "application/json",
          },
        }
      );

      console.log("📡 API response status:", response.status);

      if (!response.ok) {
        console.log(await response.json());
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const profiles = await response.json();
      console.log("✅ Loaded profiles:", profiles.length);

      if (profiles.length === 0) {
        this.showAuth(
          "No profiles found. Please create a profile in your Fillo account first."
        );
        return;
      }

      this.profiles = profiles;
      this.populateProfiles();
      this.showMain();
      this.hideStatus();
    } catch (error) {
      console.log("❌ Failed to load profiles:", error);
      this.showAuth("Failed to load profiles. Please sign in again.");
    }
  }

  populateProfiles() {
    this.elements.profileSelect.innerHTML =
      '<option value="">Select a profile...</option>';

    this.profiles.forEach((profile) => {
      const option = document.createElement("option");
      option.value = profile.id;

      // Create profile name from available data
      let profileName = profile.full_name;
      if (profile.name) {
        profileName = profile.name;
      } else if (profile.personal_details) {
        const first = profile.personal_details.first_name || "";
        const last = profile.personal_details.last_name || "";
        if (first || last) {
          profileName = `${first} ${last}`.trim();
        }
      }

      option.textContent = profileName;
      this.elements.profileSelect.appendChild(option);
    });
  }

  handleProfileSelection(profileId) {
    this.selectedProfileId = profileId;

    if (profileId) {
      const profile = this.profiles.find((p) => p.id === profileId);
      if (profile) {
        this.updateProfilePreview(profile);
        this.elements.fillBtn.disabled = false;
      }
    } else {
      this.clearProfilePreview();
      this.elements.fillBtn.disabled = true;
    }
  }

  updateProfilePreview(profile) {
    const personalDetails = profile.personal_details || {};
    console.log("details", profile);

    // Profile name
    let profileName = "Unknown Name";
    if (profile.name) {
      profileName = profile.name;
    } else {
      const fullname = personalDetails.fullName || "";
      // const last = personalDetails.last_name || '';
      profileName = fullname;
    }

    // Email
    const email =
      profile.email ||
      personalDetails.email ||
      personalDetails.contact_email ||
      "No email provided";

    // Completeness calculation
    const fields = [
      personalDetails.first_name,
      personalDetails.last_name,
      personalDetails.email,
      personalDetails.phone,
      personalDetails.address,
    ];
    const filledFields = fields.filter((f) => f && f.trim()).length;
    const completeness = Math.round((filledFields / fields.length) * 100);

    this.elements.previewName.textContent = profileName;
    this.elements.previewEmail.textContent = email;
    this.elements.previewCompleteness.textContent = `${completeness}% complete`;
    this.elements.profilePreview.classList.remove("hidden");
  }

  clearProfilePreview() {
    this.elements.profilePreview.classList.add("hidden");
  }

  async fillForm() {
    console.log("🔄 Filling form... function called");
    if (!this.selectedProfileId) {
      this.showStatus("Please select a profile first", "error");
      return;
    }

    try {
      this.showStatus("Filling form...", "info");
      console.log("🔄 Filling form... function called -trying now");
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      const profile = this.profiles.find(
        (p) => p.id === this.selectedProfileId
      );

      // Check if this is a supported site
      const url = new URL(tab.url);
      console.log(`🌐 Attempting to fill form on: ${url.hostname}`);

      // Try to communicate with content script
      let response = null;
      
      try {
        // First attempt: content script should be auto-injected
        console.log("🔄 First attempt: Sending fillForm message to content script...");
        console.log("📋 Profile data:", profile);
        
        response = await chrome.tabs.sendMessage(tab.id, {
          action: "fillForm",
          profileData: profile,
          useAI: true,
        });
        
        console.log("✅ Content script response (first attempt):", response);
      } catch (messageError) {
        // Content script not available - inject manually (this is normal for some  pages)
        try {
          console.log("🔄 Initializing form filler for this page...");

          
          console.log("❌ Content script not available, injecting manually:", messageError.message);
          
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content.js"],
          });

          console.log("✅ Content script injected, waiting for initialization...");
          
          // Wait for script to initialize
          await new Promise(resolve => setTimeout(resolve, 1000));

          // Try communication again
          console.log("🔄 Retry: Sending fillForm message to content script...");
          response = await chrome.tabs.sendMessage(tab.id, {
            action: "fillForm",
            profileData: profile,
            useAI: true,
          });
          
          console.log("✅ Content script response (after injection):", response);
        } catch (injectionError) {
          console.log("❌ Injection failed:", injectionError.message);
          throw new Error("Cannot access this page - try a different website");
        }
      }

      // Handle response
      if (response?.success) {
        console.log("🔄 Filled form... function called -success");
        this.showStatus(`✅ Filled ${response.filled || 0} fields!`, "success");
      } else {
        this.showStatus(`❌ ${response?.error || 'No fillable fields found'}`, "error");
      }
    } catch (error) {
      console.log("❌ Fill form error:", error);
      
      // Better error handling for different scenarios
      if (error.message.includes("Cannot access")) {
        this.showStatus("❌ Cannot access this page. Try on a different website.", "error");
      } else if (error.message.includes("chrome://") || error.message.includes("chrome-extension://")) {
        this.showStatus("❌ Extension cannot work on browser internal pages.", "error");
      } else {
        this.showStatus("❌ Fill failed. Please refresh the page and try again.", "error");
      }
    }
  }

  async detectFields() {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const formFields = document.querySelectorAll(
            "input, textarea, select"
          );
          return {
            totalFields: formFields.length,
            url: window.location.href,
          };
        },
      });

      const result = results[0]?.result;
      if (result) {
        this.showStatus(
          `Found ${result.totalFields} form fields on this page`,
          "success"
        );
      }
    } catch (error) {
      console.log("❌ Field detection failed:", error);
      this.showStatus("Field detection failed: " + error.message, "error");
    }
  }

  async openWebApp() {
    console.log("🌐 Opening Fillo web app...");
    await chrome.tabs.create({ url: "http://localhost:8080" });
    this.showStatus(
      "Please sign in to your account, then click refresh.",
      "info"
    );
  }



  showHelp() {
    chrome.tabs.create({ url: chrome.runtime.getURL("test-ai-form.html") });
  }

  showAuth(message = "Please sign in to access your resume profiles") {
    this.elements.authSection.classList.remove("hidden");
    this.elements.mainSection.classList.add("hidden");

    const authMessage = document.getElementById("auth-message");
    if (authMessage) {
      authMessage.textContent = message;
    }
  }

  showMain() {
    this.elements.authSection.classList.add("hidden");
    this.elements.mainSection.classList.remove("hidden");
  }

  showStatus(message, type = "info") {
    this.elements.status.textContent = message;
    this.elements.status.className = `status ${type}`;
    this.elements.status.classList.remove("hidden");

    if (type === "success" || type === "error") {
      setTimeout(() => this.hideStatus(), 3000);
    }
  }

  hideStatus() {
    this.elements.status.classList.add("hidden");
  }

  // AI Status Methods
  showAIConfig() {
    this.elements.authSection.classList.add("hidden");
    this.elements.mainSection.classList.add("hidden");
    this.elements.aiConfigSection.classList.remove("hidden");
  }

  showAIStatus(message, type = "info") {
    this.elements.aiStatus.textContent = message;
    this.elements.aiStatus.className = `status ${type}`;
    this.elements.aiStatus.classList.remove("hidden");
  }

  hideAIStatus() {
    this.elements.aiStatus.textContent = "";
    this.elements.aiStatus.className = "status hidden";
  }
}



// Initialize popup when DOM is ready
function initializePopup() {
  console.log("📱 Initializing Fillo popup...");
  const popup = new FilloPopup();
  popup.initialize().catch((error) => {
    console.error("❌ Popup initialization failed:", error);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializePopup);
} else {
  initializePopup();
}
