// Background Service Worker for Klue
// Handles context menu, text capture, and side panel orchestration

// [NOT-38] Import VectorService for semantic search
import { vectorService } from './vector-service.js';
import { extractPageMetadata } from './modules/utils.js';

console.log('🚀 Klue background service worker started');

// [NOT-38] Initialize VectorService on startup
console.log('🧠 [NOT-38] Initializing VectorService...');
vectorService.init().catch(error => {
  console.error('❌ [NOT-38] Failed to initialize VectorService:', error);
});

// [NOT-38] Keep-Alive: Long-lived port to prevent SW timeout during long operations
let keepAlivePort = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'keepalive') {
    console.log('🔌 [NOT-38] Keep-alive port connected');
    keepAlivePort = port;

    port.onDisconnect.addListener(() => {
      console.log('🔌 [NOT-38] Keep-alive port disconnected');
      keepAlivePort = null;
    });
  }
});

// Create context menu on installation
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('📦 Extension installed, creating context menu...');

  // Create context menu item for capturing text
  chrome.contextMenus.create({
    id: 'capture-text',
    title: 'Capture Text',
    contexts: ['selection']
  });

  // [NOT-27] Create context menu item for capturing webpage (bookmark)
  chrome.contextMenus.create({
    id: 'capture-page',
    title: 'Capture Webpage',
    contexts: ['page']
  });

  // [NOT-29] Create context menu item for capturing images
  chrome.contextMenus.create({
    id: 'capture-image',
    title: 'Capture Image',
    contexts: ['image']
  });

  console.log('✅ Context menu created');
});

// [NOT-20] [NOT-27] Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  console.log('📋 Context menu clicked:', info.menuItemId);

  if (info.menuItemId === 'capture-text') {
    console.log('🎯 Capture text triggered');
    console.log('Page URL:', info.pageUrl);

    try {
      // IMPORTANT: Open panel FIRST while we still have user gesture context
      await chrome.sidePanel.open({ windowId: tab.windowId });
      console.log('📂 Side panel opened');

      // [NOT-20] Capture HTML selection
      const htmlResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: captureSelectionHtml
      });

      const capturedContent = htmlResults[0].result;
      console.log('📝 Captured HTML length:', capturedContent.html.length);

      // Extract page metadata
      const metadataResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPageMetadata
      });

      const metadata = metadataResults[0].result;
      console.log('📊 Extracted metadata:', metadata);

      // Prepare the clip data with both HTML and plain text
      const clipData = {
        html: capturedContent.html,
        text: capturedContent.text,
        url: info.pageUrl,
        metadata: metadata,
        timestamp: Date.now()
      };

      // Save to storage as pending clip
      await chrome.storage.local.set({ pendingClipData: clipData });
      console.log('💾 Saved to storage as pendingClipData');

    } catch (error) {
      console.error('❌ Error capturing text:', error);
    }
  }

  // [NOT-27] Handle webpage capture (bookmark with no text selection)
  if (info.menuItemId === 'capture-page') {
    console.log('🔖 Capture webpage triggered');
    console.log('Page URL:', info.pageUrl);

    try {
      // IMPORTANT: Open panel FIRST while we still have user gesture context
      await chrome.sidePanel.open({ windowId: tab.windowId });
      console.log('📂 Side panel opened');

      // Extract page metadata
      const metadataResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPageMetadata
      });

      const metadata = metadataResults[0].result;
      console.log('📊 Extracted metadata:', metadata);

      // Prepare clip data with no text/html (bookmark mode)
      const clipData = {
        html: '',
        text: '',
        url: info.pageUrl,
        metadata: metadata,
        timestamp: Date.now()
      };

      // Save to storage as pending clip
      await chrome.storage.local.set({ pendingClipData: clipData });
      console.log('💾 Saved webpage bookmark to storage');

    } catch (error) {
      console.error('❌ Error capturing webpage:', error);
    }
  }

  // [NOT-29] Handle image capture
  if (info.menuItemId === 'capture-image') {
    console.log('🖼️  Capture image triggered');
    console.log('Image URL:', info.srcUrl);

    try {
      // IMPORTANT: Open panel FIRST while we still have user gesture context
      await chrome.sidePanel.open({ windowId: tab.windowId });
      console.log('📂 Side panel opened');

      // Fetch image as Base64 for offline persistence
      const imageData = await fetchImageAsBase64(info.srcUrl);
      console.log('📸 Image fetched as Base64, size:', imageData.length);

      // Extract page metadata
      const metadataResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPageMetadata
      });

      const metadata = metadataResults[0].result;
      console.log('📊 Extracted metadata:', metadata);

      // Prepare clip data for image
      const clipData = {
        type: 'image',
        imageData: imageData,
        url: info.pageUrl,
        metadata: metadata,
        timestamp: Date.now()
      };

      // Save to storage as pending clip
      await chrome.storage.local.set({ pendingClipData: clipData });
      console.log('💾 Saved image to storage');

    } catch (error) {
      console.error('❌ Error capturing image:', error);
    }
  }
});

