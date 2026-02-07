// [NOT-58] Debug what's being saved
// Run this BEFORE clicking "Save Clip"

console.log('🔍 Checking what will be saved...\n');

console.log('1️⃣  window.currentClipData:');
console.log(window.currentClipData);

if (window.currentClipData) {
  console.log('\n2️⃣  Metadata in currentClipData:');
  console.log('   URL:', window.currentClipData.url);
  console.log('   Metadata object:', window.currentClipData.metadata);

  if (window.currentClipData.metadata) {
    console.log('   ✅ Metadata exists!');
    console.log('      Title:', window.currentClipData.metadata.title);
    console.log('      Site:', window.currentClipData.metadata.siteName);
    console.log('      Favicon:', window.currentClipData.metadata.favicon);
  } else {
    console.log('   ❌ Metadata is NULL/UNDEFINED - This is the bug!');
  }
} else {
  console.log('   ❌ currentClipData not set');
}

console.log('\n📝 Now click "Save Clip" and check the library');
