// Fillo Auto-Fill Extension - Simple Authentication Flow
// Just check Chrome storage for FILLO_AUTH_TOKEN and use it

const SUPABASE_URL = 'https://yuojrygcrcpajiglbekd.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1b2pyeWdjcmNwYWppZ2xiZWtkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTk2ODMzNDQsImV4cCI6MjAzNTI1OTM0NH0.Y_jZMl-QU5pqE_Gj6h02Wz5J9lNh5Kn1bgSqI-Q_8xI';

class FilloPopup {
  constructor() {
    this.authToken = null;
    this.profiles = [];
    this.selectedProfileId = null;
    this.elements = {};
  }

  async initialize() {
    console.log('🚀 Fillo Auto-Fill: Initializing popup...');
    
    this.initElements();
    this.attachListeners();
    await this.checkForToken();
  }

  initElements() {
    this.elements = {
      authSection: document.getElementById('auth-section'),
      mainSection: document.getElementById('main-section'),
      profileSelect: document.getElementById('profile-select'),
      profilePreview: document.getElementById('profile-preview'),
      fillBtn: document.getElementById('fill-btn'),
      detectBtn: document.getElementById('detect-btn'),
      signinBtn: document.getElementById('signin-btn'),
      refreshBtn: document.getElementById('refresh-btn'),
      footerRefreshBtn: document.getElementById('footer-refresh-btn'),
      helpBtn: document.getElementById('help-btn'),
      status: document.getElementById('status'),
      previewName: document.getElementById('preview-name'),
      previewEmail: document.getElementById('preview-email'),
      previewCompleteness: document.getElementById('preview-completeness')
    };
  }

  attachListeners() {
    this.elements.profileSelect.addEventListener('change', (e) => {
      this.handleProfileSelection(e.target.value);
    });

    this.elements.fillBtn.addEventListener('click', () => {
      this.fillForm();
    });

    this.elements.detectBtn.addEventListener('click', () => {
      this.detectFields();
    });

    this.elements.signinBtn.addEventListener('click', () => {
      this.openWebApp();
    });

    this.elements.refreshBtn.addEventListener('click', () => {
      this.checkForToken();
    });

    this.elements.footerRefreshBtn.addEventListener('click', () => {
      this.checkForToken();
    });

    this.elements.helpBtn.addEventListener('click', () => {
      this.showHelp();
    });
  }

  async checkForToken() {
    console.log('🔍 Checking for FILLO_AUTH_TOKEN in Chrome storage...');
    
    try {
      const result = await chrome.storage.local.get(['FILLO_AUTH_TOKEN']);
      
      if (result.FILLO_AUTH_TOKEN) {
        console.log('✅ Found auth token');
        this.authToken = result.FILLO_AUTH_TOKEN;
        await this.loadProfiles();
      } else {
        console.log('❌ No auth token found');
        this.showAuth('Please sign in to access your resume profiles');
      }
      
    } catch (error) {
      console.log('❌ Error checking for token:', error);
      this.showAuth('Error checking authentication. Please try again.');
    }
  }

