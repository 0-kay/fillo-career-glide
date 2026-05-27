# Workday Job Application — Input Filling Guide

Reference for every field type in a Workday (`myworkdayjobs.com`) application and the exact technique required to fill each one. Workday is a React app — plain `element.value = x` does nothing useful; you must drive React's event system.

---

## Page Flow

Each page is identified by `data-automation-id` on the root section element.

| Step | Selector |
|------|----------|
| Apply button (job detail) | `a[data-automation-id="adventureButton"]` |
| Autofill-with-resume modal | `[data-automation-id="autofillWithResume"]` |
| Apply manually button | `[data-automation-id="applyManually"]` |
| Create account form | `input[data-automation-id="verifyPassword"]` |
| Sign-in form | `[data-automation-id="signInSubmitButton"]` |
| Upload (resume) page | `button[data-automation-id="select-files"]` |
| **My Information** | `[data-automation-id="applyFlowMyInfoPage"]` or `[data-automation-id="contactInformationPage"]` |
| **My Experience** | `[data-automation-id="applyFlowMyExpPage"]` or `[data-automation-id="myExperiencePage"]` |
| **Application Questions** | `[data-automation-id="applyFlowPrimaryQuestionsPage"]` |
| **Voluntary Disclosures** | `[data-automation-id="applyFlowVoluntaryDisclosuresPage"]` |
| **Self Identify** | `[data-automation-id="applyFlowSelfIdentifyPage"]` |
| **Review** | `[data-automation-id="applyFlowReviewPage"]` |
| Continue / Next | `button[data-automation-id="pageFooterNextButton"]` |
| Save and Continue | `button[data-automation-id="bottom-navigation-next-button"]` |
| Cookie accept | `button[data-automation-id="legalNoticeAcceptButton"]` |

---

## React Event Utilities

These helpers are needed by every fill strategy below.

```js
// Use React's native setter to bypass the synthetic value property
function getNativeSetter(el) {
  return Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
}

// Full pointer + mouse sequence (commit selections that need a "real" click)
function clickLikeUser(el) {
  const P = window.PointerEvent || MouseEvent;
  el.dispatchEvent(new P('pointerdown',  { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  el.dispatchEvent(new P('pointerup',    { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true }));
  el.click?.();
}

// Dispatch a keyboard event pair (keydown + keyup)
function dispatchKey(el, key, code = key, keyCode = 0) {
  const opts = { bubbles: true, cancelable: true, key, code, keyCode, which: keyCode };
  el.dispatchEvent(new KeyboardEvent('keydown', opts));
  el.dispatchEvent(new KeyboardEvent('keyup',   opts));
}
```

---

## Input Type Reference

### 1. Text / Textarea

**Selector**: `input[type="text"]`, `input[type="email"]`, `textarea`

**My Information field names** (use `input[name="…"]`):
- `legalName--firstName`, `legalName--lastName`
- `addressLine1`, `city`, `postalCode`
- `phoneNumber`
- `input[data-automation-id="email"]`, `input[data-automation-id="password"]`

**Fill sequence**:
```js
async function fillText(el, value) {
  const setter = getNativeSetter(el);
  const str = String(value);

  // 1. Mark field as "touched"
  el.dispatchEvent(new FocusEvent('focusin',  { bubbles: true }));
  el.dispatchEvent(new FocusEvent('focus',    { bubbles: false }));
  el.focus({ preventScroll: true });

  // 2. Clear pre-existing value so React sees a transition
  if (el.value && el.value !== str) {
    el.select?.();
    if (setter) setter.call(el, '');
    else el.value = '';
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    await new Promise(r => setTimeout(r, 30));
  }

  // 3. Set value via native React setter (bypasses synthetic getter/setter)
  if (setter) setter.call(el, str);
  else el.value = str;
  el.setAttribute('value', str);

  // 4. Fire React's controlled-input events
  el.dispatchEvent(new InputEvent('input',  { bubbles: true, inputType: 'insertText', data: str }));
  el.dispatchEvent(new Event('change',      { bubbles: true }));

  // 5. Optional: fire keyboard events on last char to trigger debounced handlers
  const ch = str.slice(-1) || 'a';
  el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ch }));
  el.dispatchEvent(new KeyboardEvent('keyup',   { bubbles: true, key: ch }));

  await new Promise(r => setTimeout(r, 50));

  // 6. Re-set if React reset (common with controlled components)
  if (el.value !== str) {
    if (setter) setter.call(el, str);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: str }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // 7. Commit
  el.dispatchEvent(new FocusEvent('blur',     { bubbles: false }));
  el.dispatchEvent(new FocusEvent('focusout', { bubbles: true  }));
}
```

