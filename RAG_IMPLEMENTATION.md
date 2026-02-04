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

## Current Status

✅ **Architecture Complete**
- All message passing infrastructure in place
- Graceful fallback when libraries unavailable
- Auto-indexing on note create/update
- Backfill mechanism for existing notes

⚠️  **Dependencies Not Bundled**
- Transformers.js and Orama are referenced but not bundled
- Dynamic imports from CDN blocked by Chrome Extension CSP
- App works without semantic search (fallback mode)

## Next Steps to Enable Semantic Search

### Option 1: Bundle Dependencies (Recommended)

1. Install dependencies:
   ```bash
   npm install @xenova/transformers @orama/orama
   ```

2. Bundle with webpack/rollup:
   ```javascript
   // webpack.config.js example
   entry: {
     'vector-service': './chrome-clipper/vector-service.js',
   },
   output: {
     path: path.resolve(__dirname, 'chrome-clipper/dist'),
   }
   ```

3. Update `vector-service.js` imports:
   ```javascript
   // Change from:
   const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');

   // To:
   const { pipeline } = await import('./dist/transformers.bundle.js');
   ```

### Option 2: Local Copies

1. Download library bundles:
   - [Transformers.js](https://github.com/xenova/transformers.js/releases)
   - [Orama](https://github.com/oramasearch/orama/releases)

2. Place in `chrome-clipper/lib/` directory

3. Update imports in `vector-service.js`:
   ```javascript
   const { pipeline } = await import('./lib/transformers.min.js');
   const { create, insert, search } = await import('./lib/orama.min.js');
   ```

### Option 3: Alternative Embedding Approach

Use a simpler embedding method that doesn't require large ML models:
- TF-IDF with local computation
- BM25 for keyword-based ranking
- Simple n-gram similarity

## Testing

Once dependencies are bundled, verify:

1. **Model Loading**
   - Check service worker console for "Model loaded" log
   - Should happen on extension startup

2. **Indexing**
   - Create a note with text "The quick brown fox"
   - Check console for "Note indexed" log

3. **Search**
   - In console: `chrome.runtime.sendMessage({ action: 'SEARCH_NOTES', query: 'fast animal' })`
   - Should return note about fox with high score

4. **Backfill**
   - In panel console: `window.reindexAllNotes()`
   - Check progress logs

## Performance Considerations

- **Model Size**: Xenova/all-MiniLM-L6-v2 (quantized) is ~25MB
- **First Load**: 2-5 seconds to load model
- **Embedding**: ~50-100ms per note
- **Search**: <100ms for 1000 notes

## Persistence

- Vector index stored in `chrome.storage.local`
- Key: `oramaVectorIndex`
- Automatically saved after each index update
- Restored on service worker restart

## Maintenance

### Re-indexing

Manual re-index via console:
```javascript
window.reindexAllNotes()
```

### Clearing Index

To force fresh index:
```javascript
// In panel console
chrome.storage.local.remove('oramaVectorIndex');
chrome.storage.local.remove('vectorIndexInitialized');
// Then reload extension
```

### Debugging

Enable debug logs in vector-service.js:
```javascript
console.log('🔍 [NOT-38] ...');
```

## Future Enhancements

- [ ] Add search UI in panel
- [ ] Implement semantic "Related Notes" feature
- [ ] Add embedding for tags and metadata
- [ ] Implement incremental indexing (update instead of full re-index)
- [ ] Add search filters (date range, tags, etc.)
- [ ] Optimize embedding generation (batch processing)
- [ ] Add search result ranking customization

## References

- [Transformers.js Documentation](https://huggingface.co/docs/transformers.js)
- [Orama Documentation](https://docs.oramasearch.com/)
- [Chrome Extension Manifest V3](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [WebAssembly in Chrome Extensions](https://developer.chrome.com/docs/extensions/mv3/wasm/)
