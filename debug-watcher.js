// [NOT-58] Debug: Watch when window.currentClipData changes
// Paste this in the side panel console BEFORE capturing

let _currentClipData = undefined;

Object.defineProperty(window, 'currentClipData', {
  get() {
    return _currentClipData;
  },
  set(value) {
    console.log('🔍 [WATCHER] window.currentClipData is being SET to:', value);
    console.log('🔍 [WATCHER] Has metadata?', value?.metadata);
    console.trace('🔍 [WATCHER] Set from:');
    _currentClipData = value;
  },
  configurable: true
});

console.log('✅ Watcher installed! Now capture something and watch for changes.');
