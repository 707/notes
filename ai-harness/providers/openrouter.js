// [NOT-46] OpenRouter Provider
// Handles API calls to OpenRouter with streaming support
// OpenRouter Documentation: https://openrouter.ai/docs

/**
 * OpenRouter provider class for AI chat completions
 * Supports streaming responses and multiple models
 */
class OpenRouterProvider {
  constructor() {
    this.apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
    this.apiKey = null;
  }

  /**
   * Initialize the provider by loading the API key from storage
   * @returns {Promise<boolean>} - Returns true if API key is available
   */
  async initialize() {
    try {
      const { openRouterApiKey } = await chrome.storage.local.get('openRouterApiKey');
      this.apiKey = openRouterApiKey;
      return !!this.apiKey;
    } catch (error) {
      console.error('❌ [NOT-46] Failed to load OpenRouter API key:', error);
      return false;
    }
  }

  /**
   * Send a message to OpenRouter and stream the response
   * @param {Array} messages - Array of message objects with role and content
   * @param {string} modelId - Model identifier (e.g., "anthropic/claude-3.5-sonnet")
   * @param {Function} onChunk - Callback for streaming chunks (delta text)
   * @param {Function} onComplete - Callback when stream completes
   * @param {Function} onError - Callback on error
   * @returns {Promise<void>}
   */
  async sendMessage(messages, modelId, onChunk, onComplete, onError) {
    // Validate API key
    if (!this.apiKey) {
      const hasKey = await this.initialize();
      if (!hasKey) {
        onError(new Error('OpenRouter API key not configured. Please add it in Settings.'));
        return;
      }
    }

    try {
      // Make request to OpenRouter
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': chrome.runtime.getURL(''),
          'X-Title': 'Knowledge Clipper'
        },
        body: JSON.stringify({
          model: modelId,
          messages: messages,
          stream: true
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `OpenRouter API error: ${response.status}`;

        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error?.message || errorMessage;
        } catch (e) {
          // If parsing fails, use the default message
        }

        throw new Error(errorMessage);
      }

      // Process streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          console.log('✅ [NOT-46] Stream complete');
          onComplete();
          break;
        }

        // Decode chunk and add to buffer
        buffer += decoder.decode(value, { stream: true });

        // Process complete lines in buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmedLine = line.trim();

          // Skip empty lines and comments
          if (!trimmedLine || trimmedLine.startsWith(':')) {
            continue;
          }

          // Parse SSE data line
          if (trimmedLine.startsWith('data: ')) {
            const data = trimmedLine.slice(6); // Remove "data: " prefix

            // Check for end of stream
            if (data === '[DONE]') {
              console.log('✅ [NOT-46] Stream [DONE] marker received');
              onComplete();
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;

              if (delta) {
                onChunk(delta);
              }
            } catch (parseError) {
              console.warn('⚠️  [NOT-46] Failed to parse SSE data:', data);
            }
          }
        }
      }
    } catch (error) {
      console.error('❌ [NOT-46] OpenRouter request failed:', error);
      onError(error);
    }
  }

  /**
   * Test the API key by making a minimal request
   * @returns {Promise<boolean>} - Returns true if API key is valid
   */
  async testApiKey() {
    if (!this.apiKey) {
      return false;
    }

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': chrome.runtime.getURL(''),
          'X-Title': 'Knowledge Clipper'
        },
        body: JSON.stringify({
          model: 'anthropic/claude-3.5-sonnet',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5
        })
      });

      return response.ok;
    } catch (error) {
      console.error('❌ [NOT-46] API key test failed:', error);
      return false;
    }
  }
}

// Export for use in harness
window.OpenRouterProvider = OpenRouterProvider;
console.log('✅ [NOT-46] OpenRouter provider loaded');
