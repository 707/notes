# Privacy Policy for Gloss

**Last Updated:** February 9, 2026

## Introduction
Gloss ("we", "our", or "us") is dedicated to protecting your privacy. This Privacy Policy explains how our Chrome Extension ("Gloss") handles your data.

## Introduction
Gloss ("we", "our", or "us") is dedicated to protecting your privacy. This Privacy Policy explains how our Chrome Extension ("Gloss") handles your data.

**Core Principle:** Gloss prioritizes **local storage**. Your notes and vector index live on your device. However, **AI chat features rely on third-party AI providers** (like OpenRouter) to process your messages.

## Data Collection and Usage

### 1. Website Content
**What we handle:** Text and images from web pages you visit.
**Why:** To allow you to capture specific snippets ("clips") to your local notebook and to generate vector embeddings for semantic search.
**Storage:** Stored locally in your browser's `IndexedDB` and `chrome.storage`.

### 2. Web History (URLs and Titles)
**What we handle:** The URL and title of the web pages you visit.
**Why:**
*   To associate your saved notes with their source (e.g., "Note taken on example.com").
*   To enable the "Contextual Recall" feature, which checks if you have existing notes relevant to the current page.
**Storage:** Stored locally on your device.

### 3. AI Chat History
**What we handle:** The contents of your conversations with the built-in AI assistant.
**Why:** To maintain conversation history and context within the side panel.
**Storage:** History is stored locally on your device.
**Processing:** When you chat, your current message and relevant context from your notes are sent to the AI provider (OpenRouter) to generate a response.

## Third-Party Services

### OpenRouter (AI Provider)
Gloss connects to OpenRouter to power the AI assistant.
*   **Data Transmission:** When you send a message, specific data (your query + relevant note context) is transmitted to OpenRouter's API for processing.
*   **Your Control:** You provide your own API key. No data is sent unless you actively use the chat feature.
*   **Privacy:** Please refer to [OpenRouter's Privacy Policy](https://openrouter.ai/privacy) to understand how they handle data processed through their API.

## Data Security
All your notes, vectors, and settings are stored locally within your Chrome browser profile. We do not have access to this data.

## Changes to This Policy
We may update our Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page.

## Contact Us
If you have any questions about this Privacy Policy, please open an issue on our GitHub repository.