**Why**: Workday listens to `focusin` to mark a field "touched" for validation. Without it, required-field errors appear even when filled. The native setter bypasses React's synthetic property so that React's reconciler actually sees the change.

---

### 2. Native `<select>` Dropdown

**Selector**: `select`

**Fill sequence**:
```js
async function fillSelect(el, value) {
  const str = String(value).toLowerCase();

  // Open (some framework selects need this)
  el.focus({ preventScroll: true });
  clickLikeUser(el);
  await new Promise(r => setTimeout(r, 500));

  // Find the best option (exact first, then semantic similarity)
  let best = null, bestScore = 0;
  for (const opt of el.options) {
    const text = opt.textContent.trim().toLowerCase();
    if (opt.value === value || text === str) { best = opt; break; }
    const score = semanticOverlap(str, text); // implement your own
    if (score > bestScore && score > 0.4) { best = opt; bestScore = score; }
  }

  if (best) {
    el.selectedIndex = Array.from(el.options).indexOf(best);
    clickLikeUser(best);
    const setter = getNativeSetter(el);
    if (setter) setter.call(el, best.value);
  }

  el.dispatchEvent(new Event('input',  { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
}
```

---

### 3. Workday Custom Dropdown (button/combobox)

**Selector**: `button[aria-haspopup="listbox"]`, `button[role="combobox"]`, `[role="combobox"]`

This is the most common dropdown style in Workday — a `<button>` that opens a `[role="listbox"]` appended elsewhere in the DOM.

**Fill sequence**:
```js
async function fillWorkdayDropdown(btn, value) {
  const str = String(value).trim();

  btn.focus({ preventScroll: true });
  btn.click(); // opens the listbox

  // Poll for [role="option"] elements — listbox may be appended to <body>
  let options = [];
  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 300));
    options = getOpenDropdownOptions(btn); // finds visible [role="option"] in open listboxes
    if (options.length > 0) break;
  }

  // Score each option and pick best match
  const best = pickBestOption(options, str); // score text against str, require >= 60
  if (!best) return false;

  best.scrollIntoView({ block: 'nearest' });
  clickLikeUser(best); // full pointer sequence — plain .click() often misses Workday handlers

  btn.dispatchEvent(new Event('change',      { bubbles: true }));
  btn.dispatchEvent(new FocusEvent('blur',   { bubbles: false }));
  btn.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  await dismissOpenDropdown(btn); // Escape or blur-click on neutral area
  await new Promise(r => setTimeout(r, 350));

  // Verify it stuck — retry once if it didn't
  if (!btnTextMatchesValue(btn, str)) {
    btn.click();
    const retryOpts = getOpenDropdownOptions(btn);
    const retryBest = pickBestOption(retryOpts, str);
    if (retryBest) clickLikeUser(retryBest);
    await new Promise(r => setTimeout(r, 350));
  }
  return true;
}

// Where to find the open listbox — Workday appends it near the button or to body
function getOpenDropdownOptions(btn) {
  const controlled = btn.getAttribute('aria-controls');
  const roots = [
    controlled && document.getElementById(controlled),
    ...document.querySelectorAll('[role="listbox"], [data-automation-id="listBox"], [data-automation-id="multiselectListBox"]')
  ].filter(el => el && isElementVisible(el));
  return roots.flatMap(r => Array.from(r.querySelectorAll('[role="option"]'))).filter(isElementVisible);
}
```

**Scoring tips**:
- Score 100 — exact text/value match
- Score 96 — both are opt-out/decline phrasing
- Score 85 — one string contains the other
- Score 0 — veteran answers need exact phrase matching (see engine.js:1596–1624 for full logic)

---

### 4. Typeahead / Search Input (school name, skills, country, state)

