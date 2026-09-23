// Fillo Auto-Fill Extension - Background Script
// Simple background script with minimal functionality

console.log('🚀 Fillo Auto-Fill: Background script started');

// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('✅ Fillo Auto-Fill extension installed');
});

// Keep service worker alive
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('📨 Background received message:', request);

  // Simple echo response for any messages
  sendResponse({ status: 'received' });
  return true;
});


const ALLOWED_EXTERNAL_ORIGINS = [
  'https://www.fylloai.com',
  'http://localhost:5173',
  'http://localhost:8080'
];

chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  if (ALLOWED_EXTERNAL_ORIGINS.includes(sender.origin)) {
    console.log('Received message:', request);
    chrome.storage.local.set({ FILLO_AUTH_TOKEN: request.accessToken })

    sendResponse({ success: true, result: 'token sent' });
  }
  return true;
});


console.log('✅ Fillo Auto-Fill: Background script ready'); 
