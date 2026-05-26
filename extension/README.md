# Fillo Auto-Fill Chrome Extension

A Chrome extension that automatically fills job application forms with your resume profiles from the Fillo web app.

## Features

- 🚀 **Auto-Fill**: Instantly populate job applications with your resume data
- 🔍 **Field Detection**: Smart detection of form fields across different job portals
- 👤 **Multiple Profiles**: Switch between different resume profiles easily
- 🎯 **Platform Support**: Works on Workday, iCIMS, Greenhouse, Lever, and more
- 🔒 **Secure**: Uses your existing Fillo authentication
- 📊 **Visual Feedback**: See exactly what fields were filled

## Installation

### Option 1: Load as Unpacked Extension (Development)

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked" 
4. Select the `extension` folder from your project
5. The Fillo Auto-Fill extension should now appear in your extensions

### Option 2: Chrome Web Store (Coming Soon)

The extension will be available on the Chrome Web Store soon.

## Setup & Usage

### 1. Authentication

1. Make sure you're signed into your Fillo account at `http://localhost:5173`
2. Click the Fillo extension icon in your Chrome toolbar
3. If not authenticated, click "Open Fillo Web App" to sign in
4. Return to the extension and click "Refresh"

### 2. Select Profile

1. Choose your desired resume profile from the dropdown
2. Preview your profile information
3. The "Fill Application Form" button will become active

### 3. Fill Job Applications

1. Navigate to any job application page (Workday, iCIMS, etc.)
2. Click the Fillo extension icon
3. Click "⚡ Fill Application Form"
4. Watch as your information is automatically filled in!

### 4. Field Detection

- Click "🔍 Detect Form Fields" to see what fields the extension can fill
- Detected fields will be highlighted on the page

## Supported Job Portals

- **Workday** (`*.workday.com`)
- **iCIMS** (`*.icims.com`)
- **Greenhouse** (`*.greenhouse.io`)
- **Lever** (`*.lever.co`)
- **Jobvite** (`*.jobvite.com`)
- **SmartRecruiters** (`*.smartrecruiters.com`)
- And many more general job application forms!

## Supported Fields

The extension can automatically fill:

- ✅ First Name & Last Name
- ✅ Full Name
- ✅ Email Address
- ✅ Phone Number
- ✅ Address Information
- ✅ LinkedIn Profile
- ✅ GitHub Profile
- ✅ Portfolio Website

## Troubleshooting

### Extension Not Working?

1. **Check Authentication**: Make sure you're signed into your Fillo account
2. **Refresh Extension**: Click the refresh button in the extension popup
3. **Check Permissions**: Ensure the extension has permissions for the job site
4. **Developer Console**: Check browser console for error messages

### Fields Not Filling?

1. **Try Field Detection**: Use the "Detect Form Fields" feature first
2. **Check Form Structure**: Some custom forms may use unusual field naming
3. **Manual Entry**: You can always copy data from the profile preview

### Common Issues

- **"Loading profiles..." stuck**: Check your internet connection and Fillo auth status
- **No fields detected**: The page might not have standard form fields
- **Partial filling**: Some sites use dynamic forms that load after page load

## Privacy & Security

- 🔒 Your data never leaves your control
- 🌐 Uses your existing Fillo authentication
- 📱 No data is stored in the extension itself
- 🛡️ All communication is encrypted via HTTPS

## Support

For issues or feature requests:
1. Check the troubleshooting section above
2. Open an issue in the project repository
3. Contact support through the Fillo web app

## Development

To modify or contribute to this extension:

```bash
# Make changes to the files in /extension/
# Reload the extension in chrome://extensions/
# Test on various job application sites
```

### File Structure

```
extension/
├── manifest.json     # Extension configuration
├── popup.html       # Extension popup interface  
├── popup.js         # Popup functionality
├── content.js       # Page interaction script
├── background.js    # Service worker
├── styles.css       # All styling
└── icons/          # Extension icons (16px, 48px, 128px)
```

## Version History

- **v1.0.0**: Initial release with core auto-fill functionality
- Support for major job portals
- Profile selection and preview
- Field detection and highlighting

---

**Made with ❤️ for the Fillo Career Platform** 