// [NOT-20] Handle extension icon clicks - now captures HTML with preserved hyperlinks
chrome.action.onClicked.addListener(async (tab) => {
  console.log('🔘 Extension icon clicked');

  try {
    // IMPORTANT: Open panel FIRST while we still have user gesture context
    await chrome.sidePanel.open({ windowId: tab.windowId });
    console.log('📂 Side panel opened');

    // [NOT-20] Capture HTML selection
    const htmlResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: captureSelectionHtml
    });

    const capturedContent = htmlResults[0].result;

    if (capturedContent.text && capturedContent.text.trim()) {
      // Has selection - capture it
      console.log('📝 Has selection, capturing...');
      console.log('📝 Captured HTML length:', capturedContent.html.length);

      const metadataResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPageMetadata
      });

      const metadata = metadataResults[0].result;

      const clipData = {
        html: capturedContent.html,
        text: capturedContent.text,
        url: tab.url,
        metadata: metadata,
        timestamp: Date.now()
      };

      await chrome.storage.local.set({ pendingClipData: clipData });
      console.log('💾 Saved to storage');
    } else {
      console.log('📚 No selection, opening library');
      // No selection - just open library
      // Clear any pending data to ensure library mode
      await chrome.storage.local.remove('pendingClipData');
    }

  } catch (error) {
    console.error('❌ Error handling icon click:', error);
  }
});

// Handle keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'capture-text') {
    console.log('⌨️  Keyboard shortcut triggered');

    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab) {
      // Trigger the same flow as icon click
      chrome.action.onClicked.dispatch(tab);
    }
  }
});

