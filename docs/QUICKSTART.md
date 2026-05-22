# Quick Start Guide

## 🚀 Load Extension in Chrome

1. Open Chrome and go to: `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right)
3. Click **"Load unpacked"**
4. Navigate to and select the `chrome-clipper` folder
5. ✅ Extension loaded!

## 🔥 Start Hot Reload (Optional)

In a terminal, run:

```bash
cd /path/to/chrome-clipper
python3 dev-watch.py
```

Keep `chrome://extensions` open in a pinned tab. When files change, you'll see a notification to reload the extension.

## 🎯 Test the Extension

### Test 1: Context Menu
1. Go to any website (try Wikipedia)
2. Highlight some text
3. Right-click → **"Capture Text"**
4. ✅ Side panel should open with the text

### Test 2: Save a Clip
1. After capturing text, type a note
2. Add tags (comma-separated)
3. Press `Cmd+Enter` or click **"Save Clip"**
4. ✅ Panel auto-closes after success

### Test 3: View Library
1. Click the extension icon (without selecting text)
2. ✅ You should see your saved clip

### Test 4: Search & Filter
1. Save a few more clips with different tags
2. Try searching in the library
3. Click on tag pills to filter
4. ✅ Search and filter should work

## 🐛 Debugging

**Background Service Worker Console:**
- Go to `chrome://extensions`
- Click "service worker" under Gloss

**Side Panel Console:**
- Open side panel
- Right-click → Inspect

## ✅ Phase 1 Complete

You've successfully set up:
- [x] Manifest V3 configuration
- [x] Context menu integration
- [x] Background service worker
- [x] Side panel UI (Capture & Library modes)
- [x] Storage persistence
- [x] Hot reload dev environment

## 🎯 Next Steps

Phase 1 is done! Ready to test and polish:
- Test on different websites
- Fine-tune the UI
- Add any missing features
- Test edge cases