**Selector**: nested inside `[data-automation-id^="formField-"]`; the actual input has one of:
- `[data-automation-id="searchBox"]`
- `input[data-uxi-widget-type="selectinput"]`
- `input[data-uxi-multiselect-id]`
- `input[placeholder="Search"]`

**School name field wrapper**: `div[data-automation-id="formField-schoolItem"]`

**Fill sequence**:
```js
async function fillTypeahead(searchInput, value, fieldName) {
  const str = String(value).trim();
  const isSchool = ['school', 'schoolName', 'institution', 'university'].includes(fieldName);

  // 1. Click the container to activate the widget
  const container = searchInput.closest('[data-automation-id="multiSelectContainer"]')
                 || searchInput.closest('[data-automation-id^="formField-"]')
                 || searchInput.parentElement;
  clickLikeUser(container);
  await new Promise(r => setTimeout(r, 200));

  // 2. Focus and clear
  const setter = getNativeSetter(searchInput);
  searchInput.focus({ preventScroll: true });
  searchInput.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  searchInput.select?.();
  document.execCommand('delete');
  if (setter) setter.call(searchInput, '');
  else searchInput.value = '';
  searchInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
  await new Promise(r => setTimeout(r, 50));

  // 3. Type the search text
  //    execCommand is most reliable; fall back to char-by-char key events
  const inserted = document.execCommand('insertText', false, str);
  if (!inserted) {
    for (let i = 0; i < str.length; i++) {
      const ch = str[i], partial = str.substring(0, i + 1);
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      if (setter) setter.call(searchInput, partial);
      else searchInput.value = partial;
      searchInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
      searchInput.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
      await new Promise(r => setTimeout(r, 20));
    }
  }
  searchInput.dispatchEvent(new InputEvent('input',  { bubbles: true, inputType: 'insertText', data: str }));
  searchInput.dispatchEvent(new Event('change', { bubbles: true }));
  dispatchKey(searchInput, 'Enter', 'Enter', 13); // trigger Workday's search API call

  // 4. Wait for async results (server-side lookup — up to 15 s)
  //    Use MutationObserver + polling for speed; school fields need score >= 100 (exact)
  const exactMin  = isSchool ? 100 : 40;
  const similarMin = isSchool ? 85  : 40;
  const bestOption = await waitForTypeaheadOption(searchInput, str, exactMin, similarMin);
  if (!bestOption) return false;

  // 5. Click the matched option — do NOT use ArrowDown+Enter,
  //    that picks the top of list (wrong school), not the scored match
  bestOption.scrollIntoView({ block: 'nearest' });
  clickLikeUser(bestOption);
  await new Promise(r => setTimeout(r, 400));

  // 6. Commit: blur using a REAL pointer click on a neutral area.
  //    Synthetic blur events alone don't collapse Workday's typeahead overlay.
  const neutral = document.querySelector('[data-automation-id="applyFlowFooter"]')
               || document.querySelector('main')
               || document.body;
  if (neutral) clickLikeUser(neutral);
  await new Promise(r => setTimeout(r, 150));

  searchInput.dispatchEvent(new FocusEvent('blur',     { bubbles: true }));
  searchInput.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  return true;
}

async function waitForTypeaheadOption(searchInput, str, exactMin, similarMin) {
  const getOptions = () => {
    const controlled = document.getElementById(searchInput.getAttribute('aria-controls'));
    const widgetId   = searchInput.getAttribute('data-uxi-multiselect-id');
    const associated = widgetId && document.querySelector(`[data-associated-widget="${widgetId}"]`);
    const fallback   = [...document.querySelectorAll(
      '[data-automation-id="responsiveMonikerPrompt"], [data-automation-id="multiselectListBox"], [role="listbox"]'
    )];
    const roots = [...new Set([controlled, associated, ...fallback].filter(Boolean))].filter(isElementVisible);
    return roots.flatMap(r => Array.from(r.querySelectorAll('[role="option"], [data-automation-id="menuItem"][role="option"]')))
                .filter(o => isElementVisible(o) && !o.closest('[data-automation-id="selectedItemList"]'));
  };

  return new Promise(resolve => {
    let done = false, similarSince = null;
    let poll = 0;
    const finish = (opt) => { if (done) return; done = true; obs.disconnect(); clearInterval(id); clearTimeout(tid); resolve(opt); };
    const check = () => {
      const ranked = getOptions()
        .map(o => ({ o, score: scoreOption(o.textContent?.trim(), str) }))
        .sort((a, b) => b.score - a.score);
      if (ranked[0]?.score >= exactMin) return finish(ranked[0].o);
      if (ranked[0]?.score >= similarMin) {
        if (!similarSince) similarSince = Date.now();
        else if (Date.now() - similarSince >= 3000) finish(ranked[0].o);
      } else {
        similarSince = null;
      }
    };
    const nudge = () => {
      if (done) return;
      if ([0, 2, 8, 16].includes(poll)) {
        searchInput.focus({ preventScroll: true });
        searchInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: str }));
        searchInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      poll++;
      check();
    };
    const obs = new MutationObserver(check);
    obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['aria-busy', 'aria-selected', 'data-automation-label'] });
    const id  = setInterval(nudge, 250);
    const tid = setTimeout(() => finish(getOptions().sort((a,b) => scoreOption(b.textContent,str)-scoreOption(a.textContent,str))[0]?.o ?? null), 15000);
    nudge();
  });
}
```

