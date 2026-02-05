// [NOT-46] AI Harness - Main Entry Point
// Provides a unified interface for AI interactions with pluggable providers
// This architecture allows easy switching between providers (OpenRouter, Gemini Nano, etc.)

/**
 * AI Harness - Manages AI provider selection and message routing
 * Implements a plugin architecture for multiple AI providers
 */
class AIHarness {
  constructor() {
    this.currentProvider = null;
    this.availableProviders = {
      openrouter: null // Will be initialized lazily
    };
  }

  /**
   * Initialize the harness with a specific provider
   * @param {string} providerName - Provider name ("openrouter", "gemini", etc.)
   * @returns {Promise<boolean>} - Returns true if initialization successful
   */
  async initialize(providerName = 'openrouter') {
    try {
      console.log(`🔌 [NOT-46] Initializing AI Harness with provider: ${providerName}`);

      // Initialize OpenRouter provider
      if (providerName === 'openrouter') {
        if (!this.availableProviders.openrouter) {
          // Check if OpenRouterProvider is loaded
          if (typeof OpenRouterProvider === 'undefined') {
            throw new Error('OpenRouterProvider not loaded');
          }
          this.availableProviders.openrouter = new OpenRouterProvider();
        }

        const hasKey = await this.availableProviders.openrouter.initialize();
        if (!hasKey) {
          console.warn('⚠️  [NOT-46] OpenRouter API key not configured');
          return false;
        }

        this.currentProvider = this.availableProviders.openrouter;
        console.log('✅ [NOT-46] OpenRouter provider initialized');
        return true;
      }

      throw new Error(`Unknown provider: ${providerName}`);
    } catch (error) {
      console.error('❌ [NOT-46] Failed to initialize AI Harness:', error);
      return false;
    }
  }

  /**
   * Send a message and receive streaming response
   * @param {string} text - User message text
   * @param {Object} context - Optional context (previous messages, model, etc.)
   * @param {Function} onChunk - Callback for streaming response chunks
   * @param {Function} onComplete - Callback when response is complete
   * @param {Function} onError - Callback on error
   * @returns {Promise<void>}
   */
  async sendMessage(text, context = {}, onChunk, onComplete, onError) {
    // Ensure provider is initialized
    if (!this.currentProvider) {
      const initialized = await this.initialize('openrouter');
      if (!initialized) {
        onError(new Error('Failed to initialize AI provider. Please check your API key in Settings.'));
        return;
      }
    }

    try {
      // Build messages array from context
      const messages = context.messages || [];

      // Add user message
      messages.push({
        role: 'user',
        content: text
      });

      // Get model ID from context or use default
      const modelId = context.modelId || 'anthropic/claude-3.5-sonnet';

      console.log(`💬 [NOT-46] Sending message to ${modelId}:`, text.substring(0, 50) + '...');

      // Send to provider
      await this.currentProvider.sendMessage(
        messages,
        modelId,
        onChunk,
        onComplete,
        onError
      );
    } catch (error) {
      console.error('❌ [NOT-46] Error in sendMessage:', error);
      onError(error);
    }
  }

  /**
   * Get list of available models for current provider
   * @returns {Array} - Array of model objects with id, name, and description
   */
  getAvailableModels() {
    // [NOT-46] Hardcoded list of popular OpenRouter models
    // In a future version, this could be fetched from OpenRouter's models API
    return [
      {
        id: 'anthropic/claude-3.5-sonnet',
        name: 'Claude 3.5 Sonnet',
        description: 'Most capable Claude model'
      },
      {
        id: 'anthropic/claude-3-haiku',
        name: 'Claude 3 Haiku',
        description: 'Fast and cost-effective'
      },
      {
        id: 'google/gemini-pro',
        name: 'Gemini Pro',
        description: 'Google\'s most capable model'
      },
      {
        id: 'openai/gpt-4-turbo',
        name: 'GPT-4 Turbo',
        description: 'OpenAI\'s latest GPT-4'
      },
      {
        id: 'openai/gpt-3.5-turbo',
        name: 'GPT-3.5 Turbo',
        description: 'Fast and efficient'
      }
    ];
  }

  /**
   * Test if current provider is configured correctly
   * @returns {Promise<boolean>} - Returns true if provider is ready
   */
  async testProvider() {
    if (!this.currentProvider) {
      return false;
    }

    try {
      if (this.currentProvider.testApiKey) {
        return await this.currentProvider.testApiKey();
      }
      return true;
    } catch (error) {
      console.error('❌ [NOT-46] Provider test failed:', error);
      return false;
    }
  }
}

// Export global instance
window.aiHarness = new AIHarness();
console.log('✅ [NOT-46] AI Harness loaded');
