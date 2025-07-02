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

console.log('✅ Fillo Auto-Fill: Background script ready'); 