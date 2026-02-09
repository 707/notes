# Developer Guide

## Project Structure

- `/` - Extension root (production code)
- `/modules/` - ES6 modules (state, UI, capture, navigation, etc.)
- `/ai-harness/` - AI provider system
- `/dist/` - Bundled ML libraries (pre-built)
- `/docs/` - Internal documentation
- `/dev/` - All development tools
  - `/dev/build/` - Build system for ML libraries
  - `/dev/tests/` - Unit tests
  - `/dev/debug/` - Debug scripts
  - `/dev/scripts/` - Utility scripts

## Development Workflow

1. Make changes to extension code
2. Test in chrome://extensions (Load unpacked)
3. Run unit tests: `open dev/tests/test-runner.html`
4. Create distribution package: `./package.sh`
5. Commit changes

## Testing

```bash
# Open test runner in Chrome
open dev/tests/test-runner.html
```

Tests cover:
- State management
- UI components (TagInput, tooltips)
- Utility functions (sanitizeHtml, formatDate)
- Database operations (Dexie)

## Debugging

Debug scripts in `dev/debug/`:
- `debug-capture-flow.js` - Trace capture process
- `debug-metadata.js` - Inspect metadata extraction
- `debug-save.js` - Verify save data structure
- `debug-source-bar.js` - Test source bar UI
- `debug-watcher.js` - Monitor state changes

Verification scripts in `dev/scripts/`:
- `verify-db.js` - Check IndexedDB health
- `quick-test.js` - Quick feature tests
- `full-debug-test.js` - Comprehensive debug

## Rebuilding ML Libraries

Only needed when updating dependencies:

```bash
cd dev/build/
npm install
npm run build
```

This bundles:
- `@xenova/transformers@2.17.2` → `dist/transformers.bundle.js` (1.3 MB)
- `@orama/orama@3.1.18` → `dist/orama.bundle.js` (139 KB)
- WASM files → `dist/wasm/` (37 MB)

**Note:** The `dist/` folder is pre-built and committed. You rarely need to rebuild.

## File Organization Rules

**Production (included in distribution):**
- All `.js`, `.css`, `.html` files in root and modules/
- `dist/` folder (ML bundles)
- `icons/` folder
- `ai-harness/` folder
- `README.md` and `USER.md`

**Development (excluded from distribution):**
- `docs/` - Internal documentation
- `dev/` - All development tools (tests, debug, build system)
- `*.bak*` - Backup files
- Hidden files (.DS_Store, .git/, .claude/)

## Creating Distribution Package

```bash
./package.sh
```

This creates `klue-chrome-extension-v1.0.0.zip` in the chrome-clipper root.

**What's excluded:**
- Defined in `.distignore`
- All dev/, docs/ folders
- Backup files
- Git files
- .claude/ development files

## Architecture Patterns

### Module System
- ES6 modules with explicit imports/exports
- State module (`modules/state.js`) - central state management
- UI module (`modules/ui.js`) - reusable components
- Database module (`modules/database.js`) - Dexie wrapper
- Capture module (`modules/capture.js`) - text/image capture logic

### AI Provider Architecture
- Plugin pattern in `ai-harness/`
- Provider-specific code in `ai-harness/providers/`
- Streaming callbacks: onChunk, onComplete, onError
- API keys stored in `chrome.storage.local`

### Event Handler Management
- Remove listeners before adding (prevent duplicates)
- Use named functions (not anonymous)
- Disable buttons during async operations
- Reset state in finally blocks

See `DESIGN_SYSTEM.md` for UI/CSS patterns.
