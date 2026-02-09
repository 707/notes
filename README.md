# Klue - Intelligent Chrome Knowledge Clipper

![klue](https://github.com/user-attachments/assets/42265fc6-0d15-4d8d-9db7-656d609b97a3)

Klue is a high-performance Chrome extension designed for researchers and power users. It goes beyond simple text clipping by providing a local-first, AI-powered knowledge base with semantic search and contextual recall.

## What Is This?

**Klue** is an AI-powered Chrome extension designed to shift knowledge capture from passive storage to active synthesis. It provides a non-intrusive side panel for capturing text, images, and context from the web, acting as a "Private, Proactive Intelligence" layer that turns your bookmarks into a living knowledge base.

## 🌟 Key Features

- 🧠 **Local RAG Stack** - High-speed semantic search using Transformers.js and Orama, running entirely in your browser.
- 💬 **AI Assistant** - Built-in chat interface with full history to synthesize and interact with your saved knowledge via OpenRouter.
- 🔍 **Hybrid Search** - Combines traditional keyword matching with vector-based semantic search.
- 📱 **Contextual Recall** - Automatically resurfaces relevant notes and semantic matches based on the page you are currently visiting.
- 🖼️ **Rich Media Support** - Capture multiple images per note and view auto-generated "Smart Chips" for YouTube and X (Twitter) links.
- 🏷️ **Advanced Organization** - Tagging system, "Read Later" queue, and "Starred" favorites.
- 🛡️ **Privacy First** - Local storage (IndexedDB) and local ML processing. Only LLM calls use cloud APIs (OpenRouter).

## Who It's For

1. **The "Deep Diver" Researcher** - Needs to connect distinct facts across domains and manage high volumes of information.
2. **The "Frontend Architect" Developer** - Collecting solutions from StackOverflow, GitHub, and technical documentation.
3. **The "Curator" Product Designer** - Documenting onboarding flows, competitive analysis, and UI inspiration.

## 🏗️ Technical Architecture

Klue is built as a modern Manifest V3 extension with a focus on performance and reliability.

### Core Stack
- **Database**: [Dexie.js](https://dexie.org/) (IndexedDB) for robust, high-capacity local storage.
- **Search Engine**: [Orama](https://oramasearch.com/) for hybrid vector and full-text search.
- **ML Engine**: [Transformers.js](https://huggingface.co/docs/transformers.js) (all-MiniLM-L6-v2) for generating local embeddings.
- **UI**: Vanilla ES6+ JavaScript with CSS Variables and a custom component architecture.
- **Build System**: [esbuild](https://esbuild.github.io/) for bundling ML modules and handling WASM binaries.

### Key Components
- `background.js`: Orchestrates the capture flow, context menus, and initializes the `VectorService`.
- `vector-service.js`: Manages the embedding pipeline and Orama index with a sequential `TaskQueue` to ensure stability.
- `database.js`: Defines the multi-version Dexie schema for notes, chats, and metadata.
- `panel.js`: The main UI orchestrator handling routing, rendering, and AI interactions.

## 📦 Distribution

### For End Users

Download the latest release `.zip` file and:
1. Unzip to a folder
2. Open Chrome → `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the unzipped folder

### For Developers

See [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) for development setup.

### Building from Source

If you need to rebuild the ML library bundles:
```bash
cd dev/build/
npm install
npm run build
```

### Creating Distribution Package

```bash
./package.sh
```

This creates `klue-chrome-extension-vX.X.X.zip` ready for distribution.

## 🚀 Getting Started (Development)

### 1. Prerequisites
- Chrome browser
- Node.js (for rebuilding ML bundles - optional)

### 2. Install the Extension
1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `chrome-clipper` directory

*Note: The `dist/` folder with ML bundles is pre-built and included.*

## 🛠️ Development Workflow

### Hot Reloading
To watch for file changes during UI development:
```bash
python3 dev/dev-watch.py
```

### Testing
Open the test runner in Chrome:
```bash
open dev/tests/test-runner.html
```

### Manual Re-indexing
If you need to force a full re-index of your library for semantic search, run this in the Side Panel console:
```javascript
window.reindexAllNotes()
```

### Debugging
- **Background**: Inspect the "Service Worker" from `chrome://extensions`
- **UI**: Right-click in the Side Panel and select "Inspect"
- **Debug Scripts**: See `dev/debug/` for specialized debugging tools

## 📅 Roadmap (2026)
- [ ] **LLM Integration**: Connect to local LLMs (via WebGPU) for fully offline synthesis.
- [ ] **Enhanced Metadata**: Automated scraping for more domains (GitHub, LinkedIn, ResearchGate).
- [ ] **Export Options**: One-click export to Markdown/Obsidian.
- [ ] **Dark Mode**: System-aware theming.

## 📄 License
MIT