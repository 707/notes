// [NOT-58] Debug the full capture flow
// Run this in the SIDE PANEL console to see what data exists

console.log('🔍 Debugging capture flow...\n');

// Check 1: What's in storage?
chrome.storage.local.get('pendingClipData').then(result => {
  console.log('1️⃣  Data in chrome.storage.local:');
  if (result.pendingClipData) {
    console.log('   ✅ pendingClipData exists');
    console.log('   URL:', result.pendingClipData.url);
    console.log('   Metadata:', result.pendingClipData.metadata);

    if (result.pendingClipData.metadata) {
      console.log('   📝 Title:', result.pendingClipData.metadata.title);
      console.log('   🏷️  Site:', result.pendingClipData.metadata.siteName);
      console.log('   🎨 Favicon:', result.pendingClipData.metadata.favicon);
    } else {
      console.log('   ❌ NO METADATA - This is the bug!');
    }
  } else {
    console.log('   ❌ No pendingClipData in storage');
  }

  console.log('\n2️⃣  window.currentClipData:');
  if (window.currentClipData) {
    console.log('   ✅ Exists');
    console.log('   URL:', window.currentClipData.url);
    console.log('   Metadata:', window.currentClipData.metadata);
  } else {
    console.log('   ❌ Not set');
  }

  console.log('\n📝 Next step:');
  console.log('   Select text on ANY webpage');
  console.log('   Right-click → "Capture Text"');
  console.log('   Then run this script again to see what was captured');
});
