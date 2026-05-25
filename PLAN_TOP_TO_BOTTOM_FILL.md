# Plan: Fill forms strictly top-to-bottom (never go backward)

## Goal
Fill any application form in a **single visual sweep from top to bottom**. The
viewport must never scroll back up to an earlier field, and no field earlier in
the document should be filled after a later one.

## Root cause (current behavior)
`engine.js` fills the page as a **sequence of independent full-page passes**,
each restarting at the top of the DOM:

- Step 0 — detected fields ([engine.js:4593](extension/content/engine.js#L4593)) — sorted top→bottom ✅
- Step 2 — platform task list ([engine.js:4776](extension/content/engine.js#L4776)) — sorted ✅
- Step 2.4 — formField scan ([engine.js:4828](extension/content/engine.js#L4828)) — sorted ✅
- Step 2.5 — classifier ([engine.js:4933](extension/content/engine.js#L4933)) — **config order ❌**
- Step 2.6 — questionnaire ([engine.js:4945](extension/content/engine.js#L4945)) — **❌**
- Step 2.7 — iCIMS label fill — **❌**
- Step 4 — generic mapping ([engine.js:4983](extension/content/engine.js#L4983)) — **❌**
- Step 5 — screening questions ([engine.js:5009](extension/content/engine.js#L5009)) — **❌**

Two mechanisms produce backward motion:
1. **Pass boundaries reset to the top.** When a later pass fills an earlier
   field, `fillElement`'s `focus()` auto-scrolls the viewport upward.
2. **Some passes iterate in config order**, so focus hops around even within one pass.

Intra-field `scrollIntoView` on dropdown option lists ([engine.js:778](extension/content/engine.js#L778),
[2498](extension/content/engine.js#L2498), [4108](extension/content/engine.js#L4108)) is *not* the problem — it is inside a
single field's interaction and must stay.

## Chosen approach: one unified top-to-bottom sweep
Replace "N passes over the whole page" with **"one pass over the page, N
strategies per field."** Enumerate every fillable field once, sort by visual
position, and for each field try the strategies in priority order until one fills it.

---

## Phase 1 — Invert strategies into per-field resolvers
Today each pass is written as "given a mapping, find its element." We need the
inverse: "given an element, find its mapping/value."

Refactor the bodies of Steps 0, 2, 2.4, 2.5, 2.7, 4, 5 into **resolver
functions** with a common signature:

```js
// returns { value, fill } or null
resolveDetected(unit)      // from detectedFields[]
resolvePlatform(unit)      // from platform config fields[] (name/automationId/label)
resolveClassifier(unit)    // normalized typed/pattern match
resolveGeneric(unit)       // generic mapping config
resolveScreening(unit)     // matchQuestionToAnswer() for question-like fields
```

Reuse the existing matching helpers (`fieldLookup` build at
[engine.js:4810](extension/content/engine.js#L4810), `fillByClassifier`, `matchQuestionToAnswer`,
`getProfileValueForPath`). Most logic already exists; it only needs to be keyed
by element instead of by mapping.

## Phase 2 — Single ordered worklist
Build one list of **field units** (the labeled container if present, else the control):

- `[data-automation-id^="formField-"]` (Workday)
- `input:not([type=hidden]):not([type=file])`, `textarea`, `select`,
  `button[aria-haspopup="listbox"]`, `[role="combobox"]`, radio/checkbox fieldsets
- elements referenced by `detectedFields`

De-dupe (a container and its inner input are one unit). Then iterate:

```js
const units = collectFieldUnits().filter(isElementVisible);
units.sort((a, b) => getVisualOrderKey(a) - getVisualOrderKey(b)); // existing primitive
for (const unit of units) {
  if (fieldTracker.filledElements.has(unit)) continue;
  const resolved = resolveDetected(unit) || resolvePlatform(unit)
    || resolveClassifier(unit) || resolveGeneric(unit) || resolveScreening(unit);
  if (!resolved) continue;
  scrollForwardIntoView(unit);          // Phase 4
  await resolved.fill();
  markFieldFilled(unit, resolved.strategy, fieldTracker);
  fieldTracker.cursorKey = Math.max(fieldTracker.cursorKey, getVisualOrderKey(unit));
}
```

Compute the order key **at fill time** (not enumeration time) so DOM mutations
between fields don't use stale positions.

## Phase 3 — Array sections in place
Work / education / websites need "Add another" clicks and reuse field names.
Keep the existing `processArrayFields` ([engine.js:2907](extension/content/engine.js#L2907)) but invoke it
**when the sweep first reaches that section's position**, so the whole section
is filled in place before the cursor moves past it. After it returns, mark the
section's region consumed and continue the outer cursor below it. This preserves
correct array handling while keeping global top-to-bottom order.

## Phase 4 — Monotonic cursor + forward-only scroll
- Add `fieldTracker.cursorKey = -Infinity`.
- Add `scrollForwardIntoView(el)`: scroll only if the element is below the
  current viewport; **never scroll up**.
- Make `fillElement` focus with `{ preventScroll: true }` and let
  `scrollForwardIntoView` own viewport movement, so filling a stray earlier
  field never yanks the page up.

## Phase 5 — Dynamic re-render without backward jumps
Forms inject fields after interaction (country→state, Add-another, resume parse).
- After the sorted list completes, re-enumerate. New visible+unfilled units
  **below `cursorKey`** are appended and filled forward.
- New units **above** the cursor (async error text, late labels) are filled
  **without scrolling** (no viewport jump), or deferred to a final no-scroll cleanup.
- Cap to ~3 re-enumeration rounds (or "until no new fills") to avoid loops.

Keep the event-driven watchers (Step 6 iCIMS revert guard
[engine.js:5059](extension/content/engine.js#L5059), Step 8.5 resume-parse watcher, dynamic observer)
but route their re-fills through the **no-scroll** path.

## Phase 6 — Rollout & verification
- Feature-flag the unified path (e.g. `ns.config.unifiedFill`) with the legacy
  multi-pass as fallback for one release.
- Add a debug log of the final fill order `(orderKey, label, strategy)` and
  assert keys are **non-decreasing**.
- Test matrix:
  - **Workday** — multi-section + work/education arrays + dependent country/state.
  - **iCIMS** — resume-parse auto-fill then label fields.
  - **Generic mapping-only** form.
  - Confirm: (a) viewport only moves downward, (b) fill count ≥ legacy,
    (c) no double-fills, (d) array entries still complete.

## Risks / edge cases
- **Stale order keys** mid-sweep → recompute at fill time; re-sort the tail after a mutation.
- **Two-column layouts** → `getVisualOrderKey` is `top*1e6 + left`, so same-row
  fields go left→right. Acceptable.
- **Multi-step wizards** (Workday) → sweep runs per page load; naturally fine.
- **Dropdown lists rendered above their field** → keep intra-field
  `scrollIntoView`; only gate *inter-field* scrolling.

## Suggested commit sequence
1. Add `scrollForwardIntoView` + `cursorKey`; switch `fillElement` to `preventScroll`. (Phase 4)
2. Extract resolvers from existing passes (no behavior change yet). (Phase 1)
3. Add unified worklist behind `unifiedFill` flag; arrays via `processArrayFields`. (Phases 2–3)
4. Add re-enumeration loop + route watchers through no-scroll fill. (Phase 5)
5. Add order-assertion logging; run test matrix; flip flag default on. (Phase 6)
