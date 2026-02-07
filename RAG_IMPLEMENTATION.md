# [NOT-38] RAG Infrastructure Implementation

## Overview

This document describes the local RAG (Retrieval-Augmented Generation) infrastructure implemented for semantic search in Knowledge Clipper.

## Architecture

### Components

1. **VectorService** (`vector-service.js`)
   - Handles embedding generation using Transformers.js
   - Manages vector storage and search using Orama
   - Provides hybrid search (keyword + vector)

2. **Background Service Worker** (`background.js`)
   - Initializes VectorService on startup
   - Listens for INDEX_NOTE and SEARCH_NOTES messages
   - Handles REINDEX_ALL requests for backfill

3. **Panel Integration** (`panel.js`)
   - Sends INDEX_NOTE messages after creating/updating notes
   - Provides manual re-index function: `window.reindexAllNotes()`
   - Auto-indexes on first run

## Build System (Implemented)

We use **esbuild** to bundle the ML libraries for the Chrome Extension environment.

### Commands
- **Install:** `npm install`
- **Build:** `npm run build` (Generates `chrome-clipper/dist/`)

### Artifacts
- `chrome-clipper/dist/transformers.bundle.js`: Bundled Transformers.js
- `chrome-clipper/dist/orama.bundle.js`: Bundled Orama
- `chrome-clipper/dist/wasm/`: ONNX Runtime WASM binaries (Copied from node_modules)

## Current Status

✅ **Fully Implemented**
- Message passing infrastructure active.
- **Bundling Complete:** `vector-service.js` now imports from local `dist/` bundles.
- **CSP Compliant:** `manifest.json` exposes `dist/wasm/*` for WASM execution.
- **Semantic Search Active:** The extension can now generate embeddings and search locally without CDN blocks.

## Maintenance

### Re-indexing

Manual re-index via console:
```javascript
window.reindexAllNotes()
```

### Updating Dependencies

To upgrade the ML libraries:
1.  Update versions in `package.json`.
2.  Run `npm install`.
3.  Run `npm run build`.
4.  Commit the updated `chrome-clipper/dist/` files.

## Performance Considerations

- **Model Size**: Xenova/all-MiniLM-L6-v2 (quantized) is ~25MB (Downloaded on first run).
- **First Load**: 2-5 seconds to load model.
- **Embedding**: ~50-100ms per note.
- **Search**: <100ms for 1000 notes.

## Persistence

- Vector index stored in `chrome.storage.local`
- Key: `oramaVectorIndex`
- Automatically saved after each index update
- Restored on service worker restart

## References

- [Transformers.js Documentation](https://huggingface.co/docs/transformers.js)
- [Orama Documentation](https://docs.oramasearch.com/)
- [Chrome Extension Manifest V3](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [WebAssembly in Chrome Extensions](https://developer.chrome.com/docs/extensions/mv3/wasm/)