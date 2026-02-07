// [NOT-38] Vector Service - Semantic search using Transformers.js and Orama
// Provides embedding generation and hybrid (keyword + vector) search capabilities
// Runs in the service worker context for background processing

// [NOT-38] Static imports for bundled ML libraries
// Service Workers require static imports; dynamic import() is not allowed
import { pipeline, env } from './dist/transformers.bundle.js';
import { create, insert, search, save, load } from './dist/orama.bundle.js';
import { saveOramaIndex, loadOramaIndex } from './storage-service.js';

/**
 * [NOT-38] TaskQueue - Sequential job processor
 * Prevents concurrent embedding requests from crashing the Service Worker
 *
 * Features:
 * - Sequential processing (one task at a time)
 * - Error isolation (one task failure doesn't stop the queue)
 * - Graceful degradation (failed tasks are logged but queue continues)
 */
class TaskQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.failedTasks = 0;
    this.completedTasks = 0;
  }

  /**
   * Add a task to the queue
   * @param {Function} task - Async function to execute
   * @returns {Promise} - Resolves when task completes
   */
  async enqueue(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.process();
    });
  }

  /**
   * Process tasks sequentially
   * Continues processing even if individual tasks fail
   * @private
   */
  async process() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.queue.length > 0) {
      const { task, resolve, reject } = this.queue.shift();
      try {
        const result = await task();
        resolve(result);
        this.completedTasks++;
      } catch (error) {
        console.error('❌ [NOT-38] Task failed in queue:', error);
        reject(error);
        this.failedTasks++;
        // Continue processing remaining tasks despite failure
      }
    }

    this.isProcessing = false;

    // Log queue statistics if there were any failures
    if (this.failedTasks > 0) {
      console.warn(`⚠️  [NOT-38] Queue stats: ${this.completedTasks} succeeded, ${this.failedTasks} failed`);
    }
  }

  /**
   * Get current queue length
   */
  get length() {
    return this.queue.length;
  }

  /**
   * Get queue statistics
   */
  get stats() {
    return {
      queued: this.queue.length,
      completed: this.completedTasks,
      failed: this.failedTasks,
      isProcessing: this.isProcessing
    };
  }
}

/**
 * [NOT-57] Flatten flexible_metadata object into dot-notation keys
 * Transforms { type: "video", duration: "10m" } into { "metadata.type": "video", "metadata.duration": "10m" }
 *
 * Why: Orama (and most simple vector stores) cannot efficiently filter deeply nested JSON.
 * Flattening allows us to use simple property filters like: where: { "metadata.type": "video" }
 *
 * @param {Object} metadata - The flexible_metadata object from a note
 * @returns {Object} - Flattened object with "metadata." prefixed keys
 */
function flattenMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return {};
  }

  const flattened = {};
  for (const [key, value] of Object.entries(metadata)) {
    // Only include non-null, non-undefined values
    if (value !== null && value !== undefined) {
      flattened[`metadata.${key}`] = value;
    }
  }
  return flattened;
}

/**
 * VectorService - Manages semantic search infrastructure
 *
 * Uses Transformers.js (Xenova/all-MiniLM-L6-v2) for generating embeddings
 * and Orama for vector storage and hybrid search.
 *
 * The vector index is persisted to IndexedDB via Dexie.
 */
class VectorService {
  constructor() {
    this.pipeline = null; // Transformers.js pipeline
    this.oramaDb = null; // Orama database instance
    this.isInitialized = false;
    this.initializationPromise = null;
    this.taskQueue = new TaskQueue(); // [NOT-38] Sequential job processor
  }

  /**
   * [NOT-38] Initialize the VectorService
   * Loads the embedding model and creates/restores the Orama index
   *
   * @returns {Promise<void>}
   */
  async init() {
    // Prevent multiple simultaneous initializations
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    if (this.isInitialized) {
      console.log('✅ VectorService already initialized');
      return;
    }

    this.initializationPromise = this._initializeInternal();
    await this.initializationPromise;
    this.initializationPromise = null;
  }

