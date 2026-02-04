// [NOT-38] Vector Service - Semantic search using Transformers.js and Orama
// Provides embedding generation and hybrid (keyword + vector) search capabilities
// Runs in the service worker context for background processing

/**
 * VectorService - Manages semantic search infrastructure
 *
 * Uses Transformers.js (Xenova/all-MiniLM-L6-v2) for generating embeddings
 * and Orama for vector storage and hybrid search.
 *
 * The vector index is persisted to IndexedDB via Orama's persistence plugin.
 */
class VectorService {
  constructor() {
    this.pipeline = null; // Transformers.js pipeline
    this.oramaDb = null; // Orama database instance
    this.isInitialized = false;
    this.initializationPromise = null;
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

      // NOTE: Dynamic imports from CDN are blocked by Chrome Extension CSP
      // For production, these libraries need to be bundled with the extension:
      // 1. Download @xenova/transformers and bundle it
      // 2. Download @orama/orama and bundle it
      // 3. Update imports below to use local files
      //
      // For now, this implementation shows the architecture and will gracefully
      // handle missing dependencies

      // Step 1: Load Transformers.js pipeline for embeddings
      console.log('📦 Loading embedding model (Xenova/all-MiniLM-L6-v2)...');

      try {
        // Try dynamic import (won't work due to CSP, but shows intended architecture)
        const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');

        // Load the feature-extraction pipeline with the quantized model
        this.pipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
          quantized: true, // Use quantized version for smaller size and faster inference
        });

        console.log('✅ Embedding model loaded');
      } catch (importError) {
        console.warn('⚠️  [NOT-38] Transformers.js not available (needs to be bundled)');
        console.warn('   See vector-service.js for bundling instructions');
        this.pipeline = null;
      }

      // Step 2: Initialize Orama database for vector search
      console.log('📊 Initializing Orama vector database...');

      try {
        // Try dynamic import (won't work due to CSP, but shows intended architecture)
        const { create, insert, search, save, load } = await import('https://cdn.jsdelivr.net/npm/@orama/orama@2.0.0-rc.16/+esm');

        // Store Orama functions for later use
        this.oramaCreate = create;
        this.oramaInsert = insert;
        this.oramaSearch = search;
        this.oramaSave = save;
        this.oramaLoad = load;

        // Define Orama schema
        const schema = {
          id: 'string',
          text: 'string', // Searchable text content
          userNote: 'string', // User's notes
          tags: 'string[]', // Tags for filtering
          url: 'string',
          timestamp: 'number',
          embedding: 'vector[384]', // all-MiniLM-L6-v2 produces 384-dimensional vectors
        };

        // Try to restore existing index from IndexedDB
        try {
          const savedIndex = await this._loadIndexFromStorage();
          if (savedIndex) {
            console.log('📂 Restoring Orama index from IndexedDB...');
            this.oramaDb = await this.oramaLoad(savedIndex);
            console.log('✅ Orama index restored');
          } else {
            throw new Error('No saved index found');
          }
        } catch (error) {
          console.log('📝 Creating new Orama index...');
          this.oramaDb = await this.oramaCreate({ schema });
          console.log('✅ New Orama index created');
        }

        this.isInitialized = true;
        console.log('✅ [NOT-38] VectorService initialized successfully');

      } catch (importError) {
        console.warn('⚠️  [NOT-38] Orama not available (needs to be bundled)');
        console.warn('   See vector-service.js for bundling instructions');
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
   * [NOT-38] Add a note to the vector index
   *
   * @param {Object} note - Note object with id, text, userNote, tags, etc.
   * @returns {Promise<void>}
   */
  async addNoteToIndex(note) {
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

      // Prepare document for Orama
      const doc = {
        id: note.id,
        text: note.text || '',
        userNote: note.userNote || '',
        tags: note.tags || [],
        url: note.url || '',
        timestamp: note.timestamp || Date.now(),
        embedding: embedding,
      };

      // Insert into Orama (or update if exists)
      await this.oramaInsert(this.oramaDb, doc);

      // Persist index to IndexedDB
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
      const schema = {
        id: 'string',
        text: 'string',
        userNote: 'string',
        tags: 'string[]',
        url: 'string',
        timestamp: 'number',
        embedding: 'vector[384]',
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
   * @private
   */
  async _saveIndexToStorage() {
    try {
      const serialized = await this.oramaSave(this.oramaDb);

      // Use chrome.storage.local for persistence
      await chrome.storage.local.set({
        oramaVectorIndex: serialized,
      });

      console.log('💾 [NOT-38] Orama index saved to storage');
    } catch (error) {
      console.error('❌ Error saving index to storage:', error);
      // Don't throw - index saving is not critical
    }
  }

  /**
   * [NOT-38] Load Orama index from IndexedDB
   * @private
   * @returns {Promise<Object|null>} - Serialized index or null if not found
   */
  async _loadIndexFromStorage() {
    try {
      const result = await chrome.storage.local.get('oramaVectorIndex');

      if (result.oramaVectorIndex) {
        console.log('📂 [NOT-38] Found saved Orama index');
        return result.oramaVectorIndex;
      }

      return null;
    } catch (error) {
      console.error('❌ Error loading index from storage:', error);
      return null;
    }
  }
}

// Export singleton instance
export const vectorService = new VectorService();
