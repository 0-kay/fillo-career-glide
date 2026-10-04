import React from 'react';
import { Link } from 'react-router-dom';
import Logo from '@/components/Logo';

const Privacy = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <nav className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link to="/" className="flex items-center space-x-3">
              <Logo className="w-8 h-8" />
              <span className="text-2xl font-bold text-gray-900">Fyllo</span>
            </Link>
          </div>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="bg-white rounded-2xl border shadow-sm p-8 sm:p-12">
          <h1 className="text-3xl sm:text-4xl font-display text-gray-900 mb-2">Privacy Policy</h1>
          <p className="text-sm text-gray-500 mb-10">Last updated: October 4, 2026</p>

          <div className="prose prose-slate max-w-none prose-headings:font-display prose-a:text-brand">
            <p>
              Fyllo ("Fyllo", "we", "us") builds a web app and a companion Chrome extension
              ("Fyllo AI") that help you fill job application forms using resume profile
              data you save in your Fyllo account. This policy explains what we collect, how it's
              used, who processes it, and how it's stored across both the web app and the extension.
            </p>

            <h2>What we collect</h2>
            <h3>Account &amp; authentication</h3>
            <p>
              Your email address and a session token, used to sign you in and keep your extension
              and web app sessions linked.
            </p>

            <h3>Profile data</h3>
            <p>
              The resume profile information you enter: name, email, phone number, mailing
              address, LinkedIn/GitHub/portfolio URLs, work and education history, skills, and any
              resume files you upload.
            </p>

            <h3>Saved answers to screening questions</h3>
            <p>
              Answers you choose to save for common application questions, such as work
              authorization, visa sponsorship, salary expectations and how you heard about a job.
              You may also save answers to optional self-identification questions (gender, race or
              ethnicity, veteran status, disability status). These are sensitive: you decide
              whether to save them, you can change or delete them at any time, and we use them
              only to answer the matching question on an application you ask Fyllo to fill.
            </p>

            <h3>Job application page content (extension)</h3>
            <p>
              When you click "Fill this form" or "Detect Fields", the extension reads the form
              fields on the current page: their labels, names, types, placeholder text, answer
              options, short nearby text, and the page's web address (URL). It uses them to decide
              which of your saved values belongs in each field, and writes those values into the
              form. It does not read or transmit the rest of the page, your browsing history, or
              data from pages where you haven't asked it to fill.
            </p>

            <h3>Employer accounts (Pro)</h3>
            <p>
              On Workday and iCIMS sign-in and sign-up pages, Fyllo can fill your email and a
              generated password. If you use this, we record which employer sites you have created
              or used an account on: the employer's site address, the platform, the email you used,
              the account's status, and when you last signed in. We never receive or store the
              passwords. A generated password is held only in your browser's memory (session
              storage) until you sign in or close the browser, so you can retrieve it if your
              password manager didn't offer to save it. The employer's site receives it as part of
              the account you create, as with any password you type.
            </p>

            <h3>Usage and form-matching data</h3>
            <p>
              We count how many times you use Fill, to apply the monthly limit on free accounts. We
              also keep a shared record of how form fields on job sites map to profile fields (for
              example, that a field labeled "Phone" on a given employer's form is a phone number),
              along with whether that mapping was kept or corrected. This record contains form
              labels and the employer's site address, not your values, and is not linked to you.
            </p>

            <h2>Who processes your data</h2>
            <ul>
              <li>
                <strong>AI processing.</strong> To decide which of your saved values belongs in a
                field, or which saved answer matches a question, Fyllo sends the form's field
                details (above) together with the relevant profile values and saved answers to an
                AI service provider that processes them on our behalf and returns a choice of which
                saved value to use. This happens only when you click Fill, and only for fields
                Fyllo couldn't match with its own rules.
              </li>
              <li>
                <strong>Hosting.</strong> Our account, profile and usage data are stored with
                Supabase, our hosting provider, over HTTPS.
              </li>
            </ul>

            <h2>What we don't do</h2>
            <ul>
              <li>We don't sell your data or share it with advertisers or data brokers.</li>
              <li>We don't use or transfer your data for purposes unrelated to filling job applications, or to determine creditworthiness or for lending.</li>
              <li>Fyllo never submits an application for you, ticks a terms or consent box, or clicks Create Account or Sign In for you. You do that yourself.</li>
              <li>We never receive the passwords for your employer accounts.</li>
              <li>Fyllo only reads or fills a form when you click a fill button. A small script runs on pages you visit so the Fyllo button can appear while you're signed in, and on Workday and iCIMS pages it recognizes sign-in screens on your device to offer help. That recognition stays in your browser; nothing about the page is sent to us until you ask Fyllo to fill.</li>
            </ul>

            <h2>Where data is stored</h2>
            <p>
              Your account and profile data are stored in our Supabase-hosted backend over HTTPS.
              The extension additionally keeps your session token, your selected profile, and a
              cached copy of our public form-matching configuration locally in your browser
              (<code>chrome.storage.local</code>), which isn't accessible to other extensions or
              websites. A generated employer-account password, if you use that feature, is kept
              only in <code>chrome.storage.session</code>, which is cleared when you close the
              browser.
            </p>

            <h2>Extension permissions</h2>
            <table>
              <thead>
                <tr><th>Permission</th><th>Why it's needed</th></tr>
              </thead>
              <tbody>
                <tr><td><code>storage</code></td><td>Keep you signed in, remember your selected profile, and hold a generated employer-account password for the browser session</td></tr>
                <tr><td><code>activeTab</code> / <code>scripting</code></td><td>Read and fill form fields on the page you're viewing, including forms inside embedded frames, only when you click Fill or Detect Fields</td></tr>
                <tr><td><code>tabs</code></td><td>Open the Fyllo web app in a new tab, and tell the on-page panel which sign-in screen the current tab shows</td></tr>
                <tr><td>Host permissions</td><td>Job applications can appear on virtually any domain (company career sites, Workday, Greenhouse, Lever, Ashby, iCIMS, Jobvite, SmartRecruiters, etc.), so the extension needs to be able to run wherever you use it. It doesn't read or fill a page until you ask it to.</td></tr>
              </tbody>
            </table>

            <h2>Data retention &amp; deletion</h2>
            <p>
              Signing out of the extension, or clearing your browser's extension storage, removes
              the locally cached session token and settings. To delete your Fyllo account and all
              associated data (your profile, saved answers, usage records and the list of employer
              accounts), email us at the address below and we'll delete it. The shared form-matching record described above isn't
              linked to you, so it isn't part of an account deletion.
            </p>

            <h2>Changes to this policy</h2>
            <p>
              We may update this policy as Fyllo changes. Material changes will be reflected here
              with an updated "Last updated" date.
            </p>

            <h2>Contact</h2>
            <p>
              Questions about this policy or your data:{' '}
              <a href="mailto:ojedele46@gmail.com">ojedele46@gmail.com</a>
            </p>
          </div>
        </div>
      </main>

      <footer className="bg-white border-t py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-gray-500 text-sm">
          © {new Date().getFullYear()} Fyllo. All rights reserved.
        </div>
      </footer>
    </div>
  );
};

export default Privacy;