  /**
   * [NOT-38] Internal initialization logic
   * @private
   */
  async _initializeInternal() {
    try {
      console.log('🧠 [NOT-38] Initializing VectorService...');

      // [NOT-38] ML libraries are bundled locally using esbuild
      // Run `npm run build` to regenerate bundles after dependency updates
      // The bundles are located in chrome-clipper/dist/

      // Step 1: Load Transformers.js pipeline for embeddings
      console.log('📦 Loading embedding model (Xenova/all-MiniLM-L6-v2)...');

      try {
        // Configure ONNX Runtime for Service Worker environment
        // Service Workers don't support URL.createObjectURL or SharedArrayBuffer
        const wasmPath = chrome.runtime.getURL('dist/wasm/');
        console.log('🔧 [NOT-38] Configuring WASM path:', wasmPath);

        env.backends.onnx.wasm.wasmPaths = wasmPath;
        env.backends.onnx.wasm.numThreads = 1; // Disable multi-threading in Service Worker
        env.backends.onnx.wasm.simd = true; // Keep SIMD for performance
        env.backends.onnx.wasm.proxy = false; // Disable proxy workers (they use createObjectURL)
        env.allowLocalModels = false; // Don't use local model cache
        env.allowRemoteModels = true; // Allow downloading models from HuggingFace

        // Load the feature-extraction pipeline with the quantized model
        this.pipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
          quantized: true, // Use quantized version for smaller size and faster inference
        });

        console.log('✅ Embedding model loaded');
      } catch (error) {
        console.warn('⚠️  [NOT-38] Failed to load Transformers.js:', error);
        console.warn('   Run `npm run build` to generate the bundle');
        this.pipeline = null;
      }

      // Step 2: Initialize Orama database for vector search
      console.log('📊 Initializing Orama vector database...');

