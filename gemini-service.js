// [NOT-40] Gemini Service - AI Synthesis using Chrome's built-in Summarizer API
// Provides synthesis capabilities to generate concise summaries from context and related notes
// Uses Gemini Nano via the Summarizer API for on-device AI processing

/**
 * [NOT-40] SynthesisQueue - Sequential synthesis job processor
 * Prevents concurrent AI requests from overloading GPU/NPU or crashing the browser
 *
 * Features:
 * - Sequential processing (one synthesis at a time)
 * - Throttling (ignores duplicate requests while generation is active)
 * - Error isolation (failed tasks don't stop the queue)
 */
class SynthesisQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.activeSynthesis = null;
  }

  /**
   * Add a synthesis task to the queue
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
   * Process synthesis tasks sequentially
   * Only one synthesis runs at a time to prevent GPU/NPU overload
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
        this.activeSynthesis = { startTime: Date.now() };
        const result = await task();
        resolve(result);
        console.log('✅ [NOT-40] Synthesis completed successfully');
      } catch (error) {
        console.error('❌ [NOT-40] Synthesis task failed:', error);
        reject(error);
      } finally {
        this.activeSynthesis = null;
      }
    }

    this.isProcessing = false;
  }

  /**
   * Check if synthesis is currently active
   */
  get isActive() {
    return this.isProcessing;
  }
}

/**
 * GeminiService - Manages AI synthesis using Chrome's Summarizer API (Gemini Nano)
 *
 * Provides semantic synthesis by combining current page context with related notes
 * to generate concise, markdown-formatted summaries.
 *
 * Requirements:
 * - Chrome 138+ stable (no flags required in production)
 * - Gemini Nano model (auto-downloads on first use)
 */
class GeminiService {
  constructor() {
    this.summarizer = null;
    this.isAvailable = false;
    this.availabilityStatus = null;
    this.downloadProgress = 0;
    this.synthesisQueue = new SynthesisQueue();
  }

  /**
   * [NOT-40] Check if Summarizer API is available and Gemini Nano is ready
   * @returns {Promise<boolean>} - True if available, false otherwise
   */
  async checkAvailability() {
    console.log('🔍 [NOT-40] Checking Summarizer API availability...');

    // Check if Summarizer API exists
    if (!self.ai || !self.ai.summarizer) {
      console.warn('⚠️  [NOT-40] Summarizer API not found. Gemini Nano is not available.');
      this.isAvailable = false;
      this.availabilityStatus = 'unavailable';
      return false;
    }

    try {
      // Check model availability status
      const availability = await self.ai.summarizer.capabilities();
      this.availabilityStatus = availability.available;

      console.log('📊 [NOT-40] Gemini Nano status:', this.availabilityStatus);

      // Available states: "readily", "after-download", "no"
      if (this.availabilityStatus === 'readily' || this.availabilityStatus === 'after-download') {
        this.isAvailable = true;
        console.log('✅ [NOT-40] Summarizer API is available');
        return true;
      } else {
        this.isAvailable = false;
        console.warn('⚠️  [NOT-40] Summarizer API is not available:', this.availabilityStatus);
        return false;
      }
    } catch (error) {
      console.error('❌ [NOT-40] Error checking Summarizer API availability:', error);
      this.isAvailable = false;
      this.availabilityStatus = 'error';
      return false;
    }
  }

  /**
   * [NOT-40] Create a Summarizer session with download progress monitoring
   * Initializes the Gemini Nano model for synthesis tasks
   * @param {Function} onProgress - Optional callback for download progress (0-1)
   * @returns {Promise<Object>} - The Summarizer session object
   */
  async createSession(onProgress = null) {
    console.log('🔧 [NOT-40] Creating Summarizer session...');

    if (!this.isAvailable) {
      throw new Error('Summarizer API is not available. Cannot create session.');
    }

    try {
      // Create session with shared context and download monitor
      const options = {
        type: 'key-points', // Use key-points for synthesis (generates bullet points)
        format: 'markdown',
        length: 'medium',
        sharedContext: 'You are helping a user understand how their saved notes relate to the webpage they are currently viewing. Focus on meaningful connections and insights.'
      };

      // Add download progress monitor if callback provided
      if (onProgress) {
        options.monitor = (m) => {
          m.addEventListener('downloadprogress', (e) => {
            const progress = e.loaded / e.total;
            this.downloadProgress = progress;
            console.log(`📥 [NOT-40] Download progress: ${Math.round(progress * 100)}%`);
            onProgress(progress);
          });
        };
      }

      this.summarizer = await self.ai.summarizer.create(options);

      console.log('✅ [NOT-40] Summarizer session created successfully');
      return this.summarizer;
    } catch (error) {
      console.error('❌ [NOT-40] Failed to create Summarizer session:', error);
      throw error;
    }
  }