  async loadProfiles() {
    if (!this.authToken) {
      this.showAuth('No authentication token available');
      return;
    }

    try {
      console.log('📡 Loading profiles from Supabase...');
      this.showStatus('Loading profiles...', 'info');
      
      const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=*`, {
        headers: {
          'Authorization': `Bearer ${this.authToken}`,
          'apikey': SUPABASE_ANON_KEY,
          'Content-Type': 'application/json'
        }
      });

      console.log('📡 API response status:', response.status);

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const profiles = await response.json();
      console.log('✅ Loaded profiles:', profiles.length);
      
      if (profiles.length === 0) {
        this.showAuth('No profiles found. Please create a profile in your Fillo account first.');
        return;
      }

      this.profiles = profiles;
      this.populateProfiles();
      this.showMain();
      this.hideStatus();
      
    } catch (error) {
      console.log('❌ Failed to load profiles:', error);
      this.showAuth('Failed to load profiles. Please sign in again.');
    }
  }

  populateProfiles() {
    this.elements.profileSelect.innerHTML = '<option value="">Select a profile...</option>';
    
    this.profiles.forEach(profile => {
      const option = document.createElement('option');
      option.value = profile.id;
      
      // Create profile name from available data
      let profileName = 'Unnamed Profile';
      if (profile.name) {
        profileName = profile.name;
      } else if (profile.personal_details) {
        const first = profile.personal_details.first_name || '';
        const last = profile.personal_details.last_name || '';
        if (first || last) {
          profileName = `${first} ${last}`.trim();
        }
      }
      
      option.textContent = profileName;
      this.elements.profileSelect.appendChild(option);
    });
  }

  handleProfileSelection(profileId) {
    this.selectedProfileId = profileId;
    
    if (profileId) {
      const profile = this.profiles.find(p => p.id === profileId);
      if (profile) {
        this.updateProfilePreview(profile);
        this.elements.fillBtn.disabled = false;
      }
    } else {
      this.clearProfilePreview();
      this.elements.fillBtn.disabled = true;
    }
  }

  updateProfilePreview(profile) {
    const personalDetails = profile.personal_details || {};
    
    // Profile name
    let profileName = 'Unknown Name';
    if (profile.name) {
      profileName = profile.name;
    } else {
      const first = personalDetails.first_name || '';
      const last = personalDetails.last_name || '';
      if (first || last) {
        profileName = `${first} ${last}`.trim();
      }
    }
    
    // Email
    const email = personalDetails.email || personalDetails.contact_email || 'No email provided';
    
    // Completeness calculation
    const fields = [
      personalDetails.first_name,
      personalDetails.last_name,
      personalDetails.email,
      personalDetails.phone,
      personalDetails.address
    ];
    const filledFields = fields.filter(f => f && f.trim()).length;
    const completeness = Math.round((filledFields / fields.length) * 100);
    
    this.elements.previewName.textContent = profileName;
    this.elements.previewEmail.textContent = email;
    this.elements.previewCompleteness.textContent = `${completeness}% complete`;
    this.elements.profilePreview.classList.remove('hidden');
  }

  clearProfilePreview() {
    this.elements.profilePreview.classList.add('hidden');
  }

  async fillForm() {
    if (!this.selectedProfileId) {
      this.showStatus('Please select a profile first', 'error');
      return;
    }

    try {
      this.showStatus('Filling form...', 'info');
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      const profile = this.profiles.find(p => p.id === this.selectedProfileId);
      
      // Inject content script
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });

      // Send profile data to content script
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'fillForm',
        profileData: profile
      });

      if (response?.success) {
        this.showStatus('✅ Form filled successfully!', 'success');
      } else {
        this.showStatus('❌ Fill failed', 'error');
      }
      
    } catch (error) {
      console.log('❌ Fill form error:', error);
      this.showStatus('Fill failed: ' + error.message, 'error');
    }
  }

  async detectFields() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const formFields = document.querySelectorAll('input, textarea, select');
          return {
            totalFields: formFields.length,
            url: window.location.href
          };
        }
      });
      
      const result = results[0]?.result;
      if (result) {
        this.showStatus(`Found ${result.totalFields} form fields on this page`, 'success');
      }
      
    } catch (error) {
      console.log('❌ Field detection failed:', error);
      this.showStatus('Field detection failed: ' + error.message, 'error');
    }
  }

  async openWebApp() {
    console.log('🌐 Opening Fillo web app...');
    await chrome.tabs.create({ url: 'http://localhost:8080' });
    this.showStatus('Please sign in to your account, then click refresh.', 'info');
  }

  showHelp() {
    chrome.tabs.create({ url: chrome.runtime.getURL('test-form.html') });
  }

  showAuth(message = 'Please sign in to access your resume profiles') {
    this.elements.authSection.classList.remove('hidden');
    this.elements.mainSection.classList.add('hidden');
    
    const authMessage = document.getElementById('auth-message');
    if (authMessage) {
      authMessage.textContent = message;
    }
  }

  showMain() {
    this.elements.authSection.classList.add('hidden');
    this.elements.mainSection.classList.remove('hidden');
  }

  showStatus(message, type = 'info') {
    this.elements.status.textContent = message;
    this.elements.status.className = `status ${type}`;
    this.elements.status.classList.remove('hidden');

    if (type === 'success' || type === 'error') {
      setTimeout(() => this.hideStatus(), 3000);
    }
  }

  hideStatus() {
    this.elements.status.classList.add('hidden');
  }
}

// Initialize popup when DOM is ready
function initializePopup() {
  console.log('📱 Initializing Fillo popup...');
  const popup = new FilloPopup();
  popup.initialize().catch(error => {
    console.error('❌ Popup initialization failed:', error);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializePopup);
} else {
  initializePopup();
} 