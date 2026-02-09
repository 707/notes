// Klue - AI Chat Module
// Handles AI chat interface, message rendering, and context-aware conversations

import { getState, setState, setMode } from './state.js';
import { navigateToView, getStackFilteredNotes } from './navigation.js';

// Module-level logging
let log, warn, error;

// Initialize module with dependencies
export function initAIChat(deps) {
    log = deps.log;
    warn = deps.warn;
    error = deps.error;
}

/**
 * [NOT-46] AI Chat Mode - Renders the chat interface
 * Loads chat history, initializes AI harness, and sets up event listeners
 */
export async function renderAIChatMode() {
    setMode('ai-chat');
    navigateToView('ai-chat-mode');

    // Get DOM elements
    const chatMessages = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    const sendButton = document.getElementById('send-chat-button');
    const clearButton = document.getElementById('clear-chat-button');
    const emptyState = document.getElementById('chat-empty-state');

    if (!chatMessages || !chatInput || !sendButton) {
        error('[NOT-46] Chat DOM elements not found');
        return;
    }

    // [NOT-51] Load preferred model from storage
    let preferredModel = 'auto'; // Default to smart auto
    try {
        const { preferredModel: savedModel } = await chrome.storage.local.get('preferredModel');
        if (savedModel) {
            preferredModel = savedModel;
            log('[NOT-51] Using preferred model:', preferredModel);
        }
    } catch (err) {
        error('[NOT-51] Failed to load preferred model:', err);
    }

    /**
     * Load or create chat session
     */
    async function loadChat() {
        try {
            const latestChat = await window.database.getLatestChat();

            if (latestChat) {
                setState({ currentChatId: latestChat.id });
                log('[NOT-46] Loaded existing chat:', getState().currentChatId);

                // Load message history
                const messages = await window.database.getChatHistory(getState().currentChatId);

                // Clear only message bubbles, preserve empty state element
                const bubbles = chatMessages.querySelectorAll('.chat-bubble');
                bubbles.forEach(bubble => bubble.remove());

                if (messages.length > 0) {
                    emptyState.classList.add('hidden');

                    // Render each message
                    messages.forEach(msg => {
                        renderMessage(msg.role, msg.content, false);
                    });

                    // Scroll to bottom
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                } else {
                    emptyState.classList.remove('hidden');
                }
            } else {
                // Create new chat with preferred model
                setState({ currentChatId: await window.database.createChat('New Chat', preferredModel) });
                log('[NOT-46] Created new chat:', getState().currentChatId);
                emptyState.classList.remove('hidden');
            }
        } catch (err) {
            error('[NOT-46] Failed to load chat:', err);
        }
    }

    /**
     * Render a message bubble in the chat
     */
    function renderMessage(role, content, animate = true) {
        emptyState.classList.add('hidden');

        const bubble = document.createElement('div');
        bubble.className = `chat-bubble chat-bubble-${role}`;
        if (animate) {
            bubble.style.opacity = '0';
        }

        const avatar = document.createElement('div');
        avatar.className = 'chat-bubble-avatar';
        avatar.textContent = role === 'user' ? 'U' : '✨';

        const contentDiv = document.createElement('div');
        contentDiv.className = 'chat-bubble-content';
        contentDiv.textContent = content;

        bubble.appendChild(avatar);
        bubble.appendChild(contentDiv);
        chatMessages.appendChild(bubble);

        // Animate in
        if (animate) {
            requestAnimationFrame(() => {
                bubble.style.opacity = '1';
            });
        }

        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;

        return contentDiv;
    }

    /**
     * Send a message to the AI
     */
    async function sendMessage() {
        const text = chatInput.value.trim();
        if (!text || getState().isTyping) return;

        // Disable input
        chatInput.disabled = true;
        sendButton.disabled = true;
        sendButton.classList.add('loading');
        setState({ isTyping: true });

        try {
            // Render user message
            renderMessage('user', text);
            await window.database.addMessage(getState().currentChatId, 'user', text);

            // Clear input
            chatInput.value = '';
            chatInput.style.height = 'auto';

            // Build context from Stack (filtered notes + page content)
            let contextPrompt = '';

            // Use shared helper to get filtered notes (excluding search filter)
            const contextNotes = getStackFilteredNotes();

            // Build context prompt if there are filtered notes or page context
            if (contextNotes.length > 0 || getState().filterState.contextFilter) {
                const contextParts = [];

                // Add filtered notes context
                if (contextNotes.length > 0) {
                    contextParts.push(`You have access to ${contextNotes.length} note${contextNotes.length === 1 ? '' : 's'} from the user's library:`);
                    contextNotes.slice(0, 10).forEach((note, i) => {
                        contextParts.push(`\\n[Note ${i + 1}]`);
                        contextParts.push(`Title: ${note.metadata?.title || 'Untitled'}`);
                        contextParts.push(`Content: ${note.text?.substring(0, 200)}${note.text?.length > 200 ? '...' : ''}`);
                        if (note.userNote) {
                            contextParts.push(`User's comment: ${note.userNote}`);
                        }
                        if (note.tags && note.tags.length > 0) {
                            contextParts.push(`Tags: ${note.tags.join(', ')}`);
                        }
                    });
                }

                // Add page context if active
                if (getState().filterState.contextFilter) {
                    const pageContent = await getPageTextContent();
                    if (pageContent) {
                        contextParts.push(`\\nCurrent page content:\\n${pageContent.substring(0, 500)}${pageContent.length > 500 ? '...' : ''}`);
                    }
                }

                contextPrompt = contextParts.join('\\n') + '\\n\\nUser question: ';
            }

            // Prepare AI message bubble for streaming
            const aiContentDiv = renderMessage('assistant', '', true);

            // Send to AI with streaming
            const fullPrompt = contextPrompt + text;
            let fullResponse = '';

            await window.aiHarness.chat(
                fullPrompt,
                {
                    onChunk: (chunk) => {
                        fullResponse += chunk;
                        aiContentDiv.textContent = fullResponse;
                        chatMessages.scrollTop = chatMessages.scrollHeight;
                    },
                    modelId: preferredModel
                }
            );

            // Save AI response to database
            await window.database.addMessage(getState().currentChatId, 'assistant', fullResponse);

            log('[NOT-46] AI response complete');

        } catch (err) {
            error('[NOT-46] Chat error:', err);
            renderMessage('assistant', `Error: ${err.message}`, true);
        } finally {
            // Re-enable input
            chatInput.disabled = false;
            sendButton.disabled = false;
            sendButton.classList.remove('loading');
            setState({ isTyping: false });
            chatInput.focus();
        }
    }

    /**
     * Clear chat history
     */
    async function clearChat() {
        if (!confirm('Clear all messages in this chat?')) return;

        try {
            await window.database.deleteChat(getState().currentChatId);
            setState({ currentChatId: await window.database.createChat('New Chat', preferredModel) });

            // Clear UI
            const bubbles = chatMessages.querySelectorAll('.chat-bubble');
            bubbles.forEach(bubble => bubble.remove());
            emptyState.classList.remove('hidden');

            log('[NOT-46] Chat cleared');
        } catch (err) {
            error('[NOT-46] Failed to clear chat:', err);
        }
    }

    // Set up event listeners
    sendButton.onclick = sendMessage;
    clearButton.onclick = clearChat;

    chatInput.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    // Auto-resize textarea
    chatInput.oninput = () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = chatInput.scrollHeight + 'px';
    };

    // Load chat on mount
    await loadChat();

    // Focus input
    chatInput.focus();
}

// Helper function to get page text content
async function getPageTextContent() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return null;

        const result = await chrome.tabs.sendMessage(tab.id, { action: 'GET_PAGE_TEXT' });
        return result?.text || null;
    } catch (err) {
        warn('Failed to get page text:', err);
        return null;
    }
}
