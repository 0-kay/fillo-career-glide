console.log(
  "🤖 Fillo Auto-Fill: Advanced content script loaded on",
  window.location.href
);

let currentObserver = null;
let isProcessing = false;
let mapping = null;
let rawMappingConfig = null;
let isInitialized = false;

const AI_CONFIG = {
  enabled: true,
  supabaseUrl: "https://yuojrygcrcpajiglbekd.supabase.co",
  supabaseKey:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1b2pyeWdjcmNwYWppZ2xiZWtkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEyMzAzMjksImV4cCI6MjA2NjgwNjMyOX0.9dYnQRjtSocxmb9gCw0fOf4GfPk2mUQNcrkOqwu8Rck",
};

const THRESHOLD_DIRECT_MATCH = 70;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeExtension);
} else {
  initializeExtension();
}

function initializeExtension() {
  if (isInitialized) return;

  console.log("🚀 Fillo extension initializing on:", window.location.hostname);

  const forms = document.querySelectorAll("form");
  const inputs = document.querySelectorAll("input, textarea, select");

  console.log(
    `📋 Found ${forms.length} forms and ${inputs.length} form fields`
  );

  Promise.all([
    loadMapping().catch((error) => {
      console.warn("⚠️ Mapping load failed:", error.message);
      return [];
    }),
    loadRawMappingConfig().catch((error) => {
      console.warn("⚠️ Raw mapping load failed:", error.message);
      return {};
    }),
    loadAIConfig().catch((error) => {
      console.warn("⚠️ AI config load failed:", error.message);
    }),
  ])
    .then(() => {
      console.log("✅ Fillo extension ready for form filling");
      isInitialized = true;
    })
    .catch((error) => {
      console.error("⚠️ Extension initialization failed:", error);
      isInitialized = true;
    });
}

async function loadAIConfig() {
  try {
    console.log("🔄 Loading intelligent field matching configuration...");
    AI_CONFIG.enabled = true;
    console.log("🧠 Intelligent field matching enabled via Supabase");
  } catch (error) {
    console.error("⚠️ Failed to load AI config:", error);
    AI_CONFIG.enabled = false;
  }
}

function resetProcessingFlag() {
  console.log("🔄 Manually resetting processing flag");
  isProcessing = false;
  return { success: true, message: "Processing flag reset" };
}

window.resetFilloProcessing = resetProcessingFlag;