  /**
   * [NOT-40] Generate synthesis from current context and related notes
   * Uses the synthesis queue to prevent concurrent requests
   *
   * @param {Object} currentContext - Current page info { title, url }
   * @param {Array} relatedNotes - Array of related notes with { text, title, url, similarity }
   * @returns {AsyncIterable} - Stream of generated text tokens
   */
  async generateSynthesis(currentContext, relatedNotes) {
    console.log('✨ [NOT-40] Starting synthesis generation...');
    console.log('📄 Current context:', currentContext);
    console.log('📚 Related notes count:', relatedNotes.length);

    // Validate inputs
    if (!currentContext || !currentContext.title) {
      throw new Error('Invalid current context provided');
    }

    if (!Array.isArray(relatedNotes) || relatedNotes.length === 0) {
      throw new Error('No related notes provided for synthesis');
    }

    // Queue the synthesis task
    return this.synthesisQueue.enqueue(async () => {
      // Ensure session exists
      if (!this.summarizer) {
        await this.createSession();
      }

      // Construct the input text
      const inputText = this.constructInput(currentContext, relatedNotes);
      console.log('📝 [NOT-40] Constructed input length:', inputText.length);

      try {
        // Generate streaming response
        const stream = await this.summarizer.summarizeStreaming(inputText);
        console.log('🌊 [NOT-40] Streaming synthesis started');
        return stream;
      } catch (error) {
        console.error('❌ [NOT-40] Synthesis generation failed:', error);
        throw error;
      }
    });
  }

  /**
   * [NOT-40] Construct the input text for summarization
   * Frames the content to encourage synthesis rather than simple summarization
   * @private
   * @param {Object} currentContext - Current page info
   * @param {Array} relatedNotes - Related notes
   * @returns {string} - Formatted input text
   */
  constructInput(currentContext, relatedNotes) {
    // Format related notes (take top 5 for context window efficiency)
    const topNotes = relatedNotes.slice(0, 5);
    const notesText = topNotes.map((item, index) => {
      const note = item.note || item; // Handle different data structures
      const similarity = item.similarity ? ` (${Math.round(item.similarity * 100)}% match)` : '';
      const title = note.metadata?.title || note.title || 'Untitled';
      const content = note.text || note.content || 'No content';
      return `Note ${index + 1}: "${title}"${similarity}\n${content}`;
    }).join('\n\n');

    // Construct input text that encourages synthesis
    return `The user is reading: "${currentContext.title}"

They have these related notes from their knowledge library:

${notesText}

Explain the key connections between the current page and these notes. What patterns or insights emerge? Focus on why these notes are relevant.`;
  }

  /**
   * [NOT-40] Check if synthesis is currently running
   * Used for throttling button clicks
   */
  get isSynthesizing() {
    return this.synthesisQueue.isActive;
  }

  /**
   * [NOT-40] Destroy the current session
   * Useful for cleanup or resetting state
   */
  async destroySession() {
    if (this.summarizer) {
      try {
        await this.summarizer.destroy();
        console.log('🗑️  [NOT-40] Summarizer session destroyed');
      } catch (error) {
        console.error('❌ [NOT-40] Error destroying session:', error);
      }
      this.summarizer = null;
    }
  }
}

// [NOT-40] Export singleton instance as global variable for panel.js
const geminiService = new GeminiService();

// Make available globally for non-module scripts
if (typeof window !== 'undefined') {
  window.geminiService = geminiService;
} else if (typeof self !== 'undefined') {
  self.geminiService = geminiService;
}
