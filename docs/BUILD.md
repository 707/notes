# Build System

**Location:** `chrome-clipper/dev/build/`

## Overview

This project bundles ML libraries (@xenova/transformers and @orama/orama) locally to enable semantic search in the Chrome extension, bypassing CSP restrictions on CDN imports.

**Important**: Service Workers do not support dynamic `import()`. The bundles are loaded using static ES6 imports at the top of `vector-service.js`.

**Note**: Dexie is NOT bundled. The extension uses the UMD bundle loaded via `<script>` tag in panel.html, which provides the global `window.Dexie` object.

## Prerequisites

- Node.js (v18 or higher)
- npm

## Initial Setup

Navigate to the build system directory and install dependencies:

```bash
cd chrome-clipper/dev/build
npm install
```

This installs:
- `esbuild` - Fast JavaScript bundler
- `fs-extra` - File system utilities
- `@xenova/transformers` - ML embeddings library
- `@orama/orama` - Vector database

## Building the Bundles

**Note**: Pre-built bundles are included in `chrome-clipper/dist/`. You only need to rebuild if:
- Updating ML library versions
- Modifying entry point files
- Debugging bundled code

To rebuild:

```bash
cd chrome-clipper/dev/build
npm run build
```

This command:
1. Bundles Transformers.js → `chrome-clipper/dist/transformers.bundle.js` (~1.3MB)
2. Bundles Orama → `chrome-clipper/dist/orama.bundle.js` (~139KB)
3. Copies WASM files → `chrome-clipper/dist/wasm/` (~37MB)

## Loading the Extension

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `chrome-clipper` directory

## Verifying the Build

After loading the extension:
1. Click the extension icon to open the side panel
2. Open Chrome DevTools → Console
3. Switch to the Service Worker context (dropdown at top)
4. Look for these messages:

```
🧠 [NOT-38] Initializing VectorService...
📦 Loading embedding model (Xenova/all-MiniLM-L6-v2)...
✅ Embedding model loaded
📊 Initializing Orama vector database...
✅ [NOT-38] VectorService initialized successfully
```

## Testing Semantic Search

In the side panel console:

```javascript
chrome.runtime.sendMessage({
  action: 'SEARCH_NOTES',
  query: 'React hooks',
  limit: 5
}, console.log);
```

Expected response:
```javascript
{
  success: true,
  results: [{note: {...}, similarity: 0.85}, ...]
}
```

## File Structure

```
chrome-clipper/
├── dev/
│   └── build/                    # Build system location
│       ├── package.json          # Dependencies and build script
│       ├── build.js             # esbuild configuration
│       ├── transformers-entry.js # Transformers.js exports
│       ├── orama-entry.js       # Orama exports
│       └── README.md            # Build system documentation
├── manifest.json                # Chrome extension manifest
├── vector-service.js           # Semantic search service
└── dist/                       # Generated bundles (output)
    ├── transformers.bundle.js
    ├── orama.bundle.js
    └── wasm/                   # ONNX Runtime WASM files
```

## What Gets Bundled

✅ **Bundled libraries:**
- `@xenova/transformers` → dist/transformers.bundle.js
- `@orama/orama` → dist/orama.bundle.js
- WASM files → dist/wasm/*.wasm

❌ **NOT bundled:**
- `dexie` - Loaded via UMD bundle in panel.html (provides global `window.Dexie`)

## Updating Dependencies

To update ML libraries:

1. Navigate to build directory: `cd chrome-clipper/dev/build`
2. Update version in `package.json`
3. Run `npm install`
4. Run `npm run build`
5. Reload the extension in Chrome

## Troubleshooting

### "Failed to load bundle" errors

1. Verify bundles exist: `ls chrome-clipper/dist/`
2. If missing, rebuild: `cd chrome-clipper/dev/build && npm run build`
3. Check for build errors in terminal output
4. Reload the extension in `chrome://extensions/`

### WASM loading errors

- Verify `manifest.json` includes `web_accessible_resources` for wasm files
- Check that WASM files exist: `ls chrome-clipper/dist/wasm/`
- If missing, rebuild to copy WASM files
- Ensure CSP includes `'wasm-unsafe-eval'` in manifest.json

### Model download fails

- First-time initialization downloads ~25MB from HuggingFace
- Requires internet connection
- Model is cached after first download
- Check browser's network console for 403/404 errors

### Build errors

**"Cannot find module 'esbuild'":**
- Run `npm install` in `chrome-clipper/dev/build/` directory

**"Entry point not found":**
- Verify entry point files exist: `transformers-entry.js`, `orama-entry.js`
- Check `build.js` for correct paths

**"Permission denied" errors:**
- Ensure `chrome-clipper/dist/` directory is writable
- Check file permissions: `chmod -R u+w chrome-clipper/dist/`

## Performance

- **First load**: 2-5 seconds (model download)
- **Subsequent loads**: <500ms (cached)
- **Bundle size**: ~1.5MB JS + ~37MB WASM
- **Embedding generation**: ~50ms per text
- **Search query**: ~20-100ms depending on index size
