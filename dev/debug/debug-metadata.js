// [NOT-58] Debug script - check what metadata was captured
// Run this in the SIDE PANEL console after capturing

if (window.currentClipData) {
  console.log('📊 Current Clip Data:', window.currentClipData);
  console.log('🌐 URL:', window.currentClipData.url);
  console.log('📝 Metadata:', window.currentClipData.metadata);
  console.log('🎨 Favicon:', window.currentClipData.metadata?.favicon);
  console.log('🏷️  Site Name:', window.currentClipData.metadata?.siteName);
  console.log('📄 Title:', window.currentClipData.metadata?.title);
} else {
  console.log('❌ No currentClipData found. Capture something first!');
}
