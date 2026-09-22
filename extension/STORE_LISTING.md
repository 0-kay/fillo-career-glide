# Chrome Web Store Listing — Fyllo Auto-Fill

Copy/paste these into the Developer Dashboard fields. Replace anything in [BRACKETS].

---

## Short description (≤ 132 characters)

```
Auto-fill job applications on any site with your saved Fyllo resume profile — name, contact info, links, and more.
```
(115 chars)

---

## Detailed description

```
Fyllo Auto-Fill saves you from retyping the same information into every job application form.

Once you've built a resume profile in Fyllo, this extension fills matching fields on job application pages — first/last name, email, phone, address, LinkedIn, GitHub, portfolio URL, and more — with one click.

HOW IT WORKS
1. Sign in to your Fyllo account at fylloai.com.
2. Click the Fyllo icon on any job application page.
3. Choose which saved profile to use.
4. Click "Fill Application Form" — Fyllo detects the form fields and fills what it recognizes.

WORKS ACROSS JOB PORTALS
Fyllo is built to handle the field-naming quirks of major application platforms, including Workday, Greenhouse, Lever, iCIMS, Jobvite, SmartRecruiters, and general company career pages.

YOU'RE IN CONTROL
- Nothing is filled until you click the Fill button — no silent, automatic form-filling.
- Use "Detect Fields" first to preview exactly which fields on a page Fyllo recognizes before filling anything.
- Your data stays tied to your Fyllo account and is only used to fill the fields you ask it to.

PRIVACY
Fyllo Auto-Fill does not sell your data or share it with advertisers. See our privacy policy: https://www.fylloai.com/privacy

Fyllo account required. Create one free at fylloai.com.
```

---

## Category

Productivity

---

## Single purpose description (required by CWS review)

```
This extension has a single purpose: to detect form fields on job application web pages and fill them with resume/profile data that the user has saved in their Fyllo account, when the user explicitly triggers a fill.
```

---

## Permission justifications (paste into the relevant CWS "justify permission" fields)

**Host permissions (`http://*/*`, `https://*/*`)**
```
Job application forms appear on an unbounded set of domains: individual company career pages, and platforms like Workday, Greenhouse, Lever, iCIMS, Jobvite, and SmartRecruiters, each on their own domains/subdomains. The extension cannot know in advance which domain a user's next job application will be on, so it requests broad host access. It only reads or writes page content when the user explicitly clicks "Fill Application Form" or "Detect Fields" in the popup — it does not run automatically or collect data passively in the background.
```

**`activeTab` / `scripting`**
```
Used to read form field metadata (labels, names, types) from the currently active tab and to write the user's profile values into matching fields, only when the user clicks Fill or Detect Fields.
```

**`storage`**
```
Used to store the user's session token and cached profile data locally in the browser, so they don't have to sign in on every page load.
```

**`tabs`**
```
Used to open the Fyllo web app (fylloai.com) in a new tab when the user clicks "Open Fyllo Web App" to sign in.
```

**Remote code / externally_connectable**
```
externally_connectable is scoped to fylloai.com (and localhost for local development) so the Fyllo web app can hand the extension a session token after the user signs in. No code is fetched or executed remotely.
```

---

## Screenshots needed (1280x800 or 640x400, at least 1, up to 5 recommended)

Suggested shots:
1. Extension popup showing a selected profile ready to fill
2. Popup open on a real job application page (e.g. a Greenhouse or Lever form) mid-fill or filled
3. "Detect Fields" results panel showing matched/unmatched field counts
4. Before/after of a form: empty vs. auto-filled

## Promo tile (optional but recommended, 440x280)

Simple: Fyllo logo/wordmark + tagline "Auto-fill job applications in one click."

---

## Store listing checklist

- [ ] Screenshots (min 1)
- [x] Privacy policy live at https://www.fylloai.com/privacy (src/pages/Privacy.tsx) — paste this URL into the dashboard's privacy policy field
- [ ] Single purpose description filled in
- [ ] Permission justifications filled in for each requested permission
- [ ] Support email/contact set in the dashboard (currently ojedele46@gmail.com in the policy — swap for a dedicated support alias if you want one, e.g. support@fylloai.com)
- [ ] Category set to Productivity
- [ ] Verify fylloai.com/dashboard is live before hitting submit
