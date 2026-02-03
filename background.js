// Background Service Worker for Knowledge Clipper
// Handles context menu, text capture, and side panel orchestration

// [NOT-27] Import shared utilities
importScripts('utils.js');

console.log('🚀 Knowledge Clipper background service worker started');

// Create context menu on installation
chrome.runtime.onInstalled.addListener(async () => {
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

// [NOT-27] extractPageMetadata moved to utils.js for shared use
