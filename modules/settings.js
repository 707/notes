// Klue - Settings Module
// Handles settings UI, API key management, and model selection

import { setMode } from './state.js';
import { navigateToView } from './navigation.js';

// Module-level logging
let log, warn, error;

// Initialize module with dependencies
export function initSettings(deps) {
    log = deps.log;
    warn = deps.warn;
    error = deps.error;
}

/**
 * [NOT-40] Settings Mode - Shows API key settings and model selection
 */
export async function renderSettingsMode() {
    setMode('settings');
    navigateToView('settings-mode');

    // Set up OpenRouter API key handlers
    await setupOpenRouterSettings();
}

/**
 * [NOT-46] Set up OpenRouter API key settings
 * [NOT-51] Also handles preferred model selection
 */
async function setupOpenRouterSettings() {
    const apiKeyInput = document.getElementById('openrouter-api-key');
    const toggleVisibilityButton = document.getElementById('toggle-api-key-visibility');
    const saveButton = document.getElementById('save-settings-button');
    const testButton = document.getElementById('test-api-key-button');
    const statusDiv = document.getElementById('settings-status');
    const modelSelector = document.getElementById('preferred-model-selector');

    if (!apiKeyInput || !saveButton || !testButton || !statusDiv || !modelSelector) {
        error('[NOT-46] Settings DOM elements not found');
        return;
    }

    /**
     * Show status message
     */
    function showStatus(message, type = 'info') {
        statusDiv.textContent = message;
        statusDiv.className = `settings-status ${type}`;
        statusDiv.classList.remove('hidden');

        // Auto-hide after 5 seconds
        setTimeout(() => {
            statusDiv.classList.add('hidden');
        }, 5000);
    }

    /**
     * Load saved API key
     */
    async function loadApiKey() {
        try {
            const { openRouterApiKey } = await chrome.storage.local.get('openRouterApiKey');
            if (openRouterApiKey) {
                apiKeyInput.value = openRouterApiKey;
                log('[NOT-46] Loaded OpenRouter API key');
            }
        } catch (err) {
            error('[NOT-46] Failed to load API key:', err);
        }
    }

    /**
     * Populate model selector with available models
     */
    function populateModelSelector() {
        try {
            const models = window.aiHarness.getAvailableModels();

            // Clear existing options
            modelSelector.innerHTML = '';

            // Add each model as an option
            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model.id;
                option.textContent = model.name;
                option.title = model.description;
                modelSelector.appendChild(option);
            });

            log('[NOT-51] Populated model selector with', models.length, 'models');
        } catch (err) {
            error('[NOT-51] Failed to populate model selector:', err);
        }
    }

    /**
     * Load saved preferred model
     */
    async function loadPreferredModel() {
        try {
            const { preferredModel } = await chrome.storage.local.get('preferredModel');
            const modelId = preferredModel || 'auto';
            modelSelector.value = modelId;
            log('[NOT-51] Loaded preferred model:', modelId);
        } catch (err) {
            error('[NOT-51] Failed to load preferred model:', err);
        }
    }

    /**
     * Save API key and preferred model
     */
    async function saveApiKey() {
        const apiKey = apiKeyInput.value.trim();
        const preferredModel = modelSelector.value;

        if (!apiKey) {
            showStatus('Please enter an API key', 'error');
            return;
        }

        saveButton.disabled = true;

        try {
            await chrome.storage.local.set({
                openRouterApiKey: apiKey,
                preferredModel: preferredModel
            });
            showStatus('Settings saved successfully!', 'success');
            log('[NOT-46] API key saved');
            log('[NOT-51] Preferred model saved:', preferredModel);
        } catch (err) {
            showStatus('Failed to save settings', 'error');
            error('[NOT-46] Failed to save settings:', err);
        } finally {
            saveButton.disabled = false;
        }
    }

    /**
     * Test API key
     */
    async function testApiKey() {
        const apiKey = apiKeyInput.value.trim();

        if (!apiKey) {
            showStatus('Please enter an API key first', 'error');
            return;
        }

        testButton.disabled = true;
        testButton.textContent = 'Testing...';

        try {
            // Save key temporarily for testing
            await chrome.storage.local.set({ openRouterApiKey: apiKey });

            // Initialize and test
            await window.aiHarness.initialize('openrouter');
            const isValid = await window.aiHarness.testProvider();

            if (isValid) {
                showStatus('✅ API key is valid!', 'success');
            } else {
                showStatus('❌ API key is invalid or connection failed', 'error');
            }
        } catch (err) {
            showStatus('❌ Test failed: ' + err.message, 'error');
            error('[NOT-46] API key test failed:', err);
        } finally {
            testButton.disabled = false;
            testButton.textContent = 'Test Connection';
        }
    }

    /**
     * Toggle API key visibility
     */
    function toggleVisibility() {
        if (apiKeyInput.type === 'password') {
            apiKeyInput.type = 'text';
            toggleVisibilityButton.textContent = '🙈';
        } else {
            apiKeyInput.type = 'password';
            toggleVisibilityButton.textContent = '👁️';
        }
    }

    // Set up event listeners
    saveButton.onclick = saveApiKey;
    testButton.onclick = testApiKey;
    if (toggleVisibilityButton) {
        toggleVisibilityButton.onclick = toggleVisibility;
    }

    // Load saved data
    await loadApiKey();
    populateModelSelector();
    await loadPreferredModel();
}
