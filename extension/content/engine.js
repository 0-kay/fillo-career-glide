(function (ns) {
    const {AI_CONFIG, MAPPING_SCORE_MIN} = ns.config;
    const {getValue, isElementVisible, getFieldLabel, showNotification, relayLog} = ns.utils;
    const {loadMapping, getPlatformFields} = ns.mapping;
    const {analyzeBatchFieldsWithAI} = ns.ai;
    const {runLLMAutofill} = ns.planner;
    // NOTE: detectPlatform is looked up at call time (not destructured) to avoid
    // stale references when scripts are dynamically injected.
    const state = ns.state;

    // --- User-interaction tracking (persists across re-fills) ---
    const userTouchedFieldIds = new Set();
    const unknownFieldLogIds = new Set();
    let lastUserInputTime = 0;
    const MIN_SCREENING_CONFIDENCE = 60;

    // Furthest absolute Y position the fill has scrolled to in the current run.
    // scrollForwardIntoView() uses this to guarantee the viewport only ever moves
    // downward, so the page fills strictly top-to-bottom and never jumps back up.
    // Reset to -Infinity at the start of every fill run.
    let fillScrollCursor = Number.NEGATIVE_INFINITY;

    const workdayDropdownSelector = [
        '[data-automation-id="multiselectListBox"]',
        '[data-automation-id="listBox"]',
        '[role="listbox"]',
        '[data-automation-id*="popup"]',
        '[data-automation-id*="menu"]'
    ].join(', ');

    function dispatchKey(target, key, code = key, keyCode = 0) {
        if (!target?.dispatchEvent) return;
        const evt = { bubbles: true, cancelable: true, key, code, keyCode, which: keyCode };
        target.dispatchEvent(new KeyboardEvent('keydown', evt));
        target.dispatchEvent(new KeyboardEvent('keyup', evt));
    }

    function clickLikeUser(target) {
        if (!target?.dispatchEvent) return;
        const Pointer = window.PointerEvent || MouseEvent;
        target.dispatchEvent(new Pointer('pointerdown', { bubbles: true, cancelable: true }));
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        target.dispatchEvent(new Pointer('pointerup', { bubbles: true, cancelable: true }));
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        target.click?.();
    }

    function getWorkdayReactProps(element) {
        if (!element) return null;
        for (const key in element) {
            if (key.startsWith('__reactProps')) return element[key];
        }
        return null;
    }

    function callWorkdayReactHandler(element, handlerName, value) {
        const props = getWorkdayReactProps(element);
        const handler = props?.[handlerName];
        if (typeof handler !== 'function') return false;

        try {
            handler({
                target: element,
                currentTarget: element,
                preventDefault: () => {},
                stopPropagation: () => {}
            });
            return true;
        } catch (error) {
            console.warn(`[Fillo] Workday React ${handlerName} handler failed:`, error);
            return false;
        }
    }

    function fillWorkdayReactTextInput(input, value) {
        if (!input || !window.location.hostname.endsWith('.myworkdayjobs.com')) return false;
        const props = getWorkdayReactProps(input);
        if (!props) return false;

        const strValue = String(value ?? '');
        input.value = strValue;
        let called = false;
        if (typeof props.onChange === 'function') {
            called = callWorkdayReactHandler(input, 'onChange', strValue) || called;
        }
        if (typeof props.onBlur === 'function') {
            called = callWorkdayReactHandler(input, 'onBlur', strValue) || called;
        }
        return called;
    }

    function nudgeWorkdaySearchableInput(input, value) {
        if (!input || !window.location.hostname.endsWith('.myworkdayjobs.com')) return false;
        const props = getWorkdayReactProps(input);
        if (typeof props?.onKeyDown !== 'function') return false;

        const strValue = String(value ?? '');
        try {
            props.onKeyDown({
                key: 'Tab',
                target: { value: strValue },
                currentTarget: { value: strValue },
                preventDefault: () => {},
                stopPropagation: () => {}
            });
            return true;
        } catch (error) {
            console.warn('[Fillo] Workday searchable input React keydown failed:', error);
            return false;
        }
    }

    // Bring an element into view WITHOUT ever scrolling the viewport upward. Tracks
    // the furthest point reached in fillScrollCursor; any target above that point is
    // left where it is (filled in place, no scroll) so the page advances strictly
    // top-to-bottom. Only scrolls when the target sits below the current viewport.
    function scrollForwardIntoView(el) {
        try {
            if (!el?.getBoundingClientRect) return;
            const rect = el.getBoundingClientRect();
            if (!rect || (rect.width === 0 && rect.height === 0)) return;
            const absoluteTop = rect.top + window.scrollY;
            // Never go backward: skip anything above the furthest point reached.
            if (absoluteTop < fillScrollCursor) return;
            fillScrollCursor = absoluteTop;
            // Scroll down only when the field is below the fold; keep a little context
            // above it. Math.max(window.scrollY, ...) guarantees we never scroll up.
            const margin = 120;
            if (rect.bottom > window.innerHeight) {
                window.scrollTo({ top: Math.max(window.scrollY, absoluteTop - margin), behavior: 'auto' });
            }
        } catch (_) {}
    }

    function getOpenWorkdayDropdowns() {
        return Array.from(document.querySelectorAll(workdayDropdownSelector)).filter(isElementVisible);
    }

    function normalizeSelectText(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/\*/g, ' ')
            .replace(/&/g, ' and ')
            .replace(/[^a-z0-9+]+/g, ' ')
            .replace(/\b(of|the|and|selected|select|country|territory)\b/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function canonicalCountryText(text) {
        const normalized = normalizeSelectText(text);
        const compact = normalized.replace(/\s+/g, '');
        if (['us', 'usa', 'unitedstates', 'unitedstatesamerica'].includes(compact)) return 'united states';
        if (['uk', 'gb', 'gbr', 'greatbritain', 'unitedkingdom'].includes(compact)) return 'united kingdom';
        return normalized;
    }

    function selectionTextMatches(actual, expected) {
        const actualNorm = normalizeSelectText(actual);
        const expectedNorm = normalizeSelectText(expected);
        if (!actualNorm || !expectedNorm) return false;
        if (actualNorm === expectedNorm || actualNorm.includes(expectedNorm) || expectedNorm.includes(actualNorm)) return true;

        const actualCountry = canonicalCountryText(actual);
        const expectedCountry = canonicalCountryText(expected);
        if (actualCountry && expectedCountry && actualCountry === expectedCountry) return true;

        const actualDialCode = actualNorm.match(/\+\d+/)?.[0];
        const expectedDialCode = expectedNorm.match(/\+\d+/)?.[0];
        return !!actualDialCode && actualDialCode === expectedDialCode;
    }

    function getWorkdayOptionLabel(optionEl) {
        if (!optionEl) return '';
        return optionEl.getAttribute?.('data-automation-label') ||
            optionEl.querySelector?.('[data-automation-id="promptOption"]')?.getAttribute?.('data-automation-label') ||
            optionEl.querySelector?.('[data-automation-id="promptOption"]')?.textContent ||
            optionEl.getAttribute?.('aria-label')?.replace(/\s+(not checked|checked|selected)$/i, '') ||
            optionEl.textContent ||
            '';
    }

    function cleanChoiceOptions(options) {
        const seen = new Set();
        const cleaned = [];
        for (const option of options || []) {
            const text = String(option || '').replace(/\s+/g, ' ').trim();
            if (!text || /^(select|choose|please|make a selection)\b/i.test(text)) continue;
            const key = text.toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            cleaned.push(text);
        }
        return cleaned;
    }

    function scoreExactFirstOption(optionText, wantedValue) {
        const option = normalizeSelectText(optionText);
        const wanted = normalizeSelectText(wantedValue);
        if (!option || !wanted || /^(select one|select|choose one|none)$/.test(option)) return -1;
        if (option === wanted) return 100;
        if (canonicalCountryText(optionText) === canonicalCountryText(wantedValue)) return 98;

        const optionDialCode = option.match(/\+\d+/)?.[0];
        const wantedDialCode = wanted.match(/\+\d+/)?.[0];
        if (optionDialCode && wantedDialCode && optionDialCode === wantedDialCode) return 96;

        if (option.startsWith(wanted)) return 85;
        if (option.includes(wanted)) return 70;
        if (wanted.includes(option) && option.length > 2) return 45;

        const wantedWords = wanted.split(/\s+/).filter(w => w.length > 1);
        if (!wantedWords.length) return 0;
        const optionWords = option.split(/\s+/);
        const hits = wantedWords.filter(w => optionWords.some(ow => ow === w || ow.includes(w) || w.includes(ow))).length;
        return Math.floor((hits / wantedWords.length) * 60);
    }

    function flattenSkillValues(value) {
        const out = [];
        const add = (item) => {
            if (item == null) return;
            if (typeof item === 'string') {
                for (const part of item.split(',')) {
                    const clean = part.trim();
                    if (clean && !/^\[object object\]$/i.test(clean)) out.push(clean);
                }
                return;
            }
            if (Array.isArray(item)) {
                for (const child of item) add(child);
                return;
            }
            if (typeof item === 'object') {
                const direct = item.skill || item.name || item.label || item.title || item.value;
                if (direct) add(direct);
                else {
                    if (Array.isArray(item.all)) add(item.all);
                    for (const [key, child] of Object.entries(item)) {
                        if (key === 'all') continue;
                        if (Array.isArray(child)) add(child);
                    }
                }
            }
        };
        add(value);
        return Array.from(new Set(out.map(s => String(s).trim()).filter(Boolean)));
    }

    function getOpenDropdownOptions(targetEl) {
        const controls = targetEl.getAttribute('aria-controls');
        const expandedId = controls ? document.getElementById(controls) : null;
        const scope = expandedId || targetEl.closest('[data-automation-id^="formField-"], fieldset, .form-group');
        const scoped = scope
            ? Array.from(scope.querySelectorAll('[role="option"]'))
            : [];
        const portal = Array.from(document.querySelectorAll('[role="listbox"], [data-automation-id="listBox"], [data-automation-id*="popup"], [data-automation-id*="menu"]'))
            .filter(isElementVisible)
            .flatMap(list => Array.from(list.querySelectorAll('[role="option"]')));
        const all = scoped.length > 0 ? scoped.concat(portal) : Array.from(document.querySelectorAll('[role="option"]'));
        return Array.from(new Set(all)).filter(o => isElementVisible(o));
    }

    async function dismissWorkdayDropdown(control, preferredOutsideTarget = null) {
        try {
            const outsideTarget = preferredOutsideTarget
                || document.querySelector('[data-automation-id="applyFlowFooter"]')
                || document.querySelector('main')
                || document.body;
            for (let attempt = 0; attempt < 4; attempt++) {
                const active = document.activeElement;
                for (const target of [control, active, document.body, document.documentElement]) {
                    dispatchKey(target, 'Escape', 'Escape', 27);
                }

                if (control?.blur) control.blur();
                if (active && active !== control && active.blur) active.blur();
                control?.dispatchEvent?.(new FocusEvent('focusout', { bubbles: true, cancelable: true }));
                active?.dispatchEvent?.(new FocusEvent('focusout', { bubbles: true, cancelable: true }));

                clickLikeUser(outsideTarget);
                await new Promise(r => setTimeout(r, 100));
                if (getOpenWorkdayDropdowns().length === 0) break;

                dispatchKey(control || document.body, 'Tab', 'Tab', 9);
                await new Promise(r => setTimeout(r, 75));
                if (getOpenWorkdayDropdowns().length === 0) break;
            }
        } catch (_) {}
    }

    // --- Workday Questionnaire / Screening Question Support ---

    function normalizeWordList(s) {
        return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(w => w.length > 2);
    }

    /** Semantic word-overlap score (module-level version for questionnaire matching). */
    function semanticScore(a, b) {
        if (!a || !b) return 0;
        const aWords = normalizeWordList(a);
        let bWords = normalizeWordList(b);
        if (!aWords.length || !bWords.length) return 0;
        let matches = 0;
        for (const w of aWords) {
            const idx = bWords.findIndex(bw => bw && (bw === w || bw.includes(w) || w.includes(bw)));
            if (idx !== -1) { matches++; bWords[idx] = null; }
        }
        return matches / Math.max(aWords.length, bWords.filter(x => x !== null).length + matches);
    }

    /** Detect if the current page has a Workday questionnaire section. */
    function detectWorkdayQuestionnairePage() {
        const dedicated = document.querySelector('[data-automation-id="applyFlowPrimaryQuestionsPage"]')
            || document.querySelector('[data-fkit-id*="primaryQuestionnaire"]')
            || document.querySelector('[data-automation-id*="questionnaire"]');
        if (dedicated) return dedicated;

        // Fallback: inline questions mixed into the personal info page — find the nearest
        // stable ancestor of the first richText-containing formField.
        const inlineQuestion = document.querySelector('[data-automation-id^="formField-"] [data-automation-id="richText"]');
        if (inlineQuestion) {
            return inlineQuestion.closest('[data-automation-id="applyFlowStep"], form, [role="main"], main') || document.body;
        }
        return null;
    }

    /** Extract questions and their answer elements from the questionnaire container. */
    function extractWorkdayQuestions(container) {
        const questions = [];
        const formFields = container.querySelectorAll('[data-automation-id^="formField-"]');
        for (const field of formFields) {
            // Cascade through question text sources — Workday uses several layouts
            const questionEl =
                field.querySelector('legend div[data-automation-id="richText"] p span') ||
                field.querySelector('legend div[data-automation-id="richText"] p') ||
                field.querySelector('legend div[data-automation-id="richText"]') ||
                field.querySelector('[data-automation-id="richText"]') ||
                field.querySelector('legend');
            // Use a plain label only when the field contains radio/checkbox inputs
            // (avoids treating normal profile fields as questions)
            const fallbackLabel = !questionEl && field.querySelector('input[type="radio"], input[type="checkbox"]')
                ? field.querySelector('label')
                : null;
            const source = questionEl || fallbackLabel;
            if (!source) continue;

            const questionText = source.textContent.trim().replace(/\*$/, '').trim();
            if (!questionText || questionText.length < 5) continue;

            const dropdownBtn = field.querySelector('button[aria-haspopup="listbox"]');
            const textInput = field.querySelector('input[type="text"]:not(.css-77hcv), textarea');
            const radioInputs = Array.from(field.querySelectorAll('input[type="radio"]'));

            if (radioInputs.length > 0) {
                const options = cleanChoiceOptions(radioInputs.map(r => getFieldLabel(r) || r.value || ''));
                questions.push({ questionText, elements: radioInputs, type: 'radio', options });
            } else if (dropdownBtn) {
                const passiveOptions = getDropdownOptionsPassive(dropdownBtn);
                questions.push({ questionText, element: dropdownBtn, type: 'dropdown', options: passiveOptions.length > 0 ? passiveOptions : [] });
            } else if (textInput) {
                questions.push({ questionText, element: textInput, type: 'text' });
            }
            // If no answer element found, skip — can't fill it
        }
        return questions;
    }

    // Read dropdown option texts without opening the dropdown. Returns [] if nothing found passively.
    function getDropdownOptionsPassive(btn) {
        if (!btn) return [];
        const selector = '[role="option"], [data-automation-id="promptOption"], [data-automation-id*="promptOption"]';
        // Check the aria-controls listbox container first (pre-rendered but hidden)
        const controlledId = btn.getAttribute('aria-controls');
        if (controlledId) {
            const container = document.getElementById(controlledId);
            if (container) {
                const opts = cleanChoiceOptions(
                    Array.from(container.querySelectorAll(selector)).map(el => getWorkdayOptionLabel(el).trim())
                );
                if (opts.length > 0) return opts;
            }
        }
        // Check enclosing form field container
        const formField = btn.closest('[data-automation-id^="formField-"], fieldset, .form-group');
        if (formField) {
            const opts = cleanChoiceOptions(
                Array.from(formField.querySelectorAll(selector)).map(el => getWorkdayOptionLabel(el).trim())
            );
            if (opts.length > 0) return opts;
        }
        return [];
    }

    /** Match a question string to the best stored screening answer. */
    /**
     * Match a question from the page to a stored screening answer.
     * @param {string} questionText - The question text from the DOM
     * @param {Array} screeningAnswers - Stored screening answers from profile
     * @param {Array} [questionPatterns] - Optional patterns from database screeningQuestions
     * @returns {Object|null} - Best matching screening answer or null
     */
    function matchQuestionToAnswer(questionText, screeningAnswers, questionPatterns, elementType = null) {
        if (!screeningAnswers || !Array.isArray(screeningAnswers)) return null;
        const qLower = questionText.toLowerCase();

        // Determine expected answer type from the element type so we don't fill a
        // free-text answer into a Yes/No field and vice-versa.
        // null = unknown (no filtering applied)
        const expectsYesNo = false;
        const expectsText = elementType === 'text' || elementType === 'textarea';

        function isTypeCompatible(sa) {
            if (!elementType) return true;
            if (expectsYesNo && sa.answerType === 'text') return false;
            if (expectsText && sa.answerType === 'yes_no') return false;
            return true;
        }

        // Phase 1: Pattern-first matching (fast substring check from database config)
        if (questionPatterns && questionPatterns.length > 0) {
            for (const pat of questionPatterns) {
                if (!qLower.includes(pat.pattern)) continue;
                // Pattern matched — find the best stored answer for this pattern key
                let bestPatMatch = null;
                let bestPatScore = 0;
                for (const sa of screeningAnswers) {
                    if (!sa.enabled || !sa.answer) continue;
                    if (!isTypeCompatible(sa)) continue;
                    // Score: keyword overlap between the stored answer and the pattern key
                    const saLower = String(sa.question || '').toLowerCase();
                    if (!saLower) continue;
                    const keywordHits = (sa.keywords || []).filter(kw => qLower.includes(kw.toLowerCase())).length;
                    const textHit = saLower.includes(pat.pattern) ? 2 : 0;
                    const score = keywordHits + textHit;
                    if (score > bestPatScore) {
                        bestPatScore = score;
                        bestPatMatch = sa;
                    }
                }
                if (bestPatMatch) {
                    console.log(`[Fillo] Pattern match "${pat.pattern}" → "${bestPatMatch.question.substring(0, 40)}..."`);
                    return bestPatMatch;
                }
            }
        }

        // Phase 2: Semantic + keyword scoring (fallback)
        let bestMatch = null;
        let bestScore = 0;

        for (const sa of screeningAnswers) {
            if (!sa.enabled || !sa.answer) continue;
            if (!isTypeCompatible(sa)) continue;
            const saQuestion = String(sa.question || '').toLowerCase();
            if (!saQuestion) continue;
            const textScore = semanticScore(qLower, saQuestion);
            let keywordScore = 0;
            if (sa.keywords && sa.keywords.length > 0) {
                const normalizedQuestion = qLower.replace(/[^a-z0-9]/g, ' ').trim();
                const matched = sa.keywords.filter(kw => {
                    const normalizedKeyword = String(kw || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
                    return normalizedKeyword && normalizedQuestion.includes(normalizedKeyword);
                });
                const hasExactKeyword = matched.some(kw =>
                    normalizedQuestion === String(kw || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').trim()
                );
                keywordScore = hasExactKeyword ? 1 : Math.min(1, matched.length / Math.min(sa.keywords.length, 4));
            }
            const combined = (textScore * 0.6) + (keywordScore * 0.4);
            if (combined > bestScore && combined > 0.35) {
                bestScore = combined;
                bestMatch = sa;
            }
        }
        return bestMatch;
    }

    // True when an option label is a real choice rather than a placeholder.
    function isRealChoiceText(text) {
        const s = String(text || '').trim().toLowerCase();
        return !!s && !/^(select|choose|please|pick|none|--)\b/.test(s);
    }

    // True when a set of option labels is clearly a binary Yes/No set (ignoring any
    // placeholder). Used so the screening fallback only fires on real yes/no questions.
    // Matches options that START with yes/no so long phrasings like "Yes, I am legally
    // authorized..." / "No, I am not..." still count.
    const startsWithYes = (t) => /^(yes|y|true)\b/.test(String(t || '').trim().toLowerCase());
    const startsWithNo = (t) => /^(no|n|false)\b/.test(String(t || '').trim().toLowerCase());
    function looksLikeYesNoOptions(texts) {
        const real = texts.map(t => String(t || '').trim().toLowerCase()).filter(isRealChoiceText);
        if (real.length < 2 || real.length > 3) return false;
        return real.some(startsWithYes) && real.some(startsWithNo);
    }

    function getWorkdayQuestionText(field) {
        if (!field) return '';
        const source =
            field.querySelector('legend div[data-automation-id="richText"] p span') ||
            field.querySelector('legend div[data-automation-id="richText"] p') ||
            field.querySelector('legend div[data-automation-id="richText"]') ||
            field.querySelector('[data-automation-id="richText"]') ||
            field.querySelector('legend') ||
            field.querySelector('label');
        let text = source?.textContent || '';

        if (!text) {
            const labelledBy = field.querySelector('[aria-labelledby]')?.getAttribute('aria-labelledby') ||
                field.getAttribute?.('aria-labelledby');
            text = labelledBy
                ? labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ')
                : '';
        }

        return String(text || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
    }

    async function fillDateInputWrapper(wrapper, value, fieldTracker, strategy = 'generic_screening') {
        if (!wrapper) return false;
        const parts = normalizeDateValue(value);
        if (!parts.year || !parts.month || !parts.day) return false;

        const monthInput = wrapper.querySelector('[data-automation-id="dateSectionMonth-input"], input[aria-label*="month" i]');
        const dayInput = wrapper.querySelector('[data-automation-id="dateSectionDay-input"], input[aria-label*="day" i]');
        const yearInput = wrapper.querySelector('[data-automation-id="dateSectionYear-input"], input[aria-label*="year" i]');
        if (!monthInput || !dayInput || !yearInput) return false;

        await fillElement(monthInput, String(parseInt(parts.month, 10)));
        await fillElement(dayInput, String(parseInt(parts.day, 10)));
        await fillElement(yearInput, parts.year);
        markFieldFilled(wrapper, strategy, fieldTracker);
        fieldTracker?.filledElements?.add(monthInput);
        fieldTracker?.filledElements?.add(dayInput);
        fieldTracker?.filledElements?.add(yearInput);
        fieldTracker?.filledValues?.set?.(monthInput, monthInput.value);
        fieldTracker?.filledValues?.set?.(dayInput, dayInput.value);
        fieldTracker?.filledValues?.set?.(yearInput, yearInput.value);
        return true;
    }

    async function fillWorkdayTodayDateQuestions(container, fieldTracker) {
        let filled = 0;
        const dateWrappers = Array.from(container.querySelectorAll('[data-automation-id="dateInputWrapper"]'))
            .filter(isElementVisible)
            .sort((a, b) => getVisualOrderKey(a) - getVisualOrderKey(b));

        for (const dateWrapper of dateWrappers) {
            if (fieldTracker.filledElements.has(dateWrapper)) continue;

            const field = dateWrapper.closest('[data-automation-id^="formField-"]') ||
                dateWrapper.closest('fieldset') ||
                dateWrapper.parentElement ||
                dateWrapper;
            const questionText = getWorkdayQuestionText(field) || getWorkdayQuestionText(dateWrapper);
            if (!/please\s+enter\s+today'?s\s+date\b/i.test(questionText)) continue;

            if (await fillDateInputWrapper(dateWrapper, new Date(), fieldTracker, 'generic_screening')) {
                console.log(`[Fillo] Filled today's date question: "${questionText.substring(0, 60)}"`);
                filled++;
                await new Promise(r => setTimeout(r, 120));
            }
        }

        return filled;
    }

    async function fillWorkdayDisabilityDateSigned(fieldTracker) {
        const fieldId = 'selfIdentifiedDisabilityData--dateSignedOn';
        const exact = document.getElementById(fieldId);
        const wrapper = exact?.matches?.('[data-automation-id="dateInputWrapper"]')
            ? exact
            : exact?.closest?.('[data-automation-id="dateInputWrapper"]') ||
                document.querySelector(`#${CSS.escape(fieldId)} [data-automation-id="dateInputWrapper"]`) ||
                document.querySelector(`[id^="${CSS.escape(fieldId)}-dateSection"]`)?.closest?.('[data-automation-id="dateInputWrapper"]');

        if (wrapper && isElementVisible(wrapper) && !fieldTracker.filledElements.has(wrapper)) {
            const ok = await fillDateInputWrapper(wrapper, new Date(), fieldTracker, 'generic_screening');
            if (ok) {
                console.log('[Fillo] Filled Workday disability Date Signed with today');
                return 1;
            }
        }

        if (exact && isElementVisible(exact) && !fieldTracker.filledElements.has(exact)) {
            const parts = normalizeDateValue(new Date());
            const value = exact.type === 'date' ? parts.iso : `${parts.month}/${parts.day}/${parts.year}`;
            if (await fillElement(exact, value)) {
                markFieldFilled(exact, 'generic_screening', fieldTracker);
                console.log('[Fillo] Filled Workday disability Date Signed with today');
                return 1;
            }
        }

        return 0;
    }

    function isPlaceholderDisclosureText(text) {
        const s = String(text || '').trim().toLowerCase();
        return !s || /^(select|choose|please|make a selection)\b/.test(s);
    }

    const WORKDAY_VETERAN_NOT_PROTECTED_OPTION = 'I IDENTIFY AS A VETERAN, JUST NOT A PROTECTED VETERAN';

    function normalizeVoluntaryDisclosureAnswer(fieldName, value) {
        const raw = String(value || '').trim();
        const lower = raw.toLowerCase();
        if (!raw) return '';

        if (/veteran/i.test(fieldName)) {
            if (/prefer|decline|do not wish|don't wish|not answer|do not want/.test(lower)) return "I don't wish to answer";
            if (/just not.*protected veteran|not (a )?protected veteran|notprotectedveteran/.test(lower)) return WORKDAY_VETERAN_NOT_PROTECTED_OPTION;
            if (/^(no|false|n|0)\b/.test(lower)) return 'I am not a protected veteran';
            if (/^(yes|true|y|1)\b/.test(lower) || /protected veteran|disabled veteran|recently separated|armed forces|campaign badge/.test(lower)) {
                return 'I identify as one or more classifications of protected veteran';
            }
        }

        if (/ethnicity|race/i.test(fieldName)) {
            if (/prefer|decline|do not wish|don't wish|not answer|do not want/.test(lower)) return 'I do not wish to answer';
        }

        if (/gender/i.test(fieldName)) {
            if (/prefer|decline|do not wish|don't wish|not answer|do not want/.test(lower)) return 'I do not wish to answer';
        }

        return raw;
    }

    function getDisclosureScreeningAnswer(screeningAnswers, config, fieldLabel = '') {
        if (!Array.isArray(screeningAnswers)) return null;
        const wanted = (config.screeningKeys || []).map(k => normalizeFieldText(k)).filter(Boolean);
        const blocked = (config.blockedScreeningKeys || []).map(k => normalizeFieldText(k)).filter(Boolean);
        const targetText = normalizeFieldText([
            config.label,
            fieldLabel,
            ...(config.screeningKeys || [])
        ].filter(Boolean).join(' '));
        const hasWantedKey = (text) => wanted.some(key => text.includes(key));
        const hasBlockedKey = (text) => blocked.some(key => text.includes(key));

        // Exact/keyed match first: this is the safest mapping when the stored
        // screening answer has a useful question/key/keyword.
        for (const answer of screeningAnswers) {
            if (!answer?.enabled || answer.answer == null || answer.answer === '') continue;
            const haystack = [
                answer.key,
                answer.question,
                ...(Array.isArray(answer.keywords) ? answer.keywords : [])
            ].filter(Boolean).join(' ');
            if (hasWantedKey(normalizeFieldText(haystack))) return answer.answer;
        }

        // Scoped similar search: useful when user data has "Please select your race..."
        // but no explicit key. It still rejects unrelated domains such as work auth.
        let best = null;
        let bestScore = 0;
        for (const answer of screeningAnswers) {
            if (!answer?.enabled || answer.answer == null || answer.answer === '') continue;
            const candidateText = normalizeFieldText([
                answer.key,
                answer.question,
                ...(Array.isArray(answer.keywords) ? answer.keywords : [])
            ].filter(Boolean).join(' '));
            if (!candidateText || hasBlockedKey(candidateText)) continue;

            const score = semanticScore(targetText, candidateText);
            if (score > bestScore && score >= 0.55) {
                best = answer;
                bestScore = score;
            }
        }

        if (best) {
            console.log(`[Fillo] Disclosure similar match "${config.name}" -> "${String(best.question || '').substring(0, 50)}" (score ${bestScore.toFixed(2)})`);
            return best.answer;
        }

        return null;
    }

    function getFirstProfileValue(profileData, paths) {
        for (const path of paths) {
            const value = getProfileValueForPath(profileData, path);
            if (value != null && value !== '') return value;
        }
        return null;
    }

    async function fillWorkdayVoluntaryDisclosures(profileData, fieldTracker) {
        const container = document.querySelector('[data-automation-id="applyFlowVoluntaryDisclosuresPage"]');
        if (!container || !isElementVisible(container)) return 0;

        const screeningAnswers = profileData?.job_preferences?.screening_answers;
        const fields = [
            {
                name: 'gender',
                label: 'Gender',
                paths: ['job_preferences.eeo.gender', 'job_preferences.gender', 'personal_details.gender'],
                screeningKeys: ['gender', 'sex'],
                blockedScreeningKeys: ['sexual orientation', 'gender identity', 'work authorization', 'authorized to work', 'visa', 'sponsor', 'veteran', 'race', 'ethnicity'],
                fallback: null,
                fallbackOptions: []
            },
            {
                name: 'ethnicity',
                label: 'Ethnicity race',
                paths: [
                    'job_preferences.eeo.race_ethnicity',
                    'job_preferences.race_ethnicity',
                    'personal_details.race_ethnicity',
                    'personal_details.ethnicity',
                    'personal_details.race'
                ],
                screeningKeys: ['ethnicity', 'race', 'race ethnicity', 'hispanic', 'latino', 'black', 'asian', 'white', 'native american', 'pacific islander'],
                blockedScreeningKeys: ['work authorization', 'authorized to work', 'visa', 'sponsor', 'veteran', 'gender', 'disability'],
                fallback: 'I do not wish to answer',
                fallbackOptions: [
                    'I do not wish to answer',
                    'I do not wish to self-identify',
                    'Decline to Self Identify',
                    'Prefer not to answer'
                ]
            },
            {
                name: 'veteranStatus',
                label: 'Veterans Status protected veteran',
                paths: [
                    'job_preferences.eeo.protected_veteran',
                    'job_preferences.protected_veteran',
                    'job_preferences.veteran_status',
                    'personal_details.veteran_status'
                ],
                screeningKeys: ['veteran', 'veteran status', 'veterans status', 'protected veteran', 'vevraa', 'military service'],
                blockedScreeningKeys: ['work authorization', 'authorized to work', 'lawfully', 'visa', 'sponsor', 'sponsorship', 'h-1b', 'gender', 'race', 'ethnicity', 'disability'],
                fallback: "I don't wish to answer",
                fallbackOptions: [
                    "I don't wish to answer",
                    'I do not wish to answer',
                    'I do not wish to self-identify',
                    'Decline to Self Identify',
                    'Prefer not to answer'
                ]
            }
        ];
        let filled = 0;

        for (const config of fields) {
            const field = container.querySelector(`[data-automation-id="formField-${config.name}"]`);
            const button = field?.querySelector('button[aria-haspopup="listbox"]');
            if (!field || !button || fieldTracker.filledElements.has(button)) continue;
            if (!fieldTracker.allowRefill && !isPlaceholderDisclosureText(button.textContent)) continue;

            const labelText = getWorkdayQuestionText(field) || config.label;
            const profileAnswer = getFirstProfileValue(profileData, config.paths);
            const directScreeningAnswer = getDisclosureScreeningAnswer(screeningAnswers, config, labelText);
            const hasProvidedAnswer = profileAnswer != null || directScreeningAnswer != null;
            const rawAnswer = profileAnswer ?? directScreeningAnswer ?? config.fallback;
            const answer = normalizeVoluntaryDisclosureAnswer(config.name, rawAnswer);
            if (!answer) continue;

            let ok = await fillElement(button, answer);
            if (
                !ok &&
                /veteran/i.test(config.name) &&
                /just not.*protected veteran|not (a )?protected veteran|notprotectedveteran/.test(String(rawAnswer || '').toLowerCase()) &&
                answer !== WORKDAY_VETERAN_NOT_PROTECTED_OPTION
            ) {
                ok = await fillElement(button, WORKDAY_VETERAN_NOT_PROTECTED_OPTION);
            }
            if (!ok && !hasProvidedAnswer && Array.isArray(config.fallbackOptions)) {
                for (const fallbackOption of config.fallbackOptions) {
                    if (!fallbackOption || fallbackOption === answer) continue;
                    ok = await fillElement(button, fallbackOption);
                    if (ok) break;
                }
            }

            if (ok) {
                markFieldFilled(button, 'generic_screening', fieldTracker);
                console.log(`[Fillo] Filled voluntary disclosure ${config.name}: "${answer}"`);
                filled++;
                await new Promise(r => setTimeout(r, 160));
            }
        }

        const termsField = container.querySelector('[data-automation-id="formField-acceptTermsAndAgreements"]');
        const termsCheckbox = termsField?.querySelector('input[type="checkbox"]') ||
            container.querySelector('input[name="acceptTermsAndAgreements"][type="checkbox"], input[id$="--acceptTermsAndAgreements"][type="checkbox"]');
        if (termsCheckbox && !fieldTracker.filledElements.has(termsCheckbox) && !termsCheckbox.checked) {
            const termsText = (getWorkdayQuestionText(termsField) || termsField?.textContent || '').toLowerCase();
            if (/acknowledge|privacy statement|terms|agreement|vibe/.test(termsText)) {
                if (await fillElement(termsCheckbox, true)) {
                    markFieldFilled(termsCheckbox, 'generic_screening', fieldTracker);
                    console.log('[Fillo] Accepted Workday terms and agreements checkbox');
                    filled++;
                }
            }
        }

        return filled;
    }

    // Screening fallback: when a yes/no question's dropdown has no stored answer, pick
    // the first Yes/No-style option. Handles native <select> and Workday listbox buttons.
    // Returns true only when it acted on a genuine yes/no dropdown.
    async function fillScreeningYesNoFallback(element, fieldTracker) {
        if (!element) return false;
        if (fieldTracker?.skippedScreeningElements?.has(element) ||
            fieldTracker?.skippedScreeningElements?.has(element.closest?.('[data-automation-id^="formField-"]'))) {
            console.log('[Fillo] Skipping Yes/No fallback because AI returned low confidence/null for this screening field');
            return false;
        }
        const tag = element.tagName?.toLowerCase();

        if (tag === 'select') {
            const opts = Array.from(element.options || []);
            if (!looksLikeYesNoOptions(opts.map(o => o.textContent))) return false;
            const first = opts.find(o => isRealChoiceText(o.textContent));
            if (!first) return false;
            const ok = await fillElement(element, first.textContent.trim());
            if (ok) {
                markFieldFilled(element, 'generic_screening', fieldTracker);
                console.log(`[Fillo] Yes/No screening fallback → "${first.textContent.trim()}"`);
            }
            return ok;
        }

        const isCombo = tag === 'button' &&
            (element.getAttribute('aria-haspopup') === 'listbox' || element.getAttribute('role') === 'combobox');
        if (isCombo) {
            element.focus({ preventScroll: true });
            element.click();
            let opts = [];
            for (let i = 0; i < 8; i++) {
                await new Promise(r => setTimeout(r, 100));
                opts = Array.from(document.querySelectorAll('[role="option"]')).filter(isElementVisible);
                if (opts.length) break;
            }
            if (!looksLikeYesNoOptions(opts.map(o => o.textContent))) {
                await dismissWorkdayDropdown(element);
                return false;
            }
            const first = opts.find(o => isRealChoiceText(o.textContent));
            if (!first) { await dismissWorkdayDropdown(element); return false; }
            clickLikeUser(first);
            element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            await new Promise(r => setTimeout(r, 200));
            await dismissWorkdayDropdown(element);
            markFieldFilled(element, 'generic_screening', fieldTracker);
            console.log(`[Fillo] Yes/No screening fallback → "${(first.textContent || '').trim()}"`);
            return true;
        }

        return false;
    }

    /** Fill Workday questionnaire / screening questions from stored answers. */
    async function fillWorkdayQuestionnaire(profileData, fieldTracker) {
        const container = detectWorkdayQuestionnairePage();
        if (!container) return 0;

        let filled = await fillWorkdayTodayDateQuestions(container, fieldTracker);

        const screeningAnswers = profileData?.job_preferences?.screening_answers;
        if (!screeningAnswers || screeningAnswers.length === 0) {
            console.log('[Fillo] No screening answers configured');
            return filled;
        }

        // Load screening question patterns from the database config for pattern-first matching
        let questionPatterns = [];
        try {
            const platformConfig = await ns.mapping.loadPlatformConfig('workday');
            questionPatterns = platformConfig?.screeningQuestions || [];
        } catch (e) {
            console.warn('[Fillo] Could not load screening patterns:', e);
        }

        const questions = extractWorkdayQuestions(container);
        console.log(`[Fillo] Found ${questions.length} questionnaire questions, ${questionPatterns.length} patterns loaded`);

        // Filter out questions we can't or shouldn't fill
        function isSkippable(q) {
            if (/how did you (hear|find|learn|know) about/i.test(q.questionText) ||
                /source of (hire|application|referral)/i.test(q.questionText)) return true;
            if (q.type === 'radio') {
                if (!q.elements || q.elements.length === 0) return true;
                if (q.elements.every(r => fieldTracker.filledElements.has(r))) return true;
                if (!fieldTracker.allowRefill && q.elements.some(r => r.checked)) return true;
            } else {
                if (!q.element) return true;
                if (fieldTracker.filledElements.has(q.element)) return true;
                if (!fieldTracker.allowRefill && q.type === 'dropdown') {
                    const btnText = q.element.textContent.trim().toLowerCase();
                    if (btnText && !btnText.includes('select') && !btnText.includes('choose') && !btnText.includes('please')) return true;
                }
                if (!fieldTracker.allowRefill && q.type === 'text' && q.element.value?.trim()) return true;
            }
            return false;
        }

        // Direct text match: normalize and compare page question against stored question text only.
        // No semantic/keyword scoring — if the text doesn't match directly, it goes to AI.
        function directMatch(pageQuestion, answers) {
            if (!Array.isArray(answers)) return null;
            const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
            const qNorm = norm(pageQuestion);
            for (const sa of answers) {
                if (!sa.enabled || !sa.answer) continue;
                const saNorm = norm(sa.question);
                if (!saNorm) continue;
                const qTokens = qNorm.split(/\s+/).filter(w => w.length > 2);
                const saTokens = saNorm.split(/\s+/).filter(w => w.length > 2);
                if (
                    qNorm === saNorm ||
                    (saNorm.length >= 20 && saTokens.length >= 3 && qNorm.includes(saNorm)) ||
                    (qNorm.length >= 20 && qTokens.length >= 3 && saNorm.includes(qNorm))
                ) return sa;
            }
            return null;
        }

        function getScreeningOptionsForQuestion(pageQuestion, answers) {
            if (!Array.isArray(answers)) return [];
            const qLower = String(pageQuestion || '').toLowerCase();
            const options = [];
            const add = values => {
                for (const value of values || []) {
                    const text = String(value || '').trim();
                    if (text) options.push(text);
                }
            };

            for (const sa of answers) {
                if (!sa?.enabled) continue;
                const haystack = [
                    sa.question,
                    ...(Array.isArray(sa.keywords) ? sa.keywords : [])
                ].filter(Boolean).join(' ');
                const keywordHit = Array.isArray(sa.keywords) && sa.keywords.some(kw => qLower.includes(String(kw || '').toLowerCase()));
                if (keywordHit || semanticScore(pageQuestion, haystack) >= 0.25) {
                    if (Array.isArray(sa.answerOptions) && sa.answerOptions.length > 0) {
                        add(sa.answerOptions);
                    } else if (sa.answerType === 'yes_no') {
                        add(['Yes', 'No']);
                    }
                    if (sa.answer) add([sa.answer]);
                }
            }

            return cleanChoiceOptions(options);
        }

        function buildScreeningFillCandidates(resolved) {
            const candidates = [];
            const add = value => {
                const text = String(value || '').replace(/_/g, ' ').trim();
                if (text) candidates.push(text);
            };
            const intent = String(resolved?.intent || '').toLowerCase();
            const value = String(resolved?.value || '').toLowerCase();
            add(resolved?.answerText);
            add(resolved?.answer);
            add(value);

            if (value === 'yes') add('Yes');
            if (value === 'no') add('No');
            if (value === 'decline' || value === 'opt_out') {
                add('I do not wish to answer');
                add('I do not want to answer');
                add('Prefer not to answer');
                add('Opt Out');
                add('Decline to Self Identify');
            }
            if (value === 'no_disability') {
                add('No, I do not have a disability and have not had one in the past');
                add('No');
            }
            if (value === 'has_disability') {
                add('Yes, I have a disability, or have had one in the past');
                add('Yes');
            }
            if (value === 'not_protected_veteran') {
                add('I am not a protected veteran');
                add('I IDENTIFY AS A VETERAN, JUST NOT A PROTECTED VETERAN');
            }
            if (value === 'protected_veteran') {
                add('I identify as one or more of the classifications of protected veteran listed above');
                add('I identify as one or more classifications of protected veteran');
            }
            if (intent === 'race_ethnicity' && (value === 'decline' || value === 'opt_out')) add('Opt Out');
            if (intent === 'gender' && (value === 'decline' || value === 'opt_out')) add('I do not wish to answer');

            // Education: add a bare degree-level stem so any Workday phrasing matches via
            // substring scoring ("Bachelor's (BS/BA)", "Bachelors", "Bachelor of Science", etc.)
            // Fires from the edge-function path (value = "bachelor" etc.) AND the directMatch
            // path (value = raw answer text, intent = null but answerText contains degree name).
            const eduSrc = String(resolved?.answerText || resolved?.answer || '');
            const isEduIntent = intent === 'education_level';
            const isEduStem = value === 'bachelor' || value === 'master' || value === 'doctoral' || value === 'associate' || value === 'highschool';
            const looksLikeDegree = /bachelor|master|doctor|doctorate|associate|phd|ph\.d/i.test(eduSrc);
            if (isEduIntent || isEduStem || looksLikeDegree) {
                if (/ph\.?d|doctor|doctoral|doctorate/i.test(eduSrc) || value === 'doctoral') {
                    add('doctoral'); add('doctorate'); add('phd');
                } else if (/master|mba|m\.s\.|m\.a\./i.test(eduSrc) || value === 'master') {
                    add('master'); add('graduate');
                } else if (/bachelor|b\.s\.|b\.a\.|undergraduate/i.test(eduSrc) || value === 'bachelor') {
                    add('bachelor');
                } else if (/associate/i.test(eduSrc) || value === 'associate') {
                    add('associate');
                } else if (/high school|ged|secondary/i.test(eduSrc) || value === 'highschool') {
                    add('high school'); add('ged'); add('secondary');
                }
            }

            return cleanChoiceOptions(candidates);
        }

        function scoreScreeningChoice(optionText, resolved) {
            const optionRaw = String(optionText || '').trim();
            const optionLower = optionRaw.toLowerCase();
            const optionNorm = normalizeSelectText(optionRaw);
            if (!optionNorm || /^(select|choose|please|make a selection)\b/i.test(optionRaw)) return -1;

            const intent = String(resolved?.intent || '').toLowerCase();
            const value = String(resolved?.value || '').toLowerCase();
            const candidates = buildScreeningFillCandidates(resolved);
            let best = 0;

            for (const candidate of candidates) {
                const candidateNorm = normalizeSelectText(candidate);
                const candidateLower = String(candidate || '').toLowerCase();
                if (!candidateNorm) continue;
                if (optionNorm === candidateNorm || optionLower === candidateLower) best = Math.max(best, 100);
                else if (selectionTextMatches(optionRaw, candidate)) best = Math.max(best, 90);
                else if (optionNorm.includes(candidateNorm) || candidateNorm.includes(optionNorm)) best = Math.max(best, 75);
                else best = Math.max(best, Math.round(semanticScore(candidateNorm, optionNorm) * 70));
            }

            // OFCCP/EEO disability and veteran special cases
            const sc = applyChoiceSpecialCases(optionRaw, value, best);
            if (sc !== null) best = sc;
            // race_ethnicity opt-out needs extra context check
            if ((value === 'decline' || value === 'opt_out') && intent === 'race_ethnicity' && /opt out/i.test(optionRaw)) best = Math.max(best, 100);
            // simple yes/no boosts
            if (value === 'yes' && /^(yes|y)\b/i.test(optionRaw)) best = Math.max(best, 100);
            if (value === 'no' && /^(no|n)\b/i.test(optionRaw)) best = Math.max(best, 100);

            return best;
        }

        function pickScreeningChoice(options, resolved) {
            const ranked = (options || [])
                .map((text, idx) => ({ text, idx, score: scoreScreeningChoice(text, resolved) }))
                .filter(item => item.score >= 60)
                .sort((a, b) => b.score - a.score || a.idx - b.idx);
            return ranked[0]?.text || null;
        }

        // Open a Workday dropdown, collect visible option texts, then close it.
        async function extractDropdownOptions(btn) {
            try {
                if (!btn) return [];

                // Try to read options without opening the dropdown first
                const passiveOpts = getDropdownOptionsPassive(btn);
                if (passiveOpts.length > 0) return passiveOpts;

                const isVisibleOption = (el) => {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
                    const rect = el.getBoundingClientRect?.();
                    return !!rect && rect.width > 0 && rect.height > 0;
                };

                const getVisibleOptionElements = () => {
                    const controlledId = btn.getAttribute?.('aria-controls');
                    const controlled = controlledId ? document.getElementById(controlledId) : null;
                    const roots = [
                        controlled,
                        ...getOpenWorkdayDropdowns(),
                        document.body
                    ].filter(Boolean);
                    const seen = new Set();
                    const optionEls = [];

                    for (const root of roots) {
                        const selector = root === document.body
                            ? '[role="option"], [data-automation-id="promptOption"], [data-automation-id*="promptOption"]'
                            : '[role="option"], [data-automation-id="promptOption"], [data-automation-id*="promptOption"], [data-automation-label]';
                        const candidates = Array.from(root.querySelectorAll(selector));
                        for (const el of candidates) {
                            if (seen.has(el) || btn.contains?.(el)) continue;
                            seen.add(el);
                            if (!isVisibleOption(el)) continue;
                            const text = getWorkdayOptionLabel(el).trim();
                            if (!text) continue;
                            optionEls.push(el);
                        }
                    }

                    return optionEls;
                };

                const openDropdown = async () => {
                    btn.focus?.({ preventScroll: true });
                    clickLikeUser(btn);
                    await new Promise(r => setTimeout(r, 120));
                    if (getVisibleOptionElements().length > 0) return;
                    dispatchKey(btn, 'ArrowDown', 'ArrowDown', 40);
                    await new Promise(r => setTimeout(r, 120));
                    if (getVisibleOptionElements().length > 0) return;
                    btn.click?.();
                };

                await openDropdown();

                let optionEls = [];
                for (let i = 0; i < 10; i++) {
                    await new Promise(r => setTimeout(r, 100));
                    optionEls = getVisibleOptionElements();
                    if (optionEls.length > 0) break;
                }

                const opts = cleanChoiceOptions(optionEls.map(el => getWorkdayOptionLabel(el)));
                await dismissWorkdayDropdown(btn);
                console.log(`[Fillo] Extracted ${opts.length} page options for "${String(btn.textContent || '').trim().substring(0, 40)}"`, opts);
                return opts;
            } catch (e) {
                try { await dismissWorkdayDropdown(btn); } catch (_) {}
                console.warn('[Fillo] Failed to extract page options:', e?.message || e);
                return [];
            }
        }

        function markScreeningQuestionSkipped(q, reason = 'ai_low_confidence') {
            if (!fieldTracker?.skippedScreeningElements || !q) return;
            if (q.element) {
                fieldTracker.skippedScreeningElements.add(q.element);
                const formField = q.element.closest?.('[data-automation-id^="formField-"]');
                if (formField) fieldTracker.skippedScreeningElements.add(formField);
            }
            if (Array.isArray(q.elements)) {
                for (const el of q.elements) {
                    fieldTracker.skippedScreeningElements.add(el);
                    const formField = el.closest?.('[data-automation-id^="formField-"]');
                    if (formField) fieldTracker.skippedScreeningElements.add(formField);
                }
            }
            console.log(`[Fillo] Screening question skipped (${reason}): "${String(q.questionText || '').substring(0, 80)}"`);
        }

        // Pass 1: resolve stored answers via direct match, collect unmatched for AI batch
        const answerMap = new Map(); // question index → normalized fill decision
        const aiBatch = [];          // { batchIndex, questionIndex }

        for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            if (isSkippable(q)) continue;
            const match = directMatch(q.questionText, screeningAnswers);
            if (match?.answer) {
                answerMap.set(i, {
                    answer: match.answer,
                    answerText: match.answer,
                    value: match.answer,
                    intent: null,
                    confidence: 100
                });
            } else {
                let pageOptions = [];
                if (q.type === 'radio') {
                    pageOptions = cleanChoiceOptions(q.options && q.options.length
                        ? q.options
                        : q.elements.map(r => getFieldLabel(r) || r.value || ''));
                } else if (q.type === 'dropdown') {
                    pageOptions = await extractDropdownOptions(q.element);
                    q.options = pageOptions;
                }
                const screeningOptions = getScreeningOptionsForQuestion(q.questionText, screeningAnswers);
                aiBatch.push({
                    batchIndex: aiBatch.length,
                    questionIndex: i,
                    questionText: q.questionText,
                    elementType: q.type,
                    pageOptions,
                    screeningOptions,
                    options: cleanChoiceOptions([...pageOptions, ...screeningOptions])
                });
            }
        }

        // Pass 2: single AI batch call for all unmatched questions
        if (aiBatch.length > 0) {
            console.log(`[Fillo] Sending ${aiBatch.length} unmatched questions to AI`);
            const aiResults = await ns.ai.answerScreeningQuestionsBatch(
                aiBatch.map(b => ({
                    questionText: b.questionText,
                    elementType: b.elementType,
                    pageOptions: b.pageOptions ?? [],
                    screeningOptions: b.screeningOptions ?? [],
                    options: b.options ?? []
                })),
                profileData?.job_preferences?.screening_answers ?? []
            );
            for (const result of aiResults) {
                // Prefer mapping by echoed question text; fall back to index
                const entry = result.question
                    ? aiBatch.find(b => b.questionText.trim() === String(result.question).trim()) ?? aiBatch[result.index]
                    : aiBatch[result.index];
                if (entry) {
                    const confidence = typeof result?.confidence === 'number' ? result.confidence : 0;
                    if (confidence < MIN_SCREENING_CONFIDENCE || (!result?.answer && !result?.answerText && !result?.value)) {
                        markScreeningQuestionSkipped(questions[entry.questionIndex], 'ai_low_confidence');
                    } else {
                        answerMap.set(entry.questionIndex, result);
                    }
                }
            }
        }

        // Pass 3: fill all resolved answers
        for (let i = 0; i < questions.length; i++) {
            const q = questions[i];
            const resolved = answerMap.get(i);
            if (!resolved) {
                if (!isSkippable(q)) console.log(`[Fillo] No answer for: "${q.questionText.substring(0, 60)}"`);
                continue;
            }

            const confidence = typeof resolved.confidence === 'number' ? resolved.confidence : 100;
            if (confidence < MIN_SCREENING_CONFIDENCE) {
                markScreeningQuestionSkipped(q, 'low_confidence_fill_guard');
                continue;
            }

            const candidates = buildScreeningFillCandidates(resolved);
            let answerText = null;
            if (q.type === 'radio' || q.type === 'dropdown') {
                if (q.type === 'dropdown' && (!q.options || q.options.length === 0)) {
                    q.options = await extractDropdownOptions(q.element);
                }
                answerText = pickScreeningChoice(q.options || [], resolved);
                if (!answerText) {
                    markScreeningQuestionSkipped(q, 'no_page_option_match');
                    continue;
                }
            } else {
                answerText = candidates[0];
            }
            if (!answerText) continue;
            console.log(`[Fillo] Filling "${q.questionText.substring(0, 50)}" -> "${answerText}"`);

            if (q.type === 'radio') {
                let picked = false;
                const rankedRadios = q.elements
                    .filter(radio => !fieldTracker.filledElements.has(radio))
                    .map((radio, idx) => {
                        const labelText = (getFieldLabel(radio) || radio.value || '').trim();
                        return { radio, idx, score: scoreScreeningChoice(labelText, resolved), labelText };
                    })
                    .filter(item => item.score >= 60)
                    .sort((a, b) => b.score - a.score || a.idx - b.idx);
                for (const { radio, labelText } of rankedRadios) {
                        radio.focus({ preventScroll: true });
                        radio.click();
                        radio.dispatchEvent(new Event('change', { bubbles: true }));
                        markFieldFilled(radio, 'platform', fieldTracker);
                        console.log(`[Fillo] Radio intent match: "${labelText}"`);
                        filled++;
                        picked = true;
                        break;
                }
                if (!picked) {
                    console.log(`[Fillo] No radio option matched "${answerText}" for "${q.questionText.substring(0, 40)}"`);
                }
            } else {
                let success = false;
                const candidateValues = cleanChoiceOptions([answerText, ...candidates]);
                for (const candidate of candidateValues) {
                    success = await fillElement(q.element, candidate);
                    if (success) break;
                }
                if (success) {
                    markFieldFilled(q.element, 'platform', fieldTracker);
                    filled++;
                }
            }
            await new Promise(r => setTimeout(r, 200));
        }

        if (filled > 0) {
            console.log(`[Fillo] Filled ${filled}/${questions.length} questionnaire answers`);
        }
        return filled;
    }

    // --- End Questionnaire Support ---

    // --- iCIMS Label-Based Fill (for company-specific rcf* fields) ---

    /**
     * Fill iCIMS fields that use company-specific rcf* IDs by matching their label text.
     * Handles "Personal Email", "Full Legal Name", "Preferred First Name", etc.
     */
    async function fillICIMSByLabel(profileData, fieldTracker) {
        const pd = profileData?.personal_details || {};
        const firstName = pd.firstName || pd.first_name || '';
        const middleName = pd.middle_name || pd.middleName || '';
        const lastName = pd.lastName || pd.last_name || '';
        // Legal name always composed from parts so middle name is never omitted
        const legalFullName = [firstName, middleName, lastName].filter(Boolean).join(' ');
        const email = pd.email || profileData?.email || '';

        const getICIMSFieldText = (el) => {
            const container = el.closest('.iCIMS_Forms_Global, .iCIMS_Forms_Field, .iCIMS_Forms_TextField, .customFieldContainer, .iCIMS_CurrentFile, .iCIMS_InfoData, .icims-form-group, .form-group, td') || el.parentElement;
            const directLabel = getFieldLabel(el) || '';
            const ariaLabel = el.getAttribute('aria-label') || '';
            const placeholder = el.getAttribute('placeholder') || '';
            const containerText = container?.textContent || '';

            return [directLabel, ariaLabel, placeholder, containerText]
                .filter(Boolean)
                .join(' ')
                .toLowerCase()
                .replace(/\*/g, '')
                .trim();
        };

        const labelMappings = [
            { patterns: ['personal email'], value: email },
            { patterns: ['preferred first name', 'preferred name', 'nickname'], value: firstName },
            { patterns: ['full legal name', 'legal name for offer', 'legal name for onboarding'], value: legalFullName },
            { patterns: ['middle name', 'middle initial'], value: middleName },
        ];

        const allFields = document.querySelectorAll('input[type="text"], input[type="email"], textarea');
        let filled = 0;

        for (const el of allFields) {
            if (!isElementVisible(el)) continue;
            if (fieldTracker.filledElements.has(el)) continue;
            if (!fieldTracker.allowRefill && el.value?.trim()) continue;

            const labelText = getICIMSFieldText(el);
            if (!labelText) continue;

            for (const mapping of labelMappings) {
                if (!mapping.value) continue;
                if (mapping.patterns.some(p => labelText.includes(p))) {
                    if (await fillElement(el, mapping.value)) {
                        relayLog('info', `[iCIMS] Label fill: "${labelText}" → "${String(mapping.value).substring(0, 30)}"`);
                        markFieldFilled(el, 'platform', fieldTracker);
                        filled++;
                    }
                    break;
                }
            }
        }

        return filled;
    }

    // --- End iCIMS Label Fill ---

    function buildSelectors(variant) {
        return [`[name="${variant}"]`, `[id="${variant}"]`, `[name*="${variant}"]`, `[id*="${variant}"]`, `[data-testid="${variant}"]`, `[data-automation-id="${variant}"]`, `[data-test="${variant}"]`, `[placeholder*="${variant}"]`, `.${variant}`];
    }

    function computeScore(element, variant) {
        if (typeof variant !== 'string') return 0;
        let score = 0;
        const name = element.name?.toLowerCase() || '';
        const id = element.id?.toLowerCase() || '';
        const placeholder = element.placeholder?.toLowerCase() || '';
        const className = element.className?.toLowerCase() || '';
        const label = (getFieldLabel(element) || '').toLowerCase();
        const v = variant.toLowerCase();
        if (name === v || id === v) score += 10;
        if (name.includes(v) || id.includes(v)) {
            score += 7;
            // Prevent substring "name" from inappropriately hijacking school/company names
            if (v === 'name' || v === 'fullname') {
                const lowerNameId = name + id;
                if (lowerNameId.includes('school') || lowerNameId.includes('company') ||
                    lowerNameId.includes('employer') || lowerNameId.includes('project') ||
                    lowerNameId.includes('university') || lowerNameId.includes('reference')) {
                    score -= 10; // Heavily penalize
                }
            }
            // Prevent "address" variants from hijacking website/URL fields
            // e.g. "websiteAddress" contains "address" but is a URL field, not a street address
            if (v === 'address' || v === 'addr' || v === 'streetaddress' || v === 'addressline1') {
                const lowerNameId = name + id;
                if (lowerNameId.includes('website') || lowerNameId.includes('url') ||
                    lowerNameId.includes('link') || lowerNameId.includes('web')) {
                    score -= 10; // Heavily penalize
                }
                if (lowerNameId.includes('line2') || lowerNameId.includes('apt') || lowerNameId.includes('suite') || lowerNameId.includes('apartment') ||
                    lowerNameId.includes('street2') || lowerNameId.includes('address2')) {
                    score -= 10; // Do not fill Address Line 2 with Address Line 1 Generic Maps
                }
                // Prevent Address Line 1 mapping from hijacking country/state/city/postal fields.
                const locationFieldPattern = /(country|countryregion|state|province|region|postal|zipcode|zip|city|municipality)/;
                if (locationFieldPattern.test(lowerNameId) || locationFieldPattern.test(label)) {
                    score -= 12;
                }
            }
        }
        
        const testId = (element.getAttribute('data-testid') || '').toLowerCase();
        const autoId = (element.getAttribute('data-automation-id') || '').toLowerCase();
        const dataTest = (element.getAttribute('data-test') || '').toLowerCase();
        
        if (testId === v || autoId === v || dataTest === v) score += 6;
        else if (testId.includes(v) || autoId.includes(v) || dataTest.includes(v)) score += 4;
        
        if (className.includes(v)) score += 5;
        if (placeholder.includes(v)) score += 4;
            if (label.includes(v)) {
                score += 3;
                if (v === 'name' || v === 'fullname') {
                if (label.includes('school') || label.includes('company') || label.includes('employer') || label.includes('project') ||
                    /\b(first|given|middle|family|last|surname)\s+name\b/.test(label)) {
                    score -= 10;
                }
            }
        }
        if (element.type === 'email' && v.includes('email')) score += 2;
        if (element.type === 'tel' && v.includes('phone')) score += 2;
        if (element.type === 'url' && (v.includes('website') || v.includes('url'))) score += 2;
        return score;
    }

    // --- Field guard helpers — prevent mismatches on ambiguous fields ---

    function isPersonalNamePartField(element) {
        if (!element) return false;
        const text = [
            element.name || '',
            element.id || '',
            element.getAttribute('data-automation-id') || '',
            element.getAttribute('aria-label') || '',
            element.placeholder || '',
            getFieldLabel(element) || '',
            element.closest?.('[data-automation-id^="formField-"]')?.textContent || ''
        ].join(' ').toLowerCase();

        return /\b(first|given|middle|family|last|surname)\s+name\b/.test(text) ||
            /legalname--(first|middle|last)name/.test(text);
    }

    function isCountyLikeField(el, fallback = '') {
        const text = getSemanticFieldText(el, fallback);
        return /\bcounty\b/.test(text);
    }

    function getRadioOptionText(radio) {
        if (!radio) return '';
        const label = getFieldLabel(radio);
        if (label) return label;

        const wrapper = radio.closest('span, label, div, td');
        const parts = [];
        let node = wrapper?.nextSibling;
        while (node && parts.join(' ').length < 180) {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent?.replace(/\s+/g, ' ').trim();
                if (text) parts.push(text);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                const el = node;
                if (el.matches?.('input[type="radio"]') || (el.tagName?.toLowerCase() === 'span' && el.querySelector?.('input[type="radio"]'))) break;
                const text = el.textContent?.replace(/\s+/g, ' ').trim();
                if (text) parts.push(text);
                if (el.querySelector?.('input[type="radio"]')) break;
            }
            node = node.nextSibling;
        }

        return (parts.join(' ') || radio.value || '').trim();
    }

    async function fillElement(element, value) {
        try {
            if (!element || value == null) return false;

            // Bring the field into view top-to-bottom before interacting. Forward-only:
            // if this field sits above where we've already filled, it stays put (no jump).
            scrollForwardIntoView(element);

            // Deep search helper to find fillable controls inside nested Shadow DOMs.
            // Include listbox/combobox buttons so Workday wrapper divs do not get filled directly.
            function findRealInput(root) {
                const sel = 'input, textarea, select, button[aria-haspopup="listbox"], button[role="combobox"], [role="combobox"]';
                const found = root.querySelector(sel);
                if (found) return found;

                // Check all children that might have their own shadow roots
                const children = root.querySelectorAll('*');
                for (const child of children) {
                    if (child.shadowRoot) {
                        const inner = findRealInput(child.shadowRoot);
                        if (inner) return inner;
                    }
                }
                return null;
            }

            let targetEl = element;
            const originalTag = targetEl.tagName.toLowerCase();

            // If it's a custom component (not a native fillable control), find the real one inside.
            if (!['input', 'textarea', 'select', 'button'].includes(originalTag)) {
                // If it's a button pretending to be a select, DO NOT override targetEl!
                if (!(originalTag === 'button' && (targetEl.getAttribute('aria-haspopup') === 'listbox' || targetEl.getAttribute('role') === 'combobox'))) {
                    const inner = findRealInput(targetEl) || (targetEl.shadowRoot && findRealInput(targetEl.shadowRoot));
                    if (inner) targetEl = inner;
                }
            }

            const tag = targetEl.tagName.toLowerCase();
            const type = (targetEl.type || '').toLowerCase();

            // Degree dropdowns should fall back to an "Other" option when the profile's
            // degree value isn't one of the listed choices. Detect the field by its
            // name / id / automation-id / label so this works for Workday and generic forms.
            const degreeProbeText = [
                element.getAttribute?.('name'), element.getAttribute?.('id'), element.getAttribute?.('data-automation-id'),
                targetEl.getAttribute?.('name'), targetEl.getAttribute?.('id'), targetEl.getAttribute?.('data-automation-id'),
                (element.closest?.('[data-automation-id^="formField-"]') || targetEl.closest?.('[data-automation-id^="formField-"]'))?.getAttribute?.('data-automation-id'),
                (() => { try { return getFieldLabel?.(element); } catch (_) { return ''; } })()
            ].filter(Boolean).join(' ').toLowerCase();
            const isDegreeField = /degree/.test(degreeProbeText);
            // Match an "Other" choice (e.g. "Other", "Others", "Other (please specify)")
            // without matching unrelated options that merely contain the substring.
            const isOtherOptionText = (txt) => /\bothers?\b/.test(String(txt || '').trim().toLowerCase());

            // Helper to mirror events on the wrapper element if it differs from the target
            const mirror = (evName, Cls, opts) => {
                if (targetEl !== element) element.dispatchEvent(new Cls(evName, opts));
            };

            // Helper to compute a semantic keyword overlap score between target DB value and an option text.
            const calculateSemanticScore = (targetStr, optionStr) => {
                if (!targetStr || !optionStr) return 0;
                // Pre-strip periods so B.Sc. becomes Bsc before calling normalizeWordList.
                // Also keeps words of length > 1 and drops common stopwords (degree-specific needs).
                const normalizeDegree = s => normalizeWordList(s.replace(/\./g, '')).filter(w => w.length > 1 && !['in','of','at','the','and'].includes(w));
                const expand = w => {
                    const dict = {
                        'bsc': ['bachelor', 'science'], 'bs': ['bachelor', 'science'], 'ba': ['bachelor', 'arts'],
                        'msc': ['master', 'science'], 'ms': ['master', 'science'], 'ma': ['master', 'arts'], 'mba': ['master', 'business', 'administration'],
                        'phd': ['doctorate', 'philosophy'], 'btech': ['bachelor', 'technology']
                    };
                    return dict[w] || [w];
                };

                const tWords = normalizeDegree(targetStr).flatMap(expand);
                let oWords = normalizeDegree(optionStr).flatMap(expand);
                if (!tWords.length || !oWords.length) return 0;

                let matches = 0;
                for (const tw of tWords) {
                    const exactIdx = oWords.indexOf(tw);
                    if (exactIdx !== -1) {
                        matches += 1;
                        oWords[exactIdx] = null;
                    } else {
                        const partialIdx = oWords.findIndex(ow => ow && (ow.includes(tw) || tw.includes(ow)));
                        if (partialIdx !== -1) {
                            matches += 0.5;
                            oWords[partialIdx] = null;
                        }
                    }
                }
                return matches / Math.max(tWords.length, oWords.filter(x => x !== null).length + matches);
            };

            if (tag === 'select') {
                const strVal = String(value);
                const strLower = strVal.toLowerCase();

                // Full pointer + mouse event chain to trigger "open" on framework-driven selects
                targetEl.focus({ preventScroll: true });
                targetEl.dispatchEvent(new PointerEvent('pointerover',  { bubbles: true, cancelable: true }));
                targetEl.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true, cancelable: true }));
                targetEl.dispatchEvent(new MouseEvent('mouseover',      { bubbles: true, cancelable: true }));
                targetEl.dispatchEvent(new MouseEvent('mouseenter',     { bubbles: true, cancelable: true }));
                targetEl.dispatchEvent(new PointerEvent('pointerdown',  { bubbles: true, cancelable: true }));
                targetEl.dispatchEvent(new MouseEvent('mousedown',      { bubbles: true, cancelable: true }));
                targetEl.dispatchEvent(new PointerEvent('pointerup',    { bubbles: true, cancelable: true }));
                targetEl.dispatchEvent(new MouseEvent('mouseup',        { bubbles: true, cancelable: true }));
                targetEl.click();

                // Small yield so the DOM can react to the open event before we try to set a value
                await new Promise(r => setTimeout(r, 500));

                // Find the matching option and select it
                let matchedOption = null;
                let bestMatchIdx = -1;
                let bestMatchScore = 0; // Semantic score ranges from 0 to 1

                for (let idx = 0; idx < targetEl.options.length; idx++) {
                    const o = targetEl.options[idx];
                    const optText = o.textContent.trim().toLowerCase();

                    if (o.value === strVal || optText === strLower) {
                        matchedOption = o;
                        bestMatchIdx = idx;
                        break; // Exact match found, stop looking
                    }

                    // Fallback to semantic similarity if exact match fails
                    if (optText && strLower) {
                        const score = calculateSemanticScore(strLower, optText);
                        // Require at least a ~40% token overlap threshold
                        if (score > bestMatchScore && score > 0.4) {
                            bestMatchScore = score;
                            matchedOption = o;
                            bestMatchIdx = idx;
                        }
                    }
                }

                // If no good local match found, fall back to AI option picking (only if AI enabled)
                if (!matchedOption && AI_CONFIG.enabled && ns.ai?.matchDropdownOptionWithAI) {
                    const aiBestIdx = await ns.ai.matchDropdownOptionWithAI(strVal, Array.from(targetEl.options).map(o => o.textContent.trim()));
                    if (aiBestIdx !== null && aiBestIdx >= 0 && aiBestIdx < targetEl.options.length) {
                        bestMatchIdx = aiBestIdx;
                        matchedOption = targetEl.options[aiBestIdx];
                    }
                }

                // Degree field with no matching option → select "Other".
                if (!matchedOption && isDegreeField) {
                    for (let idx = 0; idx < targetEl.options.length; idx++) {
                        if (isOtherOptionText(targetEl.options[idx].textContent)) {
                            matchedOption = targetEl.options[idx];
                            bestMatchIdx = idx;
                            console.log(`[Fillo] Degree "${strVal}" not in options — selecting "Other"`);
                            break;
                        }
                    }
                }

                if (matchedOption) {
                    targetEl.selectedIndex = bestMatchIdx;

                    // Fire full event sequence on the option itself
                    matchedOption.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
                    matchedOption.dispatchEvent(new MouseEvent('mousedown',     { bubbles: true, cancelable: true }));
                    matchedOption.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true, cancelable: true }));
                    matchedOption.dispatchEvent(new MouseEvent('mouseup',       { bubbles: true, cancelable: true }));
                    matchedOption.click();
                } else {
                    targetEl.value = strVal; // last resort
                }

                // Use native setter so React's synthetic onChange fires reliably
                const nativeSetter = Object.getOwnPropertyDescriptor(
                    Object.getPrototypeOf(targetEl), 'value'
                )?.set;
                if (nativeSetter) {
                    const finalVal = matchedOption
                        ? (targetEl.options[bestMatchIdx]?.value ?? strVal)
                        : strVal;
                    nativeSetter.call(targetEl, finalVal);
                }

                // Fire input + change + blur to commit the selection
                targetEl.dispatchEvent(new Event('input',  { bubbles: true, cancelable: true }));
                targetEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                mirror('change', Event, { bubbles: true });
                targetEl.dispatchEvent(new FocusEvent('blur', { bubbles: true, cancelable: true }));
                mirror('blur', FocusEvent, { bubbles: true });

            } else if (tag === 'button' && (targetEl.getAttribute('aria-haspopup') === 'listbox' || targetEl.getAttribute('role') === 'combobox')) {
                // BUTTON/COMBOBOX: specifically for Workday-style custom dropdown components
                const strVal = String(value);
                const strLower = strVal.toLowerCase();
                const initialText = (targetEl.textContent || '').trim();
                const scoreOptionAgainstAnswer = (optionText) => {
                    const optionRaw = String(optionText || '').trim();
                    const answerRaw = String(strVal || '').trim();
                    const optionLower = optionRaw.toLowerCase();
                    const answerLower = answerRaw.toLowerCase();
                    const optionNorm = normalizeSelectText(optionRaw);
                    const answerNorm = normalizeSelectText(answerRaw);
                    if (!optionNorm || !answerNorm) return -1;
                    if (/^(select|choose|please|make a selection)\b/i.test(optionRaw)) return -1;
                    if (optionNorm === answerNorm || optionLower === answerLower) return 100;

                    const answerOptOut = /do not wish|don't wish|self-identify|self identify|decline|prefer not|not answer/i.test(answerRaw);
                    const optionOptOut = /do not wish|don't wish|self-identify|self identify|decline|prefer not|not answer/i.test(optionRaw);
                    if (answerOptOut || optionOptOut) return answerOptOut === optionOptOut ? 96 : 0;

                    const answerNotProtectedVeteran = /just not.*protected veteran|not (a )?protected veteran|notprotectedveteran/i.test(answerRaw);
                    if (answerNotProtectedVeteran) {
                        if (/identify as a veteran.*not a protected veteran|just not.*protected veteran/i.test(optionRaw)) return 100;
                        if (/not (a )?protected veteran/i.test(optionRaw) && /veteran/i.test(optionRaw)) return 90;
                        return 0;
                    }

                    const answerNotVeteran = /\bnot a veteran\b|\bnot veteran\b/i.test(answerRaw);
                    if (answerNotVeteran) {
                        if (/\bnot a veteran\b|\bnot veteran\b/i.test(optionRaw)) return 100;
                        if (/not (a )?protected veteran/i.test(optionRaw)) return 35;
                        return 0;
                    }

                    const answerProtectedVeteran = /one or more classifications of protected veteran|identify as.*protected veteran|disabled veteran|recently separated|armed forces|campaign badge/i.test(answerRaw);
                    if (answerProtectedVeteran) {
                        if (/one or more.*protected veterans?|classifications of protected veterans?|identify as.*protected veteran/i.test(optionRaw) &&
                            !/not (a )?protected veteran|not a veteran|do not wish|self-identify/i.test(optionRaw)) {
                            return 100;
                        }
                        return 0;
                    }

                    if (optionNorm.includes(answerNorm) || answerNorm.includes(optionNorm)) return 85;
                    return Math.round(calculateSemanticScore(answerNorm, optionNorm) * 100);
                };
                const selectedTextMatchesRequest = (text) => {
                    return scoreOptionAgainstAnswer(text) >= 60;
                };
                const clickOptionWithPointerSequence = (optionEl) => {
                    if (!optionEl) return;
                    optionEl.scrollIntoView({ block: 'nearest' });
                    optionEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
                    optionEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                    optionEl.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
                    optionEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                    optionEl.click();
                };

                // Click button to open the listbox
                targetEl.focus({ preventScroll: true });
                targetEl.click();

                // Pick the option that best matches the requested value. Exact value/text
                // matches are taken across ALL options FIRST, so a fuzzy substring match
                // (e.g. "Female" contains "male") can never beat an exact option ("Male")
                // just because it appears earlier in the list.
                const pickOption = (options) => {
                    const ranked = options
                        .map((o, idx) => ({
                            o,
                            idx,
                            text: o.textContent?.trim() || '',
                            score: Math.max(
                                scoreOptionAgainstAnswer(o.textContent || ''),
                                o.getAttribute('data-value')?.toLowerCase() === strLower ? 100 : -1
                            )
                        }))
                        .filter(item => item.score >= 60)
                        .sort((a, b) => b.score - a.score || a.idx - b.idx);
                    if (ranked[0]) {
                        console.log(`[Fillo] Dropdown semantic option match: "${ranked[0].text}" for "${strVal}" (score ${ranked[0].score})`);
                        return ranked[0].o;
                    }
                    return null;
                };

                // Poll for the options to appear in the DOM (usually appended to body or adjacent)
                let optionsDiv = [];
                for (let i = 0; i < 8; i++) {
                    await new Promise(r => setTimeout(r, 300)); // max wait 2.4s
                    const visibleOptions = getOpenDropdownOptions(targetEl);
                    if (visibleOptions.length > 0) {
                        optionsDiv = visibleOptions;
                        break;
                    }
                }

                let selected = false;
                if (optionsDiv.length > 0) {
                    let matchedOption = pickOption(optionsDiv);

                    // If no good local match found, fall back to AI option picking (only if AI enabled)
                    if (!matchedOption && AI_CONFIG.enabled && ns.ai?.matchDropdownOptionWithAI) {
                        const aiBestIdx = await ns.ai.matchDropdownOptionWithAI(strVal, optionsDiv.map(o => o.textContent.trim()));
                        if (aiBestIdx !== null && aiBestIdx >= 0 && aiBestIdx < optionsDiv.length) {
                            matchedOption = optionsDiv[aiBestIdx];
                        }
                    }

                    // Degree field with no matching option → select "Other".
                    if (!matchedOption && isDegreeField) {
                        matchedOption = optionsDiv.find(o => isOtherOptionText(o.textContent)) || null;
                        if (matchedOption) console.log(`[Fillo] Degree "${strVal}" not in options — selecting "Other"`);
                    }

                    if (matchedOption) {
                        // Workday needs focus before clicking
                        targetEl.focus({ preventScroll: true });
                        clickOptionWithPointerSequence(matchedOption);
                        selected = true;
                    } else {
                        console.warn('[Fillo] No dropdown option matched for listbox/combo:', strVal);
                        return false;
                    }
                }

                if (!selected) {
                    return false;
                }

                // Fire generic change/blur
                targetEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                mirror('change', Event, { bubbles: true });
                targetEl.dispatchEvent(new FocusEvent('blur', { bubbles: false, cancelable: true }));
                targetEl.dispatchEvent(new FocusEvent('focusout', { bubbles: true, cancelable: true }));
                mirror('blur', FocusEvent, { bubbles: true });
                await dismissWorkdayDropdown(targetEl);

                await new Promise(r => setTimeout(r, 350));

                const finalText = (targetEl.textContent || '').trim();
                if (finalText === initialText || !selectedTextMatchesRequest(finalText)) {
                    console.warn('[Fillo] Dropdown selection did not stick:', strVal);

                    targetEl.focus({ preventScroll: true });
                    targetEl.click();

                    const retryScoped = getOpenDropdownOptions(targetEl);
                    let retryOption = pickOption(retryScoped);
                    if (!retryOption && isDegreeField) {
                        retryOption = retryScoped.find(o => isOtherOptionText(o.textContent)) || null;
                    }

                    if (retryOption) {
                        targetEl.focus({ preventScroll: true });
                        clickOptionWithPointerSequence(retryOption);

                        targetEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                        mirror('change', Event, { bubbles: true });
                        targetEl.dispatchEvent(new FocusEvent('blur', { bubbles: false, cancelable: true }));
                        targetEl.dispatchEvent(new FocusEvent('focusout', { bubbles: true, cancelable: true }));
                        mirror('blur', FocusEvent, { bubbles: true });
                        await dismissWorkdayDropdown(targetEl);
                        await new Promise(r => setTimeout(r, 350));
                    }

                    const retriedText = (targetEl.textContent || '').trim();
                    if (retriedText === initialText || !selectedTextMatchesRequest(retriedText)) {
                        console.warn(`[Fillo] Dropdown selected "${retriedText}" but expected "${strVal}"`);
                        return false;
                    }
                }

            } else if (type === 'checkbox' || type === 'radio') {
                // CHECKBOX/RADIO: set the intended state instead of blindly toggling.
                const valueText = String(value).trim().toLowerCase();
                const wantsChecked = value === true || ['true', 'yes', 'y', '1', 'checked', 'on'].includes(valueText);
                const wantsUnchecked = value === false || ['false', 'no', 'n', '0', 'unchecked', 'off'].includes(valueText);

                if (type === 'checkbox') {
                    if ((wantsChecked && targetEl.checked) || (wantsUnchecked && !targetEl.checked)) {
                        return true;
                    }
                    if (!wantsChecked && !wantsUnchecked) {
                        return false;
                    }
                } else if (type === 'radio') {
                    const radioText = (getRadioOptionText(targetEl) || targetEl.value || '').trim().toLowerCase();
                    const radioValue = String(targetEl.value || '').toLowerCase();
                    const radioGroupText = [
                        targetEl.name,
                        targetEl.id,
                        targetEl.className,
                        targetEl.closest?.('td, .iCIMS_TableRow, fieldset, div')?.textContent
                    ].filter(Boolean).join(' ').toLowerCase();
                    const wantsOptOut = /opt\s*out|don't wish|do not wish|decline|not answer|prefer not/.test(valueText);
                    const wantsProtectedNo = wantsUnchecked && /veteran/.test(radioGroupText);
                    const wantsProtectedYes = wantsChecked && /veteran/.test(radioGroupText);
                    const matchesVeteranOptOut = wantsOptOut && /optout|don'?t wish|do not wish|not answer|decline/.test(`${radioValue} ${radioText}`);
                    const matchesVeteranNo = wantsProtectedNo && /notprotectedveteran|not a protected veteran/.test(`${radioValue} ${radioText}`);
                    const matchesVeteranYes = wantsProtectedYes && /protectedveteran|identify as.*protected veteran/.test(`${radioValue} ${radioText}`) && !/notprotectedveteran|not a protected veteran/.test(`${radioValue} ${radioText}`);
                    const matchesRadio = wantsChecked || matchesVeteranOptOut || matchesVeteranNo || matchesVeteranYes ||
                        radioText === valueText || radioText.startsWith(valueText) || radioValue === valueText;
                    if (!matchesRadio) return false;
                    if (targetEl.checked) return true;
                }

                targetEl.focus({ preventScroll: true });
                targetEl.click();
                targetEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                mirror('change', Event, { bubbles: true });
                targetEl.dispatchEvent(new FocusEvent('blur', { bubbles: true, cancelable: true }));
                mirror('blur', FocusEvent, { bubbles: true });

            } else if (targetEl.getAttribute('role') === 'spinbutton') {
                // Workday date spinbuttons (Month / Year)
                // Needs the same full React event sequence as text inputs
                const strValue = String(value);
                const nativeSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(targetEl), 'value')?.set;

                // Full focus sequence — Workday marks the field "touched" on focusin
                targetEl.dispatchEvent(new FocusEvent('focusin', { bubbles: true, cancelable: true }));
                targetEl.dispatchEvent(new FocusEvent('focus', { bubbles: false, cancelable: true }));
                targetEl.focus({ preventScroll: true });

                if (nativeSetter) nativeSetter.call(targetEl, strValue);
                else targetEl.value = strValue;

                const numVal = parseInt(strValue, 10);
                if (!isNaN(numVal)) {
                    targetEl.setAttribute('aria-valuenow', String(numVal));
                    targetEl.setAttribute('aria-valuetext', strValue);
                }

                targetEl.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: strValue }));
                targetEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

                // Yield so React processes the state update before blur
                await new Promise(r => setTimeout(r, 50));

                // Re-set value in case React reset it during the event cycle
                if (targetEl.value !== strValue) {
                    if (nativeSetter) nativeSetter.call(targetEl, strValue);
                    else targetEl.value = strValue;
                    fillWorkdayReactTextInput(targetEl, strValue);
                    targetEl.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: strValue }));
                    targetEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                    await new Promise(r => setTimeout(r, 50));
                }

                // Blur + focusout — triggers validation
                targetEl.dispatchEvent(new FocusEvent('blur', { bubbles: false, cancelable: true }));
                targetEl.dispatchEvent(new FocusEvent('focusout', { bubbles: true, cancelable: true }));

                // Update the display div sibling that Workday reads
                const parent = targetEl.closest('[id$="-dateSectionMonth"], [id$="-dateSectionYear"]');
                if (parent) {
                    const display = parent.querySelector('[data-automation-id$="-display"]');
                    if (display) display.textContent = strValue;
                }

            } else {
                // TEXT / TEXTAREA / other inputs — including SmartRecruiters combobox autocompletes
                const strValue = String(value);

                // Full focus sequence — Workday listens on focusin to mark field as "touched"
                targetEl.dispatchEvent(new FocusEvent('focusin', { bubbles: true, cancelable: true }));
                targetEl.dispatchEvent(new FocusEvent('focus', { bubbles: false, cancelable: true }));
                targetEl.focus({ preventScroll: true });

                const nativeSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(targetEl), 'value')?.set;

                // If the field already holds a different value (e.g. iCIMS resume-parse auto-fill),
                // explicitly clear first. Some frameworks ignore A→B transitions without an empty state.
                const preExisting = (targetEl.value || '').trim();
                if (preExisting && preExisting !== strValue) {
                    // Select-all then delete so the framework sees a clear keystroke pattern
                    try { targetEl.select?.(); } catch(_) {}
                    targetEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'a', ctrlKey: true }));
                    if (nativeSetter) nativeSetter.call(targetEl, '');
                    else targetEl.value = '';
                    targetEl.setAttribute('value', '');
                    targetEl.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
                    targetEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Backspace' }));
                    await new Promise(r => setTimeout(r, 30));
                }

                // Set via React's native setter to update React fiber state
                if (nativeSetter) nativeSetter.call(targetEl, strValue);
                else targetEl.value = strValue;
                fillWorkdayReactTextInput(targetEl, strValue);

                // Set attribute as well for Custom Web Components (like <spl-input>) which often track attributes
                targetEl.setAttribute('value', strValue);
                if (targetEl !== element) {
                    element.setAttribute('value', strValue);
                    element.value = strValue;
                }

                // Fire input event — React 16+ listens on this for controlled components
                targetEl.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: strValue }));
                if (targetEl !== element) element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: strValue }));

                // Fire keyboard events for the last character to trigger debounced handlers
                const lastChar = strValue.slice(-1) || 'a';
                const keyOpt = { bubbles: true, cancelable: true, key: lastChar, code: `Key${lastChar.toUpperCase()}`, charCode: lastChar.charCodeAt(0) };

                targetEl.dispatchEvent(new KeyboardEvent('keydown',  keyOpt));
                targetEl.dispatchEvent(new KeyboardEvent('keypress', keyOpt));
                targetEl.dispatchEvent(new KeyboardEvent('keyup',    keyOpt));

                // Change event — triggers form-level state updates
                targetEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                mirror('change', Event, { bubbles: true });

                // Dispatch Custom Event for Angular Web Components directly
                if (element.tagName.includes('-')) {
                    element.dispatchEvent(new CustomEvent('valueChanged', { detail: strValue, bubbles: true }));
                }

                // Small yield so React processes the state update before blur
                await new Promise(r => setTimeout(r, 50));

                // Re-set value in case React reset it during the event cycle
                if (targetEl.value !== strValue) {
                    if (nativeSetter) nativeSetter.call(targetEl, strValue);
                    else targetEl.value = strValue;
                    fillWorkdayReactTextInput(targetEl, strValue);
                    targetEl.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: strValue }));
                    targetEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                }

                // SmartRecruiters / Generic Autocomplete Handling
                // Check both the inner input (targetEl) and the outer wrapper (element)
                // since spl-autocomplete wraps a plain <input> inside its shadow DOM
                const isAutocomplete = targetEl.getAttribute('role') === 'combobox' ||
                    (targetEl.name && targetEl.name.toLowerCase().includes('autocomplete')) ||
                    (targetEl.id && targetEl.id.toLowerCase().includes('autocomplete')) ||
                    (element !== targetEl && (
                        element.tagName.toLowerCase().includes('autocomplete') ||
                        element.getAttribute('role') === 'combobox' ||
                        (element.getAttribute('data-test') || '').toLowerCase().includes('autocomplete')
                    ));

                if (isAutocomplete) {
                    let autocompleteOptions = [];

                    // Helper to deeply query elements, bypassing Shadow DOM boundaries
                    const querySelectorAllDeep = (selector, root = document) => {
                        let results = Array.from(root.querySelectorAll(selector));
                        for (const el of root.querySelectorAll('*')) {
                            if (el.shadowRoot) results = results.concat(querySelectorAllDeep(selector, el.shadowRoot));
                        }
                        return results;
                    };

                    // Poll for dropdown options to appear (up to 2 seconds)
                    const optionSelector = '[role="option"], spl-autocomplete-option, sri-autocomplete-option, li[role="option"], ul[class*="autocomplete"] li, div[class*="option"], div[id*="listbox"] > div';
                    for (let i = 0; i < 20; i++) {
                        await new Promise(r => setTimeout(r, 100));

                        // Search the wrapper element's shadow root first (spl-autocomplete stores options there)
                        let visibleOptions = [];
                        if (element !== targetEl && element.shadowRoot) {
                            visibleOptions = querySelectorAllDeep(optionSelector, element.shadowRoot);
                        }
                        // Fallback: search entire document (options may be in a portal/overlay)
                        if (visibleOptions.length === 0) {
                            visibleOptions = querySelectorAllDeep(optionSelector);
                        }

                        visibleOptions = visibleOptions
                            .filter(o => isElementVisible(o))
                            .filter(o => {
                                const t = o.textContent.toLowerCase();
                                return t.length > 0 && !t.includes('loading') && !t.includes('searching') && !t.includes('no result') && !t.includes('type to search') && !t.includes('no matches');
                            });

                        if (visibleOptions.length > 0) {
                            autocompleteOptions = visibleOptions;
                            break;
                        }
                    }

                    if (autocompleteOptions.length > 0) {
                        console.log(`[Autocomplete] Found ${autocompleteOptions.length} valid options in Shadow DOM. Selecting first: "${autocompleteOptions[0].textContent.trim()}"`);

                        // 1. Simulate standard keyboard navigation (ArrowDown -> Enter) which hooks natively into framework state
                        targetEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 }));
                        targetEl.dispatchEvent(new KeyboardEvent('keyup',   { bubbles: true, cancelable: true, key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 }));
                        await new Promise(r => setTimeout(r, 100));
                        targetEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
                        targetEl.dispatchEvent(new KeyboardEvent('keyup',   { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));

                        // 2. Fallback to a physical pointer/mouse click sequence on the actual option element
                        // Dig into the option to click the span or inner text container if it exists
                        const firstOption = autocompleteOptions[0];
                        const clickTarget = firstOption.querySelector('span, div') || firstOption;

                        clickTarget.scrollIntoView({ block: 'nearest' });
                        clickTarget.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
                        clickTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                        clickTarget.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
                        clickTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                        clickTarget.click();

                        // Crucial wait for SmartRecruiters: give it time to process the selection
                        // before the blur event fires, otherwise it thinks you clicked away and cancels it
                        await new Promise(r => setTimeout(r, 800));
                    } else {
                        console.log(`[Autocomplete] Could NOT find any DOM options after typing. Framework might be completely hidden.`);
                    }
                }

                // Final value check before blur — Workday can reset controlled inputs
                if (targetEl.value !== strValue) {
                    if (nativeSetter) nativeSetter.call(targetEl, strValue);
                    else targetEl.value = strValue;
                    targetEl.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: strValue }));
                    targetEl.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                    await new Promise(r => setTimeout(r, 50));
                }

                // Blur — triggers validation / closes dropdown
                targetEl.dispatchEvent(new FocusEvent('blur', { bubbles: false, cancelable: true }));
                targetEl.dispatchEvent(new FocusEvent('focusout', { bubbles: true, cancelable: true }));
                mirror('blur', FocusEvent, { bubbles: true });
            }

            return true;
        } catch (e) {
            console.error('Error filling element:', e);
            return false;
        }
    }

    function getElementContext(el) {
        // For custom components, we often want the attributes of the wrapper
        // but the value/type from the inner input.
        const inner = el.querySelector('input, textarea, select') ||
                      el.shadowRoot?.querySelector('input, textarea, select');

        const target = inner || el;

        return {
            name: (el.name || el.getAttribute('name') || el.getAttribute('data-automation-id') || el.getAttribute('data-test') || '').toLowerCase(),
            id: el.id?.toLowerCase() || '',
            placeholder: (target.placeholder || el.getAttribute('placeholder') || '').toLowerCase(),
            label: (getFieldLabel(el) || '').toLowerCase(),
            type: (target.type || el.getAttribute('type') || '').toLowerCase()
        };
    }

    function getSemanticFieldText(el, fallback = '') {
        const formField = el?.closest?.('[data-automation-id^="formField-"]');
        const formLabel = (formField?.querySelector('[data-automation-id="richText"], label, legend')?.textContent || '').toLowerCase();
        return [
            fallback,
            el?.name,
            el?.id,
            el?.getAttribute?.('data-automation-id'),
            el?.getAttribute?.('data-fkit-id'),
            getFieldLabel(el),
            formLabel
        ].filter(Boolean).join(' ').toLowerCase();
    }


    function getFieldIdentity(el) {
        const parts = [
            el.name || '',
            el.id || '',
            el.getAttribute('data-automation-id') || '',
            el.getAttribute('data-fkit-id') || '',
            el.getAttribute('aria-label') || '',
            el.placeholder || '',
            el.getAttribute('data-testid') || ''
        ];
        const identity = parts.filter(Boolean).join('|');
        return identity || null;
    }

    function attrSelector(attr, value) {
        if (!value) return null;
        const escaped = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return `[${attr}="${escaped}"]`;
    }

    function isErroredField(element) {
        return !!element?.closest?.('.iCIMS_HasError, .has-error, [aria-invalid="true"]') ||
            element?.getAttribute?.('aria-invalid') === 'true';
    }

    function markFieldFilled(element, strategy, fieldTracker) {
        if (!element || !fieldTracker) return;
        const formField = element.closest?.('[data-automation-id^="formField-"]');
        const alreadyTracked = fieldTracker.filledElements.has(element) ||
            (formField && fieldTracker.filledElements.has(formField));
        fieldTracker.filledElements.add(element);
        if (formField) fieldTracker.filledElements.add(formField);
        if (!alreadyTracked) {
            fieldTracker.strategyStats[strategy] = (fieldTracker.strategyStats[strategy] || 0) + 1;
        }
        // iCIMS revert guard: snapshot the value we just set so we can detect if iCIMS overwrites it
        if (fieldTracker.filledValues) {
            const tag = element.tagName?.toLowerCase();
            if (tag === 'input' || tag === 'textarea') {
                fieldTracker.filledValues.set(element, element.value);
            }
        }
    }

    /**
     * Check if a field has already been filled
     * @param {HTMLElement} element - The DOM element to check
     * @param {Object} fieldTracker - The field tracker object
     * @returns {boolean} - True if the element is already filled
     */
    function isFieldFilled(element, fieldTracker) {
        if (fieldTracker?.allowRefill) {
            return fieldTracker.filledElements.has(element);
        }
        if (fieldTracker.filledElements.has(element)) return true;
        if (isErroredField(element)) return false;

        const tag = element.tagName?.toLowerCase();
        const type = (element.type || '').toLowerCase();
        if (type === 'checkbox' || type === 'radio') {
            return !!element.checked;
        }

        if (tag === 'button' && (element.getAttribute('aria-haspopup') === 'listbox' || element.getAttribute('role') === 'combobox')) {
            const text = (element.textContent || '').trim().toLowerCase();
            const isPlaceholder = !text || text.includes('select') || text.includes('choose') || text.includes('please');
            return !isPlaceholder;
        }

        return !!(element.value && element.value.trim() !== '');
    }

    function normalizeFieldText(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/\*/g, ' ')
            .replace(/&/g, ' and ')
            .replace(/[_-]+/g, ' ')
            .replace(/[^a-z0-9+]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function getContextLabel(element, container = null) {
        const scope = container || element?.closest?.('[data-automation-id^="formField-"], fieldset, .form-group, .iCIMS_Forms_Field, td') || null;
        const richText = scope?.querySelector?.([
            'legend div[data-automation-id="richText"] p span',
            'legend div[data-automation-id="richText"] p',
            'legend div[data-automation-id="richText"]',
            '[data-automation-id="richText"]',
            '[data-automation-id="formLabel"]',
            'legend',
            'label'
        ].join(', '));
        const label = richText?.textContent || getFieldLabel(element) || element?.getAttribute?.('aria-label') || '';
        return String(label || '').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
    }

    function getOptionText(input) {
        if (!input) return '';
        const label = getFieldLabel(input);
        if (label) return label.replace(/\s+/g, ' ').trim();
        const labelParent = input.closest?.('label');
        if (labelParent?.textContent) {
            return labelParent.textContent.replace(input.value || '', '').replace(/\s+/g, ' ').trim();
        }
        const wrapper = input.closest?.('[data-automation-id*="checkbox"], [data-automation-id*="radio"], div, span, li') || input.parentElement;
        return (wrapper?.textContent || input.value || '').replace(/\s+/g, ' ').trim();
    }

    function getChoiceClickTarget(input) {
        if (!input) return null;
        if (input.id) {
            try {
                const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
                if (label && isElementVisible(label)) return label;
            } catch (_) {}
        }
        const parentLabel = input.closest?.('label');
        if (parentLabel && isElementVisible(parentLabel)) return parentLabel;
        const wrapper = input.closest?.('[data-automation-id*="checkbox"], [data-automation-id*="radio"], [role="checkbox"], [role="radio"], div, span');
        return wrapper && isElementVisible(wrapper) ? wrapper : input;
    }

    function getNormalizedFieldIdentity(field) {
        const element = field?.container || field?.element || field?.elements?.[0];
        const rect = element?.getBoundingClientRect?.();
        return [
            field?.type || '',
            field?.name || '',
            field?.id || '',
            field?.automationId || '',
            field?.fkitId || '',
            normalizeFieldText(field?.label || '').slice(0, 80),
            rect ? Math.round(rect.top) : ''
        ].filter(Boolean).join('|');
    }

    function isNormalizedFieldFilled(field, fieldTracker) {
        if (!field) return true;
        if (fieldTracker?.normalizedFilledIds?.has(field.identity)) return true;
        const targets = [field.container, field.element, ...(field.elements || [])].filter(Boolean);
        if (targets.some(el => fieldTracker?.filledElements?.has(el))) return true;
        if (fieldTracker?.allowRefill) return false;

        if (field.type === 'checkboxGroup' || field.type === 'radio') {
            return (field.elements || []).some(el => !!el.checked);
        }
        if (field.element) return isFieldFilled(field.element, fieldTracker);
        return false;
    }

    function detectNormalizedType(element, container = null, groupElements = null) {
        if (groupElements?.length) {
            const groupType = (groupElements[0].type || '').toLowerCase();
            return groupType === 'radio' ? 'radio' : 'checkboxGroup';
        }
        const tag = element?.tagName?.toLowerCase();
        const type = (element?.type || '').toLowerCase();
        if (container?.querySelector?.('[data-automation-id="dateInputWrapper"]')) return 'date';
        if (tag === 'select') return 'select';
        if (tag === 'textarea') return 'textarea';
        if (tag === 'button' && (element.getAttribute('aria-haspopup') === 'listbox' || element.getAttribute('role') === 'combobox')) return 'workdayDropdown';
        if (element?.getAttribute?.('role') === 'combobox') return 'workdayDropdown';
        if (type === 'date') return 'date';
        if (type === 'radio') return 'radio';
        if (type === 'checkbox') return 'checkboxGroup';
        return 'text';
    }

    function buildNormalizedField(element, { container = null, groupElements = null } = {}) {
        if (!element && !groupElements?.length) return null;
        const target = element || groupElements[0];
        const scope = container || target.closest?.('[data-automation-id^="formField-"], fieldset, .form-group, .iCIMS_Forms_Field, td') || target;
        const type = detectNormalizedType(target, scope, groupElements);
        const options = [];
        if (groupElements?.length) {
            for (const optionEl of groupElements) {
                const text = getOptionText(optionEl);
                if (text) options.push(text);
            }
        } else if (target?.tagName?.toLowerCase() === 'select') {
            for (const option of Array.from(target.options || [])) {
                const text = option.textContent?.trim();
                if (text && !/select|choose/i.test(text)) options.push(text);
            }
        }

        const automationId = scope?.getAttribute?.('data-automation-id') || target?.getAttribute?.('data-automation-id') || '';
        const fkitId = scope?.getAttribute?.('data-fkit-id') || target?.getAttribute?.('data-fkit-id') || '';
        const field = {
            element: target,
            container: scope,
            elements: groupElements || null,
            type,
            label: getContextLabel(target, scope),
            name: target?.name || target?.getAttribute?.('name') || '',
            id: target?.id || target?.getAttribute?.('id') || '',
            automationId,
            fkitId,
            ariaLabel: target?.getAttribute?.('aria-label') || '',
            placeholder: target?.getAttribute?.('placeholder') || '',
            options,
            containerText: (scope?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 800)
        };
        field.identity = getNormalizedFieldIdentity(field);
        return field;
    }

    function scanNormalizedFields(fieldTracker) {
        const fields = [];
        const seen = new Set();
        const consumed = new WeakSet();

        const addField = (field) => {
            if (!field?.element) return;
            const isChoice = field.type === 'checkboxGroup' || field.type === 'radio';
            if (!isChoice && !isElementVisible(field.element)) return;
            if (isChoice && field.container && !isElementVisible(field.container) && !field.elements?.some(el => isElementVisible(getChoiceClickTarget(el)))) return;
            if (isNormalizedFieldFilled(field, fieldTracker)) return;
            if (seen.has(field.identity)) return;
            seen.add(field.identity);
            fields.push(field);
        };

        for (const container of Array.from(document.querySelectorAll('[data-automation-id^="formField-"], fieldset'))) {
            if (!isElementVisible(container)) continue;
            const choiceInputs = Array.from(container.querySelectorAll('input[type="radio"], input[type="checkbox"]'))
                .filter(el => !el.disabled);
            if (choiceInputs.length > 1) {
                choiceInputs.forEach(el => consumed.add(el));
                addField(buildNormalizedField(choiceInputs[0], { container, groupElements: choiceInputs }));
                continue;
            }

            const target = container.querySelector('input:not([type="hidden"]):not([type="file"]), textarea, select, button[aria-haspopup="listbox"], [role="combobox"]');
            if (target && !consumed.has(target) && isElementVisible(target) && !target.disabled) {
                consumed.add(target);
                addField(buildNormalizedField(target, { container }));
            }
        }

        const radioNames = new Set();
        for (const input of Array.from(document.querySelectorAll('input[type="radio"], input[type="checkbox"]'))) {
            if (consumed.has(input) || input.disabled) continue;
            const key = input.name ? `${input.type}:${input.name}` : `${input.type}:${input.id || input.value || getOptionText(input)}`;
            if (radioNames.has(key)) continue;
            const group = input.name
                ? Array.from(document.querySelectorAll(`input[type="${CSS.escape(input.type)}"][name="${CSS.escape(input.name)}"]`)).filter(el => isElementVisible(el) && !el.disabled)
                : [input];
            group.forEach(el => consumed.add(el));
            radioNames.add(key);
            addField(buildNormalizedField(input, { container: input.closest('fieldset, [data-automation-id^="formField-"], .form-group, td'), groupElements: group }));
        }

        for (const el of Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="file"]), textarea, select, button[aria-haspopup="listbox"], [role="combobox"]'))) {
            if (consumed.has(el) || !isElementVisible(el) || el.disabled) continue;
            addField(buildNormalizedField(el));
        }

        return fields.sort((a, b) => getVisualOrderKey(a.element) - getVisualOrderKey(b.element));
    }

    function getFieldSearchText(field) {
        return normalizeFieldText([
            field.label,
            field.name,
            field.id,
            field.automationId,
            field.fkitId,
            field.ariaLabel,
            field.placeholder,
            field.containerText,
            ...(field.options || [])
        ].filter(Boolean).join(' '));
    }

    function scoreNormalizedField(field, mapping) {
        const fieldText = getFieldSearchText(field);
        if (!fieldText || !mapping) return 0;
        let score = 0;
        const mappingName = normalizeFieldText(mapping.name || '');
        const mappingLabel = normalizeFieldText(mapping.label || '');
        const mappingKey = normalizeFieldText(mapping.key || '');

        if (mappingName && [field.name, field.id, field.automationId.replace(/^formField-/, ''), field.fkitId].some(v => normalizeFieldText(v) === mappingName)) score += 35;
        if (mappingLabel && normalizeFieldText(field.label) === mappingLabel) score += 30;
        if (mappingKey && fieldText.includes(mappingKey)) score += 15;
        if (mappingName && fieldText.includes(mappingName)) score += 12;
        if (mappingLabel && mappingLabel.length > 3 && fieldText.includes(mappingLabel)) score += 12;

        for (const pattern of mapping.patterns || []) {
            const normalizedPattern = normalizeFieldText(pattern);
            if (!normalizedPattern) continue;
            if (fieldText.includes(normalizedPattern)) score += 10;
        }

        const expectedType = String(mapping.type || '').toLowerCase();
        if (expectedType) {
            const isChoiceMapping = ['single_choice', 'checkboxgroup', 'radio'].includes(expectedType);
            const isChoiceField = field.type === 'checkboxGroup' || field.type === 'radio';
            if (isChoiceMapping && isChoiceField) score += 8;
            if (!isChoiceMapping && isChoiceField && !['checkbox', 'boolean'].includes(expectedType)) score -= 12;
            if (expectedType === 'date' && field.type === 'date') score += 8;
            if ((expectedType === 'text' || expectedType === 'textarea') && (field.type === 'text' || field.type === 'textarea')) score += 4;
        }

        return score;
    }

    function findBestNormalizedMapping(field, mappings) {
        let best = null;
        let bestScore = 0;
        for (const mapping of mappings || []) {
            if (!mapping?.profilePath) continue;
            const score = scoreNormalizedField(field, mapping);
            if (score > bestScore) {
                best = mapping;
                bestScore = score;
            }
        }
        return bestScore >= 18 ? { mapping: best, score: bestScore } : null;
    }

    function resolveMappedValue(profileData, mapping) {
        if (!mapping?.profilePath) return null;
        if (mapping.profilePath === '__today') return new Date();
        const value = getProfileValueForPath(profileData, mapping.profilePath);
        if (value != null && value !== '') return value;
        return Object.prototype.hasOwnProperty.call(mapping, 'default') ? mapping.default : null;
    }

    function getBuiltInClassifierMappings(platform) {
        if (platform !== 'workday') return [];
        return [
            {
                key: 'dateSignedOn',
                name: 'dateSignedOn',
                label: 'Disability Date Signed On',
                type: 'date',
                profilePath: '__today',
                patterns: [
                    'selfidentifieddisabilitydata datesignedon',
                    'self identified disability date signed on',
                    'date signed on',
                    'datesignedon'
                ]
            },
            {
                key: 'disability_status',
                name: 'disabilityStatus',
                label: 'Please check one of the boxes below:',
                type: 'single_choice',
                profilePath: 'job_preferences.eeo.disability_status',
                patterns: [
                    'formfield disabilitystatus',
                    'disabilitystatus checkboxgroup',
                    'selfidentifieddisabilitydata disabilitystatus',
                    'self identified disability',
                    'disability status',
                    'please check one of the boxes below',
                    'ofccp'
                ],
                options: [
                    'Yes, I have a disability, or have had one in the past',
                    'No, I do not have a disability and have not had one in the past',
                    'I do not want to answer'
                ],
                default: 'I do not want to answer'
            }
        ];
    }

    function normalizeDateValue(value) {
        const date = value instanceof Date ? value : null;
        if (date && !Number.isNaN(date.getTime())) {
            return {
                year: String(date.getFullYear()),
                month: String(date.getMonth() + 1).padStart(2, '0'),
                day: String(date.getDate()).padStart(2, '0'),
                iso: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
            };
        }

        const str = String(value || '').trim();
        let month = null, day = null, year = null;
        let match = str.match(/^(\d{4})[\/\-](\d{1,2})(?:[\/\-](\d{1,2}))?$/);
        if (match) { year = match[1]; month = match[2]; day = match[3] || null; }
        if (!year) {
            match = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
            if (match) { month = match[1]; day = match[2]; year = match[3]; }
        }
        if (!year) {
            match = str.match(/^(\d{1,2})[\/\-](\d{4})$/);
            if (match) { month = match[1]; year = match[2]; }
        }
        if (!year) {
            const monthNames = { jan:1, january:1, feb:2, february:2, mar:3, march:3, apr:4, april:4, may:5, jun:6, june:6, jul:7, july:7, aug:8, august:8, sep:9, september:9, oct:10, october:10, nov:11, november:11, dec:12, december:12 };
            match = str.match(/^([a-zA-Z]+)\s+(\d{1,2},\s*)?(\d{4})$/);
            if (match) { month = String(monthNames[match[1].toLowerCase()] || ''); day = match[2]?.replace(/\D/g, '') || null; year = match[3]; }
        }
        if (!year && /^\d{4}$/.test(str)) year = str;
        return {
            year,
            month: month ? String(parseInt(month, 10)).padStart(2, '0') : null,
            day: day ? String(parseInt(day, 10)).padStart(2, '0') : null,
            iso: year && month && day ? `${year}-${String(parseInt(month, 10)).padStart(2, '0')}-${String(parseInt(day, 10)).padStart(2, '0')}` : str
        };
    }

    async function fillNormalizedDate(field, value, fieldTracker) {
        const parts = normalizeDateValue(value);
        if (!parts.year && !parts.iso) return false;
        const wrapper = field.container?.querySelector?.('[data-automation-id="dateInputWrapper"]') ||
            field.element?.closest?.('[data-automation-id="dateInputWrapper"]');
        if (wrapper) {
            let filled = false;
            const monthInput = wrapper.querySelector('[data-automation-id="dateSectionMonth-input"], input[aria-label*="month" i]');
            const dayInput = wrapper.querySelector('[data-automation-id="dateSectionDay-input"], input[aria-label*="day" i]');
            const yearInput = wrapper.querySelector('[data-automation-id="dateSectionYear-input"], input[aria-label*="year" i]');
            if (monthInput && parts.month) { await fillElement(monthInput, String(parseInt(parts.month, 10))); filled = true; }
            if (dayInput && parts.day) { await fillElement(dayInput, String(parseInt(parts.day, 10))); filled = true; }
            if (yearInput && parts.year) { await fillElement(yearInput, parts.year); filled = true; }
            if (filled) {
                markFieldFilled(wrapper, 'classifier', fieldTracker);
                return true;
            }
        }
        if (field.element) {
            return await fillElement(field.element, field.element.type === 'date' ? parts.iso : [parts.month, parts.day, parts.year].filter(Boolean).join('/'));
        }
        return false;
    }

    // OFCCP/EEO disability and veteran special-case scoring shared between scoreScreeningChoice and scoreChoiceOption.
    // semanticValue: 'decline' | 'opt_out' | 'no_disability' | 'has_disability' | 'not_protected_veteran' | 'protected_veteran'
    // Returns adjusted score, or null if no special case applies (caller should fall through to regular scoring).
    function applyChoiceSpecialCases(optionRaw, semanticValue, currentScore) {
        const optOut = /do not wish|don't wish|do not want|prefer not|not answer|decline|self[- ]?identify|opt out/i;
        switch (semanticValue) {
            case 'decline': case 'opt_out':
                return optOut.test(optionRaw) ? Math.max(currentScore, 100) : currentScore;
            case 'no_disability':
                if (/^no\b|do not have.*disability|have not had.*disability|not disabled/.test(optionRaw)) return 100;
                if (optOut.test(optionRaw)) return Math.min(currentScore, 20);
                return null;
            case 'has_disability':
                if (/^yes\b|have.*disability|had.*disability|disabled/.test(optionRaw) &&
                    !/do not have|have not had|not disabled|do not want|not answer/.test(optionRaw)) return 100;
                if (/do not have|have not had|not disabled|do not want|not answer/.test(optionRaw)) return 0;
                return null;
            case 'not_protected_veteran':
                if (/not (a )?protected veteran/i.test(optionRaw)) return Math.max(currentScore, /just not/i.test(optionRaw) ? 100 : 92);
                if (/protected veteran/i.test(optionRaw) && !/not/i.test(optionRaw)) return Math.min(currentScore, 20);
                return null;
            case 'protected_veteran':
                if (/one or more.*protected veteran|classifications of protected veteran|identify as.*protected veteran/i.test(optionRaw) &&
                    !/not|do not wish|not answer/i.test(optionRaw)) return Math.max(currentScore, 100);
                return null;
            default:
                return null;
        }
    }

    function scoreChoiceOption(optionText, wantedValue) {
        const option = normalizeSelectText(optionText);
        const wanted = normalizeSelectText(wantedValue);
        if (!option || !wanted) return 0;

        const optionRaw = String(optionText || '').toLowerCase();
        const wantedRaw = String(wantedValue || '').toLowerCase();
        const wantsOptOut = /do not want|do not wish|don't wish|prefer not|decline|not answer/.test(wantedRaw);
        if (wantsOptOut) {
            return /do not want|do not wish|don't wish|prefer not|decline|not answer/.test(optionRaw) ? 100 : 0;
        }
        // Disability-specific paths use the shared helper
        const disabilityKey = /do not have.*disability|have not had.*disability|not disabled|no disability/.test(wantedRaw) ? 'no_disability'
            : (/have.*disability|had.*disability|disabled/.test(wantedRaw) && !/not disabled|do not have/.test(wantedRaw)) ? 'has_disability'
            : null;
        if (disabilityKey) {
            const sc = applyChoiceSpecialCases(optionRaw, disabilityKey, 0);
            if (sc !== null) return sc;
        }
        const wantsNo = /^(no|false|n|0)\b/.test(wantedRaw);
        if (wantsNo) {
            if (/^no\b|do not have.*disability|have not had.*disability|not disabled|no disability/.test(optionRaw)) return 100;
            if (/do not want|do not wish|not answer/.test(optionRaw)) return 0;
        }
        const wantsYes = /^(yes|true|y|1)\b/.test(wantedRaw);
        if (wantsYes) {
            if (/^yes\b|have.*disability|had.*disability|disabled/.test(optionRaw) &&
                !/do not have|have not had|not disabled|do not want|not answer/.test(optionRaw)) return 100;
            if (/do not have|have not had|not disabled|do not want|not answer/.test(optionRaw)) return 0;
        }

        if (selectionTextMatches(optionText, wantedValue)) return 100;
        if (option.startsWith(wanted)) return 85;
        if (option.includes(wanted)) return 75;
        if (wanted.includes(option) && option.length > 2) return 55;
        const wantedWords = wanted.split(/\s+/).filter(w => w.length > 2);
        if (!wantedWords.length) return 0;
        const optionWords = option.split(/\s+/);
        const hits = wantedWords.filter(w => optionWords.some(ow => ow === w || ow.includes(w) || w.includes(ow))).length;
        return Math.floor((hits / wantedWords.length) * 60);
    }

    async function fillChoiceGroup(field, value, fieldTracker) {
        const elements = field.elements || [];
        if (!elements.length) return false;
        const ranked = elements
            .map((el, idx) => ({ el, idx, text: getOptionText(el), score: scoreChoiceOption(getOptionText(el), value) }))
            .sort((a, b) => b.score - a.score || a.idx - b.idx);
        const best = ranked[0];
        if (!best || best.score < 40) {
            console.log(`[Fillo] No choice option matched "${value}" for "${field.label || field.name || field.identity}"`);
            return false;
        }
        if (best.el.checked) {
            markFieldFilled(best.el, 'classifier', fieldTracker);
            return true;
        }
        const clickTarget = getChoiceClickTarget(best.el);
        best.el.focus?.();
        clickLikeUser(clickTarget || best.el);
        best.el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        markFieldFilled(best.el, 'classifier', fieldTracker);
        return true;
    }

    function logUnknownNormalizedField(field, fieldTracker) {
        const id = field.identity || getNormalizedFieldIdentity(field);
        if (unknownFieldLogIds.has(id)) return;
        unknownFieldLogIds.add(id);
        if (!fieldTracker?.unknownFieldIds) return;
        if (fieldTracker.unknownFieldIds.has(id)) return;
        fieldTracker.unknownFieldIds.add(id);
        const label = field.label || field.ariaLabel || field.placeholder || field.name || field.id || '(unlabeled)';
        console.log(`[Fillo] Unknown field: "${label}"`, {
            type: field.type,
            name: field.name,
            id: field.id,
            automationId: field.automationId,
            fkitId: field.fkitId,
            options: field.options || []
        });
    }

    async function fillByClassifier(profileData, mappings, fieldTracker) {
        if (!Array.isArray(mappings) || mappings.length === 0) return 0;
        const fields = scanNormalizedFields(fieldTracker);
        // Fill in strict top-to-bottom visual order, matching the rest of the run.
        fields.sort((a, b) => getVisualOrderKey(a.element) - getVisualOrderKey(b.element));
        let filled = 0;

        for (const field of fields) {
            const best = findBestNormalizedMapping(field, mappings);
            if (!best) {
                logUnknownNormalizedField(field, fieldTracker);
                continue;
            }

            const value = resolveMappedValue(profileData, best.mapping);
            if (value == null || value === '') continue;

            try {
                const mappingType = String(best.mapping.type || '').toLowerCase();
                let success = false;
                if (field.type === 'checkboxGroup' || field.type === 'radio' || ['single_choice', 'checkboxgroup', 'radio'].includes(mappingType)) {
                    success = await fillChoiceGroup(field, value, fieldTracker);
                } else if (field.type === 'date' || mappingType === 'date') {
                    success = await fillNormalizedDate(field, value, fieldTracker);
                } else if (field.element) {
                    const displayValue = Array.isArray(value) ? value.join(', ') : (value instanceof Date ? normalizeDateValue(value).iso : String(value));
                    success = await fillElement(field.element, displayValue);
                    if (success) markFieldFilled(field.element, 'classifier', fieldTracker);
                }

                if (success) {
                    fieldTracker.normalizedFilledIds?.add(field.identity);
                    if (field.container) fieldTracker.filledElements.add(field.container);
                    relayLog('info', `[Classifier] "${field.label || field.name || field.identity}" → ${best.mapping.profilePath}`);
                    filled++;
                    await new Promise(r => setTimeout(r, 30));
                }
            } catch (error) {
                console.warn('[Fillo] Classifier fill failed:', field, error);
            }
        }

        return filled;
    }

    function fileInputHasExistingFile(fileInput) {
        if (!fileInput) return false;
        if (fileInput.files && fileInput.files.length > 0) return true;
        if ((fileInput.value || '').trim()) return true;

        const describedBy = (fileInput.getAttribute('aria-describedby') || '')
            .split(/\s+/)
            .filter(Boolean)
            .map(id => document.getElementById(id)?.textContent || '')
            .join(' ');
        const nearbyText = [
            describedBy,
            fileInput.closest('[data-automation-id*="resume" i], [data-automation-id*="attachment" i], [data-test*="resume" i], [id*="resume" i], label')?.textContent || '',
            fileInput.parentElement?.textContent || ''
        ].join(' ');

        const hasFileName = /\b[\w .'-]+\.(pdf|docx?|txt|rtf)\b/i.test(nearbyText);
        const hasUploadedText = /\b(file|resume|attachment)\s+(uploaded|attached|selected)\b/i.test(nearbyText);
        if (hasFileName || hasUploadedText) return true;

        return false;
    }

    /**
     * Inject a page-context XHR interceptor that silently empties iCIMS resume parse responses.
     * The file upload request goes to a different URL and is unaffected.
     * Returns a cleanup function that removes the interceptor.
     */
    function injectICIMSParseBlocker() {
        const script = document.createElement('script');
        script.id = '__fillo_icims_parse_blocker__';
        script.textContent = `(function(){
            window.__filloBlockICIMSParse = true;
            // URL patterns that identify iCIMS resume PARSE calls (not the file upload itself)
            const PARSE_PATTERN = /resumeParser|resume[_-]?parse|parseResume|extractResume|ResumeAttachment[_-]?Handler|icims[_-]resume[_-]parse/i;
            const origOpen = XMLHttpRequest.prototype.open;
            const origSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.open = function(method, url) {
                if (window.__filloBlockICIMSParse && typeof url === 'string' && PARSE_PATTERN.test(url)) {
                    this.__filloParseBlock = true;
                    console.log('[Fillo] Blocking iCIMS resume parse:', url);
                }
                return origOpen.apply(this, arguments);
            };
            XMLHttpRequest.prototype.send = function(body) {
                if (this.__filloParseBlock) {
                    // Let the request fire (so the server knows a parse was requested)
                    // but intercept the response before iCIMS processes it.
                    const xhr = this;
                    const origOnReady = xhr.onreadystatechange;
                    xhr.onreadystatechange = function() {
                        if (xhr.readyState === 4) {
                            // Replace response with empty JSON so iCIMS auto-fill finds no fields
                            try {
                                Object.defineProperty(xhr, 'responseText', { get: () => '{}', configurable: true });
                                Object.defineProperty(xhr, 'response',     { get: () => '{}', configurable: true });
                            } catch(_) {}
                        }
                        if (origOnReady) origOnReady.apply(xhr, arguments);
                    };
                    // Also cover addEventListener-based handlers
                    const origAEL = xhr.addEventListener.bind(xhr);
                    xhr.addEventListener = function(type, handler, ...rest) {
                        if (type === 'load' || type === 'readystatechange') {
                            const wrapped = function(e) {
                                try {
                                    Object.defineProperty(xhr, 'responseText', { get: () => '{}', configurable: true });
                                    Object.defineProperty(xhr, 'response',     { get: () => '{}', configurable: true });
                                } catch(_) {}
                                handler.apply(this, arguments);
                            };
                            return origAEL(type, wrapped, ...rest);
                        }
                        return origAEL(type, handler, ...rest);
                    };
                }
                return origSend.apply(this, arguments);
            };
        })();`;
        (document.head || document.documentElement).appendChild(script);
        script.remove(); // runs synchronously; remove tag after execution

        return function removeICIMSParseBlocker() {
            // Signal the injected code to stop blocking
            try { window.__filloBlockICIMSParse = false; } catch (_) {}
        };
    }

    async function uploadResumeIfPossible() {
        if (!ns.state.resumeDataUri) return false;

        let fileInput = null;
        const icimsResumeSelectors = [
            'input[type="file"][name*="resume" i]',
            'input[type="file"][id*="resume" i]',
            '[data-test*="resume" i] input[type="file"]',
            '[data-automation-id*="resume" i] input[type="file"]',
            '[aria-label*="resume" i] input[type="file"]',
            '[id*="resume" i] input[type="file"]'
        ];

        for (const sel of icimsResumeSelectors) {
            for (const input of document.querySelectorAll(sel)) {
                if (!isElementVisible(input)) continue;
                fileInput = input;
                break;
            }
            if (fileInput) break;
        }

        if (!fileInput) {
            const allFileInputs = Array.from(document.querySelectorAll('input[type="file"]')).filter(isElementVisible);
            if (allFileInputs.length === 1) {
                fileInput = allFileInputs[0];
            }
        }

        if (!fileInput) return false;
        if (fileInputHasExistingFile(fileInput)) {
            relayLog('info', '[Fillo] Resume upload skipped because the form already has a file selected');
            return false;
        }

        try {
            const res = await fetch(ns.state.resumeDataUri);
            const blob = await res.blob();
            const fileObj = new File([blob], ns.state.resumeFileName || 'resume.pdf', { type: blob.type || 'application/pdf' });

            const dt = new DataTransfer();
            dt.items.add(fileObj);
            fileInput.files = dt.files;

            // Let the platform process the resume, but do not replace an existing file
            // selection or existing field values elsewhere in this fill pass.
            fileInput.dispatchEvent(new Event('input',  { bubbles: true, cancelable: true }));
            fileInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            fileInput.dispatchEvent(new FocusEvent('blur', { bubbles: true, cancelable: true }));

            return true;
        } catch (e) {
            console.warn('[Fillo] Resume upload failed:', e);
            return false;
        }
    }

    async function waitForIcmsResumeUpload(timeoutMs = 10000) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            const fileLabel = document.querySelector('#PortalProfileFields\\.Resume_FileNameLabel span, #PortalProfileFields\\.Resume_FileNameLabel strong');
            const fileText = (fileLabel?.textContent || '').trim();
            if (fileText) {
                return true;
            }
            await new Promise(r => setTimeout(r, 250));
        }
        return false;
    }

    /**
     * After iCIMS processes a resume it auto-fills the form fields.
     * Wait until those mutations stop (quiet for quietMs) before we override them.
     */
    async function waitForIcimsFormSettle(quietMs = 1200, maxWaitMs = 7000) {
        return new Promise(resolve => {
            const form = document.querySelector('form, .iCIMS_TableRow') || document.body;
            if (!form) { setTimeout(resolve, quietMs); return; }
            let quietTimer = null;
            const bump = () => {
                clearTimeout(quietTimer);
                quietTimer = setTimeout(() => { observer.disconnect(); resolve(); }, quietMs);
            };
            const observer = new MutationObserver(bump);
            observer.observe(form, { childList: true, subtree: true, attributes: true, characterData: true });
            bump();
            setTimeout(() => { observer.disconnect(); clearTimeout(quietTimer); resolve(); }, maxWaitMs);
        });
    }


    function getVisualOrderKey(el) {
        if (!el || typeof el.getBoundingClientRect !== 'function') return Number.POSITIVE_INFINITY;
        const rect = el.getBoundingClientRect();
        if (!rect || (rect.width === 0 && rect.height === 0)) return Number.POSITIVE_INFINITY;
        return Math.round(rect.top * 1000) * 1000 + Math.round(rect.left);
    }

    function findFirstVisibleMatch(selectors) {
        let bestEl = null;
        let bestKey = Number.POSITIVE_INFINITY;

        for (const sel of selectors) {
            if (!sel) continue;
            let elements = [];
            try {
                elements = Array.from(document.querySelectorAll(sel));
            } catch (_) {
                continue;
            }

            for (const el of elements) {
                if (!isElementVisible(el)) continue;
                const key = getVisualOrderKey(el);
                if (key < bestKey) {
                    bestKey = key;
                    bestEl = el;
                }
            }
        }

        return { element: bestEl, orderKey: bestKey };
    }

    function getFieldOrderKey(field) {
        const selectors = [];
        if (field?.selector) selectors.push(field.selector);
        if (field?.selectorAttr && field?.name) {
            const op = field.selectorMatch === 'contains' ? '*=' : '=';
            selectors.push(`[${field.selectorAttr}${op}"${field.name}"]`);
        }
        if (field?.dataTest) selectors.push(`[data-test="${field.dataTest}"]`);
        if (field?.dataSrId) selectors.push(`[data-sr-id="${field.dataSrId}"]`);
        if (field?.name) {
            selectors.push(
                `[name="${field.name}"]`,
                `[id="${field.name}"]`,
                `[data-automation-id="${field.name}"]`,
                `[data-test="${field.name}"]`,
                `[data-sr-id="${field.name}"]`,
                `[id$="--${field.name}"]`,
                `[id$="-${field.name}"]`,
                `[id$="_${field.name}"]`,
                `[name$="--${field.name}"]`,
                `[name$="-${field.name}"]`,
                `[name$="_${field.name}"]`
            );
        }

        return findFirstVisibleMatch(selectors).orderKey;
    }

    function getDetectedFieldOrderKey(df) {
        const selectors = [
            attrSelector('name', df?.name),
            attrSelector('id', df?.id),
            attrSelector('data-automation-id', df?.dataAutomationId),
            df?.dataTestId ? `${attrSelector('data-testid', df.dataTestId)}, ${attrSelector('data-test', df.dataTestId)}` : null,
        ];
        return findFirstVisibleMatch(selectors).orderKey;
    }

    function getSalaryExpectationValue(profileData) {
        const preferencePaths = [
            ['job_preferences', 'salaryExpectation'],
            ['job_preferences', 'salary_expectations'],
            ['job_preferences', 'expectedSalary'],
            ['job_preferences', 'expected_salary'],
            ['job_preferences', 'expectedCompensation'],
            ['job_preferences', 'expected_compensation'],
            ['job_preferences', 'desiredSalary'],
            ['job_preferences', 'desired_salary']
        ];

        for (const path of preferencePaths) {
            const value = getValue(profileData, path);
            if (value != null && value !== '') return value;
        }

        const screeningAnswers = profileData?.job_preferences?.screening_answers;
        if (Array.isArray(screeningAnswers)) {
            const match = screeningAnswers.find(answer => {
                if (!answer?.enabled || !answer?.answer) return false;
                const question = String(answer.question || '').toLowerCase();
                const keywords = Array.isArray(answer.keywords) ? answer.keywords.map(k => String(k).toLowerCase()) : [];
                return question.includes('salary') ||
                    question.includes('compensation') ||
                    keywords.includes('salary') ||
                    keywords.includes('compensation') ||
                    keywords.includes('pay');
            });
            if (match) return match.answer;
        }

        return null;
    }

    function getScreeningAnswerValue(profileData, keys) {
        const screeningAnswers = profileData?.job_preferences?.screening_answers;
        if (!Array.isArray(screeningAnswers)) return null;
        const wanted = keys.map(k => normalizeFieldText(k)).filter(Boolean);

        for (const answer of screeningAnswers) {
            if (!answer?.enabled || answer.answer == null || answer.answer === '') continue;
            const haystack = normalizeFieldText([
                answer.key,
                answer.question,
                ...(Array.isArray(answer.keywords) ? answer.keywords : [])
            ].filter(Boolean).join(' '));
            if (wanted.some(key => haystack.includes(key))) return answer.answer;
        }

        return null;
    }

    function getProfileValueForPath(profileData, path) {
        const keys = Array.isArray(path) ? path : String(path || '').split('.');
        if (keys.length === 1 && keys[0] === '__today') return new Date();
        const value = getValue(profileData, keys);
        if (value != null && value !== '') return value;

        const normalizedPath = keys.join('.').toLowerCase();
        if (/job_preferences\.(salaryexpectation|salary_expectations|expectedsalary|expected_salary|expectedcompensation|expected_compensation|desiredsalary|desired_salary)$/.test(normalizedPath)) {
            return getSalaryExpectationValue(profileData);
        }
        if (/job_preferences\.eeo\.disability_status$/.test(normalizedPath)) {
            return getScreeningAnswerValue(profileData, [
                'disability_status',
                'disability status',
                'self identified disability',
                'please check one of the boxes below',
                'ofccp'
            ]);
        }

        return value;
    }

    // Build a flat lookup of platform-config fields keyed by automation-id name and
    // label, including array-template fields. Lets the top-to-bottom scan match a DOM
    // formField container back to its profile mapping.
    // Returns [{ name, label, profilePath, arrayPath, key, type, field }].
    function buildPlatformFieldLookup(platformConfig) {
        const fieldLookup = [];
        if (!platformConfig) return fieldLookup;
        for (const f of (platformConfig.fields || [])) {
            if (f.name || f.label) {
                fieldLookup.push({ name: (f.name || '').toLowerCase(), label: (f.label || '').toLowerCase(), profilePath: f.profilePath, type: f.type, field: f });
            }
        }
        for (const [arrayPath, arrayCfg] of Object.entries(platformConfig.arrays || {})) {
            for (const f of (arrayCfg.fields || [])) {
                if (f.name || f.label) {
                    fieldLookup.push({ name: (f.name || '').toLowerCase(), label: (f.label || '').toLowerCase(), arrayPath, key: f.key, type: f.type });
                }
            }
        }
        return fieldLookup;
    }

    // Per-field resolver: match a Workday formField container to its platform mapping
    // and resolve the profile value. Returns { def, value, autoId, labelText } or null.
    // For array fields it advances arrayIndexTracker on each section's "first key"
    // (company / school) so repeated sections fill entry [0], [1], ... in order.
    function resolvePlatformUnit(container, fieldLookup, profileData, arrayIndexTracker) {
        const autoId = (container.getAttribute('data-automation-id') || '').replace(/^formField-/, '').toLowerCase();
        const labelEl = container.querySelector('[data-automation-id="richText"] p, [data-automation-id="richText"], legend, label');
        const labelText = (labelEl?.textContent || '').replace(/\*+$/, '').trim().toLowerCase();

        const def = fieldLookup.find(d =>
            d.name === autoId ||
            (d.label && d.label === labelText) ||
            (d.label && labelText && labelText.includes(d.label) && d.label.length > 3) ||
            (d.label && labelText && d.label.includes(labelText) && labelText.length > 3)
        );
        if (!def) return null;

        let value = null;
        if (def.profilePath) {
            // Flat field
            value = getProfileValueForPath(profileData, def.profilePath);
        } else if (def.arrayPath && def.key) {
            // Array field — track how many times we've seen fields for this arrayPath
            const arrayData = profileData[def.arrayPath];
            if (!Array.isArray(arrayData) || arrayData.length === 0) return null;

            // Increment per-section index when we see a "first key" (e.g., company or school).
            // Platform configs use slightly different aliases, so accept all known first-key names.
            const firstKeys = {
                work_experience: ['company', 'companyName', 'employer', 'organization'],
                education_history: ['school', 'schoolName', 'institution', 'university']
            };
            if ((firstKeys[def.arrayPath] || []).includes(def.key)) {
                arrayIndexTracker[def.arrayPath] = (arrayIndexTracker[def.arrayPath] ?? -1) + 1;
            }
            const idx = arrayIndexTracker[def.arrayPath] ?? 0;
            if (idx >= arrayData.length) return null;
            value = arrayData[idx]?.[def.key];
        }

        if (value == null || value === '') return null;
        return { def, value, autoId, labelText };
    }

    function getVariantOrderKey(variants) {
        if (!Array.isArray(variants) || variants.length === 0) return Number.POSITIVE_INFINITY;
        const selectors = [];
        for (const variant of variants) {
            selectors.push(...buildSelectors(variant));
        }
        return findFirstVisibleMatch(selectors).orderKey;
    }

    /**
     * Deep-click helper: clicks a button that may be a Shadow DOM host or contain
     * a real <button> inside its shadow root (common in SmartRecruiters sri-button).
     * Falls back to a plain .click() on the element itself.
     * @param {HTMLElement} el
     */
    function deepClick(el) {
        if (!el) return;
        // Try to find a native <button> inside any shadow root first
        function findButtonDeep(root) {
            // Check light DOM first
            const btn = root.querySelector('button');
            if (btn) return btn;
            // Check all children that might have their own shadow roots
            for (const child of root.querySelectorAll('*')) {
                if (child.shadowRoot) {
                    const inner = findButtonDeep(child.shadowRoot);
                    if (inner) return inner;
                }
            }
            return null;
        }
        // Search the element's shadow root if it has one
        if (el.shadowRoot) {
            const inner = findButtonDeep(el.shadowRoot);
            if (inner) { inner.click(); return; }
        }
        // Also search light DOM children with shadow roots (e.g., oc-button > spl-button > shadow > button)
        const inner = findButtonDeep(el);
        if (inner && inner !== el) { inner.click(); return; }
        el.click();
    }

    /**
     * Find an add button that is visually inside or near a section that matches
     * the given heading keywords. This prevents clicking the work-experience add
     * button when we want the education one (both can have id="add-button").
     * @param {string[]} headingKeywords - Lowercase keywords to match a section heading
     * @returns {HTMLElement|null}
     */
    function findSectionAddButton(headingKeywords) {
        // Selectors that commonly identify section headings in Workday / ATS pages
        const headingSelectors = [
            'h2', 'h3', 'h4',
            '[role="heading"]',
            '[data-automation-id*="heading"]',
            '[data-automation-id*="section"]',
            '[data-test*="title" i]',
            '[data-test*="heading" i]',
            '.gwt-Label', '.section-title', '.section-header'
        ];

        const headings = document.querySelectorAll(headingSelectors.join(','));

        for (const heading of headings) {
            const headingText = (heading.textContent || '').toLowerCase().trim();
            if (!headingKeywords.some(kw => headingText.includes(kw))) continue;

            // Walk up to find a container that holds an add button
            let container = heading;
            for (let depth = 0; depth < 8; depth++) {
                if (!container) break;

                // Look for any add-style button in this container
                const candidates = container.querySelectorAll(
                    '[id="add-button"], [data-automation-id="add-button"], [data-test*="add" i], ' +
                    'button[aria-label*="add" i], button[title*="add" i], .add-button, [data-automation-id*="add" i], [data-automation-id*="Add" i]'
                );
                for (const btn of candidates) {
                    if (isElementVisible(btn)) {
                        console.log(`[Platform] Found section-specific add button near "${headingText.slice(0,40)}"`);
                        return btn;
                    }
                }
                container = container.parentElement;
            }
        }
        return null;
    }

    /**
     * Click the add button for a specific section type (work | education | websites).
     * Uses section-heading context first so education clicks never fire work's button.
     * @param {string} sectionType - 'work' | 'experience' | 'education' | 'websites' | ''
     * @param {number} retries
     * @returns {Promise<boolean>}
     */
    async function clickAddButtonForSection(sectionType, retries = 3) {
        const sectionKeywords = sectionType === 'work' || sectionType === 'experience'
            ? ['work experience', 'employment history', 'work history', 'professional experience', 'experience']
            : sectionType === 'education'
            ? ['education', 'academic', 'degree', 'school', 'university']
            : sectionType === 'websites'
            ? ['websites', 'web addresses', 'web address', 'links', 'urls', 'online profiles']
            : null;

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                // Priority 0: Explicit known selectors — covers SmartRecruiters and similar ATSs.
                // SmartRecruiters uses Shadow DOM custom elements (e.g. <sri-button data-test="add-experience">).
                // The host element IS queryable from light DOM; deepClick() pierces into its shadow root
                // to fire the click on the real <button> inside.
                const explicitCandidateSelectors = sectionType === 'experience' || sectionType === 'work'
                    ? [
                        '[data-test="add-experience"]',
                        '[data-automation-id="add-experience"]',
                        '[data-test="experience-add"]',
                        '[data-test="add-work"]',
                        'button[data-test*="experience" i][data-test*="add" i]'
                      ]
                    : sectionType === 'education'
                    ? [
                        '[data-test="add-education"]',
                        '[data-automation-id="add-education"]',
                        '[data-test="education-add"]',
                        'button[data-test*="education" i][data-test*="add" i]'
                      ]
                    : sectionType === 'websites'
                    ? [
                        '[data-automation-id="Add Websites"]',
                        '[data-automation-id="add-websites"]',
                        '[data-automation-id="Add Another Websites"]',
                        '[data-automation-id="addWebsite"]',
                        '[data-automation-id="add-website"]',
                        'button[data-automation-id*="website" i]',
                        'button[data-automation-id*="Website" i]'
                      ]
                    : [];

                for (const sel of explicitCandidateSelectors) {
                    for (const explicitBtn of document.querySelectorAll(sel)) {
                        if (isElementVisible(explicitBtn)) {
                            console.log(`[Platform] Clicking explicit add button "${sel}" for "${sectionType}" (attempt ${attempt + 1})`);
                            deepClick(explicitBtn);
                            await new Promise(r => setTimeout(r, 600));
                            return true;
                        }
                    }
                }

                // Priority 1: Find a button INSIDE the correct section container.
                // This is the safest approach — avoids hitting the wrong section's button.
                if (sectionKeywords) {
                    const sectionBtn = findSectionAddButton(sectionKeywords);
                    if (sectionBtn) {
                        console.log(`[Platform] Clicking section-aware add button for "${sectionType}" (attempt ${attempt + 1})`);
                        deepClick(sectionBtn);
                        await new Promise(r => setTimeout(r, 600));
                        return true;
                    }
                }

                // Priority 2: data-automation-id="add-button" — Workday's standard add button ID.
                // Both work-experience and education sections each have their own add-button.
                // Strategy: top-down — find the section container whose heading matches, then
                // pick the add-button INSIDE that container.  Falls back to the first visible one.
                {
                    let chosenBtn = null;

                    if (sectionKeywords && sectionKeywords.length > 0) {
                        // Step A: Find all containers that hold an add-button
                        const allAddBtns = Array.from(document.querySelectorAll(
                            '[data-automation-id="add-button"], #add-button'
                        )).filter(isElementVisible);

                        for (const btn of allAddBtns) {
                            // Walk UP from the button to find the tightest ancestor that has
                            // a matching heading as a DIRECT descendant (not crossing into
                            // sibling sections).  We pick the first (tightest) such ancestor.
                            let ancestor = btn.parentElement;
                            let matched = false;
                            for (let d = 0; d < 15 && ancestor; d++, ancestor = ancestor.parentElement) {
                                // Only inspect headings whose direct parent is `ancestor`
                                // or at most one level deeper — avoids "global" heading matches.
                                const shallowHeadings = Array.from(
                                    ancestor.querySelectorAll('h1,h2,h3,h4,[role="heading"],[data-automation-id*="heading"],[data-automation-id*="Heading"]')
                                ).filter(h => h.parentElement === ancestor || h.parentElement?.parentElement === ancestor);

                                if (shallowHeadings.length > 0) {
                                    const headingText = shallowHeadings.map(h => (h.textContent || '').toLowerCase()).join(' ');
                                    if (sectionKeywords.some(kw => headingText.includes(kw))) {
                                        chosenBtn = btn;
                                        matched = true;
                                    }
                                    // Stop walking — we've reached the section boundary
                                    // regardless of whether it matched, to avoid climbing into
                                    // a parent section with a different heading.
                                    break;
                                }
                            }
                            if (matched) break;
                        }

                        // No generic fallback here: if we cannot associate the add button with
                        // the requested section, clicking the first visible add button can open
                        // the wrong repeated section.
                    } else {
                        // No section context — just take the first visible add-button
                        chosenBtn = document.querySelector('[data-automation-id="add-button"], #add-button');
                        if (chosenBtn && !isElementVisible(chosenBtn)) chosenBtn = null;
                    }

                    if (chosenBtn) {
                        console.log(`[Platform] Clicking [data-automation-id="add-button"] for "${sectionType}" (attempt ${attempt + 1})`);
                        deepClick(chosenBtn);
                        await new Promise(r => setTimeout(r, 600));
                        return true;
                    }
                }

                // Priority 3: text/aria-label pattern matching (broad fallback)
                const patterns = sectionType === 'work' || sectionType === 'experience'
                    ? ['add work', 'add experience', 'add employment', 'add a job', 'add another work', 'add another experience']
                    : sectionType === 'education'
                    ? ['add education', 'add school', 'add degree', 'add a degree', 'add another education', 'add another school']
                    : sectionType === 'websites'
                    ? ['add websites', 'add website', 'add web address', 'add link', 'add another website', 'add another web address']
                    : ['add', 'add another', '+'];

                const buttons = document.querySelectorAll('button, [role="button"], a.button, .add-button, [data-test*="add" i]');
                for (const btn of buttons) {
                    const text = (btn.textContent || btn.innerText || '').toLowerCase().trim();
                    const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
                    const title = (btn.getAttribute('title') || '').toLowerCase();
                    if (patterns.some(p => text.includes(p) || aria.includes(p) || title.includes(p))
                        && isElementVisible(btn)) {
                        console.log(`[Platform] Clicking "${text || aria}" (pattern) for ${sectionType}`);
                        deepClick(btn);
                        await new Promise(r => setTimeout(r, 600));
                        return true;
                    }
                }

                if (attempt < retries) await new Promise(r => setTimeout(r, 500));
            } catch (e) {
                console.warn(`[Platform] Error clicking add button for ${sectionType} (attempt ${attempt + 1}):`, e);
            }
        }

        console.log(`[Platform] No add button found for "${sectionType}" after ${retries + 1} attempts`);
        return false;
    }

    /**
     * Get all currently visible, empty form fields that have NOT been filled yet.
     * Used after clicking "add-button" to capture newly-appeared fields.
     * @param {Object} fieldTracker - The field tracker object
     * @returns {NodeList} - Visible empty form elements
     */
    function getNewEmptyVisibleFields(fieldTracker, scopeRoot = document) {
        const queryRoot = scopeRoot?.querySelectorAll ? scopeRoot : document;
        const all = queryRoot.querySelectorAll('input, textarea, select');
        return Array.from(all).filter(el =>
            isElementVisible(el) &&
            !fieldTracker.filledElements.has(el) &&
            (!el.value || el.value.trim() === '') &&
            el.type !== 'file' && el.type !== 'hidden'
        );
    }

    async function fillWorkdaySearchFirstOption(fieldName, displayValue, selectors, fieldTracker, scopeRoot = document) {
        throwIfStopRequested();
        const searchText = String(displayValue || '').trim();
        if (!searchText) return false;
        const queryRoot = scopeRoot?.querySelectorAll ? scopeRoot : document;

        let searchInput = null;
        const hasSelectedPromptValue = (input) => {
            const scope = input?.closest?.('[data-automation-id^="formField-"], [data-automation-id="multiSelectContainer"]');
            if (!scope) return false;
            const selectedText = [
                ...scope.querySelectorAll('[data-automation-id="selectedItem"], [data-automation-id="selectedItemList"], [data-automation-id="promptSelectionLabel"]')
            ].map(node => node.textContent || '').join(' ').trim();
            const instruction = scope.querySelector('[data-automation-id="promptAriaInstruction"]')?.textContent?.trim() || '';
            return !!selectedText || (!!instruction && !/expanded|0 items selected|select one/i.test(instruction));
        };
        const isUsableSearchInput = (input) => input?.tagName?.toLowerCase() === 'input' &&
            !input.disabled &&
            isElementVisible(input) &&
            !fieldTracker.filledElements.has(input) &&
            !fieldTracker.filledElements.has(input.closest?.('[data-automation-id^="formField-"]')) &&
            !hasSelectedPromptValue(input);
        const findSearchInput = (root) => {
            if (!root?.querySelectorAll) return null;
            const inputSelectors = [
                '[data-automation-id="searchBox"]',
                'input[data-uxi-widget-type="selectinput"]',
                'input[data-uxi-multiselect-id]',
                'input[placeholder="Search"]',
                'input:not([type="hidden"])'
            ];
            for (const selector of inputSelectors) {
                const candidate = Array.from(root.querySelectorAll(selector))
                    .find(isUsableSearchInput);
                if (candidate) return candidate;
            }
            return null;
        };

        for (const sel of selectors) {
            try {
                for (const el of queryRoot.querySelectorAll(sel)) {
                    if (!isElementVisible(el)) continue;
                    if (el.tagName?.toLowerCase() === 'input') {
                        if (!isUsableSearchInput(el)) continue;
                        searchInput = el;
                        break;
                    }
                    searchInput = findSearchInput(el);
                    if (searchInput) break;
                }
            } catch (_) {}
            if (searchInput) break;
        }

        if (!searchInput) {
            const formFieldEl = queryRoot.querySelector(`[data-automation-id="formField-${fieldName}"]`);
            searchInput = findSearchInput(formFieldEl);
        }
        if (!searchInput || !isElementVisible(searchInput)) return false;

        const widget = searchInput.closest('[data-automation-id="multiSelectContainer"]') ||
            searchInput.closest('[data-automation-id^="formField-"]') ||
            searchInput.parentElement;
        const inputContainer = widget?.querySelector('[data-automation-id="multiselectInputContainer"]');
        const searchButton = widget?.querySelector('[data-automation-id="promptSearchButton"], [data-automation-id="promptIcon"]');
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(searchInput), 'value')?.set;

        clickLikeUser(inputContainer || widget || searchInput);
        await new Promise(r => setTimeout(r, 200));
        if (searchButton && !String(searchInput.value || '').trim()) {
            clickLikeUser(searchButton);
            await new Promise(r => setTimeout(r, 250));
        }

        searchInput.focus({ preventScroll: true });
        searchInput.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        searchInput.select?.();
        document.execCommand('delete');
        if (setter) setter.call(searchInput, '');
        else searchInput.value = '';
        searchInput.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
        await new Promise(r => setTimeout(r, 50));

        const inserted = document.execCommand('insertText', false, searchText);
        if (!inserted) {
            for (let i = 0; i < searchText.length; i++) {
                const ch = searchText[i];
                const nextValue = searchText.substring(0, i + 1);
                searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }));
                if (setter) setter.call(searchInput, nextValue);
                else searchInput.value = nextValue;
                searchInput.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: ch }));
                searchInput.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true, cancelable: true }));
                await new Promise(r => setTimeout(r, 20));
            }
        }
        if (searchInput.value !== searchText) {
            if (setter) setter.call(searchInput, searchText);
            else searchInput.value = searchText;
        }
        searchInput.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: searchText }));
        searchInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        nudgeWorkdaySearchableInput(searchInput, searchText);

        dispatchKey(searchInput, 'Enter', 'Enter', 13);
        console.log("Enter key clicked for the drop down")

        const getOptions = () => {
            const controls = searchInput.getAttribute('aria-controls');
            const widgetId = searchInput.getAttribute('data-uxi-multiselect-id');

            const controlledList = controls ? document.getElementById(controls) : null;
            const associatedPrompt = widgetId
                ? document.querySelector(`[data-associated-widget="${widgetId}"]`)
                : null;
            const fallbackRoots = !controlledList && !associatedPrompt
                ? [
                    ...getOpenWorkdayDropdowns(),
                    ...document.querySelectorAll('[data-automation-id="responsiveMonikerPrompt"], [data-automation-id="multiselectListBox"], [data-automation-id="activeListContainer"], [data-automation-id="listBox"], [role="listbox"], ul[role="listbox"]')
                ]
                : [];
            const roots = Array.from(new Set([
                controlledList,
                associatedPrompt,
                ...fallbackRoots
            ].filter(Boolean))).filter(isElementVisible);
            const emptyOptionPattern = /no result|no match|no items?|loading|searching|type to search|select one/i;
            const optionNodes = roots.flatMap(root => Array.from(root.querySelectorAll([
                '[data-automation-id="menuItem"][role="option"]',
                '[role="option"]',
                '[data-automation-id="multiselectOption"]',
                '[data-automation-id="promptOption"]',
                'li[data-automation-id="multiselectItem"]',
                'li'
            ].join(', '))));
            const optionRows = optionNodes.map(opt =>
                opt.closest?.('[data-automation-id="menuItem"][role="option"], [role="option"], li[data-automation-id="multiselectItem"], li') || opt
            );

            return Array.from(new Set(optionRows)).filter(opt => {
                const text = opt.textContent?.trim() || '';
                return isElementVisible(opt) &&
                    text &&
                    !opt.closest('[data-automation-id="selectedItemList"]') &&
                    !emptyOptionPattern.test(text);
            });
        };

        // Prefer an exact match; only fall back to a similar one if no exact match
        // appears. exactMin gates "settle immediately"; similarMin is the fallback bar.
        const isSchoolField = ['school', 'schoolName', 'institution', 'university'].includes(fieldName);
        const exactMin = isSchoolField ? 100 : 40;
        const similarMin = isSchoolField ? 85 : 40;
        const getRankedOptions = () => getOptions()
            .map((opt, idx) => {
                const text = getWorkdayOptionLabel(opt).trim();
                return { opt, idx, text, score: scoreExactFirstOption(text, searchText) };
            })
            .sort((a, b) => b.score - a.score || a.idx - b.idx);

        const waitForSearchOptions = async () => {
            const hasExactMatch = (ranked) => ranked.some(r => r.score >= exactMin);
            const hasSimilarMatch = (ranked) => ranked.some(r => r.score >= similarMin);
            let latestRanked = getRankedOptions();
            if (hasExactMatch(latestRanked)) return latestRanked;

            return await new Promise(resolve => {
                let done = false;
                let poll = 0;
                let similarSinceTs = null;
                const finish = (ranked) => {
                    if (done) return;
                    done = true;
                    observer.disconnect();
                    clearInterval(intervalId);
                    clearTimeout(timeoutId);
                    resolve(ranked);
                };
                const check = () => {
                    if (ns.state.stopRequested) { finish(getRankedOptions()); return; }
                    latestRanked = getRankedOptions();
                    // An exact match wins immediately.
                    if (hasExactMatch(latestRanked)) { finish(latestRanked); return; }
                    // Otherwise give an exact match a grace window to load (Workday returns
                    // results asynchronously) before settling for a similar one.
                    if (hasSimilarMatch(latestRanked)) {
                        if (similarSinceTs == null) similarSinceTs = Date.now();
                        else if (Date.now() - similarSinceTs >= 3000) finish(latestRanked);
                    } else {
                        similarSinceTs = null;
                    }
                };
                const nudgeSearch = () => {
                    if (done) return;
                    if (poll === 0 || poll === 2 || poll === 8 || poll === 16) {
                        searchInput.focus({ preventScroll: true });
                        searchInput.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: searchText }));
                        searchInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                    }
                    poll++;
                    check();
                };

                const observer = new MutationObserver(check);
                observer.observe(document.body, {
                    childList: true,
                    subtree: true,
                    characterData: true,
                    attributes: true,
                    attributeFilter: ['aria-busy', 'aria-selected', 'data-automation-selected', 'data-automation-label']
                });
                const intervalId = setInterval(nudgeSearch, 250);
                const timeoutId = setTimeout(() => finish(getRankedOptions()), 15000);
                nudgeSearch();
            });
        };

        const rankedOptions = await waitForSearchOptions();

        // Exact match first; only fall back to the best similar match if no exact exists.
        const bestRanked = rankedOptions.find(r => r.score >= exactMin)
            || rankedOptions.find(r => r.score >= similarMin);
        const firstOption = bestRanked?.opt;
        if (!firstOption) {
            const bestWeak = rankedOptions[0];
            console.log(`[Platform] No exact/strong Workday option for ${fieldName}: "${searchText}"` +
                (bestWeak ? ` (best weak match: "${bestWeak.text}" score ${bestWeak.score})` : ''));
            if (isSchoolField) {
                // Some Workday school prompts only fetch/commit after Enter, and a
                // second Enter can commit the highlighted exact result once it appears.
                searchInput.focus({ preventScroll: true });
                dispatchKey(searchInput, 'Enter', 'Enter', 13);
                await new Promise(r => setTimeout(r, 1000));
                dispatchKey(searchInput, 'Enter', 'Enter', 13);
                await new Promise(r => setTimeout(r, 500));
                if (hasSelectedPromptValue(searchInput)) {
                    markFieldFilled(searchInput, 'platform', fieldTracker);
                    const formField = searchInput.closest?.('[data-automation-id^="formField-"]');
                    if (formField) markFieldFilled(formField, 'platform', fieldTracker);
                    console.log(`[Platform] Workday school prompt committed via Enter fallback for "${searchText}"`);
                    return searchInput;
                }
            }
            return false;
        }

        const selectWorkdayPromptOption = async (option) => {
            const row = option.closest?.('[data-automation-id="menuItem"][role="option"], [role="option"]') || option;
            const listbox = row.closest?.('[role="listbox"], [data-automation-id="activeListContainer"]');
            const targets = [
                row.querySelector?.('[data-automation-id="promptLeafNode"]'),
                row.querySelector?.('[data-automation-id="promptOption"]'),
                row.querySelector?.('[data-automation-id="radioBtn"]'),
                row
            ].filter(Boolean);

            // Click the SPECIFIC matched option directly. Do NOT press ArrowDown+Enter
            // first — that commits whichever option is highlighted at the top of the
            // list (usually a similar match), not the exact one we located further down.
            row.scrollIntoView({ block: 'nearest' });
            for (const target of targets) {
                target.scrollIntoView?.({ block: 'nearest' });
                clickLikeUser(target);
                target.dispatchEvent?.(new Event('change', { bubbles: true, cancelable: true }));
                await new Promise(r => setTimeout(r, 200));
                if (getOpenWorkdayDropdowns().length === 0) return;
            }

            // Keyboard fallback only if clicking didn't commit: step down to THIS option's
            // position in the list (not blindly to the first), then Enter.
            if (listbox && getOpenWorkdayDropdowns().length > 0) {
                searchInput.focus({ preventScroll: true });
                const steps = Math.max(1, (bestRanked?.idx ?? 0) + 1);
                for (let s = 0; s < steps; s++) {
                    dispatchKey(searchInput, 'ArrowDown', 'ArrowDown', 40);
                    await new Promise(r => setTimeout(r, 30));
                }
                dispatchKey(searchInput, 'Enter', 'Enter', 13);
                await new Promise(r => setTimeout(r, 150));
            }
        };

        firstOption.scrollIntoView({ block: 'nearest' });
        await selectWorkdayPromptOption(firstOption);
        await new Promise(r => setTimeout(r, 400));

        // Click out of the school input so Workday commits the typeahead selection and
        // collapses the prompt. A real pointer click on a neutral region outside the
        // widget blurs the input the way a user clicking away would — synthetic blur
        // events alone don't reliably move DOM focus off the field.
        const clickOutTarget = document.querySelector('[data-automation-id="applyFlowFooter"]') ||
            document.querySelector('main') ||
            document.body;
        if (clickOutTarget) {
            clickLikeUser(clickOutTarget);
            await new Promise(r => setTimeout(r, 150));
        }

        searchInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
        searchInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        await dismissWorkdayDropdown(searchInput, clickOutTarget);
        const selectionCommitted = (() => {
            const scope = searchInput.closest?.('[data-automation-id^="formField-"], [data-automation-id="multiSelectContainer"]') || widget;
            const scopeText = scope?.textContent || '';
            return hasSelectedPromptValue(searchInput) ||
                selectionTextMatches(scopeText, bestRanked?.text || searchText) ||
                (getOpenWorkdayDropdowns().length === 0 && !/no result|no match|loading|searching/i.test(scopeText) &&
                    selectionTextMatches(scopeText, searchText));
        })();
        if (!selectionCommitted) {
            console.warn(`[Platform] Workday search selection did not visibly commit for ${fieldName}: "${searchText}"`);
            return false;
        }
        markFieldFilled(searchInput, 'platform', fieldTracker);
        const formField = searchInput.closest?.('[data-automation-id^="formField-"]');
        if (formField) markFieldFilled(formField, 'platform', fieldTracker);
        console.log(`[Platform] Workday search selected option for ${fieldName}: "${bestRanked?.text}" (score ${bestRanked?.score?.toFixed?.(1)}) for requested "${searchText}"`);
        return searchInput;
    }

    /**
     * Fill one array entry's fields into the currently-visible empty inputs.
     * Maps profile object keys to form fields by checking name/data-automation-id/label.
     * @param {Object} entry - The profile array entry (e.g., work_experience[i])
     * @param {string} arrayPath - 'work_experience' | 'education_history'
     * @param {number} index - The array index (for database field lookup)
     * @param {Array} platformFields - All platform field definitions
     * @param {Object} profileData - Full profile data
     * @param {Object} fieldTracker - Field tracker
     * @returns {Promise<number>} number of fields filled
     */
    async function fillArrayEntry(entry, arrayPath, index, platformFields, profileData, fieldTracker, scopeRoot = document) {
        throwIfStopRequested();
        let filled = 0;
        let entryAnchorY = null;
        const queryRoot = scopeRoot?.querySelectorAll ? scopeRoot : document;
        const firstKeyByArray = {
            work_experience: ['company', 'companyName', 'employer', 'organization'],
            education_history: ['school', 'schoolName', 'institution', 'university'],
            websites: ['url', 'website', 'link']
        };
        const rememberEntryAnchor = (el, subKey) => {
            if (arrayPath !== 'education_history') return;
            if (entryAnchorY != null) return;
            const firstKeys = firstKeyByArray[arrayPath] || [];
            if (!firstKeys.includes(subKey)) return;
            const anchor = el?.closest?.('[data-automation-id^="formField-"]') || el;
            entryAnchorY = getVisualOrderKey(anchor);
            console.log(`[Platform] Anchored ${arrayPath}[${index}] at y=${entryAnchorY}`);
        };
        const isInCurrentEntryScope = (el) => {
            if (arrayPath !== 'education_history' || entryAnchorY == null) return true;
            const anchor = el?.closest?.('[data-automation-id^="formField-"]') || el;
            return getVisualOrderKey(anchor) + 8 >= entryAnchorY;
        };

        // Strategy A: Use database field definitions for this exact index
        const fieldsForThisEntry = platformFields.filter(f =>
            f.profilePath && f.profilePath.startsWith(`${arrayPath}.${index}.`)
        );

        // Strategy A-fallback: use index-0 field defs as a template for all higher indices.
        // Workday reuses identical DOM field names (e.g. "company", "jobTitle") in each
        // dynamically-added section. fieldTracker.filledElements prevents re-filling earlier entries.
        const templateFields = fieldsForThisEntry.length > 0
            ? fieldsForThisEntry
            : platformFields.filter(f => f.profilePath && f.profilePath.startsWith(`${arrayPath}.0.`));

        if (templateFields.length > 0) {
            const getArrayFieldPriority = (field) => {
                const pathKey = String(field.profilePath || '').split('.').slice(2).join('.');
                const name = field.name || '';
                const key = pathKey || name;
                if (arrayPath === 'education_history') {
                    if (['school', 'schoolName', 'institution', 'university'].includes(key) || ['school', 'schoolName', 'institution', 'university'].includes(name)) return 0;
                    if (/degree/i.test(key) || /degree/i.test(name)) return 1;
                }
                if (arrayPath === 'work_experience') {
                    if (['company', 'companyName', 'employer'].includes(key) || ['company', 'companyName'].includes(name)) return 0;
                    if (/title|position|role/i.test(key) || /title|position|role/i.test(name)) return 1;
                }
                return 2;
            };
            const orderedTemplateFields = [...templateFields].sort((a, b) =>
                getArrayFieldPriority(a) - getArrayFieldPriority(b) || getFieldOrderKey(a) - getFieldOrderKey(b)
            );
            const src = fieldsForThisEntry.length > 0 ? `index-${index} defs` : 'index-0 template';
            console.log(`[Platform] ${arrayPath}[${index}]: filling via ${src} (${orderedTemplateFields.length} fields)`);

            for (const field of orderedTemplateFields) {
                throwIfStopRequested();
                // Extract sub-key: "work_experience.0.jobTitle" → "jobTitle"
                const subKey = field.profilePath.split('.').slice(2).join('.');
                const value = subKey ? (entry[subKey] ?? null) : null;
                if (value == null || value === '') continue;

                // For date objects {year, month}, keep as object for Workday spinbuttons;
                // flatten to string for regular text inputs
                let displayValue;
                if (value && typeof value === 'object' && !Array.isArray(value) && 'year' in value) {
                    displayValue = value; // keep object for date handler below
                } else {
                    displayValue = Array.isArray(value) ? value.join(', ') : String(value);
                }
                if (
                    arrayPath === 'education_history' &&
                    index > 0 &&
                    entryAnchorY == null &&
                    !['school', 'schoolName', 'institution', 'university'].includes(subKey)
                ) {
                    console.log(`[Platform] Waiting for ${arrayPath}[${index}] school anchor before filling ${field.name}`);
                    continue;
                }

                // Target unfilled, visible elements matching the field's name / data-automation-id.
                // `selectorAttr` in the database config lets a field declare its preferred attribute
                // (e.g. "data-sr-id" for SmartRecruiters, "aria-describedby" for Workday).
                // `selectorMatch: "contains"` uses CSS *= (substring match) for attributes
                // like aria-describedby="helpText-education-75--firstYearAttended".
                let preferredAttrSel = [];
                if (field.selectorAttr) {
                    const op = field.selectorMatch === 'contains' ? '*=' : '=';
                    preferredAttrSel = [`[${field.selectorAttr}${op}"${field.name}"]`];
                }

                // Build extra selectors from database field config
                const extraFieldSel = [];
                if (field.selector) extraFieldSel.push(field.selector);
                if (field.dataTest) extraFieldSel.push(`[data-test="${field.dataTest}"]`);
                if (field.dataSrId) extraFieldSel.push(`[data-sr-id="${field.dataSrId}"]`);

                const selectors = [
                    ...extraFieldSel,                  // database explicit selectors (highest priority)
                    ...preferredAttrSel,               // Explicit attr hint
                    `[data-automation-id="formField-${field.name}"]`, // Workday formField container (high priority)
                    `[name="${field.name}"]`,
                    `[id="${field.name}"]`,
                    `[data-automation-id="${field.name}"]`,
                    `[data-test="${field.name}"]`,
                    `[data-sr-id="${field.name}"]`,    // SmartRecruiters stable IDs
                    `[id$="--${field.name}"]`,         // Ends with exactly "--fieldName"
                    `[id$="-${field.name}"]`,          // Ends with exactly "-fieldName"
                    `[id$="_${field.name}"]`,          // Ends with exactly "_fieldName"
                    `[name$="--${field.name}"]`,       // Ends with exactly "--fieldName"
                    `[name$="-${field.name}"]`,        // Ends with exactly "-fieldName"
                    `[name$="_${field.name}"]`,        // Ends with exactly "_fieldName"
                    field.name                         // For querySelectorAll if it's a tag
                ];

                if (arrayPath === 'education_history' && ['school', 'schoolName', 'institution', 'university'].includes(field.name)) {
                    const selected = await fillWorkdaySearchFirstOption(field.name, displayValue, selectors, fieldTracker, queryRoot);
                    if (selected) {
                        rememberEntryAnchor(selected, subKey);
                        filled++;
                        await new Promise(r => setTimeout(r, 120));
                        continue;
                    }
                }

                // Workday date fields: find the dateInputWrapper and fill Month/Year spinbuttons
                const isDateField = ['startDate', 'endDate', 'educationStartDate', 'educationEndDate', 'firstYearAttended', 'lastYearAttended'].includes(field.name);
                if (isDateField && displayValue) {
                    const dateWrappers = queryRoot.querySelectorAll(`[data-automation-id="formField-${field.name}"] [data-automation-id="dateInputWrapper"]`);
                    for (const wrapper of dateWrappers) {
                        if (!isElementVisible(wrapper)) continue;
                        if (!isInCurrentEntryScope(wrapper)) continue;
                        // Check if already filled by us
                        if (fieldTracker.filledElements.has(wrapper)) continue;

                        let month = null, year = null;

                        // Handle {year, month} object format (education dates)
                        if (displayValue && typeof displayValue === 'object' && 'year' in displayValue) {
                            year = displayValue.year || null;
                            month = displayValue.month || null;
                        } else {
                            // Parse date string: "Jan 2020", "01/2020", "2020", "March 2021", "2020-01", etc.
                            const dateStr = String(displayValue).trim();

                            // Try MM/YYYY or MM-YYYY
                            const slashMatch = dateStr.match(/^(\d{1,2})[\/\-](\d{4})$/);
                            if (slashMatch) { month = slashMatch[1]; year = slashMatch[2]; }

                            // Try YYYY-MM
                            if (!year) {
                                const isoMatch = dateStr.match(/^(\d{4})[\/\-](\d{1,2})$/);
                                if (isoMatch) { year = isoMatch[1]; month = isoMatch[2]; }
                            }

                            // Try "Month YYYY" or "Mon YYYY"
                            if (!year) {
                                const monthNames = { jan:1, january:1, feb:2, february:2, mar:3, march:3, apr:4, april:4, may:5, jun:6, june:6, jul:7, july:7, aug:8, august:8, sep:9, september:9, oct:10, october:10, nov:11, november:11, dec:12, december:12 };
                                const wordMatch = dateStr.match(/^([a-zA-Z]+)\s+(\d{4})$/);
                                if (wordMatch) {
                                    const m = monthNames[wordMatch[1].toLowerCase()];
                                    if (m) { month = String(m); year = wordMatch[2]; }
                                }
                            }

                            // Try just YYYY
                            if (!year) {
                                const yearOnly = dateStr.match(/^(\d{4})$/);
                                if (yearOnly) { year = yearOnly[1]; }
                            }
                        }

                        const monthInput = wrapper.querySelector('[data-automation-id="dateSectionMonth-input"]');
                        const yearInput = wrapper.querySelector('[data-automation-id="dateSectionYear-input"]');

                        let dateFilled = false;
                        if (monthInput && month) {
                            await fillElement(monthInput, month);
                            dateFilled = true;
                        }
                        if (yearInput && year) {
                            await fillElement(yearInput, year);
                            dateFilled = true;
                        }

                        if (dateFilled) {
                            console.log(`[Platform] Filled date [${field.name}] month=${month} year=${year} (${arrayPath}[${index}])`);
                            markFieldFilled(wrapper, 'platform', fieldTracker);
                            filled++;
                            break;
                        }
                    }
                    // If endDate value is "present" (any case), tick the "I currently work here" checkbox
                    if (field.name === 'endDate' && arrayPath === 'work_experience' &&
                        /^present$/i.test(String(displayValue).trim())) {
                        const checkboxCandidates = document.querySelectorAll(
                            'input[name="currentlyWorkHere"], [id$="--currentlyWorkHere"][type="checkbox"]'
                        );
                        for (const checkbox of checkboxCandidates) {
                            if (!isElementVisible(checkbox)) continue;
                            if (fieldTracker.filledElements.has(checkbox)) continue;
                            if (!checkbox.checked && checkbox.getAttribute('aria-checked') !== 'true') {
                                checkbox.click();
                                console.log(`[Platform] Ticked "I currently work here" (endDate=present) for ${arrayPath}[${index}]`);
                                markFieldFilled(checkbox, 'platform', fieldTracker);
                                filled++;
                            }
                            break;
                        }
                    }

                    await new Promise(r => setTimeout(r, 80));
                    continue; // skip standard fill logic for date fields
                }

                // Flatten date objects to string for regular (non-spinbutton) inputs
                if (displayValue && typeof displayValue === 'object' && 'year' in displayValue) {
                    displayValue = displayValue.month
                        ? `${displayValue.month}/${displayValue.year}`
                        : displayValue.year || '';
                    if (!displayValue) continue;
                }

                let fieldFilled = false;
                for (const sel of selectors) {
                    const elements = queryRoot.querySelectorAll(sel);
                    for (const el of elements) {
                        if (!isElementVisible(el)) continue;
                        if (fieldTracker.filledElements.has(el)) continue; // already filled by us in a previous entry
                        if (!isInCurrentEntryScope(el)) continue;

                        const elValue = (el.value || el.getAttribute('value') || '').trim().toLowerCase();
                        const expectedValue = String(displayValue).trim().toLowerCase();
	
                        // Treat as successfully filled if it already holds the EXACT correct value (pre-filled)
                        if (elValue === expectedValue && expectedValue !== '') {
                            console.log(`[Platform] Already natively filled [${field.name}]="${displayValue}" (${arrayPath}[${index}])`);
                            markFieldFilled(el, 'platform', fieldTracker);
                            filled++;
                            fieldFilled = true;
                            break;
                        }

                        if (!fieldTracker.allowRefill && elValue) continue; // user pre-filled it with something else we shouldn't wipe out

                        // Otherwise, it's empty — fill it!
                        if (await fillElement(el, displayValue)) {
                            console.log(`[Platform] Filled [${field.name}]="${displayValue}" (${arrayPath}[${index}])`);
                            markFieldFilled(el, 'platform', fieldTracker);
                            rememberEntryAnchor(el, subKey);
                            filled++;
                            fieldFilled = true;
                            break;
                        }
                    }
                    if (fieldFilled) break;
                }

                await new Promise(r => setTimeout(r, 80));
            }
        } else {
            // Strategy B: No database field defs at all — heuristic fill of newly-visible empty fields
            console.log(`[Platform] ${arrayPath}[${index}]: No database field defs, using heuristic fill`);
                    const newFields = getNewEmptyVisibleFields(fieldTracker, queryRoot);

            for (const [key, val] of Object.entries(entry)) {
                throwIfStopRequested();
                if (!val || typeof val !== 'string') continue;
                const keyLower = key.toLowerCase();

                for (const el of newFields) {
                    if (fieldTracker.filledElements.has(el)) continue;
                    const elName = (el.name || el.id || el.getAttribute('data-automation-id') || '').toLowerCase();
                    const elLabel = (getFieldLabel(el) || '').toLowerCase();

                    if (elName.includes(keyLower) || elLabel.includes(keyLower) ||
                        keyLower.includes(elName) || keyLower.includes(elLabel.replace(/\s+/g, ''))) {
                        if (await fillElement(el, val)) {
                            console.log(`[Platform] Heuristic filled ${elName || elLabel} ← ${key}="${val}"`);
                            markFieldFilled(el, 'platform', fieldTracker);
                            filled++;
                            break;
                        }
                    }
                }

                await new Promise(r => setTimeout(r, 80));
            }
        }

        return filled;
    }

    /**
     * Scan current page HTML for visible Workday formField containers and fill them
     * by matching their data-automation-id / label text against the matcher JSON field defs.
     * This is the HTML-scanning approach: reads the live DOM, matches inputs, fills values.
     * @param {Object} entry - Profile data entry (e.g., work_experience[i] or flat profile)
     * @param {string} arrayPath - 'work_experience' | 'education_history' or '' for flat fields
     * @param {Array} fieldDefs - Field definitions from the database config (with name, label, key/profilePath)
     * @param {Object} fieldTracker
     * @returns {Promise<number>} - Number of fields filled
     */
    async function fillByPageHTMLScan(entry, arrayPath, fieldDefs, fieldTracker, scopeRoot = document) {
        throwIfStopRequested();
        let filled = 0;
        const queryRoot = scopeRoot?.querySelectorAll ? scopeRoot : document;

        // Collect all visible [data-automation-id^="formField-"] containers
        const formFieldEls = Array.from(queryRoot.querySelectorAll('[data-automation-id^="formField-"]'))
            .filter(el => isElementVisible(el) && !fieldTracker.filledElements.has(el));

        for (const container of formFieldEls) {
            throwIfStopRequested();
            const autoId = container.getAttribute('data-automation-id') || '';
            const fieldName = autoId.replace(/^formField-/, ''); // "companyName", "jobTitle", etc.

            // Extract label text from Workday richText, legend, or label
            const labelEl = container.querySelector('[data-automation-id="richText"] p, [data-automation-id="richText"], legend, label');
            const labelText = (labelEl?.textContent || '').replace(/\*+$/, '').trim().toLowerCase();

            // Match against field defs by: data-automation-id name OR label text
            const def = fieldDefs.find(d => {
                if (!d) return false;
                const defName = (d.name || '').toLowerCase();
                const defLabel = (d.label || '').toLowerCase();
                return defName === fieldName.toLowerCase() ||
                    (defLabel && defLabel === labelText) ||
                    (defLabel && labelText && labelText.includes(defLabel)) ||
                    (defLabel && labelText && defLabel.includes(labelText));
            });

            if (!def) continue;

            // Resolve the value from the entry object
            const key = def.key || (def.profilePath ? def.profilePath.split('.').slice(2).join('.') : null);
            if (!key) continue;
            const value = entry[key];
            if (value == null || value === '') continue;

            // Handle Workday date spinbuttons specially
            const isDateFieldName = def.name === 'startDate' || def.name === 'endDate' || def.name === 'educationStartDate' || def.name === 'educationEndDate' || def.name === 'firstYearAttended' || def.name === 'lastYearAttended';
            if (isDateFieldName) {
                const dateWrapper = container.querySelector('[data-automation-id="dateInputWrapper"]');
                if (dateWrapper && isElementVisible(dateWrapper) && !fieldTracker.filledElements.has(dateWrapper)) {
                    let month = null, year = null;
                    const dateStr = String(value).trim();
                    const slashMatch = dateStr.match(/^(\d{1,2})[\/\-](\d{4})$/);
                    if (slashMatch) { month = slashMatch[1]; year = slashMatch[2]; }
                    if (!year) {
                        const isoMatch = dateStr.match(/^(\d{4})[\/\-](\d{1,2})$/);
                        if (isoMatch) { year = isoMatch[1]; month = isoMatch[2]; }
                    }
                    if (!year) {
                        const monthNames = { jan:1, january:1, feb:2, february:2, mar:3, march:3, apr:4, april:4, may:5, jun:6, june:6, jul:7, july:7, aug:8, august:8, sep:9, september:9, oct:10, october:10, nov:11, november:11, dec:12, december:12 };
                        const wordMatch = dateStr.match(/^([a-zA-Z]+)\s+(\d{4})$/);
                        if (wordMatch) { const m = monthNames[wordMatch[1].toLowerCase()]; if (m) { month = String(m); year = wordMatch[2]; } }
                    }
                    if (!year) { const yearOnly = dateStr.match(/^(\d{4})$/); if (yearOnly) year = yearOnly[1]; }

                    const monthInput = dateWrapper.querySelector('[data-automation-id="dateSectionMonth-input"]');
                    const yearInput = dateWrapper.querySelector('[data-automation-id="dateSectionYear-input"]');
                    let dateFilled = false;
                    if (monthInput && month && !fieldTracker.filledElements.has(monthInput)) {
                        await fillElement(monthInput, month); dateFilled = true;
                    }
                    if (yearInput && year && !fieldTracker.filledElements.has(yearInput)) {
                        await fillElement(yearInput, year); dateFilled = true;
                    }
                    if (dateFilled) {
                        markFieldFilled(dateWrapper, 'platform', fieldTracker);
                        markFieldFilled(container, 'platform', fieldTracker);
                        console.log(`[HTMLScan] Filled date "${fieldName}" month=${month} year=${year}`);
                        filled++;
                    }
                }
                await new Promise(r => setTimeout(r, 80));
                continue;
            }

            // Find the fillable input inside the container
            const input = container.querySelector('input:not([type="hidden"]):not([type="file"]), textarea, select, button[aria-haspopup="listbox"]');
            if (!input || !isElementVisible(input) || fieldTracker.filledElements.has(input)) continue;

            const displayValue = Array.isArray(value) ? value.join(', ') : String(value);
            if (await fillElement(input, displayValue)) {
                markFieldFilled(input, 'platform', fieldTracker);
                markFieldFilled(container, 'platform', fieldTracker);
                console.log(`[HTMLScan] Filled "${fieldName}" (label: "${labelText}") → "${displayValue.substring(0, 40)}"`);
                filled++;
            }
            await new Promise(r => setTimeout(r, 80));
        }

        return filled;
    }

    /**
     * Process array fields (work experience, education) - fills ALL entries.
     * For each entry beyond the first, clicks the "add-button" to reveal a new
     * form section, then fills the newly-appeared empty fields.
     * @param {Array} platformFields - Array of field definitions from the database config
     * @param {Object} profileData - User profile data
     * @param {Object} fieldTracker - The field tracker object
     * @param {string} arrayPath - 'work_experience' | 'education_history'
     * @returns {Promise<number>} - Number of entries filled
     */
    async function processArrayFields(platformFields, profileData, fieldTracker, arrayPath) {
        try {
            throwIfStopRequested();
            const arrayData = profileData[arrayPath];
            if (!Array.isArray(arrayData) || arrayData.length === 0) {
                console.log(`[Platform] No ${arrayPath} data found`);
                return 0;
            }

            // Derive sectionType from the already-resolved platformFields array.
            // Each array-expanded field carries a `sectionType` property (set by mapping.js getPlatformFields).
            // This avoids a double-async call to getPlatformFields/detectPlatform without await.
            const sectionTypeFromFields = platformFields.find(f => f.arrayPath === arrayPath)?.sectionType;

            // FIX: SmartRecruiters uses 'experience' (not 'work') in data-test attributes
            // e.g. data-test="add-experience" / data-test="save-experience"
            const sectionType = sectionTypeFromFields || (arrayPath === 'work_experience' ? 'experience' : arrayPath === 'websites' ? 'websites' : 'education');

            let sectionExists = platformFields.some(f => {
                if (!f.profilePath?.startsWith(arrayPath)) return false;
                const selectors = [
                    f.selector,
                    f.name ? `[name="${f.name}"]` : null,
                    f.name ? `[data-automation-id="${f.name}"]` : null,
                    f.name ? `[data-automation-id="formField-${f.name}"]` : null,
                    f.name ? `[id$="--${f.name}"]` : null,
                ].filter(Boolean);
                return selectors.some(sel => {
                    try { return !!document.querySelector(sel); } catch(_) { return false; }
                });
            });

            if (!sectionExists) {
                const patterns = sectionType === 'experience' || sectionType === 'work'
                    ? ['add work', 'add experience', 'add employment', 'add another', 'add a job', 'add job', 'work experience', 'employment']
                    : sectionType === 'education'
                    ? ['add education', 'add school', 'add degree', 'add another', 'add a degree', 'education', 'academic']
                    : sectionType === 'websites'
                    ? ['add websites', 'add website', 'add web address', 'add link', 'add another', 'websites', 'web address']
                    : ['add', 'add another', '+'];

                const buttons = document.querySelectorAll('button, [role="button"], a.button, .add-button, [data-test*="add" i], [data-automation-id*="add" i], [data-automation-id*="Add" i], [data-automation-id="add-button"]');
                for (const btn of buttons) {
                    if (!isElementVisible(btn)) continue;
                    const text = (btn.textContent || btn.innerText || '').toLowerCase().trim();
                    const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
                    const title = (btn.getAttribute('title') || '').toLowerCase();
                    const dataAuto = (btn.getAttribute('data-automation-id') || '').toLowerCase();
                    if (patterns.some(p => text.includes(p) || aria.includes(p) || title.includes(p) || dataAuto.includes(p))) {
                        sectionExists = true;
                        break;
                    }
                }
            }

            // Final sectionExists check: look for heading text matching this section type
            if (!sectionExists) {
                const headingPatterns = sectionType === 'experience' || sectionType === 'work'
                    ? ['work experience', 'employment history', 'professional experience', 'work history']
                    : sectionType === 'education'
                    ? ['education', 'academic background', 'degrees', 'schools']
                    : sectionType === 'websites'
                    ? ['websites', 'web addresses', 'website', 'online profiles', 'links']
                    : [];
                if (headingPatterns.length > 0) {
                    const headings = document.querySelectorAll('h1,h2,h3,h4,[role="heading"],[data-automation-id*="section"],[data-automation-id*="heading"]');
                    for (const h of headings) {
                        const ht = (h.textContent || '').toLowerCase().trim();
                        if (headingPatterns.some(p => ht.includes(p)) && isElementVisible(h)) {
                            sectionExists = true;
                            break;
                        }
                    }
                }
            }

            if (!sectionExists) {
                console.log(`[Platform] Section "${arrayPath}" not present on this page, skipping`);
                return 0;
            }

            console.log(`[Platform] Processing ${arrayData.length} ${arrayPath} entries (sectionType: ${sectionType})`);
            let entriesFilled = 0;
            let addButtonFailures = 0;

            // Helper: build the reusable arrayFieldDefs for HTML-scan fallback
            const arrayFieldDefs = platformFields
                .filter(f => f.arrayPath === arrayPath)
                .map(f => ({ name: f.name, label: f.label, key: f.profilePath?.split('.').slice(2).join('.'), type: f.type }));

            function getVisibleEntryCandidates() {
                return Array.from(document.querySelectorAll(
                    '[data-automation-id^="formField-"], input:not([type="hidden"]):not([type="file"]), textarea, select, button[aria-haspopup="listbox"]'
                )).filter(isElementVisible);
            }

            function makeScopedQueryRoot(seedElements) {
                const seeds = Array.from(new Set((seedElements || []).filter(Boolean)));
                const containers = new Set();
                for (const seed of seeds) {
                    containers.add(seed);
                    const formField = seed.closest?.('[data-automation-id^="formField-"]');
                    if (formField) containers.add(formField);
                }

                const isInsideScope = (el) => {
                    if (!el) return false;
                    if (containers.has(el)) return true;
                    const formField = el.closest?.('[data-automation-id^="formField-"]');
                    if (formField && containers.has(formField)) return true;
                    for (const container of containers) {
                        if (container.contains?.(el)) return true;
                    }
                    return false;
                };

                return {
                    querySelectorAll(sel) {
                        return Array.from(document.querySelectorAll(sel)).filter(isInsideScope);
                    },
                    querySelector(sel) {
                        return this.querySelectorAll(sel)[0] || null;
                    }
                };
            }

            async function waitForNewEntryScope(beforeVisible) {
                for (let poll = 0; poll < 20; poll++) {
                    await new Promise(r => setTimeout(r, 200));
                    const current = getVisibleEntryCandidates();
                    const appeared = current.filter(el => !beforeVisible.has(el));
                    if (appeared.length > 0) {
                        return makeScopedQueryRoot(appeared);
                    }
                }
                return null;
            }

            async function openArrayEntryPanel() {
                const beforeVisible = new Set(getVisibleEntryCandidates());
                const clicked = await clickAddButtonForSection(sectionType, 2);
                if (!clicked) return null;
                return await waitForNewEntryScope(beforeVisible);
            }

            // Helper: attempt to fill the currently-open entry form, with HTML scan fallback
            async function tryFillEntry(entry, idx, entryScope = document) {
                let n = await fillArrayEntry(entry, arrayPath, idx, platformFields, profileData, fieldTracker, entryScope);
                if (n === 0 && arrayFieldDefs.length > 0 && !(arrayPath === 'education_history' && idx > 0)) {
                    n = await fillByPageHTMLScan(entry, arrayPath, arrayFieldDefs, fieldTracker, entryScope);
                }
                return n;
            }

            function normalizeExistingEntryText(value) {
                return String(value || '')
                    .toLowerCase()
                    .replace(/^https?:\/\//, '')
                    .replace(/^www\./, '')
                    .replace(/[^a-z0-9]+/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
            }

            function flattenEntryValue(value) {
                if (value == null) return '';
                if (typeof value === 'string' || typeof value === 'number') return String(value);
                if (Array.isArray(value)) return value.map(flattenEntryValue).filter(Boolean).join(' ');
                if (typeof value === 'object') {
                    if ('year' in value || 'month' in value) return [value.month, value.year].filter(Boolean).join(' ');
                    return Object.values(value).map(flattenEntryValue).filter(Boolean).join(' ');
                }
                return '';
            }

            function entryAlreadyExistsOnPage(entry, currentArrayPath) {
                const keyGroups = currentArrayPath === 'work_experience'
                    ? [['company', 'companyName', 'employer', 'organization'], ['jobTitle', 'title', 'position', 'role']]
                    : currentArrayPath === 'education_history'
                    ? [['school', 'schoolName', 'institution', 'university'], ['degree', 'degreeName', 'fieldOfStudy', 'field']]
                    : currentArrayPath === 'websites'
                    ? [['url', 'website', 'link']]
                    : [];

                const picked = [];
                for (const group of keyGroups) {
                    const raw = group.map(key => flattenEntryValue(entry[key])).find(Boolean);
                    const normalized = normalizeExistingEntryText(raw);
                    if (normalized && normalized.length >= 3) picked.push(normalized);
                }

                if (picked.length === 0) {
                    for (const value of Object.values(entry)) {
                        const normalized = normalizeExistingEntryText(flattenEntryValue(value));
                        if (normalized.length >= 4) picked.push(normalized);
                        if (picked.length >= 2) break;
                    }
                }

                if (picked.length === 0) return false;
                if (currentArrayPath !== 'websites' && picked.length < 2) return false;

                const sectionHints = currentArrayPath === 'work_experience'
                    ? ['work', 'experience', 'employment', 'job']
                    : currentArrayPath === 'education_history'
                    ? ['education', 'school', 'degree', 'university', 'academic']
                    : currentArrayPath === 'websites'
                    ? ['website', 'web address', 'url', 'link']
                    : [];
                const selector = [
                    '[role="listitem"]',
                    'li',
                    'article',
                    '[data-automation-id*="item" i]',
                    '[data-automation-id*="card" i]',
                    '[data-automation-id*="panel" i]',
                    '[data-test*="experience" i]',
                    '[data-test*="education" i]',
                    '[data-test*="website" i]',
                    '[data-automation-id*="experience" i]',
                    '[data-automation-id*="education" i]',
                    '[data-automation-id*="website" i]'
                ].join(',');
                const containers = Array.from(document.querySelectorAll(selector))
                    .filter(el => isElementVisible(el))
                    .map(el => ({
                        el,
                        text: normalizeExistingEntryText(el.innerText || el.textContent || ''),
                        hint: normalizeExistingEntryText([
                            el.getAttribute?.('data-automation-id'),
                            el.getAttribute?.('data-test'),
                            el.getAttribute?.('aria-label'),
                            el.className
                        ].filter(Boolean).join(' '))
                    }))
                    .filter(item => item.text.length >= 3 && item.text.length <= 1200)
                    .filter(item => sectionHints.length === 0 || sectionHints.some(h => item.text.includes(h) || item.hint.includes(h)) || picked.some(value => item.text.includes(value)))
                    .sort((a, b) => a.text.length - b.text.length);

                return containers.some(({ text }) => currentArrayPath === 'websites'
                    ? picked.some(value => text.includes(value))
                    : picked.slice(0, 2).every(value => text.includes(value)));
            }

            // Helper: commit the currently-open entry by clicking its Done/Save button.
            // Only uses platform-specific selectors — avoids broad [data-automation-id="saveButton"]
            // which is Workday's page-level "Save and Continue" and would navigate away.
            async function commitOpenEntry() {
                const commitSelectors = [
                    `[data-test="save-${sectionType}"]`,
                    `[data-test="${sectionType}-save"]`,
                    `[data-automation-id="save-${sectionType}"]`,
                    `[data-automation-id="${sectionType}-save"]`,
                    '[data-automation-id="done"]',
                    '[data-test="save-button"]',
                    'button[type="submit"].save',
                    'button.save-button'
                ];
                for (const sel of commitSelectors) {
                    const btn = document.querySelector(sel);
                    if (btn && isElementVisible(btn)) {
                        console.log(`[Platform] Committing entry via: ${sel}`);
                        deepClick(btn);
                        await new Promise(r => setTimeout(r, 700));
                        return true;
                    }
                }
                // Text-based: only exact "Done" to avoid accidentally clicking "Save and Continue"
                for (const btn of document.querySelectorAll('button, [role="button"]')) {
                    if (!isElementVisible(btn)) continue;
                    const text = (btn.textContent || '').trim();
                    if (text === 'Done' || text === 'done') {
                        console.log(`[Platform] Committing entry via "Done" button`);
                        deepClick(btn);
                        await new Promise(r => setTimeout(r, 700));
                        return true;
                    }
                }
                return false;
            }

            for (let i = 0; i < arrayData.length; i++) {
                throwIfStopRequested();
                const entry = arrayData[i];
                if (!entry || typeof entry !== 'object') continue;
                console.log(`[Platform] Filling ${arrayPath}[${i}]:`, Object.keys(entry).join(', '));

                if (i === 0) {
                    // For the first entry: the form may already be open on the page.
                    // Try to fill it directly; if nothing is found, click Add first.
                    let fieldsFilled = await tryFillEntry(entry, i);

                        if (fieldsFilled === 0) {
                            if (entryAlreadyExistsOnPage(entry, arrayPath)) {
                                console.log(`[Platform] ${arrayPath}[${i}] already exists on page — not clicking Add`);
                                continue;
                            }
                            if (addButtonFailures >= 3) { console.warn(`[Platform] Add button unavailable, stopping`); break; }
                            const entryScope = await openArrayEntryPanel();
                            if (entryScope) {
                                fieldsFilled = await tryFillEntry(entry, i, entryScope);
                            } else {
                                addButtonFailures++;
                                console.warn(`[Platform] Could not open form for ${arrayPath}[0]`);
                        }
                    }

                    if (fieldsFilled > 0) {
                        entriesFilled++;
                        console.log(`[Platform] ✅ Filled ${fieldsFilled} fields for ${arrayPath}[${i}]`);
                    } else {
                        console.warn(`[Platform] ⚠️ No fields filled for ${arrayPath}[${i}]`);
                    }
	                } else {
	                    // For every subsequent entry:
	                    // 1. Commit the currently-open entry (best-effort — some platforms auto-commit)
	                    // 2. If this profile entry is not already rendered, click Add first
	                    // 3. Fill only the newly-open section. Do not pour entry[i] into
	                    //    leftover blank fields from entry[i - 1].
	                    await commitOpenEntry();
	                    if (entryAlreadyExistsOnPage(entry, arrayPath)) {
	                        console.log(`[Platform] ${arrayPath}[${i}] already exists on page — not clicking Add`);
	                        continue;
	                    }
		                    if (addButtonFailures >= 3) { console.warn(`[Platform] Add button unavailable, stopping`); break; }
		                    const entryScope = await openArrayEntryPanel();
		                    let fieldsFilled = 0;
		                    if (!entryScope) {
		                        addButtonFailures++;
		                        console.warn(`[Platform] Could not open new form for ${arrayPath}[${i}], skipping to avoid cross-entry fill`);
		                        continue;
		                    }
		                    fieldsFilled = await tryFillEntry(entry, i, entryScope);
	                    if (fieldsFilled > 0) {
	                        entriesFilled++;
	                        console.log(`[Platform] ✅ Filled ${fieldsFilled} fields for ${arrayPath}[${i}]`);
                    } else {
                        console.warn(`[Platform] ⚠️ No fields filled for ${arrayPath}[${i}]`);
                    }
                }

                if (i < arrayData.length - 1) await new Promise(r => setTimeout(r, 400));
            }

            return entriesFilled;
        } catch (e) {
            if (e?.message === 'FILLO_STOPPED') throw e;
            console.error(`[Platform] Error processing array fields for ${arrayPath}:`, e);
            return 0;
        }
    }

    /**
     * Process platform-specific field using direct field name matching
     * @param {Object} field - Platform field definition with name and profilePath
     * @param {Object} profileData - User profile data
     * @param {Object} fieldTracker - The field tracker object
     * @returns {Promise<boolean>} - True if field was filled
     */
    async function processPlatformField(field, profileData, fieldTracker) {
        try {
            throwIfStopRequested();
            const {name, profilePath} = field;
            if (!name || !profilePath) return false;

            // Build selectors for this specific field name.
            // `selectorAttr` + `selectorMatch` in the database config for custom attribute matching.
            let preferredAttrSel = [];
            if (field.selectorAttr) {
                const op = field.selectorMatch === 'contains' ? '*=' : '=';
                preferredAttrSel = [`[${field.selectorAttr}${op}"${name}"]`];
            }

            // Build extra selectors from database field config
            const extraSelectors = [];
            if (field.selector) extraSelectors.push(field.selector);
            if (field.dataTest) extraSelectors.push(`[data-test="${field.dataTest}"]`);
            if (field.dataSrId) extraSelectors.push(`[data-sr-id="${field.dataSrId}"]`);

            const selectors = [
                ...extraSelectors,                  // database explicit selectors (highest priority)
                ...preferredAttrSel,               // Explicit attr hint
                `[data-automation-id="formField-${name}"]`, // Workday formField container
                `[name="${name}"]`,
                `[id="${name}"]`,
                `[data-automation-id="${name}"]`,
                `[data-test="${name}"]`,
                `[data-sr-id="${name}"]`,          // SmartRecruiters stable IDs
                `[id$="--${name}"]`,
                `[id$="-${name}"]`,
                `[id$="_${name}"]`,
                `[name$="--${name}"]`,
                `[name$="-${name}"]`,
                `[name$="_${name}"]`
            ];

            // Claim matching elements so generic mapping won't touch them
            // (prevents e.g. "address" variant filling postal code fields on iCIMS)
            if (fieldTracker.platformClaimedElements) {
                for (const sel of selectors) {
                    try {
                        for (const el of document.querySelectorAll(sel)) {
                            fieldTracker.platformClaimedElements.add(el);
                        }
                    } catch (_) { /* invalid selector */ }
                }
            }

            if (field.type === 'file') {
                if (!ns.state.resumeDataUri) return false;

                // Find the actual file input
                let fileInput = null;
                for (const sel of selectors) {
                    const elements = document.querySelectorAll(sel);
                    for (const el of elements) {
                        if (el.type === 'file') {
                            fileInput = el; break;
                        } else {
                            const inner = el.querySelector('input[type="file"]') || (el.shadowRoot && el.shadowRoot.querySelector('input[type="file"]'));
                            if (inner) { fileInput = inner; break; }
                        }
                    }
                    if (fileInput) break;
                }

                // Workday fallback: search inside containers with resume/attachment/upload automation IDs
                if (!fileInput && window.location.hostname.endsWith('.myworkdayjobs.com')) {
                    const workdayContainerSelectors = [
                        '[data-automation-id*="resume"]',
                        '[data-automation-id*="attachment"]',
                        '[data-automation-id*="upload"]'
                    ];
                    for (const containerSel of workdayContainerSelectors) {
                        for (const container of document.querySelectorAll(containerSel)) {
                            const input = container.querySelector('input[type="file"]');
                            if (input) { fileInput = input; break; }
                        }
                        if (fileInput) break;
                    }
                    // Last resort: any file input on the page (Workday pages typically have only one)
                    if (!fileInput) {
                        fileInput = document.querySelector('input[type="file"]');
                    }
                }

                // iCIMS fallback: prefer resume-labeled file controls, then any single file input.
                if (!fileInput && window.location.hostname.includes('icims.com')) {
                    const icimsResumeSelectors = [
                        'input[type="file"][name*="resume" i]',
                        'input[type="file"][id*="resume" i]',
                        '[data-test*="resume" i] input[type="file"]',
                        '[data-automation-id*="resume" i] input[type="file"]',
                        '[aria-label*="resume" i] input[type="file"]',
                        '[id*="resume" i] input[type="file"]'
                    ];

                    for (const sel of icimsResumeSelectors) {
                        for (const input of document.querySelectorAll(sel)) {
                            if (!isElementVisible(input)) continue;
                            fileInput = input;
                            break;
                        }
                        if (fileInput) break;
                    }

                    if (!fileInput) {
                        const allFileInputs = Array.from(document.querySelectorAll('input[type="file"]')).filter(isElementVisible);
                        if (allFileInputs.length === 1) {
                            fileInput = allFileInputs[0];
                        }
                    }
                }

                if (fileInput) {
                    if (fileInputHasExistingFile(fileInput)) {
                        console.log(`[Platform] Skipping resume upload for ${name}; file input already has a file`);
                        return false;
                    }

                    try {
                        const res = await fetch(ns.state.resumeDataUri);
                        const blob = await res.blob();
                        const fileObj = new File([blob], ns.state.resumeFileName || 'resume.pdf', { type: blob.type || 'application/pdf' });

                        const dt = new DataTransfer();
                        dt.items.add(fileObj);
                        fileInput.files = dt.files;

                        fileInput.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                        fileInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));

                        console.log(`[Platform] Injected resume file into ${name}`);
                        if (fieldTracker) fieldTracker.platformMatchCount = (fieldTracker.platformMatchCount || 0) + 1;
                        return true;
                    } catch (err) {
                        console.error('Failed to inject file:', err);
                    }
                }
                return false;
            }

            // Get value from profile using profilePath; fall back to field.default if absent
            const keys = profilePath.split('.');
            const profileValue = getProfileValueForPath(profileData, keys);
            const value = (profileValue != null && profileValue !== '') ? profileValue : (field.default ?? null);
            if ((value == null || value === '') && /middlename/i.test(name)) {
                const fullNameValue = getValue(profileData, ['personal_details', 'fullName'])
                    || [getValue(profileData, ['first_name']), getValue(profileData, ['last_name'])].filter(Boolean).join(' ');
                const normalizedFullName = String(fullNameValue || '').toLowerCase().replace(/\s+/g, ' ').trim();

                if (normalizedFullName) {
                    for (const sel of selectors) {
                        for (const el of document.querySelectorAll(sel)) {
                            if (!isElementVisible(el)) continue;
                            const existingVal = (el.value || el.getAttribute('value') || '').toLowerCase().replace(/\s+/g, ' ').trim();
                            if (!existingVal || existingVal !== normalizedFullName) continue;

                            const nativeSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
                            if (nativeSetter) nativeSetter.call(el, '');
                            else el.value = '';
                            el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
                            el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                            el.dispatchEvent(new FocusEvent('blur', { bubbles: true, cancelable: true }));
                            console.log(`[Platform] Cleared incorrect full-name value from ${name}`);
                            markFieldFilled(el, 'platform', fieldTracker);
                            return true;
                        }
                    }
                }
            }
            if (value == null || value === '') return false;

            // Handle array values (like skills)
            const displayValue = Array.isArray(value) ? value.join(', ') : value;

            // Workday multi-select: type each skill individually and pick from dropdown
            if (field.type === 'multi-select') {
                const skills = flattenSkillValues(value);
                if (skills.length === 0) return false;

                const findMultiSelectInput = (root) => {
                    if (!root?.querySelectorAll) return null;
                    const inputSelectors = [
                        '[data-automation-id="searchBox"]',
                        'input[data-uxi-widget-type="selectinput"]',
                        'input[data-uxi-multiselect-id]',
                        'input[id$="--skills"]',
                        'input[placeholder="Search"]',
                        'input:not([type="hidden"])'
                    ];
                    for (const selector of inputSelectors) {
                        const candidate = Array.from(root.querySelectorAll(selector))
                            .find(input => input?.tagName?.toLowerCase() === 'input' && !input.disabled && isElementVisible(input));
                        if (candidate) return candidate;
                    }
                    return null;
                };

                // Find the multiselect search input — prefer [data-automation-id="searchBox"] inside
                // the UXI multiSelectContainer, fall back to id/name selectors.
                let msInput = null;
                for (const sel of selectors) {
                    for (const el of document.querySelectorAll(sel)) {
                        if (!isElementVisible(el)) continue;
                        if (el.tagName.toLowerCase() === 'input') { msInput = el; break; }
                        // Container element — look for the searchBox input inside it
                        const inner = findMultiSelectInput(el);
                        if (inner) { msInput = inner; break; }
                    }
                    if (msInput) break;
                }
                // Fallback 1: Workday scopes fields as [data-automation-id="formField-{name}"]
                if (!msInput) {
                    const formFieldEl = document.querySelector(`[data-automation-id="formField-${field.name}"]`);
                    if (formFieldEl) {
                        const mc = formFieldEl.querySelector('[data-automation-id="multiSelectContainer"]');
                        if (mc) msInput = findMultiSelectInput(mc);
                    }
                }
                // Fallback 2: label-text match — avoid picking a different multiselect (e.g. "How did you hear")
                if (!msInput) {
                    const fieldKey = field.name.toLowerCase();
                    const fieldLbl = (field.label || '').toLowerCase();
                    for (const mc of document.querySelectorAll('[data-automation-id="multiSelectContainer"]')) {
                        const formFieldEl = mc.closest('[data-automation-id^="formField-"]');
                        const labelEl = formFieldEl?.querySelector('[data-automation-id="richText"], label, legend');
                        const labelText = (labelEl?.textContent || '').toLowerCase();
                        if (labelText.includes(fieldKey) || (fieldLbl && fieldLbl.split(' ').some(w => w.length > 3 && labelText.includes(w)))) {
                            msInput = findMultiSelectInput(mc);
                            break;
                        }
                    }
                }
                // No further fallbacks — a loose "only one multiselect on page" heuristic
                // would fill the wrong field (e.g. countryPhoneCode) when the skills container
                // is not yet visible on the current Workday step.
                if (!msInput) return false;

                const msContainer = msInput.closest('[data-automation-id="multiSelectContainer"]');

                // monikerSearchBox variant: detected by presence of [data-automation-id="monikerSearchBox"]
                // OR [data-automation-hiddensearch="true"]. Workday toggles the attribute to "false"
                // after expanding, so we capture the flag NOW before any interaction changes it.
                const isMonikerVariant = !!(
                    msContainer?.querySelector('[data-automation-id="monikerSearchBox"]') ||
                    msContainer?.querySelector('[data-automation-hiddensearch="true"]')
                );
                const activateSkillPrompt = async (input = msInput, { clickPromptButton = true } = {}) => {
                    const scope = input?.closest?.('[data-automation-id^="formField-"]') || document.querySelector(`[data-automation-id="formField-${field.name}"]`);
                    const container = input?.closest?.('[data-automation-id="multiSelectContainer"]') || scope?.querySelector('[data-automation-id="multiSelectContainer"]') || msContainer;
                    const inputContainer = container?.querySelector('[data-automation-id="multiselectInputContainer"]');
                    const hasSearchText = !!String(input?.value || '').trim();
                    const searchButton = clickPromptButton && !hasSearchText
                        ? container?.querySelector('[data-automation-id="promptSearchButton"], [data-automation-id="promptIcon"]')
                        : null;
                    const monikerBox = container?.querySelector('[data-automation-id="monikerSearchBox"]');

                    clickLikeUser(inputContainer || container || input);
                    await new Promise(r => setTimeout(r, isMonikerVariant ? 200 : 100));
                    // Do not click Workday's clearSearchButton. After text is entered,
                    // the prompt button flips to a clear button in the same icon area.
                    if (searchButton) {
                        clickLikeUser(searchButton);
                        await new Promise(r => setTimeout(r, isMonikerVariant ? 350 : 150));
                    } else if (!hasSearchText) {
                        clickLikeUser(monikerBox || input);
                        await new Promise(r => setTimeout(r, isMonikerVariant ? 250 : 100));
                    }

                    input?.focus?.();
                    input?.dispatchEvent?.(new FocusEvent('focusin', { bubbles: true }));
                    input?.dispatchEvent?.(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                    input?.dispatchEvent?.(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                    input?.click?.();
                    await new Promise(r => setTimeout(r, 100));
                };

                await activateSkillPrompt(msInput);

                const normalizeSkillText = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
                const scoreSkillOption = (wanted, candidate) => {
                    if (!wanted || !candidate) return 0;
                    if (candidate === wanted) return 100;
                    if (candidate.startsWith(wanted)) return 85;
                    if (candidate.includes(wanted)) return 75;

                    const wantedWords = wanted.split(' ').filter(Boolean);
                    const candidateWords = candidate.split(' ').filter(Boolean);
                    if (!wantedWords.length || !candidateWords.length) return 0;

                    let hits = 0;
                    for (const w of wantedWords) {
                        if (candidateWords.some(cw => cw === w || cw.includes(w) || w.includes(cw))) hits++;
                    }
                    return Math.floor((hits / wantedWords.length) * 60);
                };
                let addedCount = 0;

                for (const skill of skills) {
                    throwIfStopRequested();
                    // Re-lookup the input each iteration — UXI can replace DOM nodes after selection.
                    // Also handles monikerSearchBox variant where the input is inside a hidden-search wrapper.
                    const formFieldScope = document.querySelector(`[data-automation-id="formField-${field.name}"]`);
                    let liveInput = findMultiSelectInput(formFieldScope) || findMultiSelectInput(msContainer) || msInput;
                    if (!liveInput || !isElementVisible(liveInput)) {
                        // Last chance: expand hidden search and retry
                        const hiddenWrap = formFieldScope?.querySelector('[data-automation-hiddensearch="true"]')
                            || msContainer?.querySelector('[data-automation-hiddensearch="true"]');
                        if (hiddenWrap) {
                            (msContainer?.querySelector('[data-automation-id="multiselectInputContainer"]') || msContainer)?.click();
                            await new Promise(r => setTimeout(r, 300));
                            liveInput = findMultiSelectInput(formFieldScope) || findMultiSelectInput(hiddenWrap);
                        }
                        if (!liveInput || !isElementVisible(liveInput)) {
                            // The widget can briefly detach while a pill renders — skip this
                            // skill and retry on the next rather than abandoning all remaining.
                            console.log(`[Platform] Multi-select input not found for "${skill}", skipping to next`);
                            continue;
                        }
                    }

                    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(liveInput), 'value')?.set;

                    // Focus and activate the input
                    await activateSkillPrompt(liveInput);

                    // Clear current value: Ctrl+A then Delete, then reset via setter fallback.
                    const clearLiveInput = () => {
                        liveInput.focus({ preventScroll: true });
                        liveInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', keyCode: 65, ctrlKey: true, bubbles: true, cancelable: true }));
                        liveInput.dispatchEvent(new KeyboardEvent('keyup',   { key: 'a', code: 'KeyA', keyCode: 65, ctrlKey: true, bubbles: true, cancelable: true }));
                        liveInput.select?.();
                        document.execCommand('delete');
                        if (setter) setter.call(liveInput, '');
                        else liveInput.value = '';
                        liveInput.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
                    };
                    clearLiveInput();
                    await new Promise(r => setTimeout(r, 40));
                    // Verify it actually emptied. UXI sometimes ignores execCommand/setter, leaving
                    // the previous skill's text in place — which then keeps surfacing that skill's
                    // options for every subsequent search (the root of "every skill became Java").
                    // Backspace it out character-by-character as a guaranteed fallback.
                    for (let guard = 0; guard < 40 && String(liveInput.value || '').length; guard++) {
                        liveInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', keyCode: 8, bubbles: true, cancelable: true }));
                        const trimmed = String(liveInput.value || '').slice(0, -1);
                        if (setter) setter.call(liveInput, trimmed);
                        else liveInput.value = trimmed;
                        liveInput.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
                        liveInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Backspace', code: 'Backspace', keyCode: 8, bubbles: true, cancelable: true }));
                        await new Promise(r => setTimeout(r, 15));
                    }
                    await new Promise(r => setTimeout(r, 50));

                    // Type the skill using execCommand('insertText') — this fires isTrusted browser
                    // events that UXI's search handler responds to, unlike synthetic InputEvents.
                    // Fall back to the React-native-setter approach if execCommand is unavailable.
                    const didExecInsert = document.execCommand('insertText', false, skill);
                    if (!didExecInsert) {
                        for (let i = 0; i < skill.length; i++) {
                            const ch = skill[i];
                            const newVal = skill.substring(0, i + 1);
                            liveInput.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }));
                            if (setter) setter.call(liveInput, newVal);
                            else liveInput.value = newVal;
                            liveInput.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: ch }));
                            liveInput.dispatchEvent(new KeyboardEvent('keyup',  { key: ch, bubbles: true, cancelable: true }));
                            await new Promise(r => setTimeout(r, 20));
                        }
                    }
                    if (liveInput.value !== skill) {
                        if (setter) setter.call(liveInput, skill);
                        else liveInput.value = skill;
                    }
                    liveInput.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: skill }));
                    liveInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                    dispatchKey(liveInput, 'ArrowDown', 'ArrowDown', 40);
                    await new Promise(r => setTimeout(r, 150));
                    dispatchKey(liveInput, 'Enter', 'Enter', 13);

                    // Wait for Workday debounce (~300ms)
                    await new Promise(r => setTimeout(r, 400));

                    // Helper to get currently visible dropdown options (reused below).
                    // Some Workday tenants keep a loading overlay open for several seconds
                    // while the skill taxonomy service searches, so expose loading/no-result
                    // state separately from selectable options.
                    const getSkillListState = () => {
                        const cid = liveInput.getAttribute('aria-controls');
                        const widgetId = liveInput.getAttribute('data-uxi-multiselect-id');
                        const lr = cid ? document.getElementById(cid) : null;
                        const associatedPrompt = widgetId
                            ? document.querySelector(`[data-associated-widget="${widgetId}"]`)
                            : null;
                        const fallbackRoots = !lr && !associatedPrompt
                            ? [
                                ...getOpenWorkdayDropdowns(),
                                ...document.querySelectorAll('[data-automation-id="responsiveMonikerPrompt"], [data-automation-id="multiselectListBox"], [data-automation-id="activeListContainer"], [role="listbox"], ul[role="listbox"]')
                            ]
                            : [];
                        const roots = Array.from(new Set([
                            lr,
                            associatedPrompt,
                            ...fallbackRoots
                        ].filter(Boolean))).filter(isElementVisible);

                        const scopedOptionSelector = [
                            '[data-automation-id="menuItem"][role="option"]',
                            '[role="option"]',
                            '[data-automation-id="multiselectOption"]',
                            '[data-automation-id="promptOption"]',
                            'li[data-automation-id="multiselectItem"]',
                            'li'
                        ].join(', ');
                        const emptyOptionPattern = /no result|no match|no items?|loading|searching|type to search/i;
                        const nodes = roots.flatMap(root => Array.from(root.querySelectorAll(scopedOptionSelector)));
                        const optionRows = nodes.map(opt =>
                            opt.closest?.('[data-automation-id="menuItem"][role="option"], [role="option"], li[data-automation-id="multiselectItem"], li') || opt
                        );
                        const options = Array.from(new Set(optionRows)).filter(o => {
                            const text = o.textContent?.trim() || '';
                            const optionWidgetId = o.querySelector?.('[data-uxi-multiselect-id]')?.getAttribute('data-uxi-multiselect-id')
                                || o.getAttribute?.('data-uxi-multiselect-id');
                            return isElementVisible(o) &&
                                text &&
                                (!widgetId || !optionWidgetId || optionWidgetId === widgetId) &&
                                !o.closest('[data-automation-id="selectedItemList"]') &&
                                o.getAttribute('data-automation-id') !== 'selectedItem' &&
                                !emptyOptionPattern.test(text);
                        });
                        const listText = roots.map(root => root.textContent || '').join(' ').toLowerCase();
                        const noResults = /no results?|no matches|no items? found|no items?/.test(listText);
                        const hasBusyNode = roots.some(root =>
                            root.getAttribute('aria-busy') === 'true' ||
                            root.querySelector('[aria-busy="true"], [role="progressbar"], [data-automation-id*="loading" i], [data-automation-id*="spinner" i]')
                        );
                        const loading = !noResults && options.length === 0 && roots.length > 0 &&
                            (hasBusyNode || !/type to search|start typing/.test(listText));

                        return { options, roots, loading, noResults };
                    };

                    const waitForSkillOptions = async () => {
                        const wanted = normalizeSkillText(skill);
                        const hasExactOption = (state) => state.options.some(opt =>
                            scoreSkillOption(wanted, normalizeSkillText(opt.textContent)) >= 95
                        );
                        const hasRelevantOption = (state) => state.options.some(opt =>
                            scoreSkillOption(wanted, normalizeSkillText(opt.textContent)) >= 40
                        );
                        const startedAt = Date.now();
                        const inputHasRequestedSkill = () => {
                            const inputText = normalizeSkillText(liveInput.value || '');
                            return inputText === wanted || inputText.includes(wanted) || wanted.includes(inputText);
                        };
                        // Settle for a similar (non-exact) option only after a short grace
                        // window, so an exact match that loads slightly later still wins.
                        const canSettleSimilar = (state) =>
                            hasRelevantOption(state) &&
                            !state.loading &&
                            Date.now() - startedAt >= 1500;
                        const canTrustNoResults = (state) =>
                            state.noResults &&
                            !state.loading &&
                            inputHasRequestedSkill() &&
                            Date.now() - startedAt >= 2500;
                        const canTrustIrrelevantResults = (state) =>
                            state.options.length > 0 &&
                            !state.loading &&
                            inputHasRequestedSkill() &&
                            Date.now() - startedAt >= 3500;
                        let latestState = getSkillListState();
                        if (hasExactOption(latestState)) return latestState;

                        return await new Promise(resolve => {
                            let done = false;
                            let poll = 0;
                            const finish = (state) => {
                                if (done) return;
                                done = true;
                                observer.disconnect();
                                clearInterval(intervalId);
                                clearTimeout(timeoutId);
                                resolve(state);
                            };
                            const check = () => {
                                latestState = getSkillListState();
                                if (
                                    hasExactOption(latestState) ||
                                    canSettleSimilar(latestState) ||
                                    canTrustNoResults(latestState) ||
                                    canTrustIrrelevantResults(latestState)
                                ) {
                                    finish(latestState);
                                }
                            };
                            const nudgeSearch = async () => {
                                if (done) return;
                                latestState = getSkillListState();

                                if (poll === 2 && !latestState.loading) {
                                    dispatchKey(liveInput, 'ArrowDown', 'ArrowDown', 40);
                                    dispatchKey(liveInput, 'Enter', 'Enter', 13);
                                }

                                if (poll === 4 && latestState.options.length === 0) {
                                    await activateSkillPrompt(liveInput, { clickPromptButton: false });
                                    liveInput.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: skill }));
                                }

                                if (poll === 16 && latestState.loading) {
                                    liveInput.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: skill }));
                                    liveInput.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                                }

                                poll++;
                                check();
                            };

                            const observer = new MutationObserver(check);
                            observer.observe(document.body, {
                                childList: true,
                                subtree: true,
                                characterData: true,
                                attributes: true,
                                attributeFilter: ['aria-busy', 'aria-selected', 'data-automation-selected', 'data-automation-checked', 'data-uxi-multiselectlistitem-isselected']
                            });
                            const intervalId = setInterval(nudgeSearch, 250);
                            const timeoutId = setTimeout(() => finish(getSkillListState()), 15000);
                            nudgeSearch();
                        });
                    };

                    const skillPillSelector = [
                        '[data-automation-id="selectedItem"]',
                        '[data-automation-id="selectedItemList"] [role="listitem"]',
                        '[data-automation-id="selectedItemList"] li'
                    ].join(', ');
                    const getSelectedSkillTexts = () => {
                        const currentScope = document.querySelector(`[data-automation-id="formField-${field.name}"]`) || msContainer || document;
                        return Array.from(currentScope.querySelectorAll(skillPillSelector))
                            .filter(isElementVisible)
                            .map(node => normalizeSkillText(node.textContent || ''))
                            .filter(Boolean);
                    };

                    // Snapshot the pills already present BEFORE attempting this skill. A
                    // selection only counts when a pill that wasn't in this snapshot appears —
                    // otherwise a pre-existing pill (e.g. an earlier "Java") falsely confirms
                    // every later skill, which is exactly what made the whole list resolve to
                    // "Java". Use a multiset difference so duplicate texts can't mask a miss.
                    const pillTextsBefore = getSelectedSkillTexts();
                    const pillsBefore = pillTextsBefore.length;
                    const newlySelectedSkillTexts = () => {
                        const remaining = pillTextsBefore.slice();
                        const added = [];
                        for (const t of getSelectedSkillTexts()) {
                            const i = remaining.indexOf(t);
                            if (i >= 0) remaining.splice(i, 1);
                            else added.push(t);
                        }
                        return added;
                    };

                    let picked = false;
                    let attemptedSelection = false;

                    // Confirmed only when a genuinely new pill appears (count increased AND a
                    // text not already present shows up).
                    const checkPill = () => newlySelectedSkillTexts().length > 0;
                    const waitForPill = async (polls, interval) => {
                        for (let c = 0; c < polls; c++) {
                            await new Promise(r => setTimeout(r, interval));
                            if (checkPill()) return true;
                        }
                        return false;
                    };
                    const clickWorkdaySkillOption = async (option) => {
                        const row = option.closest?.('[data-automation-id="menuItem"][role="option"], [role="option"]') || option;
                        const listbox = row.closest?.('[role="listbox"], [data-automation-id="activeListContainer"]');
                        const isChecked = () => {
                            const checkbox = row.querySelector?.('[data-automation-id="checkboxPanel"], input[type="checkbox"]');
                            const checkboxWrap = row.querySelector?.('[data-automation-id="checkbox"]');
                            const leaf = row.querySelector?.('[data-automation-id="promptLeafNode"]');
                            return checkbox?.checked === true ||
                                checkbox?.getAttribute?.('aria-checked') === 'true' ||
                                checkboxWrap?.getAttribute?.('data-automationcheckboxchecked') === 'true' ||
                                leaf?.getAttribute?.('data-automation-checked') === 'Checked' ||
                                leaf?.getAttribute?.('data-uxi-multiselectlistitem-isselected') === 'true';
                        };
                        const targets = [
                            row.querySelector?.('[data-automation-id="promptLeafNode"]'),
                            row.querySelector?.('[data-automation-id="promptOption"]'),
                            row.querySelector?.('[data-automation-id="checkboxPanel"]'),
                            row.querySelector?.('[data-automation-id="checkbox"]'),
                            row
                        ].filter(Boolean);

                        // Click the SPECIFIC matched option directly. Do NOT press
                        // ArrowDown+Enter first — that commits whichever option is
                        // highlighted at the top of the list (usually a similar match),
                        // not the exact one. (Index-based keyboard nav remains as the
                        // outer Try 3 fallback below.)
                        row.scrollIntoView({ block: 'nearest' });
                        for (const target of targets) {
                            target.scrollIntoView?.({ block: 'nearest' });
                            clickLikeUser(target);
                            target.dispatchEvent?.(new Event('change', { bubbles: true, cancelable: true }));
                            if (await waitForPill(4, 100)) return true;
                            if (isChecked()) return true;
                        }
                        return false;
                    };

	                    {
                        const skillState = await waitForSkillOptions();
                        const dropdownOpts = skillState.options;

                        if (checkPill()) {
                            console.log(`[Platform] Multi-select added "${skill}" via keyboard entry`);
                            addedCount++;
                            picked = true;
                        } else if (dropdownOpts.length > 0) {
                            attemptedSelection = true;

                            const wanted = normalizeSkillText(skill);
                            const ranked = dropdownOpts
                                .map((opt, idx) => ({
                                    opt,
                                    idx,
                                    text: opt.textContent.trim(),
                                    score: scoreSkillOption(wanted, normalizeSkillText(opt.textContent))
                                }))
                                .sort((a, b) => b.score - a.score || a.idx - b.idx);

                            const best = ranked[0];
                            let confirmed = false;
                            if (!best || best.score < 40) {
                                console.log(`[Platform] No strong skill option match for "${skill}"`);
                            }

                            // Try 1: use the same Workday prompt selection sequence as
                            // school/university search, with checkbox targets included.
                            if (best?.opt && best.score >= 40) {
                                confirmed = await clickWorkdaySkillOption(best.opt);
                            }

                            // Try 2: press Enter on the search INPUT — selects the
                            // already-highlighted first result. Only safe when our best
                            // match IS that first result; otherwise it would commit the
                            // wrong (similar) option, so fall through to Try 3's nav.
                            if (!confirmed && best?.score >= 40 && best.idx === 0) {
                                liveInput.focus({ preventScroll: true });
                                dispatchKey(liveInput, 'Enter', 'Enter', 13);
                                confirmed = await waitForPill(10, 100);
                            }

                            // Try 3: ArrowDown to highlight best option, then Enter on the input.
                            if (!confirmed && best?.score >= 40) {
                                const downCount = Math.max(1, (best?.idx ?? 0) + 1);
                                liveInput.focus({ preventScroll: true });
                                for (let step = 0; step < downCount; step++) {
                                    dispatchKey(liveInput, 'ArrowDown', 'ArrowDown', 40);
                                    await new Promise(r => setTimeout(r, 30));
                                }
                                dispatchKey(liveInput, 'Enter', 'Enter', 13);
                                if (isMonikerVariant) {
                                    await new Promise(r => setTimeout(r, 300));
                                    dispatchKey(liveInput, 'Enter', 'Enter', 13);
                                }
                                confirmed = await waitForPill(8, 100);
                            }

                            if (confirmed) {
                                console.log(`[Platform] Multi-select added "${best?.text || skill}" for "${skill}"`);
                                addedCount++;
                                picked = true;
                            } else {
                                console.log(`[Platform] Multi-select Enter selection did not register for "${skill}"`);
                            }

                            await new Promise(r => setTimeout(r, 250));
                        } else if (skillState.loading) {
                            console.log(`[Platform] Skill options still loading for "${skill}" after waiting, skipping`);
                        } else if (skillState.noResults) {
                            console.log(`[Platform] No Workday skill results for "${skill}", skipping`);
                        } else {
                            attemptedSelection = true;
                            liveInput.focus({ preventScroll: true });
                            dispatchKey(liveInput, 'Enter', 'Enter', 13);
                            const confirmed = await waitForPill(8, 100);
                            if (confirmed) {
                                console.log(`[Platform] Multi-select added "${skill}" via free-text Enter`);
                                addedCount++;
                                picked = true;
                            }
                        }
                    }

                    if (!picked) {
                        console.log(attemptedSelection
                            ? `[Platform] Skill option match found but could not confirm selection for "${skill}", skipping`
                            : `[Platform] No dropdown option found for "${skill}", skipping`);
                        if (setter) setter.call(liveInput, '');
                        else liveInput.value = '';
                        liveInput.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
                        await new Promise(r => setTimeout(r, 300));
                    }
                }

                if (addedCount > 0) {
                    console.log(`[Platform] Added ${addedCount}/${skills.length} skills via multi-select`);
                    // Blur the input to release focus so subsequent field fills aren't intercepted
                    try {
                        const liveInputFinal = findMultiSelectInput(msContainer) || msInput;
                        if (liveInputFinal) {
                            liveInputFinal.value = '';
                            liveInputFinal.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
                            liveInputFinal.blur();
                            liveInputFinal.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
                            liveInputFinal.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
                        }
                        document.body.click(); // dismiss any open dropdown
                    } catch (_) {}
                    await new Promise(r => setTimeout(r, 300));
                    markFieldFilled(msInput, 'platform', fieldTracker);
                    return true;
                }
                return false;
            }

            // Workday single-select: search for one value in a multiselect component and pick it.
            // Used for fields like countryPhoneCode that use the UXI multiselect widget but
            // only need a single option selected (not a comma-separated list like skills).
            if (field.type === 'single-select') {
                const rawSearchTerm = String(displayValue).trim();
                if (!rawSearchTerm) return false;
                const isDegreeField = /degree/i.test(`${field.name || ''} ${field.label || ''}`);
                const isSchoolField = /school|university|institution/i.test(`${field.name || ''} ${field.label || ''}`);

                const getDegreeIntent = (value) => {
                    const normalized = String(value || '')
                        .toLowerCase()
                        .replace(/\./g, '')
                        .replace(/[^a-z0-9]+/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                    if (!normalized) return null;
                    if (/\bphd\b|doctor|doctoral|doctorate/.test(normalized)) return 'doctoral';
                    if (/\bmba\b/.test(normalized)) return 'master_business';
                    if (/\bms\b|\bmsc\b|master.*science/.test(normalized)) return 'master_science';
                    if (/\bma\b|master.*arts/.test(normalized)) return 'master_arts';
                    if (/master/.test(normalized)) return 'master';
                    if (/\bbs\b|\bbsc\b|bachelor.*science/.test(normalized)) return 'bachelor_science';
                    if (/\bba\b|bachelor.*arts/.test(normalized)) return 'bachelor_arts';
                    if (/bachelor|undergraduate/.test(normalized)) return 'bachelor';
                    if (/associate/.test(normalized)) return 'associate';
                    if (/high school|highschool|\bged\b|secondary/.test(normalized)) return 'highschool';
                    return null;
                };

                const degreeIntent = isDegreeField ? getDegreeIntent(rawSearchTerm) : null;
                const searchTerm = degreeIntent
                    ? (degreeIntent.startsWith('bachelor') ? 'Bachelor' :
                        degreeIntent.startsWith('master') ? 'Master' :
                        degreeIntent === 'doctoral' ? 'Doctor' :
                        degreeIntent === 'associate' ? 'Associate' :
                        degreeIntent === 'highschool' ? 'High School' :
                        rawSearchTerm)
                    : rawSearchTerm;
                if (isDegreeField && searchTerm !== rawSearchTerm) {
                    console.log(`[Platform] Degree search normalized "${rawSearchTerm}" -> "${searchTerm}"`);
                }

                // Find the search input inside [data-automation-id="formField-{name}"]
                let ssInput = null;
                const formFieldEl = document.querySelector(`[data-automation-id="formField-${field.name}"]`);
                if (formFieldEl) {
                    const mc = formFieldEl.querySelector('[data-automation-id="multiSelectContainer"]');
                    if (mc) ssInput = mc.querySelector('[data-automation-id="searchBox"]') || mc.querySelector('input');
                }
                if (!ssInput) {
                    for (const sel of selectors) {
                        for (const el of document.querySelectorAll(sel)) {
                            if (!isElementVisible(el)) continue;
                            if (el.tagName.toLowerCase() === 'input') { ssInput = el; break; }
                            const inner = el.querySelector('[data-automation-id="searchBox"]') || el.querySelector('input');
                            if (inner) { ssInput = inner; break; }
                        }
                        if (ssInput) break;
                    }
                }
                if (!ssInput || !isElementVisible(ssInput)) return false;

                // Check if the value is already selected
                const ssContainer = ssInput.closest('[data-automation-id="multiSelectContainer"]') || ssInput.closest('[data-automation-id^="formField-"]');
                const promptInstruction = ssContainer?.querySelector('[data-automation-id="promptAriaInstruction"]');
                const alreadySelected = (promptInstruction?.textContent || '').toLowerCase();
                if (alreadySelected && (selectionTextMatches(alreadySelected, rawSearchTerm) || selectionTextMatches(alreadySelected, searchTerm))) {
                    console.log(`[Platform] [${field.name}] already shows "${alreadySelected}", skipping`);
                    await dismissWorkdayDropdown(ssInput, document.querySelector('[data-automation-id="applyFlowFooter"]') || document.querySelector('main') || document.body);
                    markFieldFilled(ssInput, 'platform', fieldTracker);
                    return true;
                }

                // Type search term and pick the best match from the dropdown. Workday's
                // UXI input is controlled, so direct value assignment often leaves the
                // dropdown unfiltered and open.
                const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(ssInput), 'value')?.set;
                // Moniker searchBox variants (e.g. "School or University") keep the input
                // "Minimized" until the prompt is opened — clicking the input alone surfaces no
                // options, so click the prompt button / input container to expand it first.
                const ssWidget = ssInput.closest('[data-automation-id="multiSelectContainer"]');
                const ssInputContainer = ssWidget?.querySelector('[data-automation-id="multiselectInputContainer"]');
                const ssSearchButton = ssWidget?.querySelector('[data-automation-id="promptSearchButton"], [data-automation-id="promptIcon"]');
                const ssIsMoniker = !!(ssWidget?.querySelector('[data-automation-id="monikerSearchBox"]') ||
                    ssWidget?.querySelector('[data-automation-hiddensearch]'));
                const typeIntoSearch = async () => {
                    clickLikeUser(ssInputContainer || ssWidget || ssInput);
                    await new Promise(r => setTimeout(r, ssIsMoniker ? 200 : 80));
                    if (ssIsMoniker && ssSearchButton) {
                        clickLikeUser(ssSearchButton);
                        await new Promise(r => setTimeout(r, 350));
                    }
                    ssInput.click();
                    ssInput.focus({ preventScroll: true });
                    ssInput.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
                    await new Promise(r => setTimeout(r, ssIsMoniker ? 200 : 100));

                    ssInput.select?.();
                    document.execCommand('delete');
                    if (setter) setter.call(ssInput, '');
                    else ssInput.value = '';
                    ssInput.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
                    await new Promise(r => setTimeout(r, 50));

                    const didExecInsert = document.execCommand('insertText', false, searchTerm);
                    if (!didExecInsert) {
                        for (let i = 0; i < searchTerm.length; i++) {
                            const ch = searchTerm[i];
                            const nextValue = searchTerm.substring(0, i + 1);
                            ssInput.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }));
                            if (setter) setter.call(ssInput, nextValue);
                            else ssInput.value = nextValue;
                            ssInput.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: ch }));
                            ssInput.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true, cancelable: true }));
                            await new Promise(r => setTimeout(r, 20));
                        }
                    }
                    nudgeWorkdaySearchableInput(ssInput, searchTerm);
                    await new Promise(r => setTimeout(r, ssIsMoniker ? 700 : 500));
                };

                const getSingleSelectOptions = () => {
                    const controls = ssInput.getAttribute('aria-controls');
                    const controlledList = controls ? document.getElementById(controls) : null;
                    const lists = controlledList
                        ? [controlledList]
                        : getOpenWorkdayDropdowns();
                    return lists.flatMap(list => Array.from(list.querySelectorAll('[role="option"], li[data-automation-id="multiselectItem"], li')))
                        .filter(opt =>
                            isElementVisible(opt) &&
                            (opt.textContent || '').trim() &&
                            !opt.closest('[data-automation-id="selectedItemList"]') &&
                            !/no result|loading/i.test(opt.textContent || '')
                        );
                };

                const getDegreeSearchTerms = () => {
                    if (degreeIntent === 'doctoral') return ['doctoral', 'doctorate', 'phd', 'doctor'];
                    if (degreeIntent === 'master_business') return ['master', 'mba', 'business'];
                    if (degreeIntent === 'master_science') return ['master', 'science', 'ms', 'msc'];
                    if (degreeIntent === 'master_arts') return ['master', 'arts', 'ma'];
                    if (degreeIntent === 'master') return ['master', 'masters', "master's"];
                    if (degreeIntent === 'bachelor_science') return ['bachelor', 'science', 'bs', 'bsc'];
                    if (degreeIntent === 'bachelor_arts') return ['bachelor', 'arts', 'ba'];
                    if (degreeIntent === 'bachelor') return ['bachelor', 'bachelors', "bachelor's"];
                    if (degreeIntent === 'associate') return ['associate', "associate's"];
                    if (degreeIntent === 'highschool') return ['high school', 'highschool', 'ged', 'secondary'];
                    return [];
                };
                const degreeSearchTerms = isDegreeField ? getDegreeSearchTerms() : [];
                const scoreSingleSelectOption = (candidateText) => {
                    const baseScore = Math.max(
                        scoreExactFirstOption(candidateText, searchTerm),
                        scoreExactFirstOption(candidateText, rawSearchTerm)
                    );
                    if (!isDegreeField || degreeSearchTerms.length === 0) return baseScore;
                    const optionNorm = normalizeSelectText(candidateText);
                    let degreeScore = 0;
                    for (const term of degreeSearchTerms) {
                        const termNorm = normalizeSelectText(term);
                        if (!termNorm) continue;
                        if (optionNorm === termNorm || optionNorm.includes(termNorm)) degreeScore = Math.max(degreeScore, 96);
                    }
                    if (degreeIntent === 'bachelor_science' && /bachelor.*science|science.*bachelor|\bbs\b|\bbsc\b/i.test(candidateText)) degreeScore = Math.max(degreeScore, 100);
                    if (degreeIntent === 'bachelor_arts' && /bachelor.*arts|arts.*bachelor|\bba\b/i.test(candidateText)) degreeScore = Math.max(degreeScore, 100);
                    if (degreeIntent === 'master_science' && /master.*science|science.*master|\bms\b|\bmsc\b/i.test(candidateText)) degreeScore = Math.max(degreeScore, 100);
                    if (degreeIntent === 'master_arts' && /master.*arts|arts.*master|\bma\b/i.test(candidateText)) degreeScore = Math.max(degreeScore, 100);
                    if (degreeIntent === 'master_business' && /master.*business|business.*master|\bmba\b/i.test(candidateText)) degreeScore = Math.max(degreeScore, 100);
                    if (degreeSearchTerms.some(term => term.includes('bachelor')) && /\bba\b|\bbs\b|bachelor/i.test(candidateText)) degreeScore = Math.max(degreeScore, 92);
                    if (degreeSearchTerms.some(term => term.includes('master')) && /\bma\b|\bms\b|mba|master/i.test(candidateText)) degreeScore = Math.max(degreeScore, 92);
                    return Math.max(baseScore, degreeScore);
                };

                await dismissWorkdayDropdown(ssInput);
                await typeIntoSearch();

                if (isSchoolField) {
                    // Workday school/university prompts often need Enter before the
                    // remote list hydrates; keep the exact-match ranking below as the
                    // authoritative selector once options are available.
                    dispatchKey(ssInput, 'Enter', 'Enter', 13);
                    await new Promise(r => setTimeout(r, 500));
                }

                // Skills-style exact-first wait: keep polling for an EXACT option to load
                // before settling (Workday/moniker prompts fetch results asynchronously, so
                // the exact match often arrives after some similar ones). Only fall back to
                // the best similar option after a grace window passes with no exact match.
                const exactMin = isSchoolField ? 100 : (isDegreeField ? 90 : 95);
                const similarMin = isSchoolField ? 85 : (isDegreeField ? 50 : 40);
                const rankOptionsNow = () => getSingleSelectOptions()
                    .map((opt, idx) => {
                        const text = getWorkdayOptionLabel(opt).trim();
                        return { opt, idx, text, score: scoreSingleSelectOption(text) };
                    })
                    .sort((a, b) => b.score - a.score || a.idx - b.idx);

                let ranked = rankOptionsNow();
                let similarSinceTs = null;
                const maxPolls = isSchoolField ? 60 : (isDegreeField ? 8 : 24);
                const settleMs = isSchoolField ? 3000 : (isDegreeField ? 500 : 2500);
                for (let i = 0; i < maxPolls; i++) {
                    ranked = rankOptionsNow();
                    if (ranked.some(r => r.score >= exactMin)) break;          // exact match → settle now
                    if (ranked.some(r => r.score >= similarMin)) {             // only similar so far
                        if (similarSinceTs == null) similarSinceTs = Date.now();
                        else if (Date.now() - similarSinceTs >= settleMs) break;   // grace elapsed → accept similar
                    } else {
                        similarSinceTs = null;
                    }
                    await new Promise(r => setTimeout(r, isDegreeField ? 150 : 250));
                }

                // ranked is sorted by score desc, so ranked[0] is the exact match when one
                // loaded, otherwise the best similar option.
                const best = ranked[0];

                if (best && best.score >= similarMin) {
                    clickLikeUser(best.opt);
                    await new Promise(r => setTimeout(r, 400));
                    console.log(`[Platform] Single-select [${field.name}]="${searchTerm}" -> "${best.text}" (score ${best.score})`);

                    ssInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
                    ssInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
                    dispatchKey(ssInput, 'Escape', 'Escape', 27);
                    await dismissWorkdayDropdown(ssInput, document.querySelector('[data-automation-id="applyFlowFooter"]') || document.querySelector('main') || document.body);
                    markFieldFilled(ssInput, 'platform', fieldTracker);
                    return true;
                }

                if (isSchoolField) {
                    const hasSelectedPromptValue = () => {
                        const scope = ssInput.closest?.('[data-automation-id^="formField-"], [data-automation-id="multiSelectContainer"]') || ssContainer;
                        if (!scope) return false;
                        const selectedText = [
                            ...scope.querySelectorAll('[data-automation-id="selectedItem"], [data-automation-id="selectedItemList"], [data-automation-id="promptSelectionLabel"]')
                        ].map(node => node.textContent || '').join(' ').trim();
                        const instruction = scope.querySelector('[data-automation-id="promptAriaInstruction"]')?.textContent?.trim() || '';
                        return !!selectedText || (!!instruction && !/expanded|0 items selected|select one/i.test(instruction));
                    };

                    ssInput.focus({ preventScroll: true });
                    dispatchKey(ssInput, 'Enter', 'Enter', 13);
                    await new Promise(r => setTimeout(r, 1000));
                    dispatchKey(ssInput, 'Enter', 'Enter', 13);
                    await new Promise(r => setTimeout(r, 500));
                    if (hasSelectedPromptValue()) {
                        ssInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
                        ssInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
                        await dismissWorkdayDropdown(ssInput, document.querySelector('[data-automation-id="applyFlowFooter"]') || document.querySelector('main') || document.body);
                        markFieldFilled(ssInput, 'platform', fieldTracker);
                        console.log(`[Platform] Single-select school committed via Enter fallback: "${searchTerm}"`);
                        return true;
                    }
                }

                // Degree field with no matching option → select "Other". Clear the typed
                // term first so the full option list (which includes "Other") reappears,
                // since the search filters out anything not matching what was typed.
                if (/degree/i.test(`${field.name || ''} ${field.label || ''}`)) {
                    ssInput.focus({ preventScroll: true });
                    ssInput.select?.();
                    document.execCommand('delete');
                    if (setter) setter.call(ssInput, ''); else ssInput.value = '';
                    ssInput.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
                    await new Promise(r => setTimeout(r, 300));
                    let allOpts = getSingleSelectOptions();
                    for (let i = 0; i < 8 && allOpts.length === 0; i++) {
                        await new Promise(r => setTimeout(r, 200));
                        allOpts = getSingleSelectOptions();
                    }
                    const otherOpt = allOpts.find(o => /\bothers?\b/.test(getWorkdayOptionLabel(o).trim().toLowerCase()));
                    if (otherOpt) {
                        clickLikeUser(otherOpt);
                        await new Promise(r => setTimeout(r, 400));
                        console.log(`[Platform] Degree "${searchTerm}" not in options — selecting "Other"`);
                        ssInput.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
                        ssInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
                        dispatchKey(ssInput, 'Escape', 'Escape', 27);
                        await dismissWorkdayDropdown(ssInput, document.querySelector('[data-automation-id="applyFlowFooter"]') || document.querySelector('main') || document.body);
                        markFieldFilled(ssInput, 'platform', fieldTracker);
                        return true;
                    }
                }

                dispatchKey(ssInput, 'Escape', 'Escape', 27);
                await dismissWorkdayDropdown(ssInput);
                console.log(`[Platform] No single-select option matched for ${field.name}: ${searchTerm}`);
                return false;
            }

            // iCIMS custom dropdown: type character-by-character into search, pick first match
            if (field.type === 'icims-dropdown') {
                const strVal = String(displayValue);
                const strLower = strVal.toLowerCase();

                // Find the hidden select for this field
                let hiddenSelect = null;
                let container = null;
                // Try provided selectors first, then name/id with CSS.escape to handle dots/special chars
                const escapedSelectors = [
                    ...selectors,
                    `[name="${CSS.escape(name)}"]`,
                    `[id="${CSS.escape(name)}"]`,
                ];
                for (const sel of escapedSelectors) {
                    let el = null;
                    try { el = document.querySelector(sel); } catch (_) { continue; }
                    if (el) {
                        hiddenSelect = el.tagName === 'SELECT' ? el : null;
                        container = el.closest('.iCIMS_InfoData, .icims-form-group, .form-group, td') || el.parentElement;
                        break;
                    }
                }
                // Fallback: find by label text among all selects on the page
                if (!container) {
                    const labelText = (field.label || '').toLowerCase();
                    if (labelText) {
                        for (const sel of document.querySelectorAll('select')) {
                            const lbl = ns.utils.getFieldLabel(sel).toLowerCase();
                            if (lbl && lbl.includes(labelText)) {
                                hiddenSelect = sel;
                                container = sel.closest('.iCIMS_InfoData, .icims-form-group, .form-group, td') || sel.parentElement;
                                break;
                            }
                        }
                    }
                }
                if (!container) {
                    console.log(`[Platform/iCIMS] No container found for ${name}`);
                    return false;
                }

                // Find the dropdown trigger (.dropdown-select anchor)
                const trigger = container.querySelector('a.dropdown-select, a[role="combobox"]');
                if (!trigger) {
                    // Not an iCIMS custom dropdown — fall through to regular select fill
                    const selectEl = hiddenSelect || container.querySelector('select');
                    if (selectEl) return await fillElement(selectEl, displayValue);
                    return false;
                }

                // Open the dropdown with a full mouse event sequence
                trigger.focus();
                trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                await new Promise(r => setTimeout(r, 800));

                // Find the search input inside the dropdown container
                const dropdownCtnr = container.querySelector('.dropdown-container');
                const searchInput = dropdownCtnr?.querySelector('.dropdown-search')
                    || container.querySelector('.dropdown-search');
                if (!searchInput) {
                    console.log(`[Platform/iCIMS] No search input found for ${name}`);
                    trigger.click(); // close
                    return false;
                }

                // Type character by character (iCIMS uses jQuery keyup to filter via AJAX)
                searchInput.focus({ preventScroll: true });
                searchInput.value = '';
                searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                await new Promise(r => setTimeout(r, 100));

                for (let i = 0; i < strVal.length; i++) {
                    const char = strVal[i];
                    const currentVal = strVal.substring(0, i + 1);

                    searchInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: char, code: `Key${char.toUpperCase()}`, keyCode: char.charCodeAt(0) }));
                    searchInput.value = currentVal;
                    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                    searchInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: char, code: `Key${char.toUpperCase()}`, keyCode: char.charCodeAt(0) }));

                    await new Promise(r => setTimeout(r, 60));
                }

                // Wait for AJAX debounce before polling (iCIMS typically debounces 300-500ms)
                await new Promise(r => setTimeout(r, 1500));

                // Poll for results (up to ~5 more seconds)
                const searchArea = dropdownCtnr || container;
                let matched = false;
                for (let poll = 0; poll < 20; poll++) {
                    await new Promise(r => setTimeout(r, 250));
                    const options = searchArea.querySelectorAll('.dropdown-result[role="option"], .dropdown-results li[role="option"]');
                    const visibleOpts = Array.from(options).filter(o => {
                        const t = o.textContent.trim().toLowerCase();
                        if (!t) return false;
                        // Skip placeholder and status items
                        if (t.includes('no result') || t.includes('make a selection') ||
                            t.includes('type to search') || t.includes('loading') ||
                            t.includes('please select')) return false;
                        return true;
                    });

                    if (visibleOpts.length > 0) {
                        // Try exact / partial match first
                        let bestOpt = null;
                        for (const opt of visibleOpts) {
                            const optText = opt.textContent.trim().toLowerCase();
                            if (optText === strLower || optText.includes(strLower) || strLower.includes(optText)) {
                                bestOpt = opt;
                                break;
                            }
                        }
                        // Fall back to first visible option
                        if (!bestOpt) bestOpt = visibleOpts[0];

                        bestOpt.scrollIntoView({ block: 'nearest' });
                        bestOpt.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                        bestOpt.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
                        bestOpt.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                        console.log(`[Platform/iCIMS] Selected "${bestOpt.textContent.trim()}" for ${name}`);
                        matched = true;
                        break;
                    }
                }

                if (!matched) {
                    // Close dropdown
                    trigger.click();
                    console.log(`[Platform/iCIMS] No options appeared for "${strVal}" (field: ${name})`);
                    return false;
                }

                // Wait for iCIMS to update the hidden select and fire change handlers
                await new Promise(r => setTimeout(r, 500));
                // Also explicitly fire change on hidden select (triggers icimsChangeParent for dependent dropdowns)
                if (hiddenSelect) {
                    hiddenSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }
                markFieldFilled(trigger, 'platform', fieldTracker);
                return true;
            }

            for (const sel of selectors) {
                const elements = Array.from(document.querySelectorAll(sel)).sort((a, b) => getVisualOrderKey(a) - getVisualOrderKey(b));
                for (const el of elements) {
                    if (!isElementVisible(el)) continue;

                    // Workday: avoid generic fills on Country Phone Code selector.
                    const elNameId = ((el.name || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('data-automation-id') || '')).toLowerCase();
                    const elLabel = (getFieldLabel(el) || '').toLowerCase();
                    const isCountryPhoneCodeField =
                         (elNameId.includes('countryphonecode') ||
                          elNameId.includes('phonecountrycode') ||
                          (elNameId.includes('country') && elNameId.includes('phone') && elNameId.includes('code')) ||
                          elLabel.includes('country phone code'));
                    if (isCountryPhoneCodeField && name.toLowerCase() !== 'phonecountrycode') continue;

                    // Guard country/state crossover on Workday address controls.
                    // Some DOM variants expose overlapping IDs/labels (e.g. countryRegion),
                    // so validate semantic intent before applying the value.
                    const pathLower = String(profilePath || '').toLowerCase();
                    const isAddressCountryPath = pathLower.includes('personal_details.address.country');
                    const isAddressStatePath = pathLower.includes('personal_details.address.state');
                    if (isAddressCountryPath || isAddressStatePath) {
                        if (!isAddressCountryPath && isCountyLikeField(el, name)) continue;

                        const formField = el.closest('[data-automation-id^="formField-"]');
                        const formLabel = (formField?.querySelector('[data-automation-id="richText"], label, legend')?.textContent || '').toLowerCase();
                        const directLabel = (getFieldLabel(el) || '').toLowerCase();
                        const labelText = formLabel || directLabel;
                        const hint = [
                            name,
                            el.name,
                            el.id,
                            el.getAttribute('data-automation-id'),
                            getFieldLabel(el),
                            formLabel
                        ].filter(Boolean).join(' ').toLowerCase();

                        const labelLooksCountry = /\bcountry\b/.test(labelText);
                        const labelLooksCounty = /\bcounty\b/.test(labelText);
                        const labelHasRegion = /\bregion\b/.test(labelText);
                        const looksCountry = /\bcountry\b/.test(hint);
                        const hintHasRegion = /\bregion\b/.test(hint);
                        
                        // Treat regionSubdivision1 as a valid country field, not state
                        const isRegionSub1 = hint.includes('regionsubdivision1') || labelText.includes('regionsubdivision1') || hint.includes('region subdivision 1') || labelText.includes('region subdivision 1');
                        
                        const labelLooksState = (/\b(state|province|subdivision|territory)\b/.test(labelText) || (labelHasRegion && !labelLooksCountry)) && !isRegionSub1;
                        const looksState = (/\b(state|province|subdivision|territory)\b/.test(hint) || (hintHasRegion && !looksCountry)) && !isRegionSub1;

                        // Prefer explicit form labels when present.
                        if (isAddressCountryPath && labelText) {
                            if (!labelLooksCountry && labelLooksState) continue;
                        }
                        if (isAddressStatePath && labelText) {
                            if (!labelLooksState && labelLooksCounty) continue;
                        }

                        if (isAddressCountryPath && looksState && !looksCountry && !isRegionSub1) continue;
                        if (isAddressStatePath && looksCountry && !looksState) continue;
                    }

                    // Check if this element was already filled
                    if (fieldTracker.filledElements.has(el)) continue;

                    // Workday-style dropdown buttons carry a UUID in their `value` attribute
                    // (set by the framework), not the selected display text. Using `value` to
                    // detect "already filled" would always skip them. Instead, compare the
                    // button's visible text content against the expected value.
                    const isListboxButton = el.tagName.toLowerCase() === 'button' && el.getAttribute('aria-haspopup') === 'listbox';
                    if (isListboxButton) {
                        const buttonText = el.textContent.trim().toLowerCase();
                        const expectedText = String(displayValue).trim().toLowerCase();
                        if (buttonText && selectionTextMatches(buttonText, expectedText)) {
                            // Already showing the correct option — claim it and move on
                            markFieldFilled(el, 'platform', fieldTracker);
                            await dismissWorkdayDropdown(el, document.querySelector('[data-automation-id="applyFlowFooter"]') || document.querySelector('main') || document.body);
                            return true;
                        }
                        // Otherwise fall through to fillElement regardless of value attribute
                    } else {
                        // For custom web components, check both .value property and value attribute
                        const existingVal = (el.value || el.getAttribute('value') || '').trim();
                        if (!fieldTracker.allowRefill && existingVal && !isErroredField(el)) continue;
                    }

                    try {
                        if (await fillElement(el, displayValue)) {
                            console.log(`[Platform] Filled ${name} → ${profilePath}`);
                            markFieldFilled(el, 'platform', fieldTracker);
                            return true;
                        }
                    } catch (e) {
                        console.warn(`[Platform] Failed to fill element ${name}:`, e);
                        // Continue with next element
                    }
                }
            }

            return false;
        } catch (e) {
            if (e?.message === 'FILLO_STOPPED') throw e;
            console.warn(`[Platform] Error processing field ${field?.name}:`, e);
            return false;
        }
    }

    async function processSingleField(path, variants, value, fieldTracker) {
        let processValue = value;
        if (Array.isArray(value) && path.toLowerCase().includes('address')) {
            processValue = value[0];
        } else if (Array.isArray(value)) {
            processValue = value.join(', ');
        }
        
        for (const variant of variants) {
            const selectors = buildSelectors(variant);
            for (const sel of selectors) {
                const elements = Array.from(document.querySelectorAll(sel)).sort((a, b) => getVisualOrderKey(a) - getVisualOrderKey(b));
                for (const el of elements) {
                    // Skip if already filled, not visible, or claimed by platform mapping
                    if (isFieldFilled(el, fieldTracker) || !isElementVisible(el)) continue;
                    if (fieldTracker.platformClaimedElements?.has(el)) continue;
                    if (el.closest?.('[data-automation-id="multiSelectContainer"]')) continue;

                    // Generic guard for address country/state crossover.
                    const lowerPath = String(path || '').toLowerCase();
                    const isCountryPath = lowerPath.includes('personal_details.address.country');
                    const isStatePath = lowerPath.includes('personal_details.address.state');
                    if (isCountryPath || isStatePath) {
                        if (isCountyLikeField(el, variant)) continue;

                        const formField = el.closest('[data-automation-id^="formField-"]');
                        const formLabel = (formField?.querySelector('[data-automation-id="richText"], label, legend')?.textContent || '').toLowerCase();
                        const directLabel = (getFieldLabel(el) || '').toLowerCase();
                        const labelText = formLabel || directLabel;

                        // Treat regionSubdivision1 as a valid country field, not state
                        const isRegionSub1 = labelText.includes('regionsubdivision1') || labelText.includes('region subdivision 1') || variant.includes('regionsubdivision1');

                        const labelLooksCountry = /\bcountry\b/.test(labelText);
                        const labelLooksCounty = /\bcounty\b/.test(labelText);
                        const labelHasRegion = /\bregion\b/.test(labelText);
                        const labelLooksState = (/\b(state|province|subdivision|territory)\b/.test(labelText) || (labelHasRegion && !labelLooksCountry)) && !isRegionSub1;

                        if (isCountryPath && labelText) {
                            if (!labelLooksCountry && labelLooksState) continue;
                        }
                        if (isStatePath && labelText) {
                            if (!labelLooksState && labelLooksCounty) continue;
                        }
                    }

                    // Workday: avoid generic fills on Country Phone Code selector.
                    // This field is framework-managed and re-filling can break subsequent validation.
                    const elNameId = ((el.name || '') + ' ' + (el.id || '') + ' ' + (el.getAttribute('data-automation-id') || '')).toLowerCase();
                    const elLabel = (getFieldLabel(el) || '').toLowerCase();
                    const isCountryPhoneCodeField =
                        (elNameId.includes('countryphonecode') ||
                         elNameId.includes('phonecountrycode') ||
                         (elNameId.includes('country') && elNameId.includes('phone') && elNameId.includes('code')) ||
                         elLabel.includes('country phone code'));
                    if (isCountryPhoneCodeField) continue;

                    // Full-name generic mappings are intentionally broad ("name"), but
                    // they must not fill Workday's individual legal name parts.
                    if (lowerPath === 'name' || lowerPath === 'personal_details.fullname') {
                        if (isPersonalNamePartField(el)) {
                            const partText = [
                                el.name || '',
                                el.id || '',
                                el.getAttribute('data-automation-id') || '',
                                getFieldLabel(el) || '',
                                el.closest?.('[data-automation-id^="formField-"]')?.textContent || ''
                            ].join(' ').toLowerCase();
                            const isMiddleNameField = /\bmiddle\s+name\b/.test(partText) || /legalname--middlename/.test(partText);
                            const existingVal = (el.value || el.getAttribute('value') || '').toLowerCase().replace(/\s+/g, ' ').trim();
                            const fullNameVal = String(processValue || '').toLowerCase().replace(/\s+/g, ' ').trim();

                            if (isMiddleNameField && existingVal && existingVal === fullNameVal) {
                                const nativeSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
                                if (nativeSetter) nativeSetter.call(el, '');
                                else el.value = '';
                                el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'deleteContentBackward' }));
                                el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                                el.dispatchEvent(new FocusEvent('blur', { bubbles: true, cancelable: true }));
                                console.log('[Generic] Cleared full-name value from middle-name field');
                            }
                            continue;
                        }
                    }

                    const score = computeScore(el, variant);
                    if (score >= MAPPING_SCORE_MIN) {
                        if (await fillElement(el, processValue)) {
                            console.log(`[Generic] Filled ${path}: ${sel} (score: ${score})`);
                            markFieldFilled(el, 'generic', fieldTracker);
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    async function processArrayField(path, variants, values, fieldTracker) {
        if (Array.isArray(values) && values.length > 0) {
            const first = values[0];
            for (const [k, v] of Object.entries(first)) {
                if (v && typeof v === 'string') {
                    const fieldPath = `${path.replace('[]', '')}.${k}`;
                    const fieldVariants = variants.map(vr => `${vr}_${k}`);
                    await processSingleField(fieldPath, fieldVariants, v, fieldTracker);
                }
            }
        }
        return true;
    }


    /**
     * Build AI batch queue with only unfilled fields
     * @param {Object} fieldTracker - The field tracker object
     * @returns {Array} - Array of field info objects for unfilled fields only
     */
    function buildAIBatchQueue(fieldTracker) {
        const formEls = document.querySelectorAll('input, select, textarea, button[aria-haspopup="listbox"]');
        const batchAIFields = [];
        const queuedRadioGroups = new Set();

        for (const el of formEls) {
            if (!isElementVisible(el)) continue;
            if (fieldTracker.filledElements.has(el)) continue;
            if (fieldTracker.skippedScreeningElements?.has(el) ||
                fieldTracker.skippedScreeningElements?.has(el.closest?.('[data-automation-id^="formField-"]'))) continue;
            if (isCountyLikeField(el)) continue;

            const tag = el.tagName.toLowerCase();
            const type = (el.type || '').toLowerCase();
            if (type === 'radio') {
                const groupName = el.name || el.id;
                if (groupName && queuedRadioGroups.has(groupName)) continue;
                if (groupName) queuedRadioGroups.add(groupName);
            }

            // Check if element is effectively "empty"
            let isEmpty = false;
            if (tag === 'select') {
                const val = (el.value || '').trim();
                const text = el.options[el.selectedIndex]?.textContent?.toLowerCase() || '';
                if (!val || val === '-1' || val === '0' || text.includes('select') || text.includes('choose')) {
                    isEmpty = true;
                }
            } else if (tag === 'button') {
                // Listbox button: treat as empty when showing a generic placeholder
                const btnText = el.textContent.trim().toLowerCase();
                isEmpty = !btnText || btnText.includes('select') || btnText.includes('choose') || btnText.includes('please');
            } else if (type === 'radio') {
                const groupSelector = el.name ? `input[type="radio"][name="${CSS.escape(el.name)}"]` : null;
                const group = groupSelector ? Array.from(document.querySelectorAll(groupSelector)) : [el];
                isEmpty = group.every(radio => !radio.checked);
            } else {
                isEmpty = (!el.value || el.value.trim() === '' || isErroredField(el));
            }

            if (!isEmpty) continue;

            const fieldInfo = {
                element: el,
                name: el.name || '',
                id: el.id || '',
                type: tag === 'button' ? 'dropdown' : (el.type || 'text'),
                placeholder: el.placeholder || '',
                label: getFieldLabel(el) || '',
                className: el.className || '',
                context: getElementContext(el),
                required: el.required || el.hasAttribute('required'),
                maxLength: el.maxLength > 0 ? el.maxLength : null
            };

            batchAIFields.push(fieldInfo);
        }

        // Answer in strict top-to-bottom visual order so screening questions are never
        // filled out of order (and the page never scrolls backward to reach one).
        batchAIFields.sort((a, b) => getVisualOrderKey(a.element) - getVisualOrderKey(b.element));
        return batchAIFields;
    }

    ns.engine.detectFields = function () {
        const fields = [];
        const seen = new Set();

        function isVisible(el) {
            if (isElementVisible(el)) return true;
            const rect = el.getBoundingClientRect?.();
            return !!rect && rect.width > 0 && rect.height > 0;
        }

        function getLabel(el) {
            let labelText = '';
            const isWorkdayDropdown = el.matches?.('button[aria-haspopup="listbox"]');

            const formField = el.closest?.('[data-automation-id^="formField-"]');
            if (formField) {
                const richText = formField.querySelector('legend div[data-automation-id="richText"] p span')
                    || formField.querySelector('legend div[data-automation-id="richText"] p b')
                    || formField.querySelector('legend div[data-automation-id="richText"] p')
                    || formField.querySelector('legend div[data-automation-id="richText"]')
                    || formField.querySelector('[data-automation-id="formLabel"], label, legend');
                if (richText) labelText = richText.textContent.trim();
            }

            if (!labelText) {
                const fieldset = el.closest?.('fieldset');
                const legend = fieldset?.querySelector('legend');
                if (legend) labelText = legend.textContent.trim();
            }

            if (!labelText && el.id) {
                try {
                    const labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
                    if (labelEl) labelText = labelEl.textContent.trim();
                } catch (_) {}
            }
            if (!labelText) labelText = el.closest?.('label')?.textContent?.trim() || '';
            if (!labelText && !isWorkdayDropdown) labelText = el.getAttribute?.('aria-label') || '';
            if (!labelText) {
                const labelledBy = el.getAttribute?.('aria-labelledby');
                const refEl = labelledBy ? document.getElementById(labelledBy) : null;
                if (refEl) labelText = refEl.textContent.trim();
            }
            if (!labelText) {
                const autoId = el.getAttribute?.('data-automation-id');
                if (autoId) labelText = autoId.replace(/([A-Z])/g, ' $1').replace(/[-_]/g, ' ').trim();
            }
            return labelText.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
        }

        function addField(el, customType = null) {
            if (!el || !isVisible(el)) return;
            const tag = el.tagName.toLowerCase();
            const type = customType || (tag === 'select' ? 'select' : (el.type || 'text').toLowerCase());
            if (['hidden', 'submit', 'button', 'image', 'reset'].includes(type)) return;

            const uid = [
                tag,
                el.name || '',
                el.id || '',
                el.getAttribute('data-automation-id') || '',
                el.getAttribute('data-testid') || el.getAttribute('data-test') || ''
            ].join(':');
            if (seen.has(uid)) return;
            seen.add(uid);

            let options = [];
            if (tag === 'select') {
                options = Array.from(el.options)
                    .map(o => o.textContent.trim())
                    .filter(t => t && !/select|choose/i.test(t))
                    .slice(0, 10);
            }
            const currentValue = tag === 'select'
                ? (el.options[el.selectedIndex]?.textContent?.trim() || '')
                : ((el.value || el.textContent || '').trim());

            fields.push({
                tag,
                type,
                name: el.name || el.getAttribute('name') || el.getAttribute('data-automation-id') || '',
                id: el.id || '',
                placeholder: el.placeholder || '',
                label: getLabel(el).slice(0, 160),
                dataAutomationId: el.getAttribute('data-automation-id') || '',
                dataTestId: el.getAttribute('data-testid') || el.getAttribute('data-test') || '',
                className: (el.className || '').toString().slice(0, 120),
                required: el.required || el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
                hasValue: !!currentValue && !/select|choose|please/i.test(currentValue),
                currentValue: currentValue.slice(0, 80),
                options,
                ariaLabel: el.getAttribute('aria-label') || ''
            });
        }

        document.querySelectorAll('input, textarea, select').forEach(el => addField(el));
        document.querySelectorAll(
            'button[aria-haspopup="listbox"], [role="combobox"]:not(input), ' +
            '[data-automation-id*="dropdown" i], [data-automation-id*="select" i], ' +
            'a.dropdown-select, [data-test*="dropdown" i], [data-test*="select" i]'
        ).forEach(el => addField(el, 'custom-select'));

        return { fields, url: location.href, title: document.title };
    };

    function throwIfStopRequested() {
        if (ns.state.stopRequested) {
            throw new Error('FILLO_STOPPED');
        }
    }

    ns.engine.handleFillForm = async function (profileData, useAI = false, { fromObserver = false, detectedFields = null, resumeDataUri = null, resumeFileName = null } = {}) {
        useAI = false;
        // Prevent concurrent executions
        if (ns.state.isProcessing) {
            console.log('[Fillo] Already processing, skipping...');
            return {filled: 0, message: 'Already processing'};
        }
        if (window.__filloActiveFillRun) {
            console.log('[Fillo] Another fill run is already active in this tab, skipping...');
            return {filled: 0, message: 'Another fill run is already active'};
        }

        // On explicit "Fill Form" clicks, reset user-touched tracking
        if (!fromObserver) {
            userTouchedFieldIds.clear();
        }

        // Reset the forward-only scroll cursor so this run fills top-to-bottom from
        // the top of the page (see scrollForwardIntoView / fillScrollCursor).
        fillScrollCursor = Number.NEGATIVE_INFINITY;

        ns.state.isProcessing = true;
        ns.state.stopRequested = false;
        window.__filloActiveFillRun = true;
        ns.state.resumeDataUri = resumeDataUri;
        ns.state.resumeFileName = resumeFileName;

        try {
            relayLog('info', '🚀 Starting manual fill run', { useAI: false, url: location.href, hasDetectedFields: !!detectedFields, hasResume: !!resumeDataUri });
            throwIfStopRequested();

            if (window.location.hostname.includes('icims.com')) {
                const alreadyUploaded = await waitForIcmsResumeUpload(100);
                if (!alreadyUploaded) {
                    // Upload resume and let iCIMS auto-fill from it; we then overwrite with profile data.
                    const uploaded = await uploadResumeIfPossible();
                    if (uploaded) {
                        relayLog('info', '📄 Resume uploaded — waiting for upload to finish...');
                        await waitForIcmsResumeUpload(20000);
                        relayLog('info', '⏳ Waiting for iCIMS to parse resume and auto-fill fields...');
                        await waitForIcimsFormSettle(1500, 20000);
                        relayLog('info', '✅ iCIMS auto-fill settled — overwriting with profile data');
                    }
                } else {
                    // Resume already present on page load — iCIMS may have auto-filled from it.
                    relayLog('info', '📄 Resume already uploaded — waiting for auto-fill to settle...');
                    await waitForIcimsFormSettle(1500, 15000);
                }
            }

            // Initialize field tracker
                // Do not treat a manual fill click as permission to replace user-entered or
                // platform-prefilled values. Refill tracking still applies to fields Fillo
                // writes during this run, so the iCIMS revert guard can restore our own values
                // if the platform mutates them afterwards.
            const isICIMS = window.location.hostname.includes('icims.com');
            const fieldTracker = {
                filledElements: new Set(),
                platformClaimedElements: new Set(),
                normalizedFilledIds: new Set(),
                unknownFieldIds: new Set(),
                skippedScreeningElements: new Set(),
                allowRefill: false,
                // iCIMS revert guard: tracks element → intended value so we can re-fill reversions
                filledValues: isICIMS ? new Map() : null,
                strategyStats: { platform: 0, classifier: 0, generic: 0, detected: 0, generic_screening: 0 }
            };

            // Step 0: If detected fields with profile mappings are available, use them first
            // This gives the most targeted fill since the user already scanned the page
            if (detectedFields && Array.isArray(detectedFields) && detectedFields.length > 0) {
                const matchedFields = detectedFields.filter(f => f.profileMatch);
                if (matchedFields.length > 0) {
                    relayLog('info', `📋 Using ${matchedFields.length} pre-detected field mappings`);
                    
                    relayLog('info', 'Pre-detected fields:', { matchedFields });

                    const orderedMatchedFields = [...matchedFields].sort((a, b) => getDetectedFieldOrderKey(a) - getDetectedFieldOrderKey(b));

                    for (const df of orderedMatchedFields) {
                        throwIfStopRequested();
                        // Resolve the profile value from the profilePath
                        const keys = df.profileMatch.split('.');
                        const isScreeningAnswerMatch = String(df.profileMatch || '').toLowerCase() === 'job_preferences.screening_answers';
                        let value = null;
                        if (isScreeningAnswerMatch) {
                            const screeningAnswers = profileData?.job_preferences?.screening_answers;
                            const questionText = df.label || df.placeholder || df.ariaLabel || df.name || df.id;
                            const elementType = df.type === 'custom-select' ? 'select' : df.type;
                            value = matchQuestionToAnswer(questionText, screeningAnswers, [], elementType)?.answer || null;
                        } else {
                            value = getProfileValueForPath(profileData, keys);
                        }
                        if (value == null || value === '') continue;

                        const matchPathLower = String(df.profileMatch || '').toLowerCase();

                        const displayValue = Array.isArray(value) ? value.join(', ') : String(value);

                        // Find the actual DOM element using the detected field's identifiers
                        const selectors = [
                            attrSelector('name', df.name),
                            attrSelector('id', df.id),
                            attrSelector('data-automation-id', df.dataAutomationId),
                            df.dataTestId ? `${attrSelector('data-testid', df.dataTestId)}, ${attrSelector('data-test', df.dataTestId)}` : null,
                        ].filter(Boolean);

                        let filled = false;
                        for (const sel of selectors) {
                            try {
                                const elements = document.querySelectorAll(sel);
                                for (const el of elements) {
                                    if (!isElementVisible(el)) continue;
                                    if (fieldTracker.filledElements.has(el)) continue;
                                    if (!fieldTracker.allowRefill && el.value && el.value.trim() && !isErroredField(el)) continue; // Already has a value

                                    // Never map address.country/state into county-like controls.
                                    if ((matchPathLower.includes('personal_details.address.country') ||
                                         matchPathLower.includes('personal_details.address.state')) &&
                                        isCountyLikeField(el, df.name || df.id || '')) {
                                        continue;
                                    }
                                    if ((matchPathLower === 'name' || matchPathLower === 'personal_details.fullname') &&
                                        isPersonalNamePartField(el)) {
                                        continue;
                                    }

                                    if (await fillElement(el, displayValue)) {
                                        console.log(`[Detected] Filled "${df.label || df.name || df.id}" → ${df.profileMatch} = "${displayValue.substring(0, 30)}"`);
                                        markFieldFilled(el, 'detected', fieldTracker);
                                        filled = true;
                                        break;
                                    }
                                }
                            } catch (_) { /* invalid selector */ }
                            if (filled) break;
                        }

                        await new Promise(r => setTimeout(r, 20));
                    }

                    relayLog('info', `📋 Detected fields strategy filled ${fieldTracker.strategyStats.detected || 0} fields`);
                }
            }

            // Step 1: Detect platform and load platform-specific fields
            let platform = null;
            let platformFields = [];
            try {
                const detectFn = ns.domainDetector?.detectPlatform;
                if (typeof detectFn !== 'function') {
                    console.warn('[Fillo] domain-detector not loaded yet, skipping platform detection');
                } else {
                    platform = await detectFn();
                }
            } catch (e) {
                console.warn('[Fillo] Platform detection failed:', e);
                platform = null;
            }

            if (platform) {
                try {
                    // Pass profileData so array templates expand to the correct number of entries
                    platformFields = await getPlatformFields(platform, profileData);
                    relayLog('info', `🎯 Platform detected: ${platform}`, { fieldCount: platformFields.length });
                } catch (e) {
                    console.warn(`[Fillo] Failed to load platform fields for ${platform}:`, e);
                    platformFields = [];
                }
            }

            // Step 2: Try platform-specific mapping first
            if (platformFields.length > 0) {
                relayLog('info', '🎯 Applying platform-specific mappings');

                // Separate array fields from regular fields
                const workFields = platformFields.filter(f => f.profilePath?.startsWith('work_experience'));
                const educationFields = platformFields.filter(f => f.profilePath?.startsWith('education_history'));
                const websiteFields = platformFields.filter(f => f.profilePath?.startsWith('websites'));
                const regularFields = platformFields.filter(f =>
                    !f.profilePath?.startsWith('work_experience') &&
                    !f.profilePath?.startsWith('education_history') &&
                    !f.profilePath?.startsWith('websites')
                );

                // Helper: find the topmost visual position of a section by scanning headings/add-buttons
                function getSectionVisualKey(sectionKeywords) {
                    let best = Number.POSITIVE_INFINITY;
                    const headings = document.querySelectorAll('h1,h2,h3,h4,[role="heading"],[data-automation-id*="heading"],[data-automation-id*="Heading"],[data-automation-id*="section"]');
                    for (const h of headings) {
                        const text = (h.textContent || '').toLowerCase();
                        if (sectionKeywords.some(kw => text.includes(kw)) && isElementVisible(h)) {
                            const k = getVisualOrderKey(h);
                            if (k < best) best = k;
                        }
                    }
                    // Also check add-buttons: walk up to find a shallow heading, same as clickAddButtonForSection
                    const addBtns = document.querySelectorAll('[data-automation-id="add-button"]');
                    for (const btn of addBtns) {
                        if (!isElementVisible(btn)) continue;
                        let ancestor = btn.parentElement;
                        for (let d = 0; d < 15 && ancestor; d++, ancestor = ancestor.parentElement) {
                            const shallow = Array.from(ancestor.querySelectorAll('h1,h2,h3,h4,[role="heading"]'))
                                .filter(h => h.parentElement === ancestor || h.parentElement?.parentElement === ancestor);
                            if (shallow.length > 0) {
                                const headingText = shallow.map(h => (h.textContent || '').toLowerCase()).join(' ');
                                if (sectionKeywords.some(kw => headingText.includes(kw))) {
                                    const k = getVisualOrderKey(btn);
                                    if (k < best) best = k;
                                }
                                break;
                            }
                        }
                    }
                    return best;
                }

                // Build a unified task list and sort everything by visual position so the page
                // is filled strictly top-to-bottom regardless of field type.
                const tasks = [];

                for (const field of regularFields) {
                    tasks.push({ type: 'field', field, orderKey: getFieldOrderKey(field) });
                }

                if (workFields.length > 0) {
                    const orderKey = getSectionVisualKey(['work experience', 'employment history', 'work history', 'professional experience', 'experience']);
                    tasks.push({ type: 'array', arrayPath: 'work_experience', fields: workFields, orderKey });
                }

                if (educationFields.length > 0) {
                    const orderKey = getSectionVisualKey(['education', 'academic background', 'degrees', 'schools']);
                    tasks.push({ type: 'array', arrayPath: 'education_history', fields: educationFields, orderKey });
                }

                // Build websites array data once (used if/when the websites task runs)
                let websitesArray = null;
                if (websiteFields.length > 0) {
                    const pd = profileData?.personal_details || {};
                    const additionalUrls = (pd.additionalLinks || [])
                        .map(l => l?.url || l?.URL || l?.link || '')
                        .filter(url => url && url.trim());
                    const urlCandidates = [pd.linkedin, pd.github, pd.portfolio, pd.website, ...additionalUrls];
                    const seen = new Set();
                    websitesArray = [];
                    for (const rawUrl of urlCandidates) {
                        const cleanUrl = String(rawUrl || '').trim();
                        if (!cleanUrl) continue;
                        const key = cleanUrl.toLowerCase();
                        if (seen.has(key)) continue;
                        seen.add(key);
                        websitesArray.push({ url: cleanUrl });
                    }
                    if (websitesArray.length > 0) {
                        profileData._websites = websitesArray;
                        const orderKey = getSectionVisualKey(['websites', 'web addresses', 'website', 'online profiles']);
                        tasks.push({ type: 'array', arrayPath: 'websites', fields: websiteFields, orderKey });
                    }
                }

                // Sort tasks by visual order. Fields/sections not found on page (Infinity) go last.
                tasks.sort((a, b) => a.orderKey - b.orderKey);

                relayLog('info', `📋 Fill order: ${tasks.map(t => t.type === 'field' ? (t.field.name || t.field.profilePath) : t.arrayPath).join(' → ')}`);

                for (const task of tasks) {
                    throwIfStopRequested();
                    if (task.type === 'field') {
                        await processPlatformField(task.field, profileData, fieldTracker);
                        const delay = task.field.type === 'icims-dropdown' ? 4000 : 20;
                        await new Promise(r => setTimeout(r, delay));
                    } else if (task.type === 'array') {
                        if (task.arrayPath === 'work_experience') {
                            const workData = profileData['work_experience'];
                            relayLog('info', `💼 Processing work experience (${Array.isArray(workData) ? workData.length : 0} entries)`);
                            await processArrayFields(task.fields, profileData, fieldTracker, 'work_experience');
                        } else if (task.arrayPath === 'education_history') {
                            const eduData = profileData['education_history'];
                            relayLog('info', `🎓 Processing education history (${Array.isArray(eduData) ? eduData.length : 0} entries)`);
                            await processArrayFields(task.fields, profileData, fieldTracker, 'education_history');
                        } else if (task.arrayPath === 'websites' && websitesArray?.length > 0) {
                            relayLog('info', `🌐 Processing websites (${websitesArray.length} entries)`);
                            await processArrayFields(task.fields, { ...profileData, websites: websitesArray }, fieldTracker, 'websites');
                        }
                    }
                }
            }

            // Step 2.4: Comprehensive top-to-bottom formField scan — catches anything missed above.
            // Reads all visible [data-automation-id^="formField-"] containers sorted by visual position,
            // matches each against the full platform config (flat fields + array templates), and fills.
            if (platformFields.length > 0) {
                try {
                    const platformConfig = await ns.mapping.loadPlatformConfig(platform);
                    if (platformConfig) {
                        const fieldLookup = buildPlatformFieldLookup(platformConfig);

                        // Collect all visible, unfilled formField containers and sort top-to-bottom
                        const visibleFormFields = Array.from(document.querySelectorAll('[data-automation-id^="formField-"]'))
                            .filter(el => isElementVisible(el) && !fieldTracker.filledElements.has(el))
                            .sort((a, b) => getVisualOrderKey(a) - getVisualOrderKey(b));

                        // Track array indices so we fill [0], [1], [2]... for repeated sections
                        const arrayIndexTracker = {};

                        for (const container of visibleFormFields) {
                            throwIfStopRequested();
                            if (fieldTracker.filledElements.has(container)) continue;

                            // Resolve this container back to its platform mapping + profile value.
                            const resolved = resolvePlatformUnit(container, fieldLookup, profileData, arrayIndexTracker);
                            if (!resolved) continue;
                            const { def, value, autoId, labelText } = resolved;

                            if ((def.type === 'multi-select' || def.type === 'single-select') && def.field) {
                                await processPlatformField(def.field, profileData, fieldTracker);
                                await new Promise(r => setTimeout(r, 60));
                                continue;
                            }

                            // Handle Workday date spinbuttons
                            const isDateField = def.name === 'startdate' || def.name === 'enddate' ||
                                def.name === 'educationstartdate' || def.name === 'educationenddate' ||
                                def.name === 'firstyearattended' || def.name === 'lastyearattended';
                            if (isDateField) {
                                const dateWrapper = container.querySelector('[data-automation-id="dateInputWrapper"]');
                                if (dateWrapper && isElementVisible(dateWrapper) && !fieldTracker.filledElements.has(dateWrapper)) {
                                    let month = null, year = null;
                                    const dateStr = String(value).trim();
                                    const slashMatch = dateStr.match(/^(\d{1,2})[\/\-](\d{4})$/);
                                    if (slashMatch) { month = slashMatch[1]; year = slashMatch[2]; }
                                    if (!year) { const iso = dateStr.match(/^(\d{4})[\/\-](\d{1,2})$/); if (iso) { year = iso[1]; month = iso[2]; } }
                                    if (!year) {
                                        const mn = { jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12 };
                                        const wm = dateStr.match(/^([a-zA-Z]+)\s+(\d{4})$/);
                                        if (wm) { const m = mn[wm[1].toLowerCase()]; if (m) { month = String(m); year = wm[2]; } }
                                    }
                                    if (!year) { const ym = dateStr.match(/^(\d{4})$/); if (ym) year = ym[1]; }
                                    const mi = dateWrapper.querySelector('[data-automation-id="dateSectionMonth-input"]');
                                    const yi = dateWrapper.querySelector('[data-automation-id="dateSectionYear-input"]');
                                    if (mi && month) await fillElement(mi, month);
                                    if (yi && year) await fillElement(yi, year);
                                    if (mi || yi) { markFieldFilled(dateWrapper, 'platform', fieldTracker); markFieldFilled(container, 'platform', fieldTracker); }
                                }
                                await new Promise(r => setTimeout(r, 60));
                                continue;
                            }

                            const input = container.querySelector('input:not([type="hidden"]):not([type="file"]), textarea, select, button[aria-haspopup="listbox"]');
                            if (!input || !isElementVisible(input) || fieldTracker.filledElements.has(input)) continue;

                            const displayValue = Array.isArray(value) ? value.join(', ') : String(value);
                            if (await fillElement(input, displayValue)) {
                                markFieldFilled(input, 'platform', fieldTracker);
                                markFieldFilled(container, 'platform', fieldTracker);
                                relayLog('info', `[TopDown] "${autoId || labelText}" → "${displayValue.substring(0, 40)}"`);
                            }
                            await new Promise(r => setTimeout(r, 60));
                        }
                    }
                } catch (e) {
                    console.warn('[Fillo] Top-to-bottom scan failed:', e);
                }
            }

            // Step 2.5: Normalized classifier pass — catches typed/pattern mappings and
            // logs unknown fields without blindly filling unmatched controls.
            if (platformFields.length > 0) {
                try {
                    const classifierFields = platformFields.filter(f =>
                        f?.profilePath &&
                        !f.profilePath.startsWith('work_experience') &&
                        !f.profilePath.startsWith('education_history') &&
                        !f.profilePath.startsWith('websites') &&
                        f.type !== 'file'
                    );
                    const classifierFilled = await fillByClassifier(
                        profileData,
                        [...getBuiltInClassifierMappings(platform), ...classifierFields],
                        fieldTracker
                    );
                    if (classifierFilled > 0) {
                        relayLog('info', `Filled ${classifierFilled} fields via classifier`);
                    }
                } catch (e) {
                    console.warn('[Fillo] Classifier pass failed:', e);
                }
            }

            // Step 2.6: Fill Workday questionnaire/screening questions
            if (platform === 'workday') {
                try {
                    const disabilityDateFilled = await fillWorkdayDisabilityDateSigned(fieldTracker);
                    if (disabilityDateFilled > 0) {
                        relayLog('info', 'Filled Workday disability Date Signed');
                    }
                    const qFilled = await fillWorkdayQuestionnaire(profileData, fieldTracker);
                    if (qFilled > 0) {
                        relayLog('info', `Filled ${qFilled} questionnaire answers`);
                    }
                    const voluntaryFilled = await fillWorkdayVoluntaryDisclosures(profileData, fieldTracker);
                    if (voluntaryFilled > 0) {
                        relayLog('info', `Filled ${voluntaryFilled} voluntary disclosure fields`);
                    }
                } catch (e) {
                    console.warn('[Fillo] Questionnaire fill failed:', e);
                }
            }

            // Step 2.7: Fill iCIMS company-specific rcf* fields by label text
            if (platform === 'icims') {
                try {
                    const labelFilled = await fillICIMSByLabel(profileData, fieldTracker);
                    if (labelFilled > 0) {
                        relayLog('info', `Filled ${labelFilled} iCIMS fields by label matching`);
                    }
                } catch (e) {
                    console.warn('[Fillo] iCIMS label fill failed:', e);
                }
            }

            // Step 3: Load generic mapping configuration
            let mappingConfig = [];
            try {
                mappingConfig = await loadMapping();
            } catch (e) {
                console.warn('[Fillo] Mapping load failed:', e.message || e);
                mappingConfig = [];
            }

            // Disconnect existing observer
            if (state.currentObserver) {
                state.currentObserver.disconnect();
                state.currentObserver = null;
            }

            // Step 4: Apply generic mapping for remaining fields
            if (mappingConfig.length > 0) {
                relayLog('info', '📋 Applying generic mappings');
                const genericFieldTracker = {
                    ...fieldTracker,
                    allowRefill: false
                };
                const orderedMappingConfig = [...mappingConfig].sort((a, b) => getVariantOrderKey(a.variants) - getVariantOrderKey(b.variants));

                for (const {path, variants, isArray} of orderedMappingConfig) {
                    throwIfStopRequested();
                    const keys = path.replace('[]', '').split('.');
                    const val = getProfileValueForPath(profileData, keys);
                    if (val == null) continue;

                    if (isArray && Array.isArray(val)) {
                        await processArrayField(path, variants, val, genericFieldTracker);
                    } else {
                        await processSingleField(path, variants, val, genericFieldTracker);
                    }
                    await new Promise(r => setTimeout(r, 20));
                }
            }


            // Step 5: Generic Screening Questions Match
            const screeningAnswers = profileData?.job_preferences?.screening_answers;
            const salaryExpectationValue = getSalaryExpectationValue(profileData);
            if ((screeningAnswers && screeningAnswers.length > 0) || salaryExpectationValue) {
                relayLog('info', '🔍 Checking for generic screening questions...');
                let questionPatterns = [];
                if (platform) {
                    try {
                        const platformConfig = await ns.mapping.loadPlatformConfig(platform);
                        questionPatterns = platformConfig?.screeningQuestions || [];
                    } catch (e) {
                        console.warn('[Fillo] Could not load generic screening patterns:', e);
                    }
                }
                const unmatchedFields = buildAIBatchQueue(fieldTracker);
                let sqFilled = 0;
                
                for (const fieldInfo of unmatchedFields) {
                    throwIfStopRequested();
                    // Try to match using the field's label or context
                    const questionText = fieldInfo.label || fieldInfo.context?.label || fieldInfo.placeholder || fieldInfo.name;
                    // Skip very short generic field names to avoid false positive semantic matches
                    if (!questionText || questionText.length < 4) continue;
                    // Skip "How did you hear about this position?"
                    if (/how did you (hear|find|learn|know) about/i.test(questionText) ||
                        /source of (hire|application|referral)/i.test(questionText)) continue;

                    let match = matchQuestionToAnswer(questionText, screeningAnswers, questionPatterns, fieldInfo.type);
                    if (!match && salaryExpectationValue && /\b(salary|compensation|pay)\b/i.test(questionText)) {
                        match = { answer: salaryExpectationValue };
                    }
                    if (match) {
                        relayLog('info', `🎯 Generic screening match: "${questionText.substring(0, 40)}..." → "${match.answer}"`);
                        try {
                            const fillTargets = fieldInfo.type === 'radio' && fieldInfo.element.name
                                ? Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(fieldInfo.element.name)}"]`))
                                : [fieldInfo.element];
                            for (const target of fillTargets) {
                                if (await fillElement(target, match.answer)) {
                                    markFieldFilled(target, 'generic_screening', fieldTracker);
                                    sqFilled++;
                                    break;
                                }
                            }
                        } catch (e) {
                            console.warn('[Fillo] Generic screening fill failed:', e);
                        }
                    } else {
                        console.log(`[Fillo] No stored/AI-backed screening answer for "${questionText.substring(0, 60)}"; leaving blank`);
                    }
                }
                
                if (sqFilled > 0) {
                    relayLog('info', `Filled ${sqFilled} generic screening questions`);
                }
            }

            // Step 6: iCIMS revert guard — persistent watcher that re-fills any field iCIMS
            // overwrites after our fill. iCIMS parse XHR can return well after fill completes,
            // so a fixed-pass approach isn't enough — we poll for 15 seconds and re-fill on sight.
            if (isICIMS && fieldTracker.filledValues?.size > 0) {
                let revertFilling = false;
                const revertStart = Date.now();
                const REVERT_WATCH_MS = 15000;
                const revertWatcher = setInterval(async () => {
                    if (Date.now() - revertStart > REVERT_WATCH_MS) {
                        clearInterval(revertWatcher);
                        return;
                    }
                    if (revertFilling) return;
                    revertFilling = true;
                    try {
                        for (const [el, intendedValue] of fieldTracker.filledValues) {
                            if (!el.isConnected) continue;
                            if ((el.value || '').trim() === (intendedValue || '').trim()) continue;
                            relayLog('info', `[iCIMS] Revert detected on "${el.name || el.id}" — re-filling`);
                            await fillElement(el, intendedValue);
                            fieldTracker.filledValues.set(el, el.value);
                        }
                    } finally {
                        revertFilling = false;
                    }
                }, 500);
            }

            // Step 7: Set up dynamic observer to auto-fill newly-rendered fields.
            // Disabled by default so filling only runs when the user clicks the Fill
            // button. Set ns.config.AUTO_REFILL_ON_MUTATION = true to re-enable.
            if (ns.config.AUTO_REFILL_ON_MUTATION) {
                throwIfStopRequested();
                state.currentObserver = ns.engine.observeDynamic(profileData, mappingConfig, useAI);
            }

            // Step 8: Calculate and report results
            const detectedFilled = fieldTracker.strategyStats.detected || 0;
            const totalFilled = fieldTracker.strategyStats.platform +
                               fieldTracker.strategyStats.classifier +
                               fieldTracker.strategyStats.generic +
                               fieldTracker.strategyStats.generic_screening +
                               detectedFilled;

            // Step 8.5: iCIMS post-parse watcher.
            // If we filled nothing (resume parse hadn't returned yet), watch for iCIMS to
            // populate the fields, then immediately re-run the fill to overwrite.
            if (isICIMS && totalFilled === 0 && !fromObserver) {
                const targetInputs = Array.from(
                    document.querySelectorAll('input[name^="PersonProfileFields"], input[name*="_PersonProfileFields"]')
                ).filter(el => el.type !== 'hidden' && el.type !== 'file');

                if (targetInputs.length > 0) {
                    let triggered = false;
                    const triggerRefill = async () => {
                        if (triggered) return;
                        triggered = true;
                        clearInterval(parseWatcherId);
                        relayLog('info', '[iCIMS] Resume parse detected — re-filling with profile data');
                        await ns.engine.handleFillForm(profileData, useAI, { fromObserver: false, resumeDataUri, resumeFileName });
                    };
                    const parseWatcherId = setInterval(() => {
                        const anyPopulated = targetInputs.some(el => (el.value || '').trim().length > 0);
                        if (anyPopulated) triggerRefill();
                    }, 300);
                    setTimeout(() => { if (!triggered) { triggered = true; clearInterval(parseWatcherId); } }, 25000);
                }
            }

            const summary = {
                filled: totalFilled,
                platformFilled: fieldTracker.strategyStats.platform,
                classifierFilled: fieldTracker.strategyStats.classifier,
                genericFilled: fieldTracker.strategyStats.generic,
                screeningFilled: fieldTracker.strategyStats.generic_screening,
                aiMatches: 0,
                detectedFilled: detectedFilled
            };

            relayLog('info', '✅ Fill run completed', summary);

            // Only show the in-page toast when the observer fires a second-pass fill —
            // that means newly-rendered fields (e.g. post-country-selection on Workday)
            // have been caught and filled. Showing it on the initial run is misleading
            // because dependent fields may not have appeared in the DOM yet.
            if (fromObserver && totalFilled > 0) {
                showNotification(`✅ Filled ${totalFilled} more fields`, 'success');
            }

            // Step 9: (Disabled) Auto-click next/continue removed — user navigates manually

            return {
                success: true,
                filled: totalFilled,
                ...summary,
                message: `Manual form filling completed: ${detectedFilled} detected + ${summary.platformFilled} platform + ${summary.classifierFilled} classifier + ${summary.genericFilled} generic + ${summary.screeningFilled} screening`
            };
        } catch (e) {
            if (e?.message === 'FILLO_STOPPED') {
                relayLog('info', 'Fill stopped by user');
                return { success: true, stopped: true, filled: 0, message: 'Fill stopped by user' };
            }
            ns.utils.showNotification('❌ Form filling failed: ' + e.message, 'error');
            throw e;
        } finally {
            ns.state.lastFillTime = Date.now();
            ns.state.isProcessing = false;
            window.__filloActiveFillRun = false;
        }
    };

    ns.engine.observeDynamic = function (profileData, mappingConfig, useAI = false) {
        let timer = null;
        const userActivityWindow = 2000; // 2 seconds

        // Track user interaction so the observer doesn't overwrite manual input
        function onUserInput(e) {
            lastUserInputTime = Date.now();
            const target = e.target;
            if (target && target.matches && target.matches('input,textarea,select,button[aria-haspopup="listbox"],[role="combobox"]')) {
                const id = getFieldIdentity(target);
                if (id) userTouchedFieldIds.add(id);
            }
        }

        document.addEventListener('input', onUserInput, true);
        document.addEventListener('focusin', onUserInput, true);

        const obs = new MutationObserver((mutations) => {
            if (ns.state.stopRequested) return;
            // Block if an active fill is running
            if (ns.state.isProcessing) return;

            // Block for 4 seconds after any fill run to let residual DOM settling pass.
            // Shorter than the old 15s so newly-rendered dependent fields (e.g. Workday
            // state/region after country selection) get picked up in a timely second pass.
            const cooldown = 4000;
            if (ns.state.lastFillTime && (Date.now() - ns.state.lastFillTime) < cooldown) return;

            // Block while user is actively interacting with the form
            if (lastUserInputTime && (Date.now() - lastUserInputTime) < userActivityWindow) return;

            if (timer) clearTimeout(timer);
            timer = setTimeout(async () => {
                if (ns.state.stopRequested) return;
                // Double-check all guards inside the debounce
                if (ns.state.isProcessing) return;
                if (ns.state.lastFillTime && (Date.now() - ns.state.lastFillTime) < cooldown) return;
                if (lastUserInputTime && (Date.now() - lastUserInputTime) < userActivityWindow) return;

                let hasNewFormFields = false;

                for (const m of mutations) {
                    if (m.type === 'attributes') {
                        const target = m.target;
                        if (target?.nodeType === Node.ELEMENT_NODE) {
                            const el = target;
                            const isFormField = el.matches?.('input,textarea,select,button[aria-haspopup="listbox"],[role="combobox"],[data-automation-id^="formField-"]');
                            if (isFormField && isElementVisible(el)) {
                                hasNewFormFields = true;
                            }
                        }
                    }

                    if (m.type === 'childList' && m.addedNodes.length > 0) {
                        m.addedNodes.forEach(node => {
                            if (node.nodeType === Node.ELEMENT_NODE) {
                                const el = node;
                                const selector = 'input,textarea,select,button[aria-haspopup="listbox"],[role="combobox"]';
                                const hasFormFields = el.querySelectorAll?.(selector).length > 0;
                                const isFormField = el.matches?.(selector);

                                if (hasFormFields || isFormField) {
                                    const isActualFormField = isFormField ||
                                        Array.from(el.querySelectorAll(selector)).some(field => {
                                            if (field.offsetParent === null || field.value) return false;
                                            const fid = getFieldIdentity(field);
                                            if (fid && userTouchedFieldIds.has(fid)) return false;
                                            return true;
                                        });
                                    if (isActualFormField) {
                                        console.log('[Fillo] New form field detected (outside cooldown), will re-fill in 500ms');
                                        hasNewFormFields = true;
                                    }
                                }
                            }
                        });
                    }
                }

                if (hasNewFormFields) {
                    await ns.engine.handleFillForm(profileData, useAI, { fromObserver: true });
                }
            }, 300);
        });

        obs.observe(document.body, {childList: true, subtree: true, attributes: true});

        // Wrap disconnect to also clean up user-activity listeners
        const originalDisconnect = obs.disconnect.bind(obs);
        obs.disconnect = () => {
            originalDisconnect();
            document.removeEventListener('input', onUserInput, true);
            document.removeEventListener('focusin', onUserInput, true);
        };

        return obs;
    };
})(window.__Fillo);