async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeout}ms`);
    }
    throw error;
  }
}

function getEnhancedFieldContext(element) {
  const container =
    element.closest("div, fieldset, section") || element.parentElement;
  const containerText = container
    ? container.textContent?.toLowerCase() || ""
    : "";

  const siblings = Array.from(element.parentElement?.children || []);
  const siblingText = siblings
    .filter((el) => el !== element && el.textContent)
    .map((el) => el.textContent.toLowerCase())
    .join(" ");

  return {
    name: element.name?.toLowerCase() || "",
    id: element.id?.toLowerCase() || "",
    placeholder: element.placeholder?.toLowerCase() || "",
    label: getFieldLabel(element)?.toLowerCase() || "",
    type: element.type?.toLowerCase() || "",
    className: element.className?.toLowerCase() || "",
    context: containerText.substring(0, 200),
    siblingText: siblingText.substring(0, 100),
    ariaLabel: element.getAttribute("aria-label")?.toLowerCase() || "",
    ariaLabelledBy: element.getAttribute("aria-labelledby")
      ? document
          .getElementById(element.getAttribute("aria-labelledby"))
          ?.textContent?.toLowerCase() || ""
      : "",
    required: element.required || element.hasAttribute("required"),
    maxLength: element.maxLength > 0 ? element.maxLength : null,
  };
}

async function loadRawMappingConfig() {
  if (rawMappingConfig) return rawMappingConfig;
  try {
    const response = await fetch(chrome.runtime.getURL("matching_fields.json"));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    rawMappingConfig = await response.json();
    console.log("✅ Loaded raw mapping configuration");
    return rawMappingConfig;
  } catch (error) {
    console.warn("⚠️ Failed to load raw mapping configuration:", error);
    throw error;
  }
}

async function loadMapping() {
  if (mapping) return mapping;

  try {
    console.log("🔄 Loading mapping configuration...");
    const response = await fetch(chrome.runtime.getURL("matching_fields.json"));

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const config = await response.json();
    mapping = flattenMapping(config);

    if (mapping.length === 0) {
      throw new Error("Mapping configuration is empty");
    }

    console.log(
      "✅ Loaded mapping configuration:",
      mapping.length,
      "field mappings"
    );
    return mapping;
  } catch (error) {
    console.error("❌ Failed to load mapping configuration:", error);
    throw new Error(`Mapping load failed: ${error.message}`);
  }
}

function flattenMapping(config) {
  const flat = [];

  function walk(obj, parentKey = "") {
    for (const [key, val] of Object.entries(obj)) {
      const fullKey = parentKey ? `${parentKey}.${key}` : key;

      if (Array.isArray(val)) {
        const isArrayField = shouldBeArrayField(fullKey);
        flat.push({
          path: isArrayField ? `${fullKey}[]` : fullKey,
          variants: val,
          isArray: isArrayField,
        });
      } else if (typeof val === "object" && val !== null) {
        walk(val, fullKey);
      }
    }
  }
  walk(config);
  return flat;
}

function shouldBeArrayField(path) {
  const arrayPatterns = [
    "work_experience",
    "education_history",
    "projects",
    "certifications",
    "languages",
    "volunteer_experience",
    "awards_honors",
    "technical_skills",
    "soft_skills",
    "tools_technologies",
    "references",
    "publications",
    "skills_detailed",
    "reference_contacts",
  ];
  return arrayPatterns.some(
    (pattern) => path.includes(pattern) && !path.includes(".")
  );
}

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
  try {
    console.log("📨 Content script received message:", request.action);

    if (!isInitialized) {
      console.log("🔄 Extension not initialized, initializing now...");
      initializeExtension();
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    if (request.action === "fillForm") {
     console.log("🔄 Filling form with profile data:", request.profileData);
     const result = await handleFillForm(request.profileData, request.useAI);
     sendResponse({ success: true, ...result });
    } else if (request.action === "detectFields") {
      const result = await handleDetectFields();
      sendResponse({ success: true, ...result });
    } else if (request.action === "stopObservation") {
      handleStopObservation();
      sendResponse({ success: true });
    } else if (request.action === "reloadAIConfig") {
      await loadAIConfig();
      sendResponse({ success: true, message: "AI configuration reloaded" });
    } else {
      sendResponse({ success: false, error: "Unknown action" });
    }
  } catch (error) {
    console.error("❌ Content script error:", error);
    sendResponse({ success: false, error: error.message });
  }
  return true;
});

async function handleFillForm(profileData, useAI = false) {
    if (isProcessing) {
      console.log("⏳ Already processing a fill request");
      return { filled: 0, message: "Already processing" };
    }

    isProcessing = true;

  try {
    console.log(
      "🚀 Starting advanced form filling with intelligent field matching"
    );
    console.log("📋 Profile data keys:", Object.keys(profileData || {}));
    console.log("🧠 AI enabled for this request:", useAI);

    let mappingConfig = [];
    try {
      mappingConfig = await loadMapping();
    } catch (error) {
      console.warn("⚠️ Failed to load mapping configuration:", error.message);
    }

    let currentRawMappingConfig = {};
    try {
      currentRawMappingConfig = await loadRawMappingConfig();
    } catch (error) {
      console.warn(
        "⚠️ Failed to load raw mapping configuration for AI:",
        error.message
      );
    }

    if (currentObserver) {
      currentObserver.disconnect();
      currentObserver = null;
    }

    const formElements = Array.from(
      document.querySelectorAll("input, select, textarea")
    );
    const fieldsToProcess = formElements.map((element) => ({
      element,
      fieldInfo: getEnhancedFieldContext(element),
      isFilled: false,
    }));

    let filledCount = 0;
    let aiFilledCount = 0;
    let aiBatchFields = [];

    console.log(
      `📋 Found ${fieldsToProcess.length} form elements for processing`
    );

    for (const fieldData of fieldsToProcess) {
      if (
        fieldData.isFilled ||
        !isElementVisible(fieldData.element) ||
        fieldData.element.value?.trim()
      ) {
        continue;
      }

      let matchedByMapping = false;
      for (const mappingEntry of mappingConfig) {
        if (mappingEntry.isArray) continue;

        const score = computeFieldMatchScore(
          fieldData.element,
          mappingEntry.path,
          mappingEntry.variants
        );

        if (score >= THRESHOLD_DIRECT_MATCH) {
          const value = getValue(profileData, mappingEntry.path.split("."));
          if (value !== undefined && value !== null && value !== "") {
            if (fillElement(fieldData.element, value)) {
              fieldData.isFilled = true;
              filledCount++;
              matchedByMapping = true;
              console.log(
                `✅ Direct Mapping: ${
                  fieldData.fieldInfo.name || fieldData.fieldInfo.id
                } -> "${value}" (Score: ${score})`
              );
              break;
            }
          }
        }
      }

      if (!matchedByMapping) {
        if (useAI && AI_CONFIG.enabled) {
          aiBatchFields.push(fieldData);
        } else {
          const semanticMatch = findSemanticMatch(
            fieldData.fieldInfo,
            profileData
          );
          if (semanticMatch) {
            if (fillElement(fieldData.element, semanticMatch.value)) {
              fieldData.isFilled = true;
              filledCount++;
              console.log(
                `🎯 Semantic Match: ${
                  fieldData.fieldInfo.name || fieldData.fieldInfo.id
                } -> "${semanticMatch.value}"`
              );
            }
          }
        }
      }
    }

    if (aiBatchFields.length > 0 && useAI && AI_CONFIG.enabled) {
      console.log(
        `🧠 Processing ${aiBatchFields.length} fields with batch AI...`
      );
      try {
        const aiResults = await analyzeBatchFieldsWithAI(
          aiBatchFields.map((f) => f.fieldInfo),
          profileData,
          mappingConfig,
          currentRawMappingConfig
        );

        for (const result of aiResults) {
          if (result && result.shouldFill && result.fieldIndex !== undefined) {
            const fieldData = aiBatchFields[result.fieldIndex];
            if (fieldData && !fieldData.isFilled) {
              if (fillElement(fieldData.element, result.value)) {
                fieldData.isFilled = true;
                filledCount++;
                aiFilledCount++;
                console.log(
                  `🧠 ✅ AI Batch Fill: ${
                    fieldData.fieldInfo.name || fieldData.fieldInfo.id
                  } -> "${result.value}" (Confidence: ${result.confidence}%)`
                );
                console.log(`🧠 📝 AI Reasoning: ${result.reasoning}`);
              }
            }
          }
        }
      } catch (aiError) {
        console.error("❌ Batch AI processing failed:", aiError);
      }
    }

    currentObserver = observeDynamic(profileData, mappingConfig, useAI);

    console.log(
      `✅ Form filling complete: ${filledCount} fields filled (${aiFilledCount} AI matches)`
    );

    const aiStatus = useAI ? ` with AI (${aiFilledCount} AI matches)` : "";
    showNotification(`⚡ Filled ${filledCount} fields${aiStatus}`, "success");

    return {
      filled: filledCount,
      total: fieldsToProcess.length,
      aiMatches: aiFilledCount,
      message: `Form filling completed: ${filledCount} fields filled${aiStatus}`,
    };
  } catch (error) {
    console.error("❌ Error in form filling:", error);
    showNotification("❌ Form filling failed: " + error.message, "error");
    throw error;
  } finally {
    isProcessing = false
  }
}

async function analyzeBatchFieldsWithAI(
  fieldsInfo,
  profileData,
  mappingConfig,
  rawMappingConfig
) {
  const startTime = Date.now();
  console.log(
    `🧠 Starting batch AI analysis for ${fieldsInfo.length} fields...`
  );

  try {
    const requestData = {
      fields: fieldsInfo,
      profileData: profileData,
      mappingConfig: mappingConfig,
      fieldVariations: rawMappingConfig,
    };

    console.log("🧠 Batch AI Request Data:", {
      fieldsCount: requestData.fields.length,
      fieldNames: requestData.fields.map((f) => f.name || f.id || "unnamed"),
      profileDataKeys: Object.keys(profileData),
    });

    const response = await fetchWithTimeout(
      `${AI_CONFIG.supabaseUrl}/functions/v1/ai-batch-analysis`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AI_CONFIG.supabaseKey}`,
        },
        body: JSON.stringify(requestData),
      },
      20000
    );

    if (!response.ok) {
      throw new Error(
        `Batch AI HTTP ${response.status}: ${response.statusText}`
      );
    }

    const data = await response.json();
    const duration = Date.now() - startTime;

    console.log(`🧠 Batch AI completed in ${duration}ms`);
    console.log("🧠 Raw Batch AI Response:", data);

    if (data.success && data.results) {
      console.log("🧠 Batch AI Analysis Summary:", {
        totalFields: data.debug?.totalFields || fieldsInfo.length,
        processedResults: data.debug?.processedResults || data.results.length,
        fieldsToFill:
          data.debug?.fieldsToFill ||
          data.results.filter((r) => r && r.shouldFill).length,
        averageConfidence:
          data.results.length > 0
            ? data.results.reduce((sum, r) => sum + (r?.confidence || 0), 0) /
              data.results.length
            : 0,
      });

      return data.results;
    } else {
      console.log("🧠 Batch AI returned no valid results");
      return [];
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(
      `❌ Batch AI analysis failed after ${duration}ms:`,
      error.message
    );
    if (error.message.includes("timed out")) {
      console.warn(
        "⚠️ Batch AI timeout detected - falling back to standard matching"
      );
    }
    return [];
  }
}

