// Test script to verify Pulse Pill functionality
// Paste this into the browser console when the side panel is open

console.log('=== PULSE PILL DEBUG ===');

// 1. Check if button exists
const pulsePill = document.getElementById('pulse-pill-button');
console.log('1. Pulse Pill button found:', !!pulsePill);
if (pulsePill) {
  console.log('   - State:', pulsePill.dataset.state);
  console.log('   - Visible:', !pulsePill.classList.contains('hidden'));
}

// 2. Check if AIHarness is loaded
console.log('2. AIHarness loaded:', !!window.aiHarness);
if (window.aiHarness) {
  console.log('   - Current provider:', window.aiHarness.currentProvider?.constructor?.name);
}

// 3. Check if FREE_MODEL_CHAIN is loaded
console.log('3. FREE_MODEL_CHAIN loaded:', !!window.FREE_MODEL_CHAIN);
if (window.FREE_MODEL_CHAIN) {
  console.log('   - Models available:', window.FREE_MODEL_CHAIN.length);
}

// 4. Check if currentClipData exists
console.log('4. currentClipData exists:', !!window.currentClipData);
if (window.currentClipData) {
  console.log('   - Has text:', !!window.currentClipData.text);
  console.log('   - Has metadata:', !!window.currentClipData.metadata);
  console.log('   - Text preview:', window.currentClipData.text?.substring(0, 100) + '...');
}

// 5. Check if OpenRouter API key is configured
chrome.storage.local.get(['openrouter_api_key'], (result) => {
  console.log('5. OpenRouter API key configured:', !!result.openrouter_api_key);
  if (!result.openrouter_api_key) {
    console.warn('   ⚠️  API KEY NOT SET! Go to Settings and add your OpenRouter API key');
  }
});

// 6. Try to manually trigger the Pulse Pill
console.log('\n6. Testing manual trigger...');
if (pulsePill && typeof handlePulsePillClick === 'function') {
  console.log('   Click the Pulse Pill button or run: handlePulsePillClick()');
} else {
  console.error('   ❌ handlePulsePillClick function not found!');
}

console.log('\n=== END DEBUG ===');