**Why school needs score 100**: There are hundreds of similar university names. A partial match like "University of Florida" would score 85 against "Florida International University" — so we hold out for an exact match and only fall back to similarity after a 3-second grace window.

---

### 5. Checkbox

**Selector**: `input[type="checkbox"]`

**Special checkboxes**:
- Disability status group: `fieldset[data-automation-id="disabilityStatus-CheckboxGroup"] label`
- Terms & conditions: `input#termsAndConditions--acceptTermsAndAgreements`
- Create-account agreement: `input[data-automation-id="createAccountCheckbox"]`

**Fill sequence**:
```js
async function fillCheckbox(el, wantChecked) {
  const already = el.checked;
  if (already === wantChecked) return true;  // already correct

  el.focus({ preventScroll: true });
  el.click();
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  return true;
}
```

**Note**: Do NOT blindly toggle — check `el.checked` first, only click if the state needs to change.

---

### 6. Radio Button Group

**Selector**: `input[type="radio"]` — always grouped under `[data-automation-id^="formField-"]` or `<fieldset>`

**Fill sequence**:
```js
async function fillRadioGroup(radios, value) {
  const valueNorm = String(value).trim().toLowerCase();

  for (const radio of radios) {
    const labelText = (getLabelForInput(radio) || radio.value || '').trim().toLowerCase();
    const matches = labelText === valueNorm || labelText.startsWith(valueNorm) || radio.value.toLowerCase() === valueNorm;
    if (!matches) continue;
    if (radio.checked) return true;

    radio.focus({ preventScroll: true });
    radio.click();
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    radio.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    return true;
  }
  return false;
}
```

**Veteran / EEO radio special cases** — these options have tricky labels; see engine.js:1776–1784 for the exact matching rules.

---

### 7. Date Field (Workday Split Spinbutton)

**Wrapper selector**: `[data-automation-id="dateInputWrapper"]`

**Child inputs**:
- `[data-automation-id="dateSectionMonth-input"]` — `role="spinbutton"`
- `[data-automation-id="dateSectionDay-input"]`   — `role="spinbutton"`
- `[data-automation-id="dateSectionYear-input"]`  — `role="spinbutton"`

Workday does NOT use a single `<input type="date">`. Each part is its own spinbutton.