async function handleDetectFields() {
  console.log("🔍 Detecting form fields");

  const formElements = document.querySelectorAll("input, textarea, select");
  const detectedFields = [];

  formElements.forEach((element, index) => {
    if (isElementVisible(element)) {
      const fieldInfo = getEnhancedFieldContext(element);

      detectedFields.push({
        index,
        ...fieldInfo,
        hasValue: !!element.value?.trim(),
      });
    }
  });

  console.log(`✅ Detected ${detectedFields.length} visible form fields`);

  return {
    totalFields: formElements.length,
    visibleFields: detectedFields.length,
    filledFields: detectedFields.filter((f) => f.hasValue).length,
    fields: detectedFields,
    url: window.location.href,
    title: document.title,
  };
}

function handleStopObservation() {
  console.log("🛑 Stopping dynamic observation");

  if (currentObserver) {
    currentObserver.disconnect();
    currentObserver = null;
    console.log("✅ Observer stopped");
  } else {
    console.log("ℹ️ No observer was running");
  }
}

function computeFieldMatchScore(element, standardPath, variants) {
  let score = 0;
  const fieldInfo = getEnhancedFieldContext(element);

  const tokens = (str) => new Set(str.split(/[\s_-]+/).filter(Boolean));

  for (const variant of variants) {
    const variantLower = variant.toLowerCase();
    const variantTokens = tokens(variantLower);

    let currentVariantScore = 0;

    const checkAndScore = (
      text,
      exactWeight,
      partialWeight,
      tokenWeight = 0
    ) => {
      const textLower = text.toLowerCase();
      if (!textLower) return 0;
      if (textLower === variantLower) return exactWeight;
      if (textLower.includes(variantLower)) return partialWeight;

      const textTokens = tokens(textLower);
      const intersection = new Set(
        [...variantTokens].filter((x) => textTokens.has(x))
      );
      if (intersection.size > 0) {
        return (
          tokenWeight *
          (intersection.size / Math.min(variantTokens.size, textTokens.size))
        );
      }
      return 0;
    };

    currentVariantScore = Math.max(
      currentVariantScore,
      checkAndScore(fieldInfo.id, 100, 80, 50),
      checkAndScore(fieldInfo.name, 95, 75, 45),
      checkAndScore(fieldInfo.label, 90, 70, 40),
      checkAndScore(fieldInfo.placeholder, 85, 65, 35),
      checkAndScore(fieldInfo.ariaLabel, 80, 60, 30),
      checkAndScore(fieldInfo.ariaLabelledBy, 75, 55, 25),
      checkAndScore(fieldInfo.context, 10, 5, 2),
      checkAndScore(fieldInfo.siblingText, 10, 5, 2)
    );

    if (element.getAttribute("data-testid")?.toLowerCase() === variantLower)
      currentVariantScore = Math.max(currentVariantScore, 90);
    if (
      element.getAttribute("data-automation-id")?.toLowerCase() === variantLower
    )
      currentVariantScore = Math.max(currentVariantScore, 90);

    if (fieldInfo.className.includes(variantLower))
      currentVariantScore = Math.max(currentVariantScore, 30);

    if (fieldInfo.type === "email" && variantLower.includes("email"))
      currentVariantScore = Math.max(currentVariantScore, 60);
    if (
      fieldInfo.type === "tel" &&
      (variantLower.includes("phone") || variantLower.includes("tel"))
    )
      currentVariantScore = Math.max(currentVariantScore, 60);
    if (
      fieldInfo.type === "url" &&
      (variantLower.includes("website") || variantLower.includes("url"))
    )
      currentVariantScore = Math.max(currentVariantScore, 60);
    if (
      fieldInfo.type === "password" &&
      (variantLower.includes("password") || variantLower.includes("pin"))
    )
      currentVariantScore = Math.max(currentVariantScore, 80);

    score = Math.max(score, currentVariantScore);
  }

  if (
    element.hasAttribute("data-field") &&
    element.dataset.field === standardPath
  ) {
    score = Math.max(score, 100);
  }

  return score;
}

