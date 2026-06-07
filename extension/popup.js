// Fillo Auto-Fill Extension - Popup Script
// Handles auth, profile selection, and robust content injection

const SUPABASE_URL = "https://yuojrygcrcpajiglbekd.supabase.co";
const SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1b2pyeWdjcmNwYWppZ2xiZWtkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEyMzAzMjksImV4cCI6MjA2NjgwNjMyOX0.9dYnQRjtSocxmb9gCw0fOf4GfPk2mUQNcrkOqwu8Rck";
const MATCH_CONFIG_ENDPOINT = `${SUPABASE_URL}/functions/v1/match-config`;

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
    "content/domain-detector.js",
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
    this.detectedFields = null;
    this.elements = {};
    this.isFilling = false;
    this.fillBtnDefaultText = "";
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
      stopFillBtn: document.getElementById("stop-fill-btn"),
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
      detectedFieldsSection: document.getElementById("detected-fields-section"),
      detectedFieldsToggle: document.getElementById("detected-fields-toggle"),
    };
    this.fillBtnDefaultText = this.elements.fillBtn?.textContent || "Fill Application Form";
    if (this.elements.stopFillBtn) this.elements.stopFillBtn.disabled = true;
  }

  setFillingState(isFilling) {
    this.isFilling = isFilling;
    this.elements.fillBtn.disabled = isFilling || !this.selectedProfileId;
    this.elements.fillBtn.textContent = isFilling ? "Filling..." : this.fillBtnDefaultText;
    this.elements.stopFillBtn.disabled = !isFilling;
  }

  attachListeners() {
    this.elements.profileSelect.addEventListener("change", (e) => this.handleProfileSelection(e.target.value));
    this.elements.fillBtn.addEventListener("click", () => this.fillForm());
    this.elements.stopFillBtn.addEventListener("click", () => this.stopFilling());
    this.elements.detectBtn.addEventListener("click", () => this.detectFields());
    this.elements.signinBtn.addEventListener("click", () => this.openWebApp());
    this.elements.refreshBtn.addEventListener("click", () => this.checkForToken());
    this.elements.footerRefreshBtn.addEventListener("click", () => this.checkForToken());
    this.elements.helpBtn.addEventListener("click", () => this.showHelp());
    this.elements.aiSettingsBtn.addEventListener("click", () => this.showAIConfig());
    this.elements.backToMain.addEventListener("click", () => this.showMain());
    this.elements.detectedFieldsToggle.addEventListener("click", () => this.toggleDetectedFields());
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

      const res = await fetch(`${SUPABASE_URL}/rest/v1/application_profiles?select=*`, {
        headers: {
          Authorization: `Bearer ${this.authToken}`,
          apikey: SUPABASE_ANON_KEY,
          "Content-Type": "application/json",
        },
      });

      console.log("📡 Supabase response status:", res.status);
      const profiles = await res.json();

      console.group("🧠 Supabase Profiles");
      console.log(profiles);
      console.groupEnd();

      if (!res.ok) throw new Error(`API Error: ${res.status} ${res.statusText}`);
      if (!Array.isArray(profiles) || profiles.length === 0) {
        this.showAuth("No profiles found. Please create one in your Fillo account.");
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
    this.elements.profileSelect.innerHTML = '<option value="">Select a profile...</option>';
    this.profiles.forEach((profile) => {
      const opt = document.createElement("option");
      opt.value = profile.id;
      opt.textContent =
          profile.name ||
          profile.full_name ||
          `${profile.personal_details?.first_name || ""} ${profile.personal_details?.last_name || ""}`.trim() ||
          "Unnamed Profile";
      this.elements.profileSelect.appendChild(opt);
    });
  }

  handleProfileSelection(profileId) {
    this.selectedProfileId = profileId;
    if (profileId) {
      const profile = this.profiles.find((p) => p.id === profileId);
      if (profile) {
        this.updateProfilePreview(profile);
        this.elements.fillBtn.disabled = this.isFilling;
      }
    } else {
      this.clearProfilePreview();
      this.elements.fillBtn.disabled = true;
    }
  }

  updateProfilePreview(profile) {
    const details = profile.personal_details || {};
    const profileName = profile.name || details.fullName || "Unknown Name";
    const email = profile.email || details.email || details.contact_email || "No email provided";
    const filledFields = [details.first_name, details.last_name, details.email, details.phone, details.address?.line1].filter(Boolean).length;
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
  async stopFilling() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return this.showStatus("No active tab found", "error");
      if (isForbiddenUrl(tab.url)) return this.showStatus("❌ Extension cannot run on browser internal pages.", "error");

      this.setFillingState(false);
      this.showStatus("Stopping fill...", "info");

      try {
        await chrome.tabs.sendMessage(tab.id, { action: "stopFill" });
      } catch (_) {
        // The all-frames script below is the authoritative stop signal.
      }

      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => {
          const ns = window.__Fillo;
          if (!ns) return { success: false, error: "Content script not ready" };
          ns.state.stopRequested = true;
          ns.state.isProcessing = false;
          window.__filloActiveFillRun = false;
          if (ns.state.currentObserver) {
            ns.state.currentObserver.disconnect();
            ns.state.currentObserver = null;
          }
          return { success: true, stopped: true };
        }
      });

      this.showStatus("Fill stopped. Review the page before continuing.", "success");
    } catch (err) {
      console.error("❌ Stop fill failed:", err);
      this.showStatus("Could not stop filling on this page.", "error");
    }
  }

  async fillForm() {
    console.log("🔄 Starting fillForm...");
    if (this.isFilling) return;
    if (!this.selectedProfileId) return this.showStatus("Please select a profile first", "error");

    try {
      this.setFillingState(true);

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return this.showStatus("No active tab found", "error");
      if (isForbiddenUrl(tab.url))
        return this.showStatus("❌ Extension cannot run on browser internal pages.", "error");

      const profile = this.profiles.find((p) => p.id === this.selectedProfileId);
      console.group("📦 Profile Data");
      console.log(JSON.stringify(profile, null, 2));
      console.groupEnd();

      // If detected fields are available, log the mapping info
      if (this.detectedFields && this.detectedFields.length > 0) {
        const matched = this.detectedFields.filter((f) => f.profileMatch);
        console.log(`📋 Using ${matched.length}/${this.detectedFields.length} detected field mappings to guide fill`);
      }

      this.showStatus("Preparing form data...", "info");
      await ensureContentReady(tab.id);

      // Fetch the Resume File if one is attached to the profile
      let resumeDataUri = null;
      let resumeFileName = null;
      const resumeMeta = profile.resume_metadata || {};
      const metadataFileName =
        resumeMeta.fileName ||
        resumeMeta.file_name ||
        resumeMeta.originalFileName ||
        resumeMeta.original_file_name ||
        null;
      const filePath = profile.resume_metadata?.file_path;

      if (filePath && this.authToken) {
        try {
          this.showStatus("Downloading resume...", "info");
          const res = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/resumes/${filePath}`, {
            headers: {
              apikey: SUPABASE_ANON_KEY,
              Authorization: `Bearer ${this.authToken}`
            }
          });

          if (res.ok) {
            const blob = await res.blob();

            // Keep the original uploaded filename when available.
            // Older profiles may only have storage path, so parse that as a fallback.
            const storageBaseName = String(filePath || "").split('/').pop() || "";
            const parsedStorageName = (() => {
              if (!storageBaseName) return null;
              const clean = storageBaseName.split('?')[0];
              const parts = clean.split('_');
              if (parts.length > 2 && /^\d+$/.test(parts[1])) {
                return parts.slice(2).join('_');
              }
              return clean;
            })();

            resumeFileName = metadataFileName || parsedStorageName || (blob.type === "application/pdf" ? "resume.pdf" : "resume");

            try {
              resumeFileName = decodeURIComponent(resumeFileName);
            } catch (_) {
              // Keep raw name if decoding fails
            }

            resumeDataUri = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
            console.log(`✅ Downloaded resume for injection: ${resumeFileName}`);
          } else {
            console.warn("Failed to download resume:", res.statusText);
          }
        } catch (err) {
          console.warn("Error downloading resume:", err);
        }
      }

      this.showStatus("Filling form...", "info");
      console.log("🚀 Executing manual fillForm across all frames...");
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: async (profileData, useAI, detectedFields, resumeDataUri, resumeFileName) => {
           const ns = window.__Fillo;
           if (ns && ns.engine && ns.engine.handleFillForm) {
               return await ns.engine.handleFillForm(
                 profileData,
                 useAI,
                 { fromObserver: false, detectedFields, resumeDataUri, resumeFileName }
               );
           }
           return { success: false, error: "Content script not ready", count: 0 };
        },
        args: [profile, false, this.detectedFields || null, resumeDataUri, resumeFileName]
      });

      console.log("✅ All frames responded:", results);

      let totalFilled = 0;
      let totalAttempted = 0;
      let totalScreening = 0;
      let anySuccess = false;
      let lastError = "";

      // Aggregate results effectively across all iframes
      for (const res of results) {
        if (res.result && res.result.success) {
          if (res.result.stopped) {
            lastError = "Fill stopped by user";
            continue;
          }
          // If at least one frame succeeds (even if filling 0 fields), consider it a success
          // But if one frame filled >0, it will contribute to totals.
          anySuccess = true;
          totalFilled += res.result.filled || 0;
          totalAttempted += res.result.attempted || 0;
          if (typeof res.result.screeningFilled === "number") {
             totalScreening += res.result.screeningFilled;
          }
        } else if (res.result && res.result.error && res.result.error !== "Content script not ready") {
          lastError = res.result.error;
        }
      }

      if (anySuccess) {
        const msg = totalFilled > 0
            ? `✅ Filled ${totalFilled} fields${totalScreening > 0 ? ` (${totalScreening} screening)` : ""}. Watching for more…`
            : `✅ Form scanned — no new fields to fill`;
        this.showStatus(msg, "success");
      } else if (lastError === "Fill stopped by user") {
        this.showStatus("Fill stopped. Review the page before continuing.", "success");
      } else {
        this.showStatus(`❌ ${lastError || "No fillable fields found"}`, "error");
      }
    } catch (err) {
      console.error("❌ Fill form failed:", err);
      if (err.message.includes("Cannot access"))
        this.showStatus("❌ Cannot access this page. Try a different site.", "error");
      else this.showStatus("❌ Fill failed. Please refresh the page and retry.", "error");
    } finally {
      this.setFillingState(false);
    }
  }

  async detectFields() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return this.showStatus("No active tab found", "error");
      if (isForbiddenUrl(tab.url)) return this.showStatus("❌ Extension cannot run on browser internal pages.", "error");

      // Show scanning state
      this.elements.detectBtn.classList.add("scanning");
      this.elements.detectBtn.textContent = "Scanning...";
      this.showStatus("Scanning page for form fields...", "info");

      // Inject a script that deeply scans all form fields with their labels and context
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: () => {
          try {
            // Query native form elements AND custom dropdown components (Workday, SmartRecruiters, etc.)
            const nativeFields = document.querySelectorAll("input, textarea, select");
            const customDropdowns = document.querySelectorAll(
              'button[aria-haspopup="listbox"], [role="combobox"]:not(input), [role="listbox"], ' +
              '[data-automation-id*="dropdown"], [data-automation-id*="select"], ' +
              'a.dropdown-select, [data-test*="dropdown"], [data-test*="select"]'
            );

            const fields = [];
            const seen = new Set(); // Avoid duplicates

            // Helper: extract label for any element
            function getLabel(el) {
              let labelText = "";

              // For Workday questionnaire buttons (aria-haspopup="listbox"),
              // the aria-label contains the CURRENT ANSWER, not the question.
              // So we check fieldset/legend/richText FIRST for these elements.
              const isWorkdayDropdown = el.matches && el.matches('button[aria-haspopup="listbox"]');

              // Method A: Workday richText in parent formField (highest priority for dropdown buttons)
              if (isWorkdayDropdown || !labelText) {
                const formField = el.closest('[data-automation-id^="formField-"]');
                if (formField) {
                  // Match exactly what the engine does in extractWorkdayQuestions
                  const richText = formField.querySelector('legend div[data-automation-id="richText"] p span')
                    || formField.querySelector('legend div[data-automation-id="richText"] p b')
                    || formField.querySelector('legend div[data-automation-id="richText"] p')
                    || formField.querySelector('legend div[data-automation-id="richText"]');
                  if (richText) labelText = richText.textContent.trim();
                }
              }

              // Method B: fieldset legend (also high priority for dropdown buttons)
              if (!labelText) {
                const fieldset = el.closest("fieldset");
                if (fieldset) {
                  const legend = fieldset.querySelector("legend");
                  if (legend) labelText = legend.textContent.trim();
                }
              }

              // For Workday dropdowns, we already have the question — skip aria-label
              // For other elements, proceed with standard label extraction
              if (!labelText) {
                // Method 1: explicit <label for="...">
                if (el.id) {
                  const labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
                  if (labelEl) labelText = labelEl.textContent.trim();
                }
              }
              if (!labelText) {
                // Method 2: wrapping <label>
                const parentLabel = el.closest("label");
                if (parentLabel) labelText = parentLabel.textContent.trim();
              }
              if (!labelText) {
                // Method 3: aria-label (skip for Workday dropdowns — it contains the answer, not question)
                if (!isWorkdayDropdown) {
                  labelText = el.getAttribute("aria-label") || "";
                }
              }
              if (!labelText) {
                // Method 4: aria-labelledby
                const labelledBy = el.getAttribute("aria-labelledby");
                if (labelledBy) {
                  const refEl = document.getElementById(labelledBy);
                  if (refEl) labelText = refEl.textContent.trim();
                }
              }
              if (!labelText) {
                // Method 5: data-automation-id as humanized label
                const autoId = el.getAttribute("data-automation-id");
                if (autoId) labelText = autoId.replace(/([A-Z])/g, " $1").replace(/[-_]/g, " ").trim();
              }
              if (!labelText) {
                // Method 6: parent formField wrapper label (generic Workday)
                const formField = el.closest('[data-automation-id^="formField-"]');
                if (formField) {
                  const richText = formField.querySelector('label, legend, [data-automation-id="formLabel"]');
                  if (richText) labelText = richText.textContent.trim();
                }
              }

              return labelText.replace(/\*/g, "").replace(/\s+/g, " ").trim();
            }

            // Helper: check if element is reasonably visible
            function isVisible(el) {
              if (el.offsetParent !== null) return true;
              // offsetParent can be null for fixed/sticky or certain CSS — fallback to rect check
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            }

            // Process native form fields (input, textarea, select)
            for (const el of nativeFields) {
              const tag = el.tagName.toLowerCase();
              const type = (el.type || "text").toLowerCase();

              // Skip non-interactive types
              if (["hidden", "submit", "button", "image", "reset"].includes(type)) continue;

              // Visibility: selects and checkboxes/radios can be hidden behind custom wrappers
              // so we use a more lenient check for them
              if (tag === "select") {
                // For selects: always include if they have a name/id (even if visually hidden,
                // the engine can still set their value programmatically)
                if (!el.name && !el.id && !isVisible(el)) continue;
              } else if (type === "checkbox" || type === "radio") {
                // Always include checkboxes/radios
              } else {
                if (!isVisible(el)) continue;
              }

              const uid = `${tag}:${el.name || ""}:${el.id || ""}`;
              if (uid !== "::" && seen.has(uid)) continue;
              if (uid !== "::") seen.add(uid);

              const labelText = getLabel(el);

              // Get select options if applicable
              let options = [];
              if (tag === "select") {
                options = Array.from(el.options)
                  .map((o) => o.textContent.trim())
                  .filter((t) => t && !t.toLowerCase().includes("select") && !t.toLowerCase().includes("choose"))
                  .slice(0, 5);
              }

              // Current value
              const currentValue = tag === "select"
                ? (el.options[el.selectedIndex]?.textContent?.trim() || "")
                : (el.value || "").trim();

              fields.push({
                tag: tag,
                type: tag === "select" ? "select" : type,
                name: el.name || "",
                id: el.id || "",
                placeholder: el.placeholder || "",
                label: labelText.slice(0, 120),
                dataAutomationId: el.getAttribute("data-automation-id") || "",
                dataTestId: el.getAttribute("data-testid") || el.getAttribute("data-test") || "",
                className: (el.className || "").toString().slice(0, 80),
                required: el.required || el.hasAttribute("required"),
                hasValue: !!currentValue,
                currentValue: currentValue.slice(0, 40),
                options: options,
                ariaLabel: el.getAttribute("aria-label") || "",
              });
            }

            // Process custom dropdown/select components (Workday, iCIMS, SmartRecruiters)
            for (const el of customDropdowns) {
              // Skip if we already captured it as a native element
              const uid = `custom:${el.getAttribute("data-automation-id") || ""}:${el.id || ""}:${el.getAttribute("aria-label") || ""}`;
              if (uid === "custom:::" || seen.has(uid)) continue;
              seen.add(uid);

              if (!isVisible(el)) continue;

              const labelText = getLabel(el);
              const currentText = (el.textContent || el.innerText || "").trim().slice(0, 40);

              // Try to find associated native select (some ATS hide the real select behind custom UI)
              const container = el.closest(".form-group, .iCIMS_InfoData, [data-automation-id^='formField-'], td, div");
              let hiddenSelect = container?.querySelector("select");
              let options = [];
              if (hiddenSelect) {
                options = Array.from(hiddenSelect.options)
                  .map((o) => o.textContent.trim())
                  .filter((t) => t && !t.toLowerCase().includes("select") && !t.toLowerCase().includes("choose"))
                  .slice(0, 5);
              }

              fields.push({
                tag: el.tagName.toLowerCase(),
                type: "custom-select",
                name: el.name || el.getAttribute("data-automation-id") || "",
                id: el.id || "",
                placeholder: "",
                label: labelText.slice(0, 120) || currentText.slice(0, 60),
                dataAutomationId: el.getAttribute("data-automation-id") || "",
                dataTestId: el.getAttribute("data-testid") || el.getAttribute("data-test") || "",
                className: (el.className || "").toString().slice(0, 80),
                required: el.hasAttribute("required") || el.getAttribute("aria-required") === "true",
                hasValue: !!currentText && !currentText.toLowerCase().includes("select"),
                currentValue: currentText.slice(0, 40),
                options: options,
                ariaLabel: el.getAttribute("aria-label") || "",
              });
            }

            return { fields, url: window.location.href, title: document.title };
          } catch (e) {
            return { fields: [], error: e?.message };
          }
        },
      });

      // Merge results from all frames
      const allFields = [];
      let pageUrl = "";
      let pageTitle = "";

      for (const r of results) {
        if (r.result?.fields) {
          allFields.push(...r.result.fields);
          if (r.result.url) pageUrl = r.result.url;
          if (r.result.title) pageTitle = r.result.title;
        }
      }

      // Load mappings from the Supabase match table so platform and generic mappings
      // come from the same database config.
      const matchConfig = await this.loadMatchConfigFromSupabase();
      const matchingConfig = this.getGenericMappingFromMatchConfig(matchConfig);
      const platformConfig = this.getPlatformConfigForUrl(matchConfig, pageUrl || tab.url || "");

      // Build a lookup of known field identifiers from the matching config
      const knownVariants = this.buildKnownVariantsMap(matchingConfig);
      const platformVariants = this.buildPlatformFieldLookup(platformConfig);

      // Match each detected field against known variants
      const enrichedFields = allFields.map((field) => {
        const match = this.matchFieldToProfile(field, knownVariants, platformVariants);
        return { ...field, profileMatch: match };
      });

      // Store detected fields for later use by fillers
      this.detectedFields = enrichedFields;

      // Render the panel
      this.renderDetectedFields(enrichedFields);

      // Reset button state
      this.elements.detectBtn.classList.remove("scanning");
      this.elements.detectBtn.textContent = "🔍 Detect Form Fields";

      const matched = enrichedFields.filter((f) => f.profileMatch).length;
      const unmatched = enrichedFields.filter((f) => !f.profileMatch).length;

      this.showStatus(
        `✅ Found ${enrichedFields.length} fields (${matched} matched, ${unmatched} unmatched) across ${results.length} frame(s)`,
        "success"
      );
    } catch (err) {
      console.error("❌ Field detection failed:", err);
      this.elements.detectBtn.classList.remove("scanning");
      this.elements.detectBtn.textContent = "🔍 Detect Form Fields";
      this.showStatus("Field detection failed: " + err.message, "error");
    }
  }

  async loadMatchConfigFromSupabase() {
    const row = await this.fetchMatchTableRow();

    if (!row) {
      console.warn("⚠️ No database match config found; bundled fallback is disabled");
      return { domains: {}, mapping: {} };
    }

    const rows = row ? [row] : [];
    const config = this.buildMatchConfigFromRows(rows);
    if (!this.getGenericMappingFromMatchConfig(config) || Object.keys(this.getGenericMappingFromMatchConfig(config)).length === 0) {
      console.warn("⚠️ Database match config has no generic mapping");
    }
    return config;
  }

  async fetchMatchTableRow() {
    const headers = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${this.authToken || SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    };

    try {
      const apiRes = await fetch(MATCH_CONFIG_ENDPOINT, { headers });
      if (apiRes.ok) {
        const payload = await apiRes.json();
        if (payload?.success && payload.config) {
          console.log(`📡 Loaded match config from Edge Function`);
          return { data: payload.config };
        }
      } else {
        console.warn(`⚠️ Failed to load match config API: ${apiRes.status} ${apiRes.statusText}`);
      }
    } catch (error) {
      console.warn(`⚠️ Failed to load match config API:`, error);
    }

    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/matches?select=*&limit=1`, { headers });
      if (!res.ok) {
        console.warn(`⚠️ Failed to load match table matches: ${res.status} ${res.statusText}`);
        return null;
      }

      const rows = await res.json();
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (row) {
        console.log(`📡 Loaded match row from Supabase table: matches`);
        return row;
      }
    } catch (error) {
      console.warn(`⚠️ Failed to load match table matches:`, error);
    }

    return null;
  }

  parseMatchConfigFromRow(row) {
    if (!row) return null;

    if (row.data) {
      if (typeof row.data === "string") {
        try {
          return JSON.parse(row.data);
        } catch (error) {
          console.warn("⚠️ Failed to parse match row data:", error);
          return null;
        }
      }

      if (typeof row.data === "object") {
        return row.data;
      }
    }

    if (row.domains || row.fields || row.arrays || row.screeningQuestions) {
      return row;
    }

    return null;
  }

  buildMatchConfigFromRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      return { domains: {} };
    }

    for (const row of rows) {
      const config = this.parseMatchConfigFromRow(row);
      if (config?.domains && Object.keys(config.domains).length > 0) {
        return config;
      }
    }

    const domains = {};
    for (const row of rows) {
      const config = this.parseMatchConfigFromRow(row);
      if (!config) continue;

      const patterns = [
        row.domain_pattern,
        row.domain,
        row.hostname_pattern,
        row.pattern,
        config.domain_pattern,
        config.domain,
        config.hostname_pattern,
        config.pattern,
      ].filter(Boolean);

      for (const pattern of patterns) {
        domains[pattern] = config;
      }
    }

    return { domains };
  }

  /**
   * Extract generic field variants from the database match config.
   */
  getGenericMappingFromMatchConfig(matchConfig) {
    return (
      matchConfig?.mapping ||
      matchConfig?.mappings ||
      matchConfig?.genericMapping ||
      matchConfig?.genericMappings ||
      matchConfig?.fieldMappings ||
      matchConfig?.fieldsMapping ||
      matchConfig?.matching_fields ||
      matchConfig?.matchingFields ||
      {}
    );
  }

  /**
   * Build a map of known field name variants from the database generic mapping.
   * Returns a Map<lowercaseVariant, profilePath> for fast lookup.
   */
  buildKnownVariantsMap(config, parentPath = "") {
    const map = new Map();

    for (const [key, value] of Object.entries(config)) {
      const fullPath = parentPath ? `${parentPath}.${key}` : key;

      if (Array.isArray(value)) {
        // value is an array of variants for this field
        for (const v of value) {
          if (typeof v === "string") {
            map.set(v.toLowerCase(), fullPath);
          }
        }
        // Also add the key itself
        map.set(key.toLowerCase(), fullPath);
      } else if (value && typeof value === "object") {
        // Recurse into nested object
        const childMap = this.buildKnownVariantsMap(value, fullPath);
        for (const [k, v] of childMap) {
          map.set(k, v);
        }
      }
    }

    return map;
  }

  /**
  * Build a lookup map from platform field definitions.
   * This prefers the current platform's explicit field names/labels/selectors.
   */
  buildPlatformFieldLookup(platformConfig) {
    const map = new Map();
    if (!platformConfig) return map;

    const add = (text, profilePath) => {
      if (!text || !profilePath) return;
      const key = String(text).toLowerCase().trim();
      if (!key) return;
      if (!map.has(key)) map.set(key, profilePath);
    };

    const addSelectorHints = (selector, profilePath) => {
      if (!selector || !profilePath) return;

      const attrPattern = /\[(?:name|id|data-automation-id|data-testid|data-test|data-sr-id)=['"]([^'"]+)['"]\]/g;
      for (const match of selector.matchAll(attrPattern)) {
        add(match[1], profilePath);
      }

      const idPattern = /#([A-Za-z0-9_:-]+)/g;
      for (const match of selector.matchAll(idPattern)) {
        add(match[1], profilePath);
      }

      const classPattern = /\.([A-Za-z0-9_-]+)/g;
      for (const match of selector.matchAll(classPattern)) {
        add(match[1], profilePath);
      }
    };

    for (const field of platformConfig.fields || []) {
      const profilePath = field.profilePath || null;
      add(field.name, profilePath);
      addSelectorHints(field.selector, profilePath);
      add(field.dataAutomationId, profilePath);
      add(field.dataTest, profilePath);
      add(field.id, profilePath);

      if (platformConfig.platform === "workday" && profilePath === "personal_details.address.country") {
        add("country", profilePath);
        add("regionSubdivision1", profilePath);
      }

      if (field.selectorAttr && field.name) {
        add(field.name, profilePath);
      }
    }

    for (const [arrayPath, arrayConfig] of Object.entries(platformConfig.arrays || {})) {
      for (const field of arrayConfig.fields || []) {
        const profilePath = `${arrayPath}.0.${field.key}`;
        add(field.name, profilePath);
        addSelectorHints(field.selector, profilePath);
      }
    }

    return map;
  }

  /**
  * Find the platform config from the Supabase match data that matches the active page URL.
   */
  getPlatformConfigForUrl(matchJson, pageUrl) {
    try {
      const hostname = new URL(pageUrl).hostname;
      const domains = matchJson?.domains || {};

      const matchesPattern = (pattern) => {
        if (!pattern) return false;
        if (pattern === hostname) return true;
        if (pattern.startsWith("*.")) {
          const suffix = pattern.slice(2);
          return hostname === suffix || hostname.endsWith(`.${suffix}`);
        }
        return false;
      };

      for (const [pattern, config] of Object.entries(domains)) {
        if (matchesPattern(pattern)) return config;
      }
    } catch (_) {
      /* ignore */
    }
    return null;
  }

  /**
   * Try to match a detected form field to a profile path using the known variants.
   * Returns the profile path string if matched, or null if unmatched.
   */
  matchFieldToProfile(field, knownVariants, platformVariants = new Map()) {
    const textParts = [
      field.name,
      field.id,
      field.dataAutomationId,
      field.dataTestId,
      field.placeholder,
      field.ariaLabel,
      field.label,
    ].filter(Boolean).join(" ").toLowerCase();

    // Skip noisy controls that should not map to profile data.
    if (field.type === "checkbox" || field.type === "radio") {
      const consentPatterns = /background check|drug test|criminal|conviction|acknowledge|truthful|work authorization|visa sponsorship|authorized to work|relocat|citizenship|permanent residency|non-compete|non-solicitation|government employee|export control|sanctioned|protected veteran|veteran status|vevraa|veteran|disability|self identified disability|ofccp|please check one of the boxes below|how did you hear|education/i;
      if (!consentPatterns.test(textParts)) return null;
    }

    if (textParts.includes("country phone code") || textParts.includes("phonecountrycode")) {
      return null;
    }

    // Candidates to check against known variants (in priority order)
    const candidates = [
      field.name,
      field.id,
      field.dataAutomationId,
      field.dataTestId,
      field.placeholder,
      field.ariaLabel,
    ].filter(Boolean);

    // Direct platform match from the Supabase match data takes priority.
    for (const candidate of candidates) {
      const lower = candidate.toLowerCase();
      if (platformVariants.has(lower)) return platformVariants.get(lower);

      const stripped = lower
        .replace(/^(input_|field_|form_|txt_|sel_|rbtn_)/, "")
        .replace(/(_input|_field|_text|_select)$/, "");
      if (platformVariants.has(stripped)) return platformVariants.get(stripped);
    }

    // Direct generic match
    for (const candidate of candidates) {
      const lower = candidate.toLowerCase();
      if (knownVariants.has(lower)) return knownVariants.get(lower);

      // Try stripping common prefixes/suffixes
      const stripped = lower
        .replace(/^(input_|field_|form_|txt_|sel_|rbtn_)/, "")
        .replace(/(_input|_field|_text|_select)$/, "");
      if (knownVariants.has(stripped)) return knownVariants.get(stripped);
    }

    // Fuzzy match: check if any candidate CONTAINS a known variant or vice versa
    for (const candidate of candidates) {
      const lower = candidate.toLowerCase();
      for (const [variant, path] of knownVariants) {
        if (variant.length < 3) continue; // skip very short matches
        if (lower.includes(variant) || variant.includes(lower)) {
          // Avoid false positives: require at least 50% overlap
          const overlapRatio = Math.min(variant.length, lower.length) / Math.max(variant.length, lower.length);
          if (overlapRatio > 0.4) return path;
        }
      }
    }

    // Label text match
    if (field.label) {
      const labelLower = field.label.toLowerCase().replace(/[^a-z0-9 ]/g, "");
      const labelWords = labelLower.split(/\s+/).filter((w) => w.length > 2);

      // Common label → profile path mapping
      const labelMap = {
        "first name": "personal_details.first_name",
        "last name": "personal_details.last_name",
        "full name": "personal_details.fullName",
        "email": "personal_details.email",
        "phone": "personal_details.phone",
        "address": "personal_details.address.line1",
        "city": "personal_details.address.city",
        "state": "personal_details.address.state",
        "zip": "personal_details.address.postalCode",
        "postal code": "personal_details.address.postalCode",
        "country": "personal_details.address.country",
        "linkedin": "personal_details.linkedin",
        "github": "personal_details.github",
        "portfolio": "personal_details.portfolio",
        "summary": "personal_details.summary",
        "company": "work_experience.company",
        "job title": "work_experience.jobTitle",
        "position": "work_experience.jobTitle",
        "school": "education_history.school",
        "university": "education_history.school",
        "degree": "education_history.degree",
        "salary": "job_preferences.salaryExpectation",
        "expected salary": "job_preferences.salaryExpectation",
        "salary expectation": "job_preferences.salaryExpectation",
        "salary expectations": "job_preferences.salaryExpectation",
        "compensation": "job_preferences.salaryExpectation",
        "expected compensation": "job_preferences.salaryExpectation",
        "compensation expectation": "job_preferences.salaryExpectation",
        "compensation expectations": "job_preferences.salaryExpectation",
        "pay expectation": "job_preferences.salaryExpectation",
        "pay expectations": "job_preferences.salaryExpectation",
        "relocate": "willing_to_relocate",
        // Screening / questionnaire questions
        "relocating for this role": "job_preferences.screening_answers",
        "authorized to work": "job_preferences.screening_answers",
        "work lawfully": "job_preferences.screening_answers",
        "lawfully in the united states": "job_preferences.screening_answers",
        "legally authorized": "job_preferences.screening_answers",
        "work authorization": "job_preferences.screening_answers",
        "visa sponsorship": "job_preferences.screening_answers",
        "sponsor": "job_preferences.screening_answers",
        "sponsorship": "job_preferences.screening_answers",
        "immigration": "job_preferences.screening_answers",
        "immigration case": "job_preferences.screening_answers",
        "employment-based visa": "job_preferences.screening_answers",
        "h-1b": "job_preferences.screening_answers",
        "protected veteran": "job_preferences.screening_answers",
        "veteran status": "job_preferences.screening_answers",
        "vevraa": "job_preferences.screening_answers",
        "veteran": "job_preferences.screening_answers",
        "non-compete": "job_preferences.screening_answers",
        "non-solicitation": "job_preferences.screening_answers",
        "government employee": "job_preferences.screening_answers",
        "export control": "job_preferences.screening_answers",
        "sanctioned": "job_preferences.screening_answers",
        "citizenship": "job_preferences.screening_answers",
        "permanent residency": "job_preferences.screening_answers",
        "related to a current": "job_preferences.screening_answers",
        "related to an employee": "job_preferences.screening_answers",
        "acknowledge": "job_preferences.screening_answers",
        "truthful": "job_preferences.screening_answers",
        "background check": "background_check_consent",
        "drug test": "drug_test_consent",
        "criminal": "criminal_history",
        "conviction": "criminal_history",
        "how did you hear": "job_preferences.screening_answers",
        "highest level of education": "job_preferences.screening_answers",
        "level of education": "job_preferences.screening_answers",
        "highest education": "job_preferences.screening_answers",
        "18 years": "job_preferences.screening_answers",
        "years of age": "job_preferences.screening_answers",
        "previously employed": "job_preferences.screening_answers",
        "formerly employed": "job_preferences.screening_answers",
        "contractor": "job_preferences.screening_answers",
        "gender": "job_preferences.screening_answers",
        "race": "job_preferences.screening_answers",
        "ethnicity": "job_preferences.screening_answers",
        "disability": "job_preferences.screening_answers",
        "disability status": "job_preferences.screening_answers",
        "self identified disability": "job_preferences.screening_answers",
        "ofccp": "job_preferences.screening_answers",
        "please check one of the boxes below": "job_preferences.screening_answers",
      };

      for (const [labelPattern, path] of Object.entries(labelMap)) {
        if (labelLower.includes(labelPattern)) return path;
      }
    }

    return null;
  }

  /**
   * Render the detected fields panel in the popup.
   */
  renderDetectedFields(fields) {
    const section = document.getElementById("detected-fields-section");
    const list = document.getElementById("detected-fields-list");
    const countEl = document.getElementById("detected-fields-count");
    const matchedCountEl = document.getElementById("detected-matched-count");
    const unmatchedCountEl = document.getElementById("detected-unmatched-count");

    const matched = fields.filter((f) => f.profileMatch);
    const unmatched = fields.filter((f) => !f.profileMatch);

    countEl.textContent = `${fields.length} field${fields.length !== 1 ? "s" : ""} detected`;
    matchedCountEl.textContent = `${matched.length} matched`;
    unmatchedCountEl.textContent = `${unmatched.length} unmatched`;

    // Build field cards — matched first, then unmatched
    const sorted = [...matched, ...unmatched];
    list.innerHTML = sorted
      .map((field) => {
        const displayLabel =
          field.label || field.placeholder || field.name || field.id || field.dataAutomationId || "Unknown field";
        const typeLabel = field.type === "custom-select" ? "dropdown" : field.type === "select" || field.tag === "select" ? "select" : field.type || "text";
        const isMatched = !!field.profileMatch;
        const mappingText = isMatched ? `→ ${field.profileMatch}` : "No mapping";

        return `
        <div class="detected-field-card">
          <div class="detected-field-status ${isMatched ? "matched" : "unmatched"}"></div>
          <div class="detected-field-info">
            <div class="detected-field-label" title="${this.escapeHtml(displayLabel)}">${this.escapeHtml(displayLabel)}</div>
            <div class="detected-field-meta">
              <span class="detected-field-type">${typeLabel}${field.required ? " •\u00a0req" : ""}</span>
              <span class="detected-field-mapping ${isMatched ? "" : "none"}">${this.escapeHtml(mappingText)}</span>
            </div>
          </div>
        </div>`;
      })
      .join("");

    // Show the section
    section.classList.remove("hidden");
  }

  escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  toggleDetectedFields() {
    const list = document.getElementById("detected-fields-list");
    const arrow = document.getElementById("toggle-arrow");
    if (list.classList.contains("hidden")) {
      list.classList.remove("hidden");
      arrow.classList.add("expanded");
    } else {
      list.classList.add("hidden");
      arrow.classList.remove("expanded");
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
    if (["success", "error"].includes(type)) setTimeout(() => this.hideStatus(), 3000);
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
      if (msg && msg.action === 'relayLog') {
        const level = msg.level || 'log';
        const args = Array.isArray(msg.args) ? msg.args : [msg.message || ''];
        try { (console[level] || console.log).apply(console, ['[Fillo Relay]', ...args]); } catch { console.log('[Fillo Relay]', ...args); }
      }
    });
  } catch(_) {}
  const popup = new FilloPopup();
  popup.initialize().catch((err) => console.error("❌ Popup init failed:", err));
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initializePopup);
else initializePopup();