**Fill sequence**:
```js
async function fillWorkdayDate(wrapper, dateValue) {
  const { month, day, year } = parseDateParts(dateValue); // returns { month: '05', day: '27', year: '2024' }

  const monthEl = wrapper.querySelector('[data-automation-id="dateSectionMonth-input"]');
  const dayEl   = wrapper.querySelector('[data-automation-id="dateSectionDay-input"]');
  const yearEl  = wrapper.querySelector('[data-automation-id="dateSectionYear-input"]');

  for (const [el, val] of [[monthEl, String(parseInt(month,10))], [dayEl, String(parseInt(day,10))], [yearEl, year]]) {
    if (!el) continue;
    const setter = getNativeSetter(el);

    el.dispatchEvent(new FocusEvent('focusin',  { bubbles: true }));
    el.dispatchEvent(new FocusEvent('focus',    { bubbles: false }));
    el.focus({ preventScroll: true });

    if (setter) setter.call(el, val);
    else el.value = val;

    // Also update ARIA attrs so Workday's display div reflects the value
    const num = parseInt(val, 10);
    if (!isNaN(num)) {
      el.setAttribute('aria-valuenow',  String(num));
      el.setAttribute('aria-valuetext', val);
    }

    el.dispatchEvent(new InputEvent('input',  { bubbles: true, inputType: 'insertText', data: val }));
    el.dispatchEvent(new Event('change',      { bubbles: true }));
    await new Promise(r => setTimeout(r, 50));

    // Re-set if React reset during event cycle
    if (el.value !== val) {
      if (setter) setter.call(el, val);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: val }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    el.dispatchEvent(new FocusEvent('blur',     { bubbles: false }));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }
}
```

**Special**: Education year-only fields use `[data-automation-id="dateSectionYear-input"]` alone inside `[aria-describedby*="firstYearAttended"]` or `[aria-describedby*="lastYearAttended"]`.

---

### 8. Date Picker (Calendar Icon — "Today" button)

Used on: disability self-identify date, "today's date" screening questions.

```js
async function fillDatePickerToday(container) {
  const icon = container.querySelector('[data-automation-id="dateIcon"]');
  if (!icon || !isElementVisible(icon)) return false;
  icon.click();
  await new Promise(r => setTimeout(r, 500));
  const todayBtn = document.querySelector('[data-automation-id="datePickerSelectedToday"]');
  if (!todayBtn) return false;
  todayBtn.click();
  await new Promise(r => setTimeout(r, 300));
  return true;
}
```

Detect "today's date" questions: `/please\s+enter\s+today'?s\s+date/i.test(questionText)`.

---

### 9. File Upload (Resume)

**Selector**: `input[data-automation-id="file-upload-input-ref"]`  
**Confirmation**: `[data-automation-id="file-upload-item"]`

```js
// Content script (Chrome extension):
async function uploadFile(inputEl, file) {
  // inputEl.type === 'file' — cannot set .value directly
  const dt = new DataTransfer();
  dt.items.add(file); // file is a File object
  inputEl.files = dt.files;
  inputEl.dispatchEvent(new Event('change', { bubbles: true }));
}

// Playwright:
await page.locator("input[data-automation-id='file-upload-input-ref']").setInputFiles(resumePath);
await page.waitForSelector("[data-automation-id='file-upload-item']", { timeout: 15000 });
```

---

### 10. Phone Device Type Dropdown

**Selector**: `button#phoneNumber--phoneType`  
This is a Workday custom dropdown (type 3 above) with a stable ID.

```js
async function fillPhoneType(page_or_doc) {
  const btn = document.querySelector('button#phoneNumber--phoneType');
  if (!btn || !/Select One/i.test(btn.textContent)) return; // already set
  btn.click();
  await new Promise(r => setTimeout(r, 400));
  const mobileOpt = [...document.querySelectorAll('[role="option"]')].find(o => /mobile/i.test(o.textContent));
  if (mobileOpt) clickLikeUser(mobileOpt);
}
```

---

## My Information — Field Selectors

Workday uses two naming conventions for the same fields depending on tenant version:

| Field | Primary selector | Alternate selector |
|-------|------------------|--------------------|
| First name | `input[name="legalName--firstName"]` | `input[data-automation-id="legalNameSection_firstName"]` |
| Last name | `input[name="legalName--lastName"]` | `input[data-automation-id="legalNameSection_lastName"]` |
| Address line 1 | `input[name="addressLine1"]` | `input[data-automation-id="addressSection_addressLine1"]` |
| City | `input[name="city"]` | `input[data-automation-id="addressSection_city"]` |
| Postal code | `input[name="postalCode"]` | `input[data-automation-id="addressSection_postalCode"]` |
| State / Region | `button[data-automation-id="addressSection_countryRegion"]` | Workday dropdown (strategy 3) |
| Phone number | `input[name="phoneNumber"]` | `input[data-automation-id="phone-number"]` |
| Phone type | `button#phoneNumber--phoneType` | `button[data-automation-id="phone-device-type"]` |
| Email | `input[data-automation-id="email"]` | — |
| Password | `input[data-automation-id="password"]` | — |

