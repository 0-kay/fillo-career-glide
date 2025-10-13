(function (ns) {
    const {AI_CONFIG, SEMANTIC_SCORE_THRESHOLD, MAPPING_SCORE_MIN} = ns.config;
    const {getValue, isElementVisible, getFieldLabel, showNotification, relayLog} = ns.utils;
    const {loadMapping} = ns.mapping;
    const {analyzeBatchFieldsWithAI} = ns.ai;
    const {runLLMAutofill} = ns.planner;
    const state = ns.state;

    function buildSelectors(variant) {
        return [`[name="${variant}"]`, `[id="${variant}"]`, `[name*="${variant}"]`, `[id*="${variant}"]`, `[data-testid="${variant}"]`, `[data-automation-id="${variant}"]`, `[placeholder*="${variant}"]`, `.${variant}`];
    }

    function computeScore(element, variant) {
        if (typeof variant !== 'string') return 0;
        let score = 0;
        const name = element.name?.toLowerCase() || '';
        const id = element.id?.toLowerCase() || '';
        const placeholder = element.placeholder?.toLowerCase() || '';
        const className = element.className?.toLowerCase() || '';
        const v = variant.toLowerCase();
        if (name === v || id === v) score += 10;
        if (name.includes(v) || id.includes(v)) score += 7;
        if (element.getAttribute('data-testid') === v) score += 6;
        if (element.getAttribute('data-automation-id') === v) score += 6;
        if (className.includes(v)) score += 5;
        if (placeholder.includes(v)) score += 4;
        const label = (getFieldLabel(element) || '').toLowerCase();
        if (label.includes(v)) score += 3;
        if (element.type === 'email' && v.includes('email')) score += 2;
        if (element.type === 'tel' && v.includes('phone')) score += 2;
        if (element.type === 'url' && (v.includes('website') || v.includes('url'))) score += 2;
        return score;
    }

    function fillElement(element, value) {
        try {
            if (!element || value == null) return false;
            const tag = element.tagName.toLowerCase();
            const type = element.type?.toLowerCase();
            if (tag === 'select') {
                const options = element.querySelectorAll('option');
                for (const o of options) {
                    if (o.value === value || o.textContent.trim() === value) {
                        element.value = o.value;
                        break;
                    }
                }
            } else if (type === 'checkbox' || type === 'radio') {
                element.checked = Boolean(value);
            } else if (type === 'file') {
                return false;
            } else {
                element.value = String(value);
            }
            element.dispatchEvent(new Event('input', {bubbles: true}));
            element.dispatchEvent(new Event('change', {bubbles: true}));
            element.dispatchEvent(new Event('blur', {bubbles: true}));
            return true;
        } catch (e) {
            console.error('Error filling element:', e);
            return false;
        }
    }

    function getElementContext(el) {
        return {
            name: el.name?.toLowerCase() || '',
            id: el.id?.toLowerCase() || '',
            placeholder: el.placeholder?.toLowerCase() || '',
            label: (getFieldLabel(el) || '').toLowerCase(),
            type: el.type?.toLowerCase() || ''
        };
    }

    function findSemanticMatch(ctx, profile) {
        const patterns = [
            {keywords: ['email'], get: () => profile.personal_details?.email},
            {keywords: ['first', 'fname'], get: () => profile.first_name},
            {keywords: ['last', 'lname'], get: () => profile.last_name},
            {
                keywords: ['name', 'fullname'],
                get: () => profile.personal_details?.fullName || `${profile.first_name || ''} ${profile.last_name || ''}`.trim()
            },
            {keywords: ['phone', 'tel'], get: () => profile.personal_details?.phone},
            {keywords: ['address', 'street'], get: () => profile.personal_details?.address},
            {keywords: ['linkedin'], get: () => profile.personal_details?.linkedin},
            {keywords: ['github'], get: () => profile.personal_details?.github},
            {keywords: ['portfolio', 'website'], get: () => profile.personal_details?.portfolio},
            {keywords: ['summary', 'about'], get: () => profile.personal_details?.summary},
            {
                keywords: ['skill', 'technical'],
                get: () => Array.isArray(profile.technical_skills) ? profile.technical_skills.join(', ') : profile.technical_skills?.all?.join(', ')
            },
            {
                keywords: ['soft'],
                get: () => Array.isArray(profile.soft_skills) ? profile.soft_skills.join(', ') : profile.soft_skills?.all?.join(', ')
            },
            {
                keywords: ['tools', 'technologies'],
                get: () => Array.isArray(profile.tools_technologies) ? profile.tools_technologies.join(', ') : null
            },
            {
                keywords: ['language'],
                get: () => Array.isArray(profile.languages) ? profile.languages.map(l => typeof l === 'string' ? l : l.language).filter(Boolean).join(', ') : null
            },
            {keywords: ['relocate', 'relocation'], get: () => profile.willing_to_relocate},
            {keywords: ['background', 'screening'], get: () => profile.background_check_consent},
            {keywords: ['drug', 'test'], get: () => profile.drug_test_consent},
            {keywords: ['criminal', 'conviction'], get: () => profile.criminal_history},
            {keywords: ['salary', 'compensation'], get: () => profile.job_preferences?.salaryExpectation},
            {keywords: ['remote', 'telecommute'], get: () => profile.job_preferences?.remote},
        ];
        for (const p of patterns) {
            const matches = p.keywords.some(k => ctx.name.includes(k) || ctx.id.includes(k) || ctx.label.includes(k) || ctx.placeholder.includes(k));
            if (matches) {
                const v = p.get();
                if (v) return {value: v, pattern: p.keywords.join('|')};
            }
        }
        return null;
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
                if (v && typeof v === 'string') {
                    const fieldPath = `${path.replace('[]', '')}.${k}`;
                    const fieldVariants = variants.map(vr => `${vr}_${k}`);
                    await processSingleField(fieldPath, fieldVariants, v);
                }
            }
        }
        return true;
    }

    async function enhancedFallbackMatch(profileData, mappingConfig, useAI) {
        const formEls = document.querySelectorAll('input, select, textarea');
        let filled = 0, totalMatches = 0, aiFilled = 0;
        const batchAIFields = [];
        for (const el of formEls) {
            if (!isElementVisible(el)) continue;
            const fieldInfo = {
                element: el,
                name: el.name || '',
                id: el.id || '',
                type: el.type || 'text',
                placeholder: el.placeholder || '',
                label: getFieldLabel(el) || '',
                className: el.className || '',
                context: getElementContext(el),
                required: el.required || el.hasAttribute('required'),
                maxLength: el.maxLength > 0 ? el.maxLength : null
            };
            let matched = false;
            for (const m of mappingConfig) {
                let best = 0;
                const variants = Array.isArray(m.variants) ? m.variants : [];
                for (const v of variants) {
                    if (typeof v !== 'string') continue;
                    const s = computeScore(el, v);
                    if (s > best) best = s;
                }
                if (best > SEMANTIC_SCORE_THRESHOLD) {
                    const val = getValue(profileData, m.path.replace('[]', '').split('.'));
                    if (val != null && val !== '') {
                        await processSingleField(m.path, m.variants, val);
                        filled++;
                        totalMatches++;
                        matched = true;
                        break;
                    }
                }
            }
            if (!matched && useAI && AI_CONFIG.enabled) {
                batchAIFields.push({...fieldInfo, context: {...fieldInfo.context}});
            }
            if (!matched && !useAI) {
                const sem = findSemanticMatch(getElementContext(el), profileData);
                console.log('Semantic Match:', sem);
                if (sem) {
                    fillElement(el, sem.value);
                    filled++;
                    totalMatches++;
                }
            }
        }
        if (batchAIFields.length > 0 && useAI && AI_CONFIG.enabled) {
            relayLog('log', '🧠 Processing fields with Batch AI...', { count: batchAIFields.length });
            const results = await analyzeBatchFieldsWithAI(batchAIFields, profileData, mappingConfig);
            relayLog('log', '🧠 Batch AI returned results:', { count: results.length });
            for (const r of results) {
                if (r && r.shouldFill && r.fieldIndex < batchAIFields.length) {
                    const el = batchAIFields[r.fieldIndex].element;
                    try {
                        if (fillElement(el, r.value)) {
                            filled++;
                            aiFilled++;
                            totalMatches++;
                        }
                    } catch (e) {
                        console.error('AI fill failed:', e);
                    }
                }
            }
        }
        return {filled, total: formEls.length, aiMatches: aiFilled};
    }

    ns.engine.handleFillForm = async function (profileData, useAI = false) {
        try {
            relayLog('info', '🚀 Starting fill run', { useAI, url: location.href });
            try {
                await runLLMAutofill({profileId: profileData?.id});
            } catch (e) {
                console.warn('LLM planner failed or disabled:', e?.message || e);
            }
            let mappingConfig = [];
            try {
                mappingConfig = await loadMapping();
            } catch (e) {
                console.warn('Mapping load failed:', e.message);
                mappingConfig = [];
            }
            if (state.currentObserver) {
                state.currentObserver.disconnect();
                state.currentObserver = null;
            }
            let totalFilled = 0, totalAttempted = 0;
            if (mappingConfig.length > 0) {
                for (const {path, variants, isArray} of mappingConfig) {
                    totalAttempted++;
                    const keys = path.replace('[]', '').split('.');
                    const val = getValue(profileData, keys);
                    if (val == null) continue;
                    if (isArray && Array.isArray(val)) {
                        const ok = await processArrayField(path, variants, val);
                        if (ok) totalFilled++;
                    } else {
                        const ok = await processSingleField(path, variants, val);
                        if (ok) totalFilled++;
                    }
                    await new Promise(r => setTimeout(r, 100));
                }
            }
            const fb = await enhancedFallbackMatch(profileData, mappingConfig, useAI);
            const aiMatches = fb.aiMatches || 0;
            state.currentObserver = ns.engine.observeDynamic(profileData, mappingConfig, useAI);
            const filled = totalFilled + (fb.filled || 0);
            const summary = { filled, aiMatches, attempted: totalAttempted };
            relayLog('info', '✅ Fill run completed', summary);
            showNotification(`⚡ Filled ${filled} fields${useAI ? ` with AI (${aiMatches} AI matches)` : ''}`, 'success');
            return {
                filled,
                attempted: totalAttempted,
                aiMatches,
                message: `Form filling completed: ${totalFilled} mappings + ${(fb.filled || 0)} fallback`
            };
        } catch (e) {
            ns.utils.showNotification('❌ Form filling failed: ' + e.message, 'error');
            throw e;
        } finally {
            ns.state.isProcessing = false;
        }
    };

    ns.engine.observeDynamic = function (profileData, mappingConfig, useAI = false) {
        let timer = null;
        const obs = new MutationObserver((mutations) => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(async () => {
                let hasNew = false;
                for (const m of mutations) {
                    if (m.type === 'childList') {
                        m.addedNodes.forEach(node => {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                const el = node;
                                if (el.querySelectorAll?.('input,textarea,select').length > 0 || el.matches?.('input,textarea,select')) hasNew = true;
                            }
                        });
                    }
                }
                if (hasNew) await ns.engine.handleFillForm(profileData, useAI);
            }, 500);
        });
        obs.observe(document.body, {childList: true, subtree: true});
        return obs;
    };
})(window.__Fillo);