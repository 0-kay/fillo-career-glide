(function (ns) {
  const { AI_CONFIG, SEMANTIC_SCORE_THRESHOLD, MAPPING_SCORE_MIN } = ns.config;
  const {
    getValue,
    isElementVisible,
    getFieldLabel,
    showNotification,
    relayLog,
  } = ns.utils;
  const { loadMapping } = ns.mapping;
  const { analyzeBatchFieldsWithAI } = ns.ai;
  const { runLLMAutofill } = ns.planner;
  const state = ns.state;

  function buildSelectors(variant) {
    return [
      `[name="${variant}"]`,
      `[id="${variant}"]`,
      `[name*="${variant}"]`,
      `[id*="${variant}"]`,
      `[data-testid="${variant}"]`,
      `[data-automation-id="${variant}"]`,
      `[placeholder*="${variant}"]`,
      `.${variant}`,
    ];
  }

  function computeScore(element, variant) {
    if (typeof variant !== "string") return 0;
    let score = 0;
    const name = element.name?.toLowerCase() || "";
    const id = element.id?.toLowerCase() || "";
    const placeholder = element.placeholder?.toLowerCase() || "";
    const className = element.className?.toLowerCase() || "";
    const v = variant.toLowerCase();
    if (name === v || id === v) score += 10;
    if (name.includes(v) || id.includes(v)) score += 7;
    if (element.getAttribute("data-testid") === v) score += 6;
    if (element.getAttribute("data-automation-id") === v) score += 6;
    if (className.includes(v)) score += 5;
    if (placeholder.includes(v)) score += 4;
    const label = (getFieldLabel(element) || "").toLowerCase();
    if (label.includes(v)) score += 3;
    if (element.type === "email" && v.includes("email")) score += 2;
    if (element.type === "tel" && v.includes("phone")) score += 2;
    if (element.type === "url" && (v.includes("website") || v.includes("url")))
      score += 2;
    return score;
  }

  function fillElement(element, value) {
    try {
      if (!element || value == null) return false;
      const tag = element.tagName.toLowerCase();
      const type = element.type?.toLowerCase();
      if (tag === "select") {
        const options = element.querySelectorAll("option");
        for (const o of options) {
          if (o.value === value || o.textContent.trim() === value) {
            element.value = o.value;
            break;
          }
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
    } catch (e) {
      console.error("Error filling element:", e);
      return false;
    }
  }

  function getElementContext(el) {
    return {
      name: el.name?.toLowerCase() || "",
      id: el.id?.toLowerCase() || "",
      placeholder: el.placeholder?.toLowerCase() || "",
      label: (getFieldLabel(el) || "").toLowerCase(),
      type: el.type?.toLowerCase() || "",
    };
  }

  // function findSemanticMatch(ctx, profile) {
  //     const patterns = [
  //         {keywords: ['email'], get: () => profile.personal_details?.email},
  //         {keywords: ['first', 'fname'], get: () => profile.first_name},
  //         {keywords: ['last', 'lname'], get: () => profile.last_name},
  //         {
  //             keywords: ['name', 'fullname'],
  //             get: () => profile.personal_details?.fullName || `${profile.first_name || ''} ${profile.last_name || ''}`.trim()
  //         },
  //         {keywords: ['phone', 'tel'], get: () => profile.personal_details?.phone},
  //         {keywords: ['address', 'street'], get: () => profile.personal_details?.address},
  //         {keywords: ['linkedin'], get: () => profile.personal_details?.linkedin},
  //         {keywords: ['github'], get: () => profile.personal_details?.github},
  //         {keywords: ['portfolio', 'website'], get: () => profile.personal_details?.portfolio},
  //         {keywords: ['summary', 'about'], get: () => profile.personal_details?.summary},
  //         {
  //             keywords: ['skill', 'technical'],
  //             get: () => Array.isArray(profile.technical_skills) ? profile.technical_skills.join(', ') : profile.technical_skills?.all?.join(', ')
  //         },
  //         {
  //             keywords: ['soft'],
  //             get: () => Array.isArray(profile.soft_skills) ? profile.soft_skills.join(', ') : profile.soft_skills?.all?.join(', ')
  //         },
  //         {
  //             keywords: ['tools', 'technologies'],
  //             get: () => Array.isArray(profile.tools_technologies) ? profile.tools_technologies.join(', ') : null
  //         },
  //         {
  //             keywords: ['language'],
  //             get: () => Array.isArray(profile.languages) ? profile.languages.map(l => typeof l === 'string' ? l : l.language).filter(Boolean).join(', ') : null
  //         },
  //         {keywords: ['relocate', 'relocation'], get: () => profile.willing_to_relocate},
  //         {keywords: ['background', 'screening'], get: () => profile.background_check_consent},
  //         {keywords: ['drug', 'test'], get: () => profile.drug_test_consent},
  //         {keywords: ['criminal', 'conviction'], get: () => profile.criminal_history},
  //         {keywords: ['salary', 'compensation'], get: () => profile.job_preferences?.salaryExpectation},
  //         {keywords: ['remote', 'telecommute'], get: () => profile.job_preferences?.remote},
  //     ];
  //     for (const p of patterns) {
  //         const matches = p.keywords.some(k => ctx.name.includes(k) || ctx.id.includes(k) || ctx.label.includes(k) || ctx.placeholder.includes(k));
  //         if (matches) {
  //             const v = p.get();
  //             if (v) return {value: v, pattern: p.keywords.join('|')};
  //         }
  //     }
  //     return null;
  // }

  // Enhanced findSemanticMatch function with better fallback coverage
  // This function is called when a field is NOT found in matching_fields.json
  // It uses intelligent pattern matching to fill unmapped fields

  function findSemanticMatch(context, profileData) {
    const patterns = [
      // Basic contact info
      {
        keywords: ["email", "e-mail", "mail", "electronic"],
        getValue: () =>
          profileData.personal_details?.email || profileData.email,
      },
      {
        keywords: ["first", "fname", "given", "forename"],
        getValue: () =>
          profileData.first_name || profileData.personal_details?.first_name,
      },
      {
        keywords: ["last", "lname", "surname", "family"],
        getValue: () =>
          profileData.last_name || profileData.personal_details?.last_name,
      },
      {
        keywords: ["middle", "mname"],
        getValue: () =>
          profileData.middle_name || profileData.personal_details?.middle_name,
      },
      {
        keywords: ["name", "fullname", "full_name", "full-name"],
        getValue: () =>
          profileData.personal_details?.fullName ||
          profileData.name ||
          profileData.full_name ||
          `${profileData.first_name || ""} ${
            profileData.last_name || ""
          }`.trim(),
      },
      {
        keywords: ["phone", "tel", "mobile", "contact", "cell"],
        getValue: () =>
          profileData.personal_details?.phone || profileData.phone,
      },

      // Address fields
      {
        keywords: ["address", "street", "addr", "address1", "line1"],
        getValue: () =>
          profileData.personal_details?.address || profileData.address,
      },
      {
        keywords: ["address2", "line2", "apt", "suite", "unit"],
        getValue: () =>
          profileData.personal_details?.address2 || profileData.address2,
      },
      {
        keywords: ["city", "town", "locality"],
        getValue: () => profileData.personal_details?.city || profileData.city,
      },
      {
        keywords: ["state", "province", "region"],
        getValue: () =>
          profileData.personal_details?.state || profileData.state,
      },
      {
        keywords: ["zip", "postal", "postcode", "pincode"],
        getValue: () =>
          profileData.personal_details?.zipCode ||
          profileData.zipCode ||
          profileData.postal_code,
      },
      {
        keywords: ["country", "nation"],
        getValue: () =>
          profileData.personal_details?.country || profileData.country,
      },

      // Social/Professional links
      {
        keywords: ["linkedin", "linked-in"],
        getValue: () =>
          profileData.personal_details?.linkedin || profileData.linkedin,
      },
      {
        keywords: ["github", "git"],
        getValue: () =>
          profileData.personal_details?.github || profileData.github,
      },
      {
        keywords: ["portfolio", "website", "url", "site"],
        getValue: () =>
          profileData.personal_details?.portfolio ||
          profileData.portfolio ||
          profileData.website,
      },
      {
        keywords: ["twitter", "tweet"],
        getValue: () =>
          profileData.personal_details?.twitter || profileData.twitter,
      },

      // Professional info
      {
        keywords: ["summary", "about", "bio", "profile", "objective"],
        getValue: () =>
          profileData.personal_details?.summary ||
          profileData.summary ||
          profileData.bio,
      },
      {
        keywords: ["company", "employer", "organization", "current-company"],
        getValue: () => {
          if (
            Array.isArray(profileData.work_experience) &&
            profileData.work_experience.length > 0
          ) {
            return profileData.work_experience[0].company;
          }
          return profileData.current_company;
        },
      },
      {
        keywords: ["position", "title", "job", "role", "current-title"],
        getValue: () => {
          if (
            Array.isArray(profileData.work_experience) &&
            profileData.work_experience.length > 0
          ) {
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
        keywords: [
          "school",
          "university",
          "college",
          "education",
          "institution",
        ],
        getValue: () => {
          if (
            Array.isArray(profileData.education_history) &&
            profileData.education_history.length > 0
          ) {
            return profileData.education_history[0].school;
          }
          return null;
        },
      },
      {
        keywords: ["degree", "qualification"],
        getValue: () => {
          if (
            Array.isArray(profileData.education_history) &&
            profileData.education_history.length > 0
          ) {
            return profileData.education_history[0].degree;
          }
          return null;
        },
      },
      {
        keywords: ["major", "field", "study"],
        getValue: () => {
          if (
            Array.isArray(profileData.education_history) &&
            profileData.education_history.length > 0
          ) {
            return profileData.education_history[0].field_of_study;
          }
          return null;
        },
      },
      {
        keywords: ["gpa", "grade"],
        getValue: () => {
          if (
            Array.isArray(profileData.education_history) &&
            profileData.education_history.length > 0
          ) {
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
        getValue: () =>
          profileData.willing_to_relocate ||
          profileData.job_preferences?.willing_to_relocate,
      },
      {
        keywords: ["salary", "compensation", "expected", "pay", "wage"],
        getValue: () =>
          profileData.job_preferences?.salaryExpectation ||
          profileData.salary_expectation,
      },
      {
        keywords: ["remote", "telecommute", "work-from-home", "wfh"],
        getValue: () =>
          profileData.job_preferences?.remote || profileData.remote_preference,
      },
      {
        keywords: ["start", "available", "availability", "join"],
        getValue: () =>
          profileData.job_preferences?.startDate ||
          profileData.availability_date,
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
        getValue: () =>
          profileData.cover_letter || profileData.motivation_letter,
      },
      {
        keywords: ["transcript"],
        getValue: () => profileData.transcript_url,
      },

      // References
      {
        keywords: ["reference", "referral", "referred"],
        getValue: () => {
          if (
            Array.isArray(profileData.references) &&
            profileData.references.length > 0
          ) {
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
          console.log(
            `🎯 Fallback Match: ${
              context.name || context.id
            } -> "${value}" (Pattern: ${pattern.keywords.join("|")})`
          );
          return { value, pattern: pattern.keywords.join("|") };
        }
      }
    }

    return null;
  }

  // Export for use in your existing content script
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { findSemanticMatch };
  }

  async function processSingleField(path, variants, value) {
    for (const variant of variants) {
      const selectors = buildSelectors(variant);
      for (const sel of selectors) {
        const elements = document.querySelectorAll(sel);
        for (const el of elements) {
          if (!isElementVisible(el) || el.value?.trim()) continue;
          const score = computeScore(el, variant);
          if (score >= MAPPING_SCORE_MIN) {
            if (fillElement(el, value)) {
              console.log(`Filled ${path}: ${sel} (score: ${score})`);
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  async function processArrayField(path, variants, values) {
    if (Array.isArray(values) && values.length > 0) {
      const first = values[0];
      for (const [k, v] of Object.entries(first)) {
        if (v && typeof v === "string") {
          const fieldPath = `${path.replace("[]", "")}.${k}`;
          const fieldVariants = variants.map((vr) => `${vr}_${k}`);
          await processSingleField(fieldPath, fieldVariants, v);
        }
      }
    }
    return true;
  }

  //   async function enhancedFallbackMatch(profileData, mappingConfig, useAI) {
  //     const formEls = document.querySelectorAll("input, select, textarea");
  //     let filled = 0,
  //       totalMatches = 0,
  //       aiFilled = 0;
  //     const batchAIFields = [];
  //     for (const el of formEls) {
  //       if (!isElementVisible(el)) continue;
  //       const fieldInfo = {
  //         element: el,
  //         name: el.name || "",
  //         id: el.id || "",
  //         type: el.type || "text",
  //         placeholder: el.placeholder || "",
  //         label: getFieldLabel(el) || "",
  //         className: el.className || "",
  //         context: getElementContext(el),
  //         required: el.required || el.hasAttribute("required"),
  //         maxLength: el.maxLength > 0 ? el.maxLength : null,
  //       };
  //       let matched = false;
  //       for (const m of mappingConfig) {
  //         let best = 0;
  //         const variants = Array.isArray(m.variants) ? m.variants : [];
  //         for (const v of variants) {
  //           if (typeof v !== "string") continue;
  //           const s = computeScore(el, v);
  //           if (s > best) best = s;
  //         }
  //         if (best > SEMANTIC_SCORE_THRESHOLD) {
  //           const val = getValue(
  //             profileData,
  //             m.path.replace("[]", "").split(".")
  //           );
  //           if (val != null && val !== "") {
  //             await processSingleField(m.path, m.variants, val);
  //             filled++;
  //             totalMatches++;
  //             matched = true;
  //             break;
  //           }
  //         }
  //       }
  //       if (!matched && useAI && AI_CONFIG.enabled) {
  //         batchAIFields.push({ ...fieldInfo, context: { ...fieldInfo.context } });
  //       }
  //       if (!matched && !useAI) {
  //         const sem = findSemanticMatch(getElementContext(el), profileData);
  //         console.log("Semantic Match:", sem);
  //         if (sem) {
  //           fillElement(el, sem.value);
  //           filled++;
  //           totalMatches++;
  //         }
  //       }
  //     }
  //     if (batchAIFields.length > 0 && useAI && AI_CONFIG.enabled) {
  //       relayLog("log", "🧠 Processing fields with Batch AI...", {
  //         count: batchAIFields.length,
  //       });
  //       const results = await analyzeBatchFieldsWithAI(
  //         batchAIFields,
  //         profileData,
  //         mappingConfig
  //       );
  //       relayLog("log", "🧠 Batch AI returned results:", {
  //         count: results.length,
  //       });
  //       for (const r of results) {
  //         if (r && r.shouldFill && r.fieldIndex < batchAIFields.length) {
  //           const el = batchAIFields[r.fieldIndex].element;
  //           try {
  //             if (fillElement(el, r.value)) {
  //               filled++;
  //               aiFilled++;
  //               totalMatches++;
  //             }
  //           } catch (e) {
  //             console.error("AI fill failed:", e);
  //           }
  //         }
  //       }
  //     }
  //     return { filled, total: formEls.length, aiMatches: aiFilled };
  //   }

  // FIXED: The issue is in enhancedFallbackMatch function
  // The semantic fallback wasn't being called properly

  async function enhancedFallbackMatch(profileData, mappingConfig, useAI, pastMisses) {
    const formEls = document.querySelectorAll("input, select, textarea");
    let filled = 0,
      totalMatches = 0,
      aiFilled = 0;
    const batchAIFields = [];

    for (const el of formEls) {
      if (!isElementVisible(el) || el.value?.trim()) continue; // Skip if already filled

      const fieldInfo = {
        element: el,
        name: el.name || "",
        id: el.id || "",
        type: el.type || "text",
        placeholder: el.placeholder || "",
        label: getFieldLabel(el) || "",
        className: el.className || "",
        context: getElementContext(el),
        required: el.required || el.hasAttribute("required"),
        maxLength: el.maxLength > 0 ? el.maxLength : null,
      };

      let matched = false;

      // First: Try direct mapping with high score threshold
      for (const m of mappingConfig) {
        let best = 0;
        const variants = Array.isArray(m.variants) ? m.variants : [];
        for (const v of variants) {
          if (typeof v !== "string") continue;
          const s = computeScore(el, v);
          if (s > best) best = s;
        }
        if (best > SEMANTIC_SCORE_THRESHOLD) {
          const val = getValue(
            profileData,
            m.path.replace("[]", "").split(".")
          );
          if (val != null && val !== "") {
            if (fillElement(el, val)) {
              filled++;
              totalMatches++;
              matched = true;
              console.log(`✅ Direct mapping: ${el.name || el.id} -> "${val}"`);
              break;
            }
          }
        }
      }

      // Second: If not matched by direct mapping, try semantic fallback OR AI
      if (!matched) {
        if (useAI && AI_CONFIG.enabled) {
          // Queue for AI batch processing
          batchAIFields.push({
            ...fieldInfo,
            context: { ...fieldInfo.context },
          });
        } else {
          // Use semantic fallback immediately
          const sem = findSemanticMatch(fieldInfo.context, profileData);
          if (sem) {
            if (fillElement(el, sem.value)) {
              filled++;
              totalMatches++;
              console.log(
                `🎯 Semantic fallback: ${el.name || el.id} -> "${
                  sem.value
                }" (Pattern: ${sem.pattern})`
              );
            }
          }
        }
      }
    }

    // Third: Process AI batch if enabled and we have queued fields
    if (batchAIFields.length > 0 && useAI && AI_CONFIG.enabled) {
      relayLog("log", "🧠 Processing fields with Batch AI...", {
        count: batchAIFields.length,
      });

      try {
        const results = await analyzeBatchFieldsWithAI(
          batchAIFields,
          profileData,
          mappingConfig,
          pastMisses
        );

        relayLog("log", "🧠 Batch AI returned results:", {
          count: results.length,
        });

        for (const r of results) {
          if (r && r.shouldFill && r.fieldIndex < batchAIFields.length) {
            const el = batchAIFields[r.fieldIndex].element;
            try {
              if (fillElement(el, r.value)) {
                filled++;
                aiFilled++;
                totalMatches++;
                console.log(`🧠 AI fill: ${el.name || el.id} -> "${r.value}"`);
              }
            } catch (e) {
              console.error("AI fill failed:", e);
            }
          }
        }
      } catch (aiError) {
        console.error("❌ AI batch processing failed:", aiError);

        // FALLBACK: If AI fails, use semantic matching on queued fields
        console.log(
          "🔄 AI failed, falling back to semantic matching for queued fields"
        );
        for (const fieldInfo of batchAIFields) {
          const el = fieldInfo.element;
          if (el.value?.trim()) continue; // Skip if filled by another process

          const sem = findSemanticMatch(fieldInfo.context, profileData);
          if (sem) {
            if (fillElement(el, sem.value)) {
              filled++;
              totalMatches++;
              console.log(
                `🎯 Semantic fallback (post-AI-fail): ${el.name || el.id} -> "${
                  sem.value
                }"`
              );
            }
          }
        }
      }
    }

    return { filled, total: formEls.length, aiMatches: aiFilled };
  }

  ns.engine.handleFillForm = async function (profileData, useAI = false, pastMisses = []) {
    try {
      relayLog("info", "🚀 Starting fill run", { useAI, url: location.href });
      try {
        await runLLMAutofill({ profileId: profileData?.id });
      } catch (e) {
        console.warn("LLM planner failed or disabled:", e?.message || e);
      }
      let mappingConfig = [];
      try {
        mappingConfig = await loadMapping();
      } catch (e) {
        console.warn("Mapping load failed:", e.message);
        mappingConfig = [];
      }
      if (state.currentObserver) {
        state.currentObserver.disconnect();
        state.currentObserver = null;
      }
      let totalFilled = 0,
        totalAttempted = 0;
      if (mappingConfig.length > 0) {
        for (const { path, variants, isArray } of mappingConfig) {
          totalAttempted++;
          const keys = path.replace("[]", "").split(".");
          const val = getValue(profileData, keys);
          if (val == null) continue;
          if (isArray && Array.isArray(val)) {
            const ok = await processArrayField(path, variants, val);
            if (ok) totalFilled++;
          } else {
            const ok = await processSingleField(path, variants, val);
            if (ok) totalFilled++;
          }
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      const fb = await enhancedFallbackMatch(profileData, mappingConfig, useAI, pastMisses);
      const aiMatches = fb.aiMatches || 0;

      // Identify missed fields for fallback report
      const missedFields = ns.engine.getMissedFields();
      if (missedFields.length > 0) {
        console.log(`📋 Found ${missedFields.length} missed fields:`, missedFields);
        chrome.runtime.sendMessage({
          action: 'SAVE_MISSED_FIELDS',
          missedFields: missedFields,
          profileId: profileData.id,
          profileData: profileData,
          pageUrl: window.location.href
        });
      }

      state.currentObserver = ns.engine.observeDynamic(
        profileData,
        mappingConfig,
        useAI
      );
      const filled = totalFilled + (fb.filled || 0);
      const summary = { filled, aiMatches, attempted: totalAttempted, missedCount: missedFields.length };
      relayLog("info", "✅ Fill run completed", summary);
      showNotification(
        `⚡ Filled ${filled} fields${
          useAI ? ` with AI (${aiMatches} AI matches)` : ""
        }`,
        "success"
      );
      return {
        filled,
        attempted: totalAttempted,
        aiMatches,
        missedFields: missedFields,
        message: `Form filling completed: ${totalFilled} mappings + ${
          fb.filled || 0
        } fallback. ${missedFields.length} fields still empty.`,
      };
    } catch (e) {
      ns.utils.showNotification(
        "❌ Form filling failed: " + e.message,
        "error"
      );
      throw e;
    } finally {
      ns.state.isProcessing = false;
    }
  };

  ns.engine.observeDynamic = function (
    profileData,
    mappingConfig,
    useAI = false
  ) {
    let timer = null;
    const obs = new MutationObserver((mutations) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        let hasNew = false;
        for (const m of mutations) {
          if (m.type === "childList") {
            m.addedNodes.forEach((node) => {
              if (node.nodeType === Node.ELEMENT_NODE) {
                const el = node;
                if (
                  el.querySelectorAll?.("input,textarea,select").length > 0 ||
                  el.matches?.("input,textarea,select")
                )
                  hasNew = true;
              }
            });
          }
        }
        if (hasNew) await ns.engine.handleFillForm(profileData, useAI);
      }, 500);
    });
    obs.observe(document.body, { childList: true, subtree: true });
    return obs;
  };

  ns.engine.getMissedFields = function() {
    const inputs = document.querySelectorAll('input, select, textarea');
    const missed = [];

    inputs.forEach(el => {
      // Use ns.utils instead of direct access if they are namespaced
      if (!ns.utils.isElementVisible(el) || el.disabled || el.readOnly) return;
      const val = el.value?.trim();
      if (val && el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'file') return;
      if ((el.type === 'checkbox' || el.type === 'radio') && el.checked) return;

      missed.push({
        id: el.id || '',
        name: el.name || '',
        placeholder: el.placeholder || '',
        label: ns.utils.getFieldLabel(el) || '',
        type: el.type || 'text',
        tagName: el.tagName.toLowerCase()
      });
    });

    return missed;
  };
})(window.__Fillo);