function fillElement(element, value) {
  try {
    if (!element || value == null) return false;

    const tagName = element.tagName.toLowerCase();
    const type = element.type?.toLowerCase();

    if (tagName === "select") {
      const options = element.querySelectorAll("option");
      let selected = false;
      for (const option of options) {
        if (
          option.value === String(value) ||
          option.textContent.trim() === String(value)
        ) {
          element.value = option.value;
          selected = true;
          break;
        }
      }
      if (!selected) {
        console.warn(
          `⚠️ No matching option found for select field ${
            element.name || element.id
          } with value "${value}"`
        );
        return false;
      }
    } else if (type === "checkbox" || type === "radio") {
      element.checked = Boolean(value);
    } else if (type === "file") {
      return false;
    } else {
      element.value = String(value);
    }

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));

    return true;
  } catch (error) {
    console.error("❌ Error filling element:", error);
    return false;
  }
}

// function findSemanticMatch(context, profileData) {
//   const patterns = [
//     {
//       keywords: ["email"],
//       getValue: () => profileData.personal_details?.email,
//     },
//     { keywords: ["first", "fname"], getValue: () => profileData.first_name },
//     { keywords: ["last", "lname"], getValue: () => profileData.last_name },
//     {
//       keywords: ["name", "fullname"],
//       getValue: () =>
//         profileData.personal_details?.fullName ||
//         `${profileData.first_name || ""} ${profileData.last_name || ""}`.trim(),
//     },
//     {
//       keywords: ["phone", "tel"],
//       getValue: () => profileData.personal_details?.phone,
//     },
//     {
//       keywords: ["address", "street"],
//       getValue: () => profileData.personal_details?.address,
//     },
//     {
//       keywords: ["linkedin"],
//       getValue: () => profileData.personal_details?.linkedin,
//     },
//     {
//       keywords: ["github"],
//       getValue: () => profileData.personal_details?.github,
//     },
//     {
//       keywords: ["portfolio", "website"],
//       getValue: () => profileData.personal_details?.portfolio,
//     },
//     {
//       keywords: ["summary", "about"],
//       getValue: () => profileData.personal_details?.summary,
//     },
//     {
//       keywords: ["skill", "technical"],
//       getValue: () => {
//         const skills = profileData.technical_skills;
//         if (Array.isArray(skills)) return skills.join(", ");
//         if (skills?.all) return skills.all.join(", ");
//         return null;
//       },
//     },
//     {
//       keywords: ["soft"],
//       getValue: () => {
//         const skills = profileData.soft_skills;
//         if (Array.isArray(skills)) return skills.join(", ");
//         if (skills?.all) return skills.all.join(", ");
//         return null;
//       },
//     },
//     {
//       keywords: ["tools", "technologies"],
//       getValue: () => {
//         const tools = profileData.tools_technologies;
//         if (Array.isArray(tools)) return tools.join(", ");
//         return null;
//       },
//     },
//     {
//       keywords: ["language"],
//       getValue: () => {
//         const languages = profileData.languages;
//         if (Array.isArray(languages)) {
//           return languages
//             .map((lang) => (typeof lang === "string" ? lang : lang.language))
//             .filter(Boolean)
//             .join(", ");
//         }
//         return null;
//       },
//     },
//     {
//       keywords: ["relocate", "relocation"],
//       getValue: () => profileData.willing_to_relocate,
//     },
//     {
//       keywords: ["background", "screening"],
//       getValue: () => profileData.background_check_consent,
//     },
//     {
//       keywords: ["drug", "test"],
//       getValue: () => profileData.drug_test_consent,
//     },
//     {
//       keywords: ["criminal", "conviction"],
//       getValue: () => profileData.criminal_history,
//     },
//     {
//       keywords: ["salary", "compensation"],
//       getValue: () => profileData.job_preferences?.salaryExpectation,
//     },
//     {
//       keywords: ["remote", "telecommute"],
//       getValue: () => profileData.job_preferences?.remote,
//     },
//   ];