// Listen for messages from the side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('📨 Message received:', message);

  if (message.action === 'close_panel') {
    // Fallback method to close panel if window.close() doesn't work
    console.log('🚪 Close panel requested');
    // Note: In Manifest V3, we can't force close the side panel programmatically
    // The panel.js should use window.close() which works in most cases
    sendResponse({ success: true });
  }

  if (message.action === 'log') {
    // Useful for debugging from panel
    console.log('📝 Panel log:', message.data);
    sendResponse({ success: true });
  }

  // [NOT-38] Handle INDEX_NOTE requests from panel
  if (message.action === 'INDEX_NOTE') {
    console.log('🔍 [NOT-38] INDEX_NOTE request received');

    if (!message.note) {
      console.error('❌ [NOT-38] No note provided in INDEX_NOTE message');
      sendResponse({ success: false, error: 'No note provided' });
      return true;
    }

    // Index the note asynchronously
    (async () => {
      try {
        await vectorService.addNoteToIndex(message.note);
        console.log('✅ [NOT-38] Note indexed successfully');
        sendResponse({ success: true });
      } catch (error) {
        console.error('❌ [NOT-38] Failed to index note:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();

    return true; // Keep message channel open for async response
  }

  // [NOT-38] Handle SEARCH_NOTES requests from panel
  if (message.action === 'SEARCH_NOTES') {
    console.log('🔍 [NOT-38] SEARCH_NOTES request received');

    if (!message.query) {
      console.error('❌ [NOT-38] No query provided in SEARCH_NOTES message');
      sendResponse({ success: false, error: 'No query provided' });
      return true;
    }

    // Search notes asynchronously
    (async () => {
      try {
        const searchResults = await vectorService.search(message.query, message.limit || 10);

        // Map results to expected format: { note, similarity }
        // vectorService returns { id, score, document }
        const formattedResults = searchResults.map(result => ({
          note: result.document, // The document contains the note fields
          similarity: result.score // Map score to similarity (0-1 range)
        }));

        console.log(`✅ [NOT-38] Search complete: ${formattedResults.length} results`);
        sendResponse({ success: true, results: formattedResults });
      } catch (error) {
        console.error('❌ [NOT-38] Search failed:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();

    return true; // Keep message channel open for async response
  }

  // [NOT-38] Handle REINDEX_ALL requests (for backfill)
  if (message.action === 'REINDEX_ALL') {
    console.log('🔄 [NOT-38] REINDEX_ALL request received');

    // Re-index all notes asynchronously
    (async () => {
      try {
        if (!message.allNotes) {
          sendResponse({ success: false, error: 'Please provide allNotes array' });
          return;
        }

        let indexedCount = 0;
        for (const note of message.allNotes) {
          try {
            await vectorService.addNoteToIndex(note);
            indexedCount++;
          } catch (error) {
            console.error(`❌ Failed to index note ${note.id}:`, error);
          }
        }

        console.log(`✅ [NOT-38] Re-index complete: ${indexedCount}/${message.allNotes.length} notes`);
        sendResponse({ success: true, indexedCount: indexedCount });
      } catch (error) {
        console.error('❌ [NOT-38] Re-index failed:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();

    return true; // Keep message channel open for async response
  }

  return true; // Keep message channel open for async response
});

/**
 * [NOT-20] Injected function to capture selection as HTML
 * Preserves hyperlinks and formatting by using DOM Range API instead of plain text
 * Uses XMLSerializer as specified for robust serialization
 * This runs in the context of the webpage
 */
function captureSelectionHtml() {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return { html: '', text: '' };
  }

  // Clone the selected content to preserve DOM structure
  const range = selection.getRangeAt(0);
  const clonedContent = range.cloneContents();

  // Use XMLSerializer for robust serialization (as per spec)
  const serializer = new XMLSerializer();

  // Create a temporary container to serialize the HTML
  const tempDiv = document.createElement('div');
  tempDiv.appendChild(clonedContent);

  // Serialize each child node and concatenate
  let htmlString = '';
  Array.from(tempDiv.childNodes).forEach(node => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      htmlString += serializer.serializeToString(node);
    } else if (node.nodeType === Node.TEXT_NODE) {
      // For text nodes, just use the text content
      htmlString += node.textContent;
    }
  });

  // Get plain text fallback
  const textString = selection.toString();

  return {
    html: htmlString,
    text: textString
  };
}



/**
 * [NOT-29] Fetch an image and convert it to Base64 for offline persistence
 * Uses fetch() to get the image data and converts it to a data URL
 *
 * @param {string} imageUrl - The URL of the image to fetch
 * @returns {Promise<string>} - Base64 data URL of the image
 */
async function fetchImageAsBase64(imageUrl) {
  try {
    // Fetch the image
    const response = await fetch(imageUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }

    // Get image as blob
    const blob = await response.blob();

    // Convert blob to Base64 using FileReader
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onloadend = () => {
        // reader.result contains the data URL (Base64)
        resolve(reader.result);
      };

      reader.onerror = () => {
        reject(new Error('Failed to convert image to Base64'));
      };

      reader.readAsDataURL(blob);
    });

  } catch (error) {
    console.error('❌ Error fetching image as Base64:', error);
    throw error;
  }
}
