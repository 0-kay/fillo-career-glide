(function (ns) {
    function _s(el) {
        return (el?.innerText || el?.textContent || '').trim().replace(/\s+/g, ' ');
    }

    ns.planner.candidateInputs = function () {
        const list = [...document.querySelectorAll('input,textarea,select')].filter(el => !el.disabled && el.offsetParent !== null);
        return list.map((el, i) => {
            const label = el.labels?.[0] || el.closest('label') || el.closest('div,section,td,th');
            const near = label?.closest('div,section,td,th')?.innerText ?? '';
            return {
                id: `el_${i}`,
                tag: el.tagName.toLowerCase(),
                type: el.getAttribute('type') || 'text',
                name: el.getAttribute('name') || null,
                idAttr: el.getAttribute('id') || null,
                placeholder: el.getAttribute('placeholder') || null,
                ariaLabel: el.getAttribute('aria-label') || null,
                labelText: _s(label).slice(0, 200),
                nearbyText: _s({innerText: near}).slice(0, 260),
                required: !!el.required,
                maxLength: el.maxLength > 0 ? el.maxLength : null
            };
        });
    };

    ns.planner.buildPageContext = function () {
        return {url: location.href, title: document.title, inputs: ns.planner.candidateInputs()};
    };

    ns.planner.requestFillPlan = async function (pageCtx, {profileId, useAI = true} = {}) {
        const {FILLO_AUTH_TOKEN} = await chrome.storage.local.get('FILLO_AUTH_TOKEN');
        const r = await fetch('https://api.yourapp.com/llm/fill-plan', {
            method: 'POST',
            headers: {'Content-Type': 'application/json', ...(FILLO_AUTH_TOKEN ? {Authorization: `Bearer ${FILLO_AUTH_TOKEN}`} : {})},
            body: JSON.stringify({pageCtx, profileId, useAI})
        });
        if (!r.ok) throw new Error('plan_failed');
        return r.json();
    };

    ns.planner.indexInputs = function () {
        const map = {}, els = [...document.querySelectorAll('input,textarea,select')];
        els.forEach((el, i) => map[`el_${i}`] = el);
        return map;
    };

    ns.planner.setValue = function (el, val) {
        if (!el) return;
        const tag = el.tagName.toLowerCase();
        if (tag === 'select') {
            el.value = val;
            el.dispatchEvent(new Event('change', {bubbles: true}));
        } else {
            el.focus();
            el.value = val;
            el.dispatchEvent(new Event('input', {bubbles: true}));
            el.dispatchEvent(new Event('change', {bubbles: true}));
            el.blur();
        }
    };

    ns.planner.runLLMAutofill = async function ({profileId} = {}) {
        const flagName = ns.config.ENABLE_LLM_PLAN_FLAG_NAME;
        try {
            const disabled = (typeof window !== 'undefined' && Object.prototype.hasOwnProperty.call(window, flagName)) ? window[flagName] === false : false;
            if (disabled) return;
        } catch (_) { /* ignore */
        }
        const ctx = ns.planner.buildPageContext();
        const plan = await ns.planner.requestFillPlan(ctx, {profileId});
        const byId = ns.planner.indexInputs();
        let filled = 0;
        for (const {id, value, confidence} of (plan.mapping || [])) {
            if (typeof value === 'string' && (confidence ?? 0) >= 60) {
                ns.planner.setValue(byId[id], value);
                filled++;
            }
        }
        console.log(`LLM plan applied: filled ${filled} fields`);
    };
})(window.__Fillo);