---

## Education Section

```
[data-automation-id="educationSection"]
  └── button[data-automation-id="Add"]                       ← "Add education" button
  └── div[data-automation-id="formField-schoolItem"]
        └── input                                            ← typeahead (strategy 4, exactMin=100)
  └── button[data-automation-id="degree"]                    ← dropdown (strategy 3)
  └── [data-automation-id="formField-field-of-study"]
        └── input                                            ← typeahead (strategy 4)
  └── [data-automation-id="formField-gradeAverage"]
        └── input[data-automation-id="gpa"]                  ← text (strategy 1)
  └── [data-automation-id="formField-firstYearAttended"]
        └── input[data-automation-id="dateSectionYear-input"] ← year-only spinbutton (strategy 7)
  └── [data-automation-id="formField-lastYearAttended"]
        └── input[data-automation-id="dateSectionYear-input"] ← year-only spinbutton (strategy 7)
```

**Ordering**: Fill school first — it's the section anchor; other fields appear after it commits. Wait for the school typeahead overlay to collapse (neutral pointer click) before moving to degree.

**Multiple entries**: After the first, click `[data-automation-id="educationSection"] button[data-automation-id="Add"]` to reveal entry N, then wait for `[data-automation-id="formField-schoolItem"]` to become visible before filling.

---

## Work Experience Section

```
div[data-automation-id="workExperienceSection"]
  └── button[data-automation-id="Add"]           ← first entry add button (data-automation-id*="add")
  └── button[data-automation-id="Add"]           ← subsequent entries (data-automation-id*="Add")

div[data-automation-id="workExperience-{n}"]    ← n = 1, 2, 3 …
  └── input[data-automation-id="jobTitle"]       ← text (strategy 1)
  └── input[data-automation-id="company"]        ← text (strategy 1)
  └── input[data-automation-id="location"]       ← text (strategy 1)
  └── [data-automation-id="formField-startDate"]
        └── input[data-automation-id="dateSectionMonth-input"] ← spinbutton (strategy 7)
        └── input[data-automation-id="dateSectionYear-input"]
  └── [data-automation-id="formField-endDate"]
        └── input[data-automation-id="dateSectionMonth-input"]
        └── input[data-automation-id="dateSectionYear-input"]
  └── textarea[data-automation-id="description"] ← text area (strategy 1)
```

**Add button**: Scope to `[data-automation-id="workExperienceSection"]` — both work and education share `button[data-automation-id="Add"]` so a document-level query will click the wrong one.

---

## Skills Section

```
[data-automation-id="formField-skillsPrompt"]
  └── input                                      ← typeahead (strategy 4)
```

Skills is a multi-select typeahead — each skill is added individually:
1. Type the skill name into the input
2. Wait for `[role="option"]` suggestions
3. Click the matching option
4. The input clears automatically for the next skill

---

## Languages Section

> **Note**: Only present on some Workday tenants. Check for the section before filling.

```
[data-automation-id="languagesSection"]
  └── button[data-automation-id="Add"]           ← "Add language" button

Per-entry fields (appear after clicking Add):
  └── [data-automation-id="formField-language"]
        └── input                                ← typeahead (strategy 4)
  └── button[data-automation-id="proficiency"]   ← Workday dropdown (strategy 3)
                                                    options: Basic, Conversational, Proficient, Fluent, Native
```

**Fill order**: Type language name first → wait for typeahead commit → then set proficiency dropdown.

---

## Certifications / Licenses Section

> **Note**: Only present on some Workday tenants (usually in "Additional Information" or extended My Experience pages).

```
[data-automation-id="certifications"]           ← or [data-automation-id="certificationsSection"]
  └── button[data-automation-id="Add"]

Per-entry fields:
  └── input[data-automation-id="certificationName"]   ← text (strategy 1)
  └── input or typeahead for issuing organization      ← strategy 1 or 4
  └── [data-automation-id="dateInputWrapper"]         ← issue date (strategy 7)
  └── [data-automation-id="dateInputWrapper"]         ← expiry date (strategy 7)
  └── input[data-automation-id="certificationId"]     ← optional license/cert number, text (strategy 1)
```