//   for (const pattern of patterns) {
//     const matches = pattern.keywords.some(
//       (keyword) =>
//         context.name.includes(keyword) ||
//         context.id.includes(keyword) ||
//         context.label.includes(keyword) ||
//         context.placeholder.includes(keyword) ||
//         context.ariaLabel.includes(keyword) ||
//         context.ariaLabelledBy.includes(keyword) ||
//         context.context.includes(keyword) ||
//         context.siblingText.includes(keyword)
//     );

//     if (matches) {
//       const value = pattern.getValue();
//       if (value !== undefined && value !== null && value !== "") {
//         return { value, pattern: pattern.keywords.join("|") };
//       }
//     }
//   }
//   return null;
// }

// Enhanced findSemanticMatch function with better fallback coverage
// This function is called when a field is NOT found in matching_fields.json
// It uses intelligent pattern matching to fill unmapped fields

function findSemanticMatch(context, profileData) {
  const patterns = [
    // Basic contact info
    {
      keywords: ["email", "e-mail", "mail", "electronic"],
      getValue: () => profileData.personal_details?.email || profileData.email,
    },
    { 
      keywords: ["first", "fname", "given", "forename"], 
      getValue: () => profileData.first_name || profileData.personal_details?.first_name 
    },
    { 
      keywords: ["last", "lname", "surname", "family"], 
      getValue: () => profileData.last_name || profileData.personal_details?.last_name 
    },
    {
      keywords: ["middle", "mname"],
      getValue: () => profileData.middle_name || profileData.personal_details?.middle_name,
    },
    {
      keywords: ["name", "fullname", "full_name", "full-name"],
      getValue: () =>
        profileData.personal_details?.fullName ||
        profileData.name ||
        profileData.full_name ||
        `${profileData.first_name || ""} ${profileData.last_name || ""}`.trim(),
    },
    {
      keywords: ["phone", "tel", "mobile", "contact", "cell"],
      getValue: () => profileData.personal_details?.phone || profileData.phone,
    },
    
    // Address fields
    {
      keywords: ["address", "street", "addr", "address1", "line1"],
      getValue: () => profileData.personal_details?.address || profileData.address,
    },
    {
      keywords: ["address2", "line2", "apt", "suite", "unit"],
      getValue: () => profileData.personal_details?.address2 || profileData.address2,
    },
    {
      keywords: ["city", "town", "locality"],
      getValue: () => profileData.personal_details?.city || profileData.city,
    },
    {
      keywords: ["state", "province", "region"],
      getValue: () => profileData.personal_details?.state || profileData.state,
    },
    {
      keywords: ["zip", "postal", "postcode", "pincode"],
      getValue: () => profileData.personal_details?.zipCode || profileData.zipCode || profileData.postal_code,
    },
    {
      keywords: ["country", "nation"],
      getValue: () => profileData.personal_details?.country || profileData.country,
    },
    
    // Social/Professional links
    {
      keywords: ["linkedin", "linked-in"],
      getValue: () => profileData.personal_details?.linkedin || profileData.linkedin,
    },
    {
      keywords: ["github", "git"],
      getValue: () => profileData.personal_details?.github || profileData.github,
    },
    {
      keywords: ["portfolio", "website", "url", "site"],
      getValue: () => profileData.personal_details?.portfolio || profileData.portfolio || profileData.website,
    },
    {
      keywords: ["twitter", "tweet"],
      getValue: () => profileData.personal_details?.twitter || profileData.twitter,
    },
    
    // Professional info
    {
      keywords: ["summary", "about", "bio", "profile", "objective"],
      getValue: () => profileData.personal_details?.summary || profileData.summary || profileData.bio,
    },
    {
      keywords: ["company", "employer", "organization", "current-company"],
      getValue: () => {
        if (Array.isArray(profileData.work_experience) && profileData.work_experience.length > 0) {
          return profileData.work_experience[0].company;
        }
        return profileData.current_company;
      },
    },
    {
      keywords: ["position", "title", "job", "role", "current-title"],
      getValue: () => {
        if (Array.isArray(profileData.work_experience) && profileData.work_experience.length > 0) {
          return profileData.work_experience[0].position;
        }
        return profileData.current_position;
      },
    },
    {
      keywords: ["years", "experience", "yoe"],
      getValue: () => {
        if (Array.isArray(profileData.work_experience)) {
          return String(profileData.work_experience.length);
        }
        return profileData.years_of_experience;
      },
    },
    
    // Education
    {
      keywords: ["school", "university", "college", "education", "institution"],
      getValue: () => {
        if (Array.isArray(profileData.education_history) && profileData.education_history.length > 0) {
          return profileData.education_history[0].school;
        }
        return null;
      },
    },
    {
      keywords: ["degree", "qualification"],
      getValue: () => {
        if (Array.isArray(profileData.education_history) && profileData.education_history.length > 0) {
          return profileData.education_history[0].degree;
        }
        return null;
      },
    },
    {
      keywords: ["major", "field", "study"],
      getValue: () => {
        if (Array.isArray(profileData.education_history) && profileData.education_history.length > 0) {
          return profileData.education_history[0].field_of_study;
        }
        return null;
      },
    },
    {
      keywords: ["gpa", "grade"],
      getValue: () => {
        if (Array.isArray(profileData.education_history) && profileData.education_history.length > 0) {
          return profileData.education_history[0].gpa;
        }
        return null;
      },
    },
    
    // Skills
    {
      keywords: ["skill", "technical", "tech-skill"],
      getValue: () => {
        const skills = profileData.technical_skills;
        if (Array.isArray(skills)) return skills.join(", ");
        if (skills?.all) return skills.all.join(", ");
        return null;
      },
    },
    {
      keywords: ["soft"],
      getValue: () => {
        const skills = profileData.soft_skills;
        if (Array.isArray(skills)) return skills.join(", ");
        if (skills?.all) return skills.all.join(", ");
        return null;
      },
    },
    {
      keywords: ["tools", "technologies", "software"],
      getValue: () => {
        const tools = profileData.tools_technologies;
        if (Array.isArray(tools)) return tools.join(", ");
        return null;
      },
    },
    {
      keywords: ["language", "spoken"],
      getValue: () => {
        const languages = profileData.languages;
        if (Array.isArray(languages)) {
          return languages
            .map((lang) => (typeof lang === "string" ? lang : lang.language))
            .filter(Boolean)
            .join(", ");
        }
        return null;
      },
    },
    
    // Job preferences
    {
      keywords: ["relocate", "relocation", "willing", "move"],
      getValue: () => profileData.willing_to_relocate || profileData.job_preferences?.willing_to_relocate,
    },
    {
      keywords: ["salary", "compensation", "expected", "pay", "wage"],
      getValue: () => profileData.job_preferences?.salaryExpectation || profileData.salary_expectation,
    },
    {
      keywords: ["remote", "telecommute", "work-from-home", "wfh"],
      getValue: () => profileData.job_preferences?.remote || profileData.remote_preference,
    },
    {
      keywords: ["start", "available", "availability", "join"],
      getValue: () => profileData.job_preferences?.startDate || profileData.availability_date,
    },
    
    // Legal/Compliance
    {
      keywords: ["background", "screening", "check"],
      getValue: () => profileData.background_check_consent,
    },
    {
      keywords: ["drug", "test", "screening"],
      getValue: () => profileData.drug_test_consent,
    },
    {
      keywords: ["criminal", "conviction", "felony"],
      getValue: () => profileData.criminal_history,
    },
    {
      keywords: ["veteran", "military"],
      getValue: () => profileData.veteran_status,
    },
    {
      keywords: ["disability", "disabled"],
      getValue: () => profileData.disability_status,
    },
    {
      keywords: ["citizenship", "authorized", "work-authorization"],
      getValue: () => profileData.work_authorization,
    },
    {
      keywords: ["sponsor", "visa", "h1b"],
      getValue: () => profileData.requires_sponsorship,
    },
    
    // Documents
    {
      keywords: ["resume", "cv"],
      getValue: () => profileData.resume_url || profileData.cv_url,
    },
    {
      keywords: ["cover", "letter", "motivation"],
      getValue: () => profileData.cover_letter || profileData.motivation_letter,
    },
    {
      keywords: ["transcript"],
      getValue: () => profileData.transcript_url,
    },
    
    // References
    {
      keywords: ["reference", "referral", "referred"],
      getValue: () => {
        if (Array.isArray(profileData.references) && profileData.references.length > 0) {
          return `${profileData.references[0].name} - ${profileData.references[0].email}`;
        }
        return profileData.referral_source;
      },
    },
    
    // Demographics (handle carefully)
    {
      keywords: ["gender"],
      getValue: () => profileData.gender,
    },
    {
      keywords: ["race", "ethnicity"],
      getValue: () => profileData.ethnicity,
    },
    {
      keywords: ["dob", "birth", "birthdate"],
      getValue: () => profileData.date_of_birth,
    },
  ];

  // Check all patterns
  for (const pattern of patterns) {
    const matches = pattern.keywords.some(
      (keyword) =>
        context.name.includes(keyword) ||
        context.id.includes(keyword) ||
        context.label.includes(keyword) ||
        context.placeholder.includes(keyword) ||
        context.ariaLabel.includes(keyword) ||
        context.ariaLabelledBy.includes(keyword) ||
        context.context.includes(keyword) ||
        context.siblingText.includes(keyword)
    );

    if (matches) {
      const value = pattern.getValue();
      if (value !== undefined && value !== null && value !== "") {
        console.log(`🎯 Fallback Match: ${context.name || context.id} -> "${value}" (Pattern: ${pattern.keywords.join("|")})`);
        return { value, pattern: pattern.keywords.join("|") };
      }
    }
  }
  
  return null;
}

