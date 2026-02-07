// Debug script to check source bar rendering
console.log('=== SOURCE BAR DEBUG ===');

// 1. Check if source bar exists
const sourceBar = document.querySelector('.source-bar');
console.log('1. Source bar element found:', !!sourceBar);

// 2. Check current clipData flexible_metadata
if (window.currentClipData) {
  console.log('2. Current flexible_metadata:', window.currentClipData.metadata?.flexible_metadata);
}

// 3. Check if renderDynamicSourceBar function exists
console.log('3. renderDynamicSourceBar exists:', typeof renderDynamicSourceBar);

// 4. Try manually rendering
if (sourceBar && window.currentClipData && typeof renderDynamicSourceBar === 'function') {
  console.log('4. Attempting manual render...');
  renderDynamicSourceBar(window.currentClipData, sourceBar);
  console.log('   ✅ Render complete. Check the source bar in the UI!');
} else {
  console.error('4. ❌ Cannot render - missing required elements');
}

// 5. Check what's actually in the source bar DOM
if (sourceBar) {
  console.log('5. Source bar HTML:', sourceBar.innerHTML);
  const dynamicContent = sourceBar.querySelector('.source-bar-dynamic');
  console.log('   - Dynamic content exists:', !!dynamicContent);
  if (dynamicContent) {
    console.log('   - Dynamic content HTML:', dynamicContent.innerHTML);
  }
}

console.log('=== END DEBUG ===');
