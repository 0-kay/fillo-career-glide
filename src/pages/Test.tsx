import React from 'react';

const Test = () => {
  return (
    <div className="max-w-3xl mx-auto p-5 bg-gray-100 min-h-screen">
      <div className="bg-white p-8 rounded-lg shadow-md">
        <h1 className="text-2xl font-bold text-center text-gray-800 mb-8">
          🚀 Fillo Extension Test Form
        </h1>

        <div className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white p-4 rounded-md mb-6 text-center">
          <h3 className="text-lg font-semibold mb-2">🔐 Clean Authentication Flow!</h3>
          <p>
            Extension now uses direct web app ↔ extension communication.
            <br />
            Simple, reliable, and token-safe!
          </p>
        </div>

        <div className="bg-blue-100 border border-blue-300 rounded p-4 mb-6">
          <strong>🎯 New Authentication Flow Test:</strong>
          <ol className="list-decimal pl-6 mt-2 space-y-1">
            <li><strong>Install Extension:</strong> Load the /extension folder in Chrome</li>
            <li><strong>Click Extension:</strong> Should show "Authentication Required"</li>
            <li><strong>Click "Open Fillo Web App":</strong> Opens localhost:8080 in new tab</li>
            <li><strong>Sign Into Your Account:</strong> Login saves token to extension automatically</li>
            <li><strong>Click Extension Again:</strong> Should now show your profiles!</li>
            <li><strong>Select Profile & Fill Form:</strong> Click "⚡ Fill Application Form"</li>
            <li><strong>Watch Magic:</strong> Form fields auto-populate with your data!</li>
          </ol>
          <p className="mt-2 font-medium">✅ Expected Result: Seamless authentication without any token clearing bugs</p>
        </div>

        <div id="status" className="hidden text-center font-semibold rounded p-3 mb-6" />

        <form id="jobApplicationForm" className="space-y-6">
          <div className="flex gap-6">
            <div className="flex-1">
              <label htmlFor="firstName" className="block mb-1 font-medium text-gray-700">First Name *</label>
              <input type="text" id="firstName" name="firstName" required className="w-full border border-gray-300 rounded px-3 py-2" />
            </div>
            <div className="flex-1">
              <label htmlFor="lastName" className="block mb-1 font-medium text-gray-700">Last Name *</label>
              <input type="text" id="lastName" name="lastName" required className="w-full border border-gray-300 rounded px-3 py-2" />
            </div>
          </div>

          <div>
            <label htmlFor="fullName" className="block mb-1 font-medium text-gray-700">Full Name</label>
            <input type="text" id="fullName" name="fullName" className="w-full border border-gray-300 rounded px-3 py-2" />
          </div>

          <div>
            <label htmlFor="email" className="block mb-1 font-medium text-gray-700">Email Address *</label>
            <input type="email" id="email" name="email" required className="w-full border border-gray-300 rounded px-3 py-2" />
          </div>

          <div>
            <label htmlFor="phone" className="block mb-1 font-medium text-gray-700">Phone Number</label>
            <input type="tel" id="phone" name="phone" className="w-full border border-gray-300 rounded px-3 py-2" />
          </div>

          <div>
            <label htmlFor="address" className="block mb-1 font-medium text-gray-700">Address</label>
            <textarea id="address" name="address" className="w-full border border-gray-300 rounded px-3 py-2 h-24 resize-y"></textarea>
          </div>

          <div className="flex gap-6">
            <div className="flex-1">
              <label htmlFor="city" className="block mb-1 font-medium text-gray-700">City</label>
              <input type="text" id="city" name="city" className="w-full border border-gray-300 rounded px-3 py-2" />
            </div>
            <div className="flex-1">
              <label htmlFor="state" className="block mb-1 font-medium text-gray-700">State</label>
              <select id="state" name="state" className="w-full border border-gray-300 rounded px-3 py-2">
                <option value="">Select State</option>
                <option value="AL">Alabama</option>
                <option value="CA">California</option>
                <option value="FL">Florida</option>
                <option value="NY">New York</option>
                <option value="TX">Texas</option>
              </select>
            </div>
            <div className="flex-1">
              <label htmlFor="zipCode" className="block mb-1 font-medium text-gray-700">ZIP Code</label>
              <input type="text" id="zipCode" name="zipCode" className="w-full border border-gray-300 rounded px-3 py-2" />
            </div>
          </div>

          <div>
            <label htmlFor="linkedin" className="block mb-1 font-medium text-gray-700">LinkedIn Profile</label>
            <input type="text" id="linkedin" name="linkedin" className="w-full border border-gray-300 rounded px-3 py-2" />
          </div>

          <div>
            <label htmlFor="github" className="block mb-1 font-medium text-gray-700">GitHub Profile</label>
            <input type="text" id="github" name="github" className="w-full border border-gray-300 rounded px-3 py-2" />
          </div>

          <div>
            <label htmlFor="portfolio" className="block mb-1 font-medium text-gray-700">Portfolio Website</label>
            <input type="text" id="portfolio" name="portfolio" className="w-full border border-gray-300 rounded px-3 py-2" />
          </div>

          <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded hover:bg-blue-700 transition">
            Submit Test Application
          </button>
        </form>
      </div>
    </div>
  );
};

export default Test;