// Export for use in your existing content script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { findSemanticMatch };
}

function observeDynamic(profileData, mappingConfig, useAI = false) {
  console.log("👁️ Setting up dynamic observation");
  console.log("👁️ AI enabled for dynamic observation:", useAI);

  let debounceTimer = null;

  const observer = new MutationObserver((mutations) => {
    if (debounceTimer) clearTimeout(debounceTimer);

    debounceTimer = setTimeout(async () => {
      let hasNewFields = false;

      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node;
              if (
                element.querySelectorAll?.("input, textarea, select").length >
                  0 ||
                element.matches?.("input, textarea, select")
              ) {
                hasNewFields = true;
              }
            }
          });
        }
      }

      if (hasNewFields) {
        console.log("🔄 New fields detected, re-running filler");
        await handleFillForm(profileData, useAI);
      }
    }, 500);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  return observer;
}

function getValue(obj, keys) {
  let current = obj;
  for (const key of keys) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
}

function isElementVisible(element) {
  const style = window.getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    element.offsetParent !== null &&
    element.offsetWidth > 0 &&
    element.offsetHeight > 0
  );
}

function getFieldLabel(element) {
  if (element.id) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label?.textContent) return label.textContent.trim();
  }

  const parentLabel = element.closest("label");
  if (parentLabel?.textContent) {
    return parentLabel.textContent.replace(element.value || "", "").trim();
  }

  const prevSibling = element.previousElementSibling;
  if (prevSibling?.tagName === "LABEL") {
    return prevSibling.textContent?.trim() || "";
  }

  return "";
}

function showNotification(message, type = "info") {
  try {
    const notification = document.createElement("div");
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
    background: ${
      type === "success" ? "#10b981" : type === "error" ? "#ef4444" : "#3b82f6"
    };
      color: white;
      padding: 12px 20px;
    border-radius: 8px;
    z-index: 10000;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      font-size: 14px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      max-width: 300px;
    word-wrap: break-word;
  `;
    notification.textContent = message;

    document.body.appendChild(notification);

    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 4000);
  } catch (error) {
    console.error("Failed to show notification:", error);
  }
}

console.log("✅ Fillo Advanced Form Filler ready");

window.addEventListener("beforeunload", () => {
  if (currentObserver) {
    currentObserver.disconnect();
  }
});
