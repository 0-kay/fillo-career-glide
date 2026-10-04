# ATS harness

Runs the real extension content scripts against saved application forms in a real browser
page (so layout/visibility checks behave), using the production match config.

```bash
node tests/ats/build-config.mjs   # match config, form_mappings seed rows, planner bundle
node tests/ats/serve.mjs          # http://localhost:8765/tests/ats/harness.html
```

## Accuracy eval
`http://localhost:8765/tests/ats/eval.html` runs every fixture and scores it against
`expected/<fixture>.json` (see `expected/README.md`): correct, wrong fills, missed, precision,
recall. Two modes: `client` (extension rules only) and `server` (adds the resolve-form-fill
planner, bundled locally: seed rows + deterministic rules, no model calls). Each fixture also
runs with no platform pinned, which is what happens when platform detection fails, so the two
rows should match. `?src=<dir>` loads content scripts from another directory, e.g. an older
commit's `extension/content` exported to `generated/baseline`, for before/after numbers.

The model layers (screening answers, profile-path selection) are measured by
`tests/formfill/live.test.ts` against the real API (needs `TYPESAFE_API_KEY`), which also
reruns every case to check the answers are consistent.

Open `harness.html?fixture=<name>&platform=<platform>&auto=1`. Omit `platform` to test the
generic path. Results land in `window.__result` and the side panel (`✔` = filled).

| Fixture | Platform | Notes |
|---|---|---|
| `lever` | `lever` | static form |
| `greenhouse` | `greenhouse` | React-select dropdowns are inert in a static snapshot |
| `ashby` | `ashby` | Yes/No button pairs, radio EEO groups |
| `smartrecruiters` | `smartrecruiters` | every control is inside open shadow roots (0 in the light DOM) |
| `jobvite` | none (no config) | native selects; "Work Status" must stay blank |
| `workable` | none needed | negative test: job-specific Yes/No skill questions must stay blank |

## Account screens (Workday, iCIMS)
`auth.html` runs `content/ats-auth.js` against `fixtures/auth/*` (Workday chooser, sign-in and
create-account screens captured from a live tenant without submitting anything; iCIMS's email
step; a synthetic iCIMS create step) and checks detection, filling, the honeypot guard and the
password generator. `widget.html?screen=…&plan=…` previews the widget's account card with stubbed
extension APIs.

## Adding a fixture
Run `capture.js` in the DevTools console on the application page **before filling anything in**
(or as a DevTools snippet). It downloads `<host>.html`; move it to `fixtures/`. It keeps open shadow
roots as declarative shadow DOM (the harness mounts fixtures with `setHTMLUnsafe`), records which
elements were hidden as inline `display:none`, drops scripts/styles/media, trims very long custom
option lists, and clears every value. Then add `expected/<name>.json` and a row to `RUNS` in
`eval.html`. Fixtures are static: widgets that need the page's own JavaScript (menus,
autocomplete) can't be exercised here, so verify those in a real browser with the extension
loaded unpacked.

## Not covered
iCIMS and Workday: both show the application only after creating a candidate account, so the
fixtures have to be captured by someone signed in (use `capture.js`).
