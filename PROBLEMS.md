# Reported Problems

## Workday
- Country was not being filled.
- The country dropdown was not sticking after selection and logged `Dropdown selection did not stick: United States`.
- A country field with the same label as another field caused matching conflicts.
- `regionSubdivision1` was being blocked even though it can be a valid plain text country input on some Workday pages.
- The form filling should happen sequentially from top to bottom.

## iCIMS
- Address 2 was being placed into Address 1 separated by a comma.
- Full Legal Name for Offer and Onboarding Documents was missing first name, middle name, and last name.
- Resume should be uploaded first before filling other fields.
- After upload, the engine should wait before filling so the resume can finish parsing.
- The page sometimes refreshes after upload.
- The resume upload should be confirmed using the current file label span, such as `#PortalProfileFields.Resume_FileNameLabel`, and only continue when it is not empty.
- A normal iCIMS text field like `rcf2092` should also be filled.
- iCIMS fields should not rely only on `label[for=...]`; surrounding container text should also be considered.

## Array / Section Filling
- Work experience, education, and websites were failing with `No add button found`.
- The engine should skip array sections that are not present in the DOM instead of searching for add buttons forever.

## Matching / Mapping
- `match.json` should no longer be the live source of truth.
- Matching should use the new Supabase `matches` table, with JSON stored in the `data` column.
- For matches, the engine should use the field name and/or selector, not shared labels.
- A universal function should live in `utils.js` for loading match data from the database.
- The matching flow should use the current page structure to decide what to fill and in what order.

## Resume / Upload Flow
- Resume upload needed to happen before any other iCIMS filling.
- The engine needed a short wait after upload before continuing.
- The upload step needed to survive page refreshes during the iCIMS flow.