      try {
        // Store Orama functions for later use
        this.oramaCreate = create;
        this.oramaInsert = insert;
        this.oramaSearch = search;
        this.oramaSave = save;
        this.oramaLoad = load;

        // [NOT-57] Define Orama schema with flattened metadata fields
        const schema = {
          id: 'string',
          text: 'string', // Searchable text content
          userNote: 'string', // User's notes
          tags: 'string[]', // Tags for filtering
          url: 'string',
          timestamp: 'number',
          embedding: 'vector[384]', // all-MiniLM-L6-v2 produces 384-dimensional vectors
          // [NOT-57] Flattened flexible_metadata fields for efficient filtering
          // These fields allow queries like: where: { "metadata.type": "video" }
          'metadata.type': 'string', // Content type (video, repo, article, tweet, etc.)
          'metadata.stars': 'number', // GitHub stars
          'metadata.language': 'string', // Programming language (GitHub)
          'metadata.duration': 'string', // Video duration (YouTube)
          'metadata.channel': 'string', // YouTube channel
          'metadata.views': 'string', // YouTube views (stored as string "1.2M" or raw number string)
          'metadata.author': 'string', // Author/creator
        };

        // [NOT-38] Try to restore existing index from IndexedDB
        try {
          const savedIndex = await loadOramaIndex();
          if (savedIndex) {
            console.log('📂 Restoring Orama index from IndexedDB...');
            const indexSize = JSON.stringify(savedIndex).length;
            console.log(`📊 Saved index size: ${(indexSize / 1024).toFixed(2)} KB`);

            // Restore the index
            this.oramaDb = await this.oramaLoad(savedIndex);
            console.log('✅ Orama index restored successfully from IndexedDB');
          } else {
            throw new Error('No saved index found');
          }
        } catch (error) {
          console.warn(`⚠️  Restore failed: ${error.message}`);
          console.log('📝 Creating new Orama index...');
          this.oramaDb = await this.oramaCreate({ schema });
          console.log('✅ New Orama index created');

          // [NOT-40] Clear the initialized flag so panel.js will trigger a reindex
          // This ensures existing notes are indexed into the new empty index
          // The old incompatible index will be overwritten on next successful save
          try {
            await chrome.storage.local.set({ vectorIndexInitialized: false });
            console.log('🔄 [NOT-40] Cleared vectorIndexInitialized flag - reindex will be triggered on next panel load');
          } catch (storageError) {
            console.warn('⚠️  [NOT-40] Failed to clear vectorIndexInitialized flag:', storageError.message);
          }
        }

        this.isInitialized = true;
        console.log('✅ [NOT-38] VectorService initialized successfully');

      } catch (error) {
        console.warn('⚠️  [NOT-38] Failed to initialize Orama:', error);
        console.warn('   Run `npm run build` to generate the bundle');
        this.oramaDb = null;

        // Mark as initialized even if libraries aren't available
        // This allows the rest of the app to work, just without semantic search
        this.isInitialized = true;
        console.log('⚠️  [NOT-38] VectorService initialized in fallback mode (no semantic search)');
      }

    } catch (error) {
      console.error('❌ [NOT-38] Failed to initialize VectorService:', error);
      this.isInitialized = false;
      throw error;
    }
  }

  /**
   * [NOT-38] Generate embedding vector for text
   *
   * @param {string} text - The text to embed
   * @returns {Promise<Array<number>>} - 384-dimensional embedding vector
   */
  async generateEmbedding(text) {
    if (!this.isInitialized) {
      await this.init();
    }

    if (!this.pipeline) {
      console.warn('⚠️  [NOT-38] Pipeline not available, returning zero vector');
      return new Array(384).fill(0);
    }

    if (!text || text.trim().length === 0) {
      console.warn('⚠️  Empty text provided for embedding');
      return new Array(384).fill(0); // Return zero vector
    }

    try {
      // Generate embedding using Transformers.js
      const output = await this.pipeline(text, {
        pooling: 'mean',
        normalize: true,
      });

      // Convert to array and ensure it's 384 dimensions
      const embedding = Array.from(output.data);

      if (embedding.length !== 384) {
        console.warn(`⚠️  Expected 384 dimensions, got ${embedding.length}`);
      }

      return embedding;

    } catch (error) {
      console.error('❌ Error generating embedding:', error);
      throw error;
    }
  }

  /**
   * [NOT-38] Add a note to the vector index (with queue)
   * Uses TaskQueue to prevent concurrent embedding requests
   *
   * @param {Object} note - Note object with id, text, userNote, tags, etc.
   * @returns {Promise<void>}
   */
  async addNoteToIndex(note) {
    return this.taskQueue.enqueue(() => this._addNoteToIndexInternal(note));
  }

  /**
   * [NOT-38] Internal method to add a note to the vector index
   * @private
   * @param {Object} note - Note object with id, text, userNote, tags, etc.
   * @returns {Promise<void>}
   */
  async _addNoteToIndexInternal(note) {
    if (!this.isInitialized) {
      await this.init();
    }

    if (!this.oramaDb) {
      console.warn('⚠️  [NOT-38] Orama not available, skipping indexing');
      return;
    }

    try {
      console.log(`🔍 [NOT-38] Indexing note: ${note.id}`);

      // Combine text and userNote for embedding
      const textToEmbed = [
        note.text || '',
        note.userNote || '',
        note.metadata?.title || '',
        note.metadata?.siteName || '',
      ].filter(Boolean).join(' ');

      // Generate embedding
      const embedding = await this.generateEmbedding(textToEmbed);

      // [NOT-57] Flatten flexible_metadata for Orama indexing
      const flattenedMetadata = flattenMetadata(note.flexible_metadata || {});

      // Prepare document for Orama
      const doc = {
        id: note.id,
        text: note.text || '',
        userNote: note.userNote || '',
        tags: note.tags || [],
        url: note.url || '',
        timestamp: note.timestamp || Date.now(),
        embedding: embedding,
        ...flattenedMetadata, // [NOT-57] Spread flattened metadata fields (e.g., "metadata.type": "video")
      };

      // Insert into Orama (or update if exists)
      await this.oramaInsert(this.oramaDb, doc);
      console.log(`📝 [NOT-38] Document inserted with embedding length: ${embedding.length}`);

      // Persist index to Dexie
      await this._saveIndexToStorage();

      console.log(`✅ [NOT-38] Note indexed: ${note.id}`);

    } catch (error) {
      console.error('❌ Error adding note to index:', error);
      throw error;
    }
  }

  /**
   * [NOT-38] Search notes using hybrid (keyword + vector) search
   *
   * @param {string} query - Search query
   * @param {number} limit - Maximum number of results (default: 10)
   * @returns {Promise<Array>} - Array of search results with scores
   */
  async search(query, limit = 10) {
    if (!this.isInitialized) {
      await this.init();
    }

    if (!this.oramaDb) {
      console.warn('⚠️  [NOT-38] Orama not available, returning empty results');
      return [];
    }

    if (!query || query.trim().length === 0) {
      console.warn('⚠️  Empty search query');
      return [];
    }

    try {
      console.log(`🔍 [NOT-38] Searching for: "${query}"`);

      // Generate embedding for the query
      const queryEmbedding = await this.generateEmbedding(query);
      console.log(`🔍 [NOT-38] Generated embedding (first 5 dims): [${queryEmbedding.slice(0, 5).map(x => x.toFixed(3)).join(', ')}...]`);

      // Perform hybrid search (vector + keyword)
      const searchResults = await this.oramaSearch(this.oramaDb, {
        term: query, // Keyword search on text fields
        vector: {
          value: queryEmbedding,
          property: 'embedding',
        },
        limit: limit,
        // Orama automatically combines keyword and vector scores
      });

      console.log(`✅ [NOT-38] Found ${searchResults.hits.length} results`);
      if (searchResults.hits.length > 0) {
        console.log(`📊 [NOT-38] Top result score: ${searchResults.hits[0].score.toFixed(3)}`);
      }

      // Return hits with scores
      return searchResults.hits.map(hit => ({
        id: hit.document.id,
        score: hit.score,
        document: hit.document,
      }));

    } catch (error) {
      console.error('❌ Error searching notes:', error);
      throw error;
    }
  }

  /**
   * [NOT-38] Re-index all notes from Dexie
   * Used for backfill or manual re-indexing
   *
   * @param {Function} getAllNotesFn - Function that returns all notes from Dexie
   * @returns {Promise<number>} - Number of notes indexed
   */
  async reindexAll(getAllNotesFn) {
    if (!this.isInitialized) {
      await this.init();
    }

    try {
      console.log('🔄 [NOT-38] Starting full re-index...');

      // Get all notes from Dexie
      const allNotes = await getAllNotesFn();
      console.log(`📚 [NOT-38] Found ${allNotes.length} notes to index`);

      // Clear existing index and create new one
      console.log('🗑️  Clearing existing index...');
      // [NOT-57] Schema with flattened metadata fields
      const schema = {
        id: 'string',
        text: 'string',
        userNote: 'string',
        tags: 'string[]',
        url: 'string',
        timestamp: 'number',
        embedding: 'vector[384]',
        // [NOT-57] Flattened flexible_metadata fields
        'metadata.type': 'string',
        'metadata.stars': 'number',
        'metadata.language': 'string',
        'metadata.duration': 'string',
        'metadata.channel': 'string',
        'metadata.views': 'string',
        'metadata.author': 'string',
      };
      this.oramaDb = await this.oramaCreate({ schema });

      // Index each note
      let indexedCount = 0;
      for (const note of allNotes) {
        try {
          await this.addNoteToIndex(note);
          indexedCount++;

          // Log progress every 10 notes
          if (indexedCount % 10 === 0) {
            console.log(`📊 [NOT-38] Indexed ${indexedCount}/${allNotes.length} notes`);
          }
        } catch (error) {
          console.error(`❌ Failed to index note ${note.id}:`, error);
        }
      }

      console.log(`✅ [NOT-38] Re-index complete: ${indexedCount}/${allNotes.length} notes indexed`);
      return indexedCount;

    } catch (error) {
      console.error('❌ Error during re-index:', error);
      throw error;
    }
  }

  /**
   * [NOT-38] Save Orama index to IndexedDB
   * Uses native IndexedDB for unlimited storage (supports images/videos)
   * @private
   */
  async _saveIndexToStorage() {
    try {
      const serialized = await this.oramaSave(this.oramaDb);
      const sizeKB = (JSON.stringify(serialized).length / 1024).toFixed(2);
      console.log(`💾 [NOT-38] Serializing index (${sizeKB} KB)...`);

      // Use IndexedDB for persistence (no size limits)
      await saveOramaIndex(serialized);

      console.log('✅ [NOT-38] Orama index saved to IndexedDB');
    } catch (error) {
      console.error('❌ Error saving index to IndexedDB:', error);
      // Don't throw - index saving is not critical
    }
  }
}

// Export singleton instance
export const vectorService = new VectorService();
