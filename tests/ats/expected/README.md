Ground truth for `eval.html`, one file per fixture, scored against `profile.json`.

- `"key": "text"` — the field must be filled, and its value must contain `text` (case-insensitive).
- `"key": "re:<regex>"` — the value must match the regex (case-insensitive).
- `"key": null` — the field must stay blank (no profile value, or it is the applicant's call).
  Filling it counts as a wrong fill.
- `"__unnamed__": null` — no field without a name/id may be filled (hidden proxies).
- Keys not listed are not scored: fields a static snapshot cannot exercise (React-Select
  menus, file uploads) or where either outcome is acceptable.
