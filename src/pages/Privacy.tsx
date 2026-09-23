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
          <p className="text-sm text-gray-500 mb-10">Last updated: September 22, 2026</p>

          <div className="prose prose-slate max-w-none prose-headings:font-display prose-a:text-brand">
            <p>
              Fyllo ("Fyllo", "we", "us") builds a web app and a companion Chrome extension
              ("Fyllo Auto-Fill") that help you fill job application forms using resume profile
              data you save in your Fyllo account. This policy explains what we collect, how it's
              used, and how it's stored across both the web app and the extension.
            </p>

            <h2>What we collect</h2>
            <h3>Account & authentication</h3>
            <p>
              Your email address and a session token, used to sign you in and keep your extension
              and web app sessions linked.
            </p>

            <h3>Profile data</h3>
            <p>
              The resume profile information you enter: name, email, phone number, mailing
              address, LinkedIn/GitHub/portfolio URLs, and similar application-form fields, plus
              any resume files you upload.
            </p>

            <h3>Job application page content (extension only)</h3>
            <p>
              When you click "Fill Application Form" or "Detect Fields" in the extension, it reads
              the form fields (labels, input names, types) on the current page to match them
              against your saved profile data, and writes your profile values into matching
              fields. It does not read or transmit full page content, browsing history, or data
              from pages where you haven't triggered a fill/detect action.
            </p>

            <h2>What we don't do</h2>
            <ul>
              <li>We don't sell your data or share it with advertisers or data brokers.</li>
              <li>The extension doesn't run in the background collecting data — filling only happens when you click Fill/Detect.</li>
              <li>Form-field matching is deterministic and rule-based against your saved profile data; we don't send your form data to third-party AI providers by default.</li>
            </ul>

            <h2>Where data is stored</h2>
            <p>
              Your account and profile data are stored in our Supabase-hosted backend over HTTPS.
              The extension additionally caches your session token and profile data locally in
              your browser (<code>chrome.storage.local</code>), which isn't accessible to other
              extensions or websites.
            </p>

            <h2>Extension permissions</h2>
            <table>
              <thead>
                <tr><th>Permission</th><th>Why it's needed</th></tr>
              </thead>
              <tbody>
                <tr><td><code>storage</code></td><td>Store your auth token and cached profile data locally</td></tr>
                <tr><td><code>activeTab</code> / <code>scripting</code></td><td>Read and fill form fields on the page you're viewing, only when you click Fill or Detect Fields</td></tr>
                <tr><td><code>tabs</code></td><td>Open the Fyllo web app in a new tab from the extension popup</td></tr>
                <tr><td>Host permissions</td><td>Job applications can appear on virtually any domain (company career sites, Workday, Greenhouse, Lever, iCIMS, etc.), so the extension needs to be able to run wherever you use it</td></tr>
              </tbody>
            </table>

            <h2>Data retention & deletion</h2>
            <p>
              Signing out of the extension, or clearing your browser's extension storage, removes
              the locally cached auth token and profile data. To delete your Fyllo account and all
              associated data, go to <strong>Settings → Privacy &amp; Security</strong> in the web
              app, or email us at the address below.
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
