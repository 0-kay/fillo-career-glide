# ATS harness

Runs the real extension content scripts against saved application forms in a real browser
page (so layout/visibility checks behave), using the production match config.

```bash
node tests/ats/build-config.mjs   # extract MATCH_CONFIG from the match-config edge function
node tests/ats/serve.mjs          # http://localhost:8765/tests/ats/harness.html
```

Open `harness.html?fixture=<name>&platform=<platform>&auto=1`. Omit `platform` to test the
generic path. Results land in `window.__result` and the side panel (`✔` = filled).

| Fixture | Platform | Notes |
|---|---|---|
| `lever` | `lever` | static form |
| `greenhouse` | `greenhouse` | React-select dropdowns are inert in a static snapshot |
| `ashby` | `ashby` | Yes/No button pairs, radio EEO groups |
| `workable` | none needed | negative test: job-specific Yes/No skill questions must stay blank |

`profile.json` is in the extension's real profile shape (the `application_profiles` row),
with screening answers copied from `ScreeningQuestionsDialog` defaults.

## Adding a fixture
Open the real application page in a browser, let it render, and save the form's controls with
their real attributes and labels to `fixtures/<name>.html` (body content only, no scripts).
Public pages only, no personal data. Fixtures are static: widgets that need the page's own
JavaScript (menus, autocomplete) can't be exercised here, so verify those in a real browser
with the extension loaded unpacked.

## Not covered
iCIMS (application is behind account creation), Workday (tenant-specific, needs a login).
