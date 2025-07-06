# 🔧 **Extension Debugging Guide**

## 🚨 **Current Issue**
The extension gets stuck at "Initializing form filler for this page..." and doesn't proceed.

## 🧪 **Step-by-Step Debugging Process**

### **Step 1: Load the Extension**
1. Open Chrome
2. Go to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the `extension` folder
6. ✅ Extension should appear in the list

### **Step 2: Test with Simple Form**
1. Open the simple test page: `extension/simple-test.html`
2. Open browser console (F12)
3. You should see:
   ```
   🧪 Simple test page loaded
   ✅ Chrome extension API is available
   🎯 Page fully loaded and ready for extension testing
   ```

### **Step 3: Test Extension Popup**
1. Click the Fillo extension icon in the browser toolbar
2. You should see the popup with profile selection
3. If you see "Please sign in" - that's expected for now

### **Step 4: Test Extension Communication**
1. On the simple test page, open console
2. Open extension popup
3. Click "Fill Application Form" (even if no profile selected)
4. **Watch the console for these messages:**

#### **Expected Console Output:**
```
📨 Content script received message: fillForm
🚀 DEBUG: Fill form message received
🚀 DEBUG: Profile data: [object Object]
🚀 Starting advanced form filling with intelligent field matching
📋 Profile data keys: ["first_name", "last_name", ...]
🔄 Using enhanced fallback matching (skipping mapping config)
🧠 Running enhanced fallback matching with intelligent analysis
✅ Enhanced fallback filled X additional fields
```

#### **If You See This Instead:**
```
🔄 First attempt: Sending fillForm message to content script...
❌ Content script not available, injecting manually: [error message]
🔄 Initializing form filler for this page...
✅ Content script injected, waiting for initialization...
🔄 Retry: Sending fillForm message to content script...
```

### **Step 5: Check for Common Issues**

#### **Issue A: Content Script Not Loading**
- Check if you see `🤖 Fillo Auto-Fill: Advanced content script loaded` in console
- If not, the content script isn't loading properly

#### **Issue B: Message Listener Not Working**
- Check if you see `📨 Content script received message: fillForm`
- If not, the message listener isn't working

#### **Issue C: Content Script Errors**
- Look for any red errors in the console
- Check if there are JavaScript syntax errors

### **Step 6: Manual Tests**

#### **Test A: Manual Content Script Injection**
In the console, run:
```javascript
console.log('Testing manual injection...');
// This should show the content script is working
```

#### **Test B: Test Message Sending**
In the console, run:
```javascript
chrome.runtime.sendMessage({action: 'test'}, (response) => {
    console.log('Response:', response);
});
```

#### **Test C: Test Form Field Detection**
In the console, run:
```javascript
const fields = document.querySelectorAll('input, textarea, select');
console.log('Found fields:', fields.length);
fields.forEach((field, i) => {
    console.log(`Field ${i}:`, field.name, field.type);
});
```

## 🔍 **Common Debugging Scenarios**

### **Scenario 1: Extension Not Loading**
**Symptoms:** No extension icon in toolbar
**Solutions:**
- Check `chrome://extensions/` for errors
- Verify `manifest.json` is valid
- Check file permissions

### **Scenario 2: Content Script Not Injecting**
**Symptoms:** No console messages from content script
**Solutions:**
- Check `manifest.json` permissions
- Verify content script file path
- Check for JavaScript syntax errors

### **Scenario 3: Message Listener Not Responding**
**Symptoms:** Popup sends message but gets no response
**Solutions:**
- Check if message listener is properly registered
- Verify `chrome.runtime.onMessage.addListener` is called
- Check for errors in message handler

### **Scenario 4: Profile Data Issues**
**Symptoms:** Extension runs but doesn't fill fields
**Solutions:**
- Check if profile data is being passed correctly
- Verify profile data structure
- Check if form fields are being detected

## 📋 **Debugging Checklist**

- [ ] Extension appears in `chrome://extensions/`
- [ ] Extension icon appears in browser toolbar
- [ ] Extension popup opens when clicked
- [ ] Simple test page loads without errors
- [ ] Content script logs appear in console
- [ ] Message listener responds to popup messages
- [ ] Form fields are detected correctly
- [ ] AI configuration is working (if configured)

## 🚨 **If Still Not Working**

### **Check Extension Console:**
1. Go to `chrome://extensions/`
2. Click "Inspect views: background" or "service worker"
3. Look for errors in the background script

### **Check Content Script Injection:**
1. In the page console, run:
   ```javascript
   console.log('Testing content script...');
   ```

### **Verify Permissions:**
Check if the extension has the right permissions in `manifest.json`:
```json
{
  "permissions": [
    "storage",
    "activeTab", 
    "scripting",
    "tabs"
  ],
  "host_permissions": [
    "https://*/*",
    "http://*/*"
  ]
}
```

---

## 🎯 **Expected Working Flow**

1. **Extension loads** → Icon appears in toolbar
2. **User clicks icon** → Popup opens
3. **User clicks "Fill Form"** → Message sent to content script
4. **Content script receives message** → Logs appear in console
5. **Form filling begins** → Fields get filled with data
6. **Success notification** → User sees confirmation

**If any step fails, that's where the issue is!** 