If the certification name input opens a typeahead (some tenants), treat it as strategy 4 with `exactMin=40`.

---

## Awards / Honors Section

> **Note**: Only present on some Workday tenants.

```
[data-automation-id="awardsSection"]            ← or [data-automation-id="honorsSection"]
  └── button[data-automation-id="Add"]

Per-entry fields:
  └── input[data-automation-id="awardTitle"]         ← text (strategy 1)
  └── input[data-automation-id="awardIssuer"]        ← text (strategy 1)
  └── [data-automation-id="dateInputWrapper"]        ← award date (strategy 7)
  └── textarea[data-automation-id="awardDescription"] ← optional, text (strategy 1)
```

---

## Websites / Links Section

```
[data-automation-id="websiteSection"]
  └── button[data-automation-id="Add"]

Per-entry containers: div[data-automation-id="websitePanelSet-{n}"]  ← n = 1, 2 …
  └── input                                      ← text (strategy 1), fill with full URL

Special LinkedIn input (present on some tenants instead of the generic box):
  input[data-automation-id="linkedinQuestion"]   ← strategy 1
```

---

## Screening / Application Questions Page

**Container**: `[data-automation-id="applyFlowPrimaryQuestionsPage"]`

Each question lives in `[data-automation-id^="formField-"]`. Find the question text from:
```
legend > div[data-automation-id="richText"] > p  (preferred)
legend                                            (fallback)
```

Then detect the answer element:
| Element found | Field type | Strategy |
|---------------|------------|----------|
| `input[type="radio"]` × N | Radio group | Strategy 6 |
| `button[aria-haspopup="listbox"]` | Workday dropdown | Strategy 3 |
| `input[type="text"]` or `textarea` | Free text | Strategy 1 |

---

## Voluntary Disclosures Page

**Container**: `[data-automation-id="applyFlowVoluntaryDisclosuresPage"]`

Common fields:
- Gender: `button[data-automation-id="gender"]` — Workday dropdown (strategy 3)
- Hispanic / Latino: `button[data-automation-id="hispanicOrLatino"]` — dropdown (strategy 3)
- Ethnicity: `button[data-automation-id="ethnicityDropdown"]` or `button[data-automation-id="ethnicity"]` — dropdown (strategy 3)
- Veteran status: `button[data-automation-id="veteranStatus"]` — dropdown (strategy 3); requires exact phrase matching (see strategy 3 scoring notes)
- Terms / agreement checkbox: `input#termsAndConditions--acceptTermsAndAgreements` or `input[data-automation-id="agreementCheckbox"]` — checkbox (strategy 5)

---

## Self Identify (Disability) Page

**Container**: `[data-automation-id="applyFlowSelfIdentifyPage"]`

Fields:
- Full name: `input#selfIdentifiedDisabilityData--name` (free text, strategy 1)
- Date signed: `[data-automation-id="dateInputWrapper"]` near `[id*="dateSignedOn"]` — fill with today's date (strategy 7)
- Disability status checkbox: `fieldset[data-automation-id="disabilityStatus-CheckboxGroup"] label:text-is("I do not want to answer")` (strategy 5)

---

## Common Pitfalls

| Symptom | Root cause | Fix |
|---------|-----------|-----|
| Field appears empty after fill | Used `el.value = x` without React native setter | Use `getNativeSetter(el).call(el, x)` |
| Validation error on required field | Skipped `focusin` before fill | Dispatch `focusin` first |
| Dropdown closes but nothing selected | Used `ArrowDown+Enter` on typeahead | Click the specific scored `[role="option"]` node |
| School name reverts after 1 s | Synthetic `blur` didn't collapse overlay | Do a real pointer `click` on a neutral element after selection |
| Date spinbutton resets to empty | React reconciler overrode value | Re-check `el.value` after events; set again if needed |
| Second education entry fills first entry's fields | Fill ran before section appeared | Wait for the new `[data-automation-id="formField-schoolItem"]` to be visible before filling |
| Dropdown option selected wrong school | Fuzzy fallback selected before exact loaded | Use MutationObserver with 3-second grace window for school typeaheads |
