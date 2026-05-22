// [NOT-58] Full Debug Test
// This will help us understand exactly what's happening

console.log('🔍 [NOT-58] Starting full debug test...\n');

// Test 1: Check if we're in capture mode
const captureMode = document.getElementById('capture-mode');
const isCaptureVisible = captureMode && !captureMode.classList.contains('hidden');
console.log('1️⃣  Capture mode visible:', isCaptureVisible);

// Test 2: Check currentClipData
console.log('2️⃣  window.currentClipData:', window.currentClipData);

// Test 3: Check what's displayed in the source bar
const favicon = document.getElementById('capture-favicon');
const siteName = document.getElementById('capture-site-name');
const url = document.getElementById('capture-url');

if (favicon && siteName && url) {
  console.log('3️⃣  Source bar content:');
  console.log('   - Favicon src:', favicon.src);
  console.log('   - Site name:', siteName.textContent);
  console.log('   - URL:', url.textContent);
} else {
  console.log('3️⃣  Source bar elements not found');
}

// Test 4: Check if there's pending clip data in storage
chrome.storage.local.get('pendingClipData').then(result => {
  console.log('4️⃣  Pending clip data in storage:', result.pendingClipData);

  if (result.pendingClipData && result.pendingClipData.metadata) {
    console.log('\n✅ Found metadata:');
    console.log('   Title:', result.pendingClipData.metadata.title);
    console.log('   Site:', result.pendingClipData.metadata.siteName);
    console.log('   Favicon:', result.pendingClipData.metadata.favicon);
  }
});

// Test 5: Check current mode
console.log('5️⃣  Current mode:', window.currentMode || 'unknown');

console.log('\n📝 Instructions:');
console.log('   1. If you see "Capture mode visible: false" - click extension icon to open capture');
console.log('   2. If metadata shows "Gloss" - you may be in manual note mode');
console.log('   3. Try: Select text on THIS page → right-click → "Capture Text"');
