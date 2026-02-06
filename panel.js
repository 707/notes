// Knowledge Clipper - Side Panel Logic

/**
 * PANEL.JS - Main Orchestrator
 * 
 * [NAV] SECTIONS:
 * @STATE       - Global state & Persistence
 * @CORE_UTILS  - Sanitization, Dates, & UI Helpers
 * @ROUTING     - Navigation & Mode Switching
 * @CAPTURE     - Saving notes & Multi-image logic
 * @LIBRARY     - List rendering, filtering, sorting
 * @AI          - Chat, Contextual Recall & Synthesis
 * @SETTINGS    - Config & API Keys
 * @INIT        - Global Event Listeners & Boot
 */

// [NOT-34] Debug flag - set to false for production
const DEBUG = true;
const log = DEBUG ? console.log.bind(console) : () => {};
const warn = DEBUG ? console.warn.bind(console) : () => {};
const error = console.error.bind(console); // Always log errors

log('📱 Panel script loaded');

// =============================================================================
// @STATE - Global Variables & Persistence
// =============================================================================

// State
let currentMode = null;
let previousMode = null; // [NOT-34] Track previous view for navigation after capture
let allNotes = [];
let filteredNotes = [];

// [NOT-40] Gemini Nano availability state
let geminiAvailable = false;

// [NOT-33] Edit Mode State
let isEditModeActive = false;
let editModeNoteId = null;
let editModeImages = [];

// [NOT-33] Web Capture State
let isWebCaptureListening = false;
let currentImages = [];

// [NOT-31] Filter & View State
let filterState = {
  search: '',
  sort: 'newest',
  tags: [],
  readLater: false,
  starred: false,
  contextFilter: null
};
let isExpandedAll = false;
let libraryListenersInitialized = false;

// [NOT-39] Contextual Recall State
let contextPillAnimated = false;
let contextMatchType = null;
let semanticMatches = [];

// [NOT-22] Global TagInput instance for Capture Mode
let captureTagInput = null;

// [NOT-40] Gemini Status Polling
let geminiStatusPollInterval = null;

// Load persisted filter state
async function loadFilterState() {
  try {
    const metadata = await window.database.db.metadata.get('filterState');
    if (metadata && metadata.value) {
      filterState = metadata.value;
      // [NOT-31] Always reset context filter on load (page-specific, shouldn't persist)
      filterState.contextFilter = null;
      // [NOT-35] Ensure starred property exists (for backward compatibility)
      if (filterState.starred === undefined) {
        filterState.starred = false;
      }
      log('📂 Loaded persisted filter state:', filterState);
    }
  } catch (error) {
    error('❌ Error loading filter state:', error);
  }
}

// Save filter state
async function saveFilterState() {
  try {
    await window.database.db.metadata.put({ key: 'filterState', value: filterState });
  } catch (error) {
    error('❌ Error saving filter state:', error);
  }
}

// =============================================================================
// @CORE_UTILS - Sanitization, Helpers, & Date Formatting
// =============================================================================

/**
 * [NOT-20] Sanitize HTML content using native DOMParser
 * Only allows safe elements: text, links, and basic formatting
 * Strips all scripts, styles, and potentially dangerous content
 *
 * @param {string} htmlString - The raw HTML string to sanitize
 * @returns {string} - Safe HTML string ready for innerHTML
 */
function sanitizeHtml(htmlString) {
  if (!htmlString) return '';

  // Create a temporary DOM to parse and filter the HTML
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');

  // Allowlist of safe elements
  const allowedTags = ['a', 'b', 'i', 'strong', 'em', 'br', 'p', 'span'];

  // Recursively clean the DOM tree
  function cleanNode(node) {
    const nodeName = node.nodeName.toLowerCase();

    // Text nodes are always safe
    if (node.nodeType === Node.TEXT_NODE) {
      return node.cloneNode(true);
    }

    // Element nodes must be in allowlist
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (!allowedTags.includes(nodeName)) {
        // Not allowed - but preserve text content of children
        const fragment = document.createDocumentFragment();
        Array.from(node.childNodes).forEach(child => {
          const cleanedChild = cleanNode(child);
          if (cleanedChild) {
            fragment.appendChild(cleanedChild);
          }
        });
        return fragment;
      }

      // Create clean element
      const cleanElement = document.createElement(nodeName);

      // Handle attributes based on element type
      if (nodeName === 'a') {
        // For links, only allow href and force target="_blank" for safety
        const href = node.getAttribute('href');
        if (href) {
          // [NOT-20] Validate href using URL constructor to prevent XSS bypasses
          try {
            const url = new URL(href.trim(), window.location.origin);
            const protocol = url.protocol.toLowerCase();

            // Only allow http, https, and relative URLs
            if (protocol === 'http:' || protocol === 'https:') {
              cleanElement.setAttribute('href', href.trim());
              cleanElement.setAttribute('target', '_blank');
              cleanElement.setAttribute('rel', 'noopener noreferrer');
            }
          } catch (e) {
            // Invalid URL or dangerous protocol - skip this link but preserve text
            // Link element will be created but without href, so it will be stripped
            // and text preserved by the fragment logic
          }
        }
      }
      // All other allowed tags have no attributes

      // Recursively clean children
      Array.from(node.childNodes).forEach(child => {
        const cleanedChild = cleanNode(child);
        if (cleanedChild) {
          cleanElement.appendChild(cleanedChild);
        }
      });

      return cleanElement;
    }

    // Skip all other node types (comments, etc.)
    return null;
  }

  // Clean the body content
  const cleanFragment = document.createDocumentFragment();
  Array.from(doc.body.childNodes).forEach(child => {
    const cleanedChild = cleanNode(child);
    if (cleanedChild) {
      cleanFragment.appendChild(cleanedChild);
    }
  });

  // Convert back to HTML string
  const tempDiv = document.createElement('div');
  tempDiv.appendChild(cleanFragment);
  return tempDiv.innerHTML;
}

/**
 * [NOT-20] Enhance HTML with Smart Chips for rich media links
 * Detects YouTube and Twitter/X URLs (both as links and plain text) and applies special styling
 * Auto-links plain text URLs that match rich media patterns
 *
 * @param {string} htmlString - The sanitized HTML string
 * @returns {string} - Enhanced HTML with smart-chip classes
 */
function enhanceRichMedia(htmlString) {
  if (!htmlString) return '';

  // Parse the HTML
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlString;

  // Step 1: Auto-link plain text URLs for YouTube and Twitter
  // Improved regex patterns that avoid trailing punctuation and cover more URL formats
  // Non-capturing group at end prevents capturing trailing punctuation
  const youtubePattern = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|v\/)|youtu\.be\/)[\w-]+(?:[?&][\w=&-]*)?(?=[.,;:!?\s)]|$)/gi;
  const twitterPattern = /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/[\w]+\/status\/\d+(?=[.,;:!?\s)]|$)/gi;

  // Process text nodes to auto-link URLs
  function processTextNodes(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      let text = node.textContent;

      // Find all matches (both YouTube and Twitter) with their positions
      const matches = [];

      // Find YouTube matches
      youtubePattern.lastIndex = 0;
      let match;
      while ((match = youtubePattern.exec(text)) !== null) {
        matches.push({
          index: match.index,
          length: match[0].length,
          url: match[0],
          type: 'youtube'
        });
      }

      // Find Twitter matches
      twitterPattern.lastIndex = 0;
      while ((match = twitterPattern.exec(text)) !== null) {
        matches.push({
          index: match.index,
          length: match[0].length,
          url: match[0],
          type: 'twitter'
        });
      }

      // If we found any matches, process them
      if (matches.length > 0) {
        // Sort matches by position
        matches.sort((a, b) => a.index - b.index);

        const fragment = document.createDocumentFragment();
        let lastIndex = 0;

        matches.forEach(matchInfo => {
          // Add text before this match
          if (matchInfo.index > lastIndex) {
            fragment.appendChild(document.createTextNode(text.substring(lastIndex, matchInfo.index)));
          }

          // Create link for this match
          const link = document.createElement('a');
          let url = matchInfo.url;

          // Ensure URL has protocol
          if (!url.match(/^https?:\/\//i)) {
            url = 'https://' + url;
          }

          link.href = url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';

          // [NOT-26] Set pill text instead of URL
          if (matchInfo.type === 'youtube') {
            link.textContent = '(YouTube Link)';
            link.classList.add('smart-chip', 'smart-chip-youtube');
            link.setAttribute('data-media-type', 'youtube');
          } else if (matchInfo.type === 'twitter') {
            link.textContent = '(X Link)';
            link.classList.add('smart-chip', 'smart-chip-twitter');
            link.setAttribute('data-media-type', 'twitter');
          } else {
            link.textContent = matchInfo.url;
          }

          fragment.appendChild(link);
          lastIndex = matchInfo.index + matchInfo.length;
        });

        // Add remaining text
        if (lastIndex < text.length) {
          fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
        }

        // Replace text node with fragment
        if (node.parentNode) {
          node.parentNode.replaceChild(fragment, node);
        }
      }
    } else if (node.nodeType === Node.ELEMENT_NODE && node.nodeName !== 'A') {
      // Don't process text inside existing links
      Array.from(node.childNodes).forEach(child => processTextNodes(child));
    }
  }

  // Process all text nodes to auto-link URLs
  processTextNodes(tempDiv);

  // Step 2: Enhance existing links that weren't auto-linked
  const links = tempDiv.querySelectorAll('a[href]');

  links.forEach(link => {
    // Skip if already has smart-chip class (was auto-linked above)
    if (link.classList.contains('smart-chip')) {
      return;
    }

    const href = link.getAttribute('href');
    if (!href) return;

    // [NOT-26] Detect YouTube links and set pill text
    if (href.match(/(?:youtube\.com\/(?:watch|shorts|embed|v)|youtu\.be\/)/i)) {
      link.textContent = '(YouTube Link)';
      link.classList.add('smart-chip', 'smart-chip-youtube');
      link.setAttribute('data-media-type', 'youtube');
    }

    // [NOT-26] Detect Twitter/X links and set pill text
    if (href.match(/(?:twitter\.com\/.*\/status|x\.com\/.*\/status)/i)) {
      link.textContent = '(X Link)';
      link.classList.add('smart-chip', 'smart-chip-twitter');
      link.setAttribute('data-media-type', 'twitter');
    }
  });

  return tempDiv.innerHTML;
}

/**
 * [NOT-38] Check if vector index needs initialization and trigger backfill if needed
 * Runs on first panel load to ensure all existing notes are indexed
 * @returns {Promise<void>}
 */
async function checkAndReindexIfNeeded() {
  try {
    // Check if vector index has been initialized
    const { vectorIndexInitialized } = await chrome.storage.local.get('vectorIndexInitialized');

    if (!vectorIndexInitialized) {
      log('🔄 [NOT-38] First run detected, starting vector index backfill...');

      // Get all notes from database
      const allNotes = await window.database.getAllNotes();

      if (allNotes.length > 0) {
        log(`📊 [NOT-38] Indexing ${allNotes.length} existing notes...`);

        // [NOT-38] Open keep-alive port to prevent SW timeout during long re-indexing
        const keepAlivePort = chrome.runtime.connect({ name: 'keepalive' });
        log('🔌 [NOT-38] Keep-alive port opened for re-indexing');

        // Send all notes to background for indexing
        try {
          const response = await chrome.runtime.sendMessage({
            action: 'REINDEX_ALL',
            allNotes: allNotes
          });

          if (response.success) {
            log(`✅ [NOT-38] Backfill complete: ${response.indexedCount} notes indexed`);
            // Mark as initialized
            await chrome.storage.local.set({ vectorIndexInitialized: true });
          } else {
            warn('⚠️  [NOT-38] Backfill failed:', response.error);
          }
        } catch (error) {
          warn('⚠️  [NOT-38] Failed to send reindex request:', error);
        } finally {
          // Close keep-alive port
          keepAlivePort.disconnect();
          log('🔌 [NOT-38] Keep-alive port closed');
        }
      } else {
        log('📭 [NOT-38] No notes to index, marking as initialized');
        await chrome.storage.local.set({ vectorIndexInitialized: true });
      }
    } else {
      log('✅ [NOT-38] Vector index already initialized');
    }
  } catch (error) {
    error('❌ [NOT-38] Error during reindex check:', error);
    // Don't block panel loading if this fails
  }
}

/**
 * [NOT-38] Manually trigger a full re-index of all notes
 * Useful for debugging or after major changes
 * Can be called from browser console: window.reindexAllNotes()
 * @returns {Promise<void>}
 */
async function reindexAllNotes() {
  try {
    console.log('🔄 [NOT-38] Manual re-index triggered...');

    const allNotes = await window.database.getAllNotes();
    console.log(`📊 [NOT-38] Re-indexing ${allNotes.length} notes...`);

    // [NOT-38] Open keep-alive port to prevent SW timeout
    const keepAlivePort = chrome.runtime.connect({ name: 'keepalive' });
    console.log('🔌 [NOT-38] Keep-alive port opened for re-indexing');

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'REINDEX_ALL',
        allNotes: allNotes
      });

      if (response.success) {
        console.log(`✅ [NOT-38] Re-index complete: ${response.indexedCount}/${allNotes.length} notes indexed`);
        // Reset the initialized flag to force re-check
        await chrome.storage.local.set({ vectorIndexInitialized: true });
      } else {
        console.error('❌ [NOT-38] Re-index failed:', response.error);
      }
    } catch (error) {
      console.error('❌ [NOT-38] Error during manual re-index:', error);
    } finally {
      // Close keep-alive port
      keepAlivePort.disconnect();
      console.log('🔌 [NOT-38] Keep-alive port closed');
    }
  } catch (error) {
    console.error('❌ [NOT-38] Error during manual re-index:', error);
  }
}

// [NOT-38] Expose reindex function for manual use
window.reindexAllNotes = reindexAllNotes;

// =============================================================================
// @ROUTING - Navigation & Mode Switching
// =============================================================================

/**
 * [NOT-31] [NOT-39] Check for Contextual Recall - show pill if notes exist for current page
 * Upgraded to include semantic matches via vector search
 * Optimized single-pass algorithm to count exact and domain matches
 * @returns {Promise<void>}
 */
async function checkContextualRecall() {
  try {
    // Get current tab URL and title
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;

    const currentUrl = tab.url;
    const currentTitle = tab.title || '';

    // Extract domain from current URL
    let currentDomain = '';
    try {
      const url = new URL(currentUrl);
      currentDomain = url.hostname;
    } catch (e) {
      return; // Invalid URL, silently exit
    }

    // Single-pass counting for exact and domain matches (optimized for large libraries)
    let exactCount = 0;
    let domainCount = 0;
    const exactNoteIds = new Set(); // Track exact match IDs to filter from semantic results

    for (const note of allNotes) {
      if (!note.url) continue;

      // Check exact match first
      if (note.url === currentUrl) {
        exactCount++;
        exactNoteIds.add(note.id);
        continue; // Skip domain check if exact match found
      }

      // Extract domain only if needed (lazy evaluation)
      try {
        const noteUrl = new URL(note.url);
        if (noteUrl.hostname === currentDomain) {
          domainCount++;
        }
      } catch (e) {
        // Invalid URL in note, skip it
      }
    }

    // [NOT-39] Query vector service for semantic matches
    let semanticCount = 0;
    semanticMatches = []; // Reset semantic matches

    try {
      log(`🔍 [NOT-39] Requesting semantic search for: "${currentTitle}"`);
      const response = await chrome.runtime.sendMessage({
        action: 'SEARCH_NOTES',
        query: currentTitle,
        limit: 20 // Get more results to account for filtering
      });

      if (response && response.success && response.results) {
        // [NOT-39] Get ignored connections for this context
        const ignoredNoteIds = await window.database.getIgnoredConnectionsForContext(currentUrl);
        const ignoredSet = new Set(ignoredNoteIds);

        const rawCount = response.results.length;

        // Filter results: similarity > 0.2 (Orama hybrid scores are typically lower than pure cosine)
        // Top results from semantic search are relevant even with lower scores
        semanticMatches = response.results
          .filter(result =>
            result.similarity > 0.2 &&
            !exactNoteIds.has(result.note.id) &&
            !ignoredSet.has(result.note.id)
          )
          .slice(0, 5); // Limit to top 5 semantic matches

        semanticCount = semanticMatches.length;
        log(`🔍 [NOT-39] Search complete. Raw: ${rawCount}, Filtered: ${semanticCount}. (Exact matches excluded: ${exactNoteIds.size})`);

        // Log similarity scores for debugging
        if (semanticMatches.length > 0) {
          log(`📊 [NOT-39] Top similarity scores: ${semanticMatches.map(m => m.similarity.toFixed(3)).join(', ')}`);
        }
      } else {
        warn('⚠️ [NOT-39] Semantic search response invalid:', response);
      }
    } catch (error) {
      warn('[NOT-39] Semantic search failed:', error);
      // Continue with exact/domain matches even if semantic search fails
    }

    const pillElement = document.getElementById('context-pill');
    const pillText = pillElement?.querySelector('.pill-text');
    if (!pillElement || !pillText) return;

    // [NOT-39] Display logic: handle exact, semantic, and hybrid states
    if (exactCount > 0 && semanticCount > 0) {
      // Hybrid state: both exact and semantic matches
      contextMatchType = 'hybrid';
      pillText.textContent = `${exactCount} Note${exactCount === 1 ? '' : 's'} + ${semanticCount} Related`;
      showPillWithAnimation(pillElement, 'hybrid');
    } else if (exactCount > 0) {
      // Exact matches only
      contextMatchType = 'exact';
      pillText.textContent = `${exactCount} Note${exactCount === 1 ? '' : 's'} Here`;
      showPillWithAnimation(pillElement, 'exact');
    } else if (semanticCount > 0) {
      // Semantic matches only
      contextMatchType = 'semantic';
      pillText.textContent = `Related: ${semanticCount} Note${semanticCount === 1 ? '' : 's'}`;
      showPillWithAnimation(pillElement, 'pulse');
    } else if (domainCount > 0) {
      // Domain matches (fallback)
      contextMatchType = 'domain';
      pillText.textContent = `${domainCount} Note${domainCount === 1 ? '' : 's'} on Site`;
      showPillWithAnimation(pillElement, 'exact');
    } else {
      // No matches
      pillElement.classList.add('hidden');
      contextMatchType = null;
      semanticMatches = [];
    }
  } catch (error) {
    error('[NOT-31] [NOT-39] Error in checkContextualRecall:', error);
  }
}

/**
 * [NOT-31] [NOT-39] [NOT-48] Helper to show pill with one-time animation and appropriate state
 * @param {HTMLElement} pillElement - The pill element
 * @param {string} state - The state class to apply: 'pulse', 'hybrid', or 'exact'
 */
function showPillWithAnimation(pillElement, state = 'exact') {
  pillElement.classList.remove('hidden');

  // [NOT-48] Preserve active class if it was already present
  const wasActive = pillElement.classList.contains('active');

  // [NOT-39] Remove all state classes first
  pillElement.classList.remove('pulse', 'hybrid', 'active');

  // [NOT-39] Apply the appropriate state class and icon
  const iconUse = pillElement.querySelector('.icon use');
  if (state === 'pulse') {
    pillElement.classList.add('pulse');
    if (iconUse) iconUse.setAttribute('href', '#icon-file-text');
  } else if (state === 'hybrid') {
    pillElement.classList.add('hybrid');
    if (iconUse) iconUse.setAttribute('href', '#icon-sparkle'); // Sparkle icon for hybrid state
  } else {
    // exact or domain state
    if (iconUse) iconUse.setAttribute('href', '#icon-file-text');
  }

  // [NOT-48] Restore active class to maintain hybrid view state
  if (wasActive) {
    pillElement.classList.add('active');
  }

  // One-time entrance animation
  if (!contextPillAnimated) {
    pillElement.classList.add('animate');
    contextPillAnimated = true;
    setTimeout(() => pillElement.classList.remove('animate'), 300);
  }
}

/**
 * [NOT-34] Navigate to a specific view and update header button states
 * @param {string} viewId - The view to navigate to (library-mode, ai-chat-mode, settings-mode, capture-mode)
 */
function navigateToView(viewId) {
  // Hide all views
  const views = ['library-mode', 'ai-chat-mode', 'settings-mode', 'capture-mode'];
  views.forEach(view => {
    const element = document.getElementById(view);
    if (element) element.classList.add('hidden');
  });

  // Show target view
  const targetView = document.getElementById(viewId);
  if (targetView) targetView.classList.remove('hidden');

  // Update button active states (only for non-capture modes)
  if (viewId !== 'capture-mode') {
    const buttons = {
      'library-mode': 'library-button',
      'ai-chat-mode': 'ai-button',
      'settings-mode': 'settings-button'
    };

    // Remove active from all navigation buttons
    Object.values(buttons).forEach(buttonId => {
      const button = document.getElementById(buttonId);
      if (button) button.classList.remove('active');
    });

    // Add active to current view's button
    const activeButtonId = buttons[viewId];
    if (activeButtonId) {
      const activeButton = document.getElementById(activeButtonId);
      if (activeButton) activeButton.classList.add('active');
    }

    // Show navigation buttons, hide back button
    const menuLeft = document.querySelector('.menu-left');
    const menuRight = document.querySelector('.menu-right');
    const backButton = document.getElementById('back-button');
    if (menuLeft) menuLeft.classList.remove('hidden');
    if (menuRight) menuRight.classList.remove('hidden');
    if (backButton) backButton.classList.add('hidden');
  }
}

/**
 * [NOT-31] [NOT-34] [NOT-39] Handle context pill click - toggle contextual recall filter or show hybrid view
 * When activating: navigates to library (if needed), filters notes and auto-expands them
 * For semantic/hybrid states: renders special hybrid view with sections
 * When deactivating: clears the filter
 */
async function handleContextPillClick() {
  try {
    const pillElement = document.getElementById('context-pill');

    // [NOT-34] If not in library mode, navigate to library first
    if (currentMode !== 'library') {
      // Set up the filter before navigating
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) return;

      const currentUrl = tab.url;

      // [NOT-39] For semantic/hybrid states, just navigate and render hybrid view
      if (contextMatchType === 'semantic' || contextMatchType === 'hybrid') {
        pillElement?.classList.add('active');
        await renderLibraryMode();
        // Hybrid view will be rendered automatically by renderNotesList
        return;
      }

      // Set filter based on match type for exact/domain
      if (contextMatchType === 'exact') {
        filterState.contextFilter = currentUrl;
      } else if (contextMatchType === 'domain') {
        const url = new URL(currentUrl);
        filterState.contextFilter = url.hostname;
      }

      pillElement?.classList.add('active');

      // Navigate to library with filter active
      await renderLibraryMode();

      // Auto-expand after navigation
      setTimeout(() => setAllNotesExpanded(true), 0);

      await saveFilterState();
      return;
    }

    // [NOT-41] Toggle filter state (when already in library)
    // Check DOM active class instead of match type to determine if pill is active
    if (pillElement?.classList.contains('active')) {
      // Deactivate filter
      filterState.contextFilter = null;
      pillElement?.classList.remove('active');
      setAllNotesExpanded(false);
    } else {
      // Activate filter
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) return;

      const currentUrl = tab.url;

      // [NOT-39] For semantic/hybrid states, set active and render hybrid view
      if (contextMatchType === 'semantic' || contextMatchType === 'hybrid') {
        pillElement?.classList.add('active');
        // Hybrid view will be rendered automatically by renderNotesList
        filterAndRenderNotes();
        return;
      }

      // Set filter based on match type for exact/domain
      if (contextMatchType === 'exact') {
        filterState.contextFilter = currentUrl;
      } else if (contextMatchType === 'domain') {
        const url = new URL(currentUrl);
        filterState.contextFilter = url.hostname;
      }

      pillElement?.classList.add('active');

      // [NOT-36] Auto-expand notes when activating context filter
      setAllNotesExpanded(true);
    }

    // Apply filter and re-render
    filterAndRenderNotes();

    // Auto-expand all notes after rendering if filter is active
    if (filterState.contextFilter) {
      setTimeout(() => setAllNotesExpanded(true), 0);
    }

    // Save filter state
    await saveFilterState();
  } catch (error) {
    error('[NOT-31] [NOT-39] Error handling context pill click:', error);
  }
}

// =============================================================================
// @CAPTURE - Saving notes & Multi-image logic
// =============================================================================



/**
 * [NOT-33] Handle file upload for multi-image support
 * Reads files via FileReader, enforces 5-image limit, and adds to current images array
 *
 * @param {FileList} files - The files selected by the user
 * @param {boolean} isEditMode - Whether we're in edit mode (use editModeImages instead of currentImages)
 */
function handleFileUpload(files, isEditMode = false) {
  const imagesArray = isEditMode ? editModeImages : currentImages;
  log(`📤 [NOT-33] Uploading ${files.length} images... (Edit mode: ${isEditMode})`);

  // [NOT-33] Enforce 5-image limit
  const remainingSlots = 5 - imagesArray.length;

  if (remainingSlots <= 0) {
    alert('Maximum of 5 images per note. Please remove some images before adding more.');
    return;
  }

  const filesToProcess = Array.from(files).slice(0, remainingSlots);

  if (files.length > remainingSlots) {
    alert(`Only ${remainingSlots} image${remainingSlots === 1 ? '' : 's'} can be added (5 image limit).`);
  }

  // Process each file
  filesToProcess.forEach(file => {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      warn('⚠️  Skipping non-image file:', file.name);
      return;
    }

    // Use FileReader to convert to Base64
    const reader = new FileReader();

    reader.onload = (e) => {
      const imageData = e.target.result;

      // Add to images array
      const imageObject = {
        id: crypto.randomUUID(),
        data: imageData,
        timestamp: Date.now()
      };

      imagesArray.push(imageObject);
      log(`✅ [NOT-33] Image added: ${file.name}`);

      // Re-render preview list
      if (isEditMode) {
        // Find the card element being edited
        const cardElement = document.querySelector('.note-card.editing');
        if (cardElement) {
          renderEditModeImageGallery(cardElement, editModeImages);
        }
      } else {
        renderImagePreviews('capture-image-preview-list', currentImages, false);
      }
    };

    reader.onerror = (error) => {
      error('❌ Error reading file:', error);
      alert(`Failed to load image: ${file.name}`);
    };

    reader.readAsDataURL(file);
  });
}

/**
 * [NOT-36] Dedicated storage listener for web capture mode
 * Handles pendingClipData changes when in listening mode
 * Supports both Create and Edit modes
 */
function handleWebCaptureStorageChange(changes, area) {
  if (area !== 'local' || !changes.pendingClipData || !changes.pendingClipData.newValue) {
    return;
  }

  const newClipData = changes.pendingClipData.newValue;

  // Only handle if we're in web capture listening mode and it's an image
  if (isWebCaptureListening && newClipData.type === 'image' && newClipData.imageData) {
    log(`🖼️  [NOT-36] Web capture image received, appending to ${isEditModeActive ? 'edit mode' : 'capture mode'} note...`);

    // Add the captured image to the correct array based on mode
    const imageObject = {
      id: crypto.randomUUID(),
      data: newClipData.imageData,
      timestamp: Date.now()
    };

    if (isEditModeActive) {
      // Edit mode - append to editModeImages
      editModeImages.push(imageObject);

      // Enforce 5-image limit
      if (editModeImages.length >= 5) {
        log('⚠️  [NOT-36] Reached 5-image limit, deactivating listening mode');
        isWebCaptureListening = false;

        const captureButton = document.getElementById('edit-capture-webpage-image-button');
        if (captureButton) {
          captureButton.classList.remove('active');
          const buttonSpan = captureButton.querySelector('span');
          if (buttonSpan) {
            buttonSpan.textContent = 'Capture from Webpage';
          }
          captureButton.setAttribute('title', 'Capture image from webpage');
        }

        // Remove listener when deactivating
        chrome.storage.onChanged.removeListener(handleWebCaptureStorageChange);
      }

      // Re-render edit mode gallery
      const cardElement = document.querySelector('.note-card.editing');
      if (cardElement) {
        renderEditModeImageGallery(cardElement, editModeImages);
      }
    } else {
      // Capture mode - append to currentImages
      currentImages.push(imageObject);

      // Enforce 5-image limit
      if (currentImages.length >= 5) {
        log('⚠️  [NOT-36] Reached 5-image limit, deactivating listening mode');
        isWebCaptureListening = false;

        const captureButton = document.getElementById('capture-webpage-image-button');
        if (captureButton) {
          captureButton.classList.remove('active');
          const buttonSpan = captureButton.querySelector('span');
          if (buttonSpan) {
            buttonSpan.textContent = 'Capture from Webpage';
          }
          captureButton.setAttribute('title', 'Capture image from webpage');
        }

        // Remove listener when deactivating
        chrome.storage.onChanged.removeListener(handleWebCaptureStorageChange);
      }

      // Re-render capture mode preview list
      renderImagePreviews('capture-image-preview-list', currentImages, false);
    }

    // Clear the pending clip data so it doesn't trigger a new note
    chrome.storage.local.remove('pendingClipData');
  }
}

/**
 * [NOT-33] Activate web capture mode - listen for right-click image capture
 * Toggles UI state to indicate "Listening..." mode
 * Works for both capture mode and edit mode
 */
function activateWebCaptureMode(buttonId = 'capture-webpage-image-button') {
  log('👂 [NOT-33] Activating web capture listening mode...');

  const captureButton = document.getElementById(buttonId);

  if (!captureButton) {
    warn('⚠️  [NOT-33] Capture button not found:', buttonId);
    return;
  }

  // [NOT-33] Check 5-image limit before activating (use correct array based on mode)
  const imagesArray = isEditModeActive ? editModeImages : currentImages;

  if (!isWebCaptureListening && imagesArray.length >= 5) {
    alert('Maximum of 5 images per note. Please remove some images before capturing more.');
    return;
  }

  // Toggle listening state
  isWebCaptureListening = !isWebCaptureListening;

  if (isWebCaptureListening) {
    // [NOT-36] Add dedicated storage listener when activating
    chrome.storage.onChanged.addListener(handleWebCaptureStorageChange);

    // Update button to show "Listening..." state
    captureButton.classList.add('active');
    const buttonSpan = captureButton.querySelector('span');
    if (buttonSpan) {
      buttonSpan.textContent = 'Right-click any image on page to capture';
    }
    captureButton.setAttribute('title', 'Cancel listening mode');
    log(`✅ [NOT-36] Listening for webpage image capture (${isEditModeActive ? 'Edit' : 'Capture'} mode)...`);
  } else {
    // [NOT-36] Remove dedicated storage listener when deactivating
    chrome.storage.onChanged.removeListener(handleWebCaptureStorageChange);

    // Deactivate listening mode
    captureButton.classList.remove('active');
    const buttonSpan = captureButton.querySelector('span');
    if (buttonSpan) {
      buttonSpan.textContent = 'Capture from Webpage';
    }
    captureButton.setAttribute('title', 'Capture image from webpage');
    log('⏹️  [NOT-36] Stopped listening for webpage image capture');
  }
}

/**
 * [NOT-33] Render image gallery in the thumbnail area for edit mode
 * Converts the single thumbnail into a horizontal scrollable gallery with delete buttons
 *
 * @param {HTMLElement} cardElement - The note card element
 * @param {Array<Object>} images - Array of image objects to render
 */
function renderEditModeImageGallery(cardElement, images) {
  const thumbnailContainer = cardElement.querySelector('.note-thumbnail');

  if (!thumbnailContainer) {
    warn('⚠️  [NOT-33] Thumbnail container not found');
    return;
  }

  // Clear existing content
  thumbnailContainer.innerHTML = '';

  if (images.length === 0) {
    thumbnailContainer.classList.add('hidden');
    return;
  }

  // Show container and convert to gallery mode
  thumbnailContainer.classList.remove('hidden');
  thumbnailContainer.classList.add('edit-mode-gallery');

  // Render each image with delete button
  images.forEach((image, index) => {
    const imgWrapper = document.createElement('div');
    imgWrapper.className = 'edit-gallery-item';

    const img = document.createElement('img');
    img.src = image.data;
    img.alt = `Image ${index + 1}`;

    // Click to open lightbox
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      openLightbox(images, index);
    });

    const deleteButton = document.createElement('button');
    deleteButton.className = 'edit-gallery-delete';
    deleteButton.type = 'button';
    deleteButton.title = 'Remove image';
    deleteButton.setAttribute('aria-label', 'Remove image');

    const deleteIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    deleteIcon.classList.add('icon', 'icon-sm');
    const deleteUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    deleteUse.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#icon-x');
    deleteIcon.appendChild(deleteUse);
    deleteButton.appendChild(deleteIcon);

    // Delete handler
    deleteButton.addEventListener('click', (e) => {
      e.stopPropagation();
      log(`🗑️  [NOT-33] Removing image ${index + 1} from gallery`);
      images.splice(index, 1);
      renderEditModeImageGallery(cardElement, images);
    });

    imgWrapper.appendChild(img);
    imgWrapper.appendChild(deleteButton);
    thumbnailContainer.appendChild(imgWrapper);
  });

  log(`🖼️  [NOT-33] Rendered ${images.length} image(s) in edit mode gallery`);
}

/**
 * [NOT-33] Render image preview thumbnails
 * Shows all images with delete buttons in edit mode
 *
 * @param {string} containerId - The ID of the preview list container
 * @param {Array<Object>} images - Array of image objects to render
 * @param {boolean} isEditMode - Whether we're in edit mode (shows delete buttons)
 */
function renderImagePreviews(containerId, images, isEditMode = false) {
  const previewList = document.getElementById(containerId);

  if (!previewList) {
    warn(`⚠️  [NOT-33] Image preview list container not found: ${containerId}`);
    return;
  }

  // Clear existing previews
  previewList.innerHTML = '';

  if (images.length === 0) {
    previewList.classList.add('hidden');
    return;
  }

  // Show container
  previewList.classList.remove('hidden');

  // Render each image thumbnail
  images.forEach((image, index) => {
    const thumbnailContainer = document.createElement('div');
    thumbnailContainer.className = 'image-preview-item';

    const img = document.createElement('img');
    img.src = image.data;
    img.alt = `Image ${index + 1}`;
    img.className = 'image-preview-thumbnail';

    // Add click listener to open lightbox
    img.addEventListener('click', () => {
      openLightbox(images, index);
    });

    thumbnailContainer.appendChild(img);

    // [NOT-33] Add delete button in edit mode
    if (isEditMode) {
      const deleteButton = document.createElement('button');
      deleteButton.className = 'image-preview-delete';
      deleteButton.type = 'button';
      deleteButton.title = 'Remove image';
      deleteButton.setAttribute('aria-label', 'Remove image');

      const deleteIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      deleteIcon.classList.add('icon', 'icon-sm');
      const deleteUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      deleteUse.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#icon-x');
      deleteIcon.appendChild(deleteUse);
      deleteButton.appendChild(deleteIcon);

      // Delete button handler
      deleteButton.addEventListener('click', (e) => {
        e.stopPropagation();
        log(`🗑️  [NOT-33] Removing image ${index + 1}`);
        images.splice(index, 1);
        renderImagePreviews(containerId, images, isEditMode);
      });

      thumbnailContainer.appendChild(deleteButton);
    }

    previewList.appendChild(thumbnailContainer);
  });

  log(`🖼️  [NOT-33] Rendered ${images.length} image preview(s) in ${containerId}`);
}



/**
 * [NOT-22] TagInput Component - Pill-based tag input with autocomplete
 * Creates an interactive tag input with pills for existing tags and autocomplete
 */
class TagInput {
  constructor(containerElement, initialTags = [], onChangeCallback = null) {
    this.container = containerElement;
    this.tags = initialTags.map(tag => tag.startsWith('#') ? tag.substring(1) : tag);
    this.onChange = onChangeCallback;
    this.inputValue = '';
    this.suggestions = [];
    this.selectedIndex = -1;
    this.localSuggestions = []; // [NOT-58] Tags from vector search (Tier 1)

    // [NOT-22] Create wrapper for input and suggestions
    this.wrapper = document.createElement('div');
    this.container.appendChild(this.wrapper);

    this.render();
  }

  /**
   * [NOT-58] Set local tag suggestions from vector search
   * These are rendered as "ghost chips" with dashed blue borders
   *
   * @param {Array<string>} suggestions - Array of tag names (without # prefix)
   */
  setLocalSuggestions(suggestions) {
    this.localSuggestions = suggestions.filter(tag => {
      const lowerTag = tag.toLowerCase();
      return !this.tags.some(t => t.toLowerCase() === lowerTag);
    });
    this.renderTagSuggestions();
  }

  /**
   * Get all unique tags from all notes for autocomplete
   */
  getAllExistingTags() {
    const uniqueTags = new Set();
    allNotes.forEach(note => {
      note.tags.forEach(tag => {
        const cleanTag = tag.startsWith('#') ? tag.substring(1) : tag;
        uniqueTags.add(cleanTag);
      });
    });
    return Array.from(uniqueTags).sort();
  }

  /**
   * Render the tag input component
   */
  render() {
    // Clear wrapper
    this.wrapper.innerHTML = '';

    // Create input container
    const inputContainer = document.createElement('div');
    inputContainer.className = 'tag-input-container';
    this.inputContainer = inputContainer;

    // Render existing tag pills
    this.tags.forEach((tag, index) => {
      const pill = this.createPill(tag, index);
      inputContainer.appendChild(pill);
    });

    // Create and append input field
    this.inputField = document.createElement('input');
    this.inputField.type = 'text';
    this.inputField.className = 'tag-input-field';
    this.inputField.placeholder = this.tags.length === 0 ? 'Type tags and press Enter or comma...' : 'Add more...';
    this.inputField.value = this.inputValue;

    inputContainer.appendChild(this.inputField);

    // Create dropdown (hidden by default)
    this.dropdown = document.createElement('div');
    this.dropdown.className = 'tag-dropdown hidden';
    inputContainer.appendChild(this.dropdown);

    // Add input container to wrapper
    this.wrapper.appendChild(inputContainer);

    // Attach event listeners
    this.attachEventListeners();

    // Focus container makes input clickable
    inputContainer.addEventListener('click', () => {
      this.inputField.focus();
    });

    // [NOT-22] Render tag suggestions (recent tags)
    this.renderTagSuggestions();
  }

  /**
   * Create a tag pill element
   */
  createPill(tag, index) {
    const pill = document.createElement('div');
    pill.className = 'tag-pill';

    const label = document.createElement('span');
    label.textContent = tag;

    const removeBtn = document.createElement('span');
    removeBtn.className = 'tag-pill-remove';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.removeTag(index);
    });

    pill.appendChild(label);
    pill.appendChild(removeBtn);

    return pill;
  }

  /**
   * Attach event listeners to input field
   */
  attachEventListeners() {
    this.inputField.addEventListener('input', (e) => {
      this.inputValue = e.target.value;
      this.updateSuggestions();
    });

    this.inputField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        this.addTag();
      } else if (e.key === 'Backspace' && this.inputValue === '') {
        e.preventDefault();
        this.removeLastTag();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.navigateSuggestions(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.navigateSuggestions(-1);
      } else if (e.key === 'Escape') {
        this.hideSuggestions();
      }
    });

    this.inputField.addEventListener('blur', () => {
      // Delay to allow dropdown clicks
      setTimeout(() => {
        this.hideSuggestions();
      }, 200);
    });
  }

  /**
   * Add a new tag
   */
  addTag(tagText = null) {
    const text = (tagText || this.inputValue).trim();
    if (!text) return;

    // Remove # if user typed it
    const cleanTag = text.startsWith('#') ? text.substring(1) : text;

    // [NOT-22] Don't add duplicates (case-insensitive check to prevent "JavaScript" and "javascript")
    const lowerCleanTag = cleanTag.toLowerCase();
    if (this.tags.some(t => t.toLowerCase() === lowerCleanTag)) {
      this.inputValue = '';
      this.inputField.value = '';
      this.hideSuggestions();
      return;
    }

    this.tags.push(cleanTag);
    this.inputValue = '';
    this.render(); // Re-renders input and suggestions
    this.inputField.focus();

    if (this.onChange) {
      this.onChange(this.getTags());
    }
  }

  /**
   * Remove a tag by index
   */
  removeTag(index) {
    this.tags.splice(index, 1);
    this.render(); // Re-renders input and suggestions
    this.inputField.focus();

    if (this.onChange) {
      this.onChange(this.getTags());
    }
  }

  /**
   * Remove the last tag (for backspace)
   */
  removeLastTag() {
    if (this.tags.length > 0) {
      this.tags.pop();
      this.render(); // Re-renders input and suggestions
      this.inputField.focus();

      if (this.onChange) {
        this.onChange(this.getTags());
      }
    }
  }

  /**
   * Update autocomplete suggestions
   */
  updateSuggestions() {
    if (!this.inputValue.trim()) {
      this.hideSuggestions();
      return;
    }

    const query = this.inputValue.toLowerCase().trim();
    const allTags = this.getAllExistingTags();

    // Filter tags that match and aren't already added
    this.suggestions = allTags.filter(tag =>
      tag.toLowerCase().includes(query) && !this.tags.includes(tag)
    );

    this.selectedIndex = -1;
    this.renderSuggestions();
  }

  /**
   * Render autocomplete dropdown
   */
  renderSuggestions() {
    this.dropdown.innerHTML = '';

    if (this.suggestions.length === 0 && this.inputValue.trim()) {
      // [NOT-22] Show "Create" option using safe DOM manipulation (no innerHTML with user input)
      const createOption = document.createElement('div');
      createOption.className = 'tag-dropdown-option create';

      const iconSpan = document.createElement('span');
      iconSpan.className = 'tag-dropdown-icon';
      iconSpan.textContent = '+';

      createOption.appendChild(iconSpan);
      createOption.appendChild(document.createTextNode(`Create "${this.inputValue.trim()}"`));

      createOption.addEventListener('click', () => {
        this.addTag();
      });
      this.dropdown.appendChild(createOption);
      this.dropdown.classList.remove('hidden');
      return;
    }

    if (this.suggestions.length === 0) {
      this.hideSuggestions();
      return;
    }

    this.suggestions.forEach((tag, index) => {
      const option = document.createElement('div');
      option.className = 'tag-dropdown-option';
      if (index === this.selectedIndex) {
        option.classList.add('selected');
      }

      // [NOT-16] Fix XSS vulnerability - use safe DOM creation instead of innerHTML
      const iconSpan = document.createElement('span');
      iconSpan.className = 'tag-dropdown-icon';
      iconSpan.textContent = '#';

      option.appendChild(iconSpan);
      option.appendChild(document.createTextNode(tag));

      option.addEventListener('click', () => {
        this.addTag(tag);
      });
      this.dropdown.appendChild(option);
    });

    this.dropdown.classList.remove('hidden');
  }

  /**
   * Navigate suggestions with arrow keys
   */
  navigateSuggestions(direction) {
    if (this.suggestions.length === 0) return;

    this.selectedIndex += direction;

    if (this.selectedIndex < -1) {
      this.selectedIndex = this.suggestions.length - 1;
    } else if (this.selectedIndex >= this.suggestions.length) {
      this.selectedIndex = -1;
    }

    if (this.selectedIndex >= 0) {
      this.inputValue = this.suggestions[this.selectedIndex];
      this.inputField.value = this.inputValue;
    }

    this.renderSuggestions();
  }

  /**
   * Hide suggestions dropdown
   */
  hideSuggestions() {
    this.dropdown.classList.add('hidden');
    this.selectedIndex = -1;
  }

  /**
   * [NOT-22] Render recent tag suggestions below the input
   * Shows the most recently used tags as clickable chips
   */
  renderTagSuggestions() {
    // Remove existing suggestions container if any
    const existingSuggestions = this.wrapper.querySelector('.tag-suggestions');
    if (existingSuggestions) {
      existingSuggestions.remove();
    }

    // [NOT-58] Get local suggestions (from vector search)
    const availableLocalSuggestions = this.localSuggestions.filter(tag => {
      const lowerTag = tag.toLowerCase();
      return !this.tags.some(t => t.toLowerCase() === lowerTag);
    });

    // Get recent tags (sorted by most recent usage)
    const recentTags = this.getRecentTags(10);

    // Filter out already-added tags and local suggestions (to avoid duplicates)
    const availableRecentTags = recentTags.filter(tag => {
      const lowerTag = tag.toLowerCase();
      return !this.tags.some(t => t.toLowerCase() === lowerTag) &&
             !availableLocalSuggestions.some(s => s.toLowerCase() === lowerTag);
    });

    // Don't show suggestions if both are empty
    if (availableLocalSuggestions.length === 0 && availableRecentTags.length === 0) {
      return;
    }

    // Create suggestions container
    const suggestionsContainer = document.createElement('div');
    suggestionsContainer.className = 'tag-suggestions';

    // [NOT-58] Render Local Suggestions (Ghost Chips - Dashed Blue)
    if (availableLocalSuggestions.length > 0) {
      const localLabel = document.createElement('span');
      localLabel.className = 'tag-suggestions-label';
      localLabel.textContent = 'Related:';
      suggestionsContainer.appendChild(localLabel);

      availableLocalSuggestions.forEach(tag => {
        const chip = document.createElement('div');
        chip.className = 'tag-suggestion-chip tag-suggestion-local';

        const icon = document.createElement('span');
        icon.className = 'tag-suggestion-icon';
        icon.textContent = '+';

        chip.appendChild(icon);
        chip.appendChild(document.createTextNode(tag));

        chip.addEventListener('click', () => {
          this.addTag(tag);
        });

        suggestionsContainer.appendChild(chip);
      });
    }

    // Render Recent Tags (Standard Chips)
    if (availableRecentTags.length > 0) {
      const recentLabel = document.createElement('span');
      recentLabel.className = 'tag-suggestions-label';
      recentLabel.textContent = 'Recent:';
      recentLabel.style.marginLeft = availableLocalSuggestions.length > 0 ? 'var(--spacing-md)' : '0';
      suggestionsContainer.appendChild(recentLabel);

      availableRecentTags.forEach(tag => {
        const chip = document.createElement('div');
        chip.className = 'tag-suggestion-chip';

        const icon = document.createElement('span');
        icon.className = 'tag-suggestion-icon';
        icon.textContent = '+';

        chip.appendChild(icon);
        chip.appendChild(document.createTextNode(tag));

        chip.addEventListener('click', () => {
          this.addTag(tag);
        });

        suggestionsContainer.appendChild(chip);
      });
    }

    this.wrapper.appendChild(suggestionsContainer);
  }

  /**
   * [NOT-22] Get most recently used tags
   * @param {number} limit - Maximum number of tags to return
   * @returns {Array<string>} - Array of tag names (without # prefix)
   */
  getRecentTags(limit = 10) {
    // Sort notes by timestamp (newest first)
    const sortedNotes = [...allNotes].sort((a, b) => b.timestamp - a.timestamp);

    // Collect tags in order of appearance (most recent first)
    const tagSet = new Set();
    for (const note of sortedNotes) {
      for (const tag of note.tags) {
        const cleanTag = tag.startsWith('#') ? tag.substring(1) : tag;
        tagSet.add(cleanTag);
        if (tagSet.size >= limit) {
          break;
        }
      }
      if (tagSet.size >= limit) {
        break;
      }
    }

    return Array.from(tagSet);
  }

  /**
   * Get tags array with # prefix
   */
  getTags() {
    return this.tags.map(tag => `#${tag}`);
  }

  /**
   * Set tags programmatically
   */
  setTags(tags) {
    this.tags = tags.map(tag => tag.startsWith('#') ? tag.substring(1) : tag);
    this.render();

    if (this.onChange) {
      this.onChange(this.getTags());
    }
  }
}



/**
 * [NOT-16] [NOT-27] Handle create note button click
 * Attempts to capture current page metadata, falls back to blank note for restricted pages
 */
async function handleCreateNote() {
  log('➕ Creating note from current page...');

  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      warn('⚠️  No active tab found, creating blank note');
      await chrome.storage.local.remove('pendingClipData');
      renderCaptureMode({});
      return;
    }

    // Check if URL is valid for script injection (http/https only)
    const url = tab.url;
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      warn('⚠️  Restricted page (chrome://, etc.), creating blank note');
      await chrome.storage.local.remove('pendingClipData');
      renderCaptureMode({});
      return;
    }

    // [NOT-27] Extract page metadata with explicit error handling
    log('📊 Extracting page metadata from:', url);

    try {
      const metadataResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractPageMetadata
      });

      const metadata = metadataResults[0].result;
      log('✅ Metadata extracted:', metadata);

      // Prepare clip data (bookmark mode - no text/html)
      const clipData = {
        html: '',
        text: '',
        url: url,
        metadata: metadata,
        timestamp: Date.now()
      };

      // Render capture mode with page data
      renderCaptureMode(clipData);

    } catch (scriptError) {
      // [NOT-27] Handle executeScript failures on restricted pages
      warn('⚠️  Script injection failed (likely restricted page):', scriptError.message);
      log('📝 Falling back to blank note');

      // Fallback to blank note
      await chrome.storage.local.remove('pendingClipData');
      renderCaptureMode({});
    }

  } catch (error) {
    error('❌ Unexpected error in handleCreateNote:', error);
    // Fallback to blank note on any unexpected error
    await chrome.storage.local.remove('pendingClipData');
    renderCaptureMode({});
  }
}



/**
 * [NOT-16] Capture Mode - Supports both web clips and manual note creation
 * @param {Object} clipData - The clip data (can be empty for manual notes)
 */
async function renderCaptureMode(clipData = {}) {
  // [NOT-34] Store previous mode to return to it after save/cancel
  if (currentMode !== 'capture') {
    previousMode = currentMode;
  }
  currentMode = 'capture';

  // [NOT-33] Reset edit mode flags (in case we're coming from library with an active edit)
  isEditModeActive = false;
  editModeNoteId = null;
  editModeImages = [];

  // [NOT-33] Initialize images array from clipData or start fresh
  currentImages = [];

  // Handle legacy single imageData (backward compatibility)
  if (clipData.imageData && typeof clipData.imageData === 'string') {
    currentImages = [{
      id: crypto.randomUUID(),
      data: clipData.imageData,
      timestamp: Date.now()
    }];
  }

  // Handle new multi-image format
  if (clipData.images && Array.isArray(clipData.images)) {
    currentImages = [...clipData.images];
  }

  // [NOT-33] Reset web capture listening state
  isWebCaptureListening = false;
  const captureButton = document.getElementById('capture-webpage-image-button');
  if (captureButton) {
    captureButton.classList.remove('active');
    const buttonSpan = captureButton.querySelector('span');
    if (buttonSpan) {
      buttonSpan.textContent = 'Capture from Webpage';
    }
  }

  // Hide loading and other views, show capture
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('library-mode').classList.add('hidden');
  document.getElementById('ai-chat-mode')?.classList.add('hidden');
  document.getElementById('settings-mode')?.classList.add('hidden');
  document.getElementById('capture-mode').classList.remove('hidden');

  // [NOT-34] Show back button, hide navigation buttons
  const backButton = document.getElementById('back-button');
  const menuLeft = document.querySelector('.menu-left');
  const menuRight = document.querySelector('.menu-right');
  const contextPill = document.getElementById('context-pill');
  const expandButton = document.getElementById('expand-all-button');

  if (backButton) {
    backButton.classList.remove('hidden');
    backButton.onclick = navigateToLibrary;
  }
  if (menuLeft) menuLeft.classList.add('hidden');
  if (menuRight) menuRight.classList.add('hidden');
  if (contextPill) contextPill.classList.add('hidden');
  if (expandButton) expandButton.classList.add('hidden');

  // [NOT-16] [NOT-27] Hide or show source bar based on content type
  const sourceBar = document.querySelector('.source-bar');
  const textPreviewSection = document.querySelector('.preview-section');
  const previewLabel = textPreviewSection.querySelector('.section-label');

  if (clipData.url && clipData.metadata) {
    // Has URL and metadata - show source info
    sourceBar.style.display = '';
    textPreviewSection.style.display = '';

    document.getElementById('capture-favicon').src = clipData.metadata.favicon;
    document.getElementById('capture-site-name').textContent = clipData.metadata.siteName;
    document.getElementById('capture-url').textContent = clipData.url;

    // [NOT-58] Render dynamic source bar based on flexible_metadata.type
    renderDynamicSourceBar(clipData, sourceBar);

    // [NOT-27] Check if this is a bookmark (no text/html) or text selection
    if (!clipData.text && !clipData.html) {
      // Bookmark mode - show page title with badge
      previewLabel.textContent = 'Capture Source';
      const textPreview = document.getElementById('capture-text-preview');
      textPreview.innerHTML = '';

      // Create title with webpage badge
      const titleContainer = document.createElement('div');
      titleContainer.style.display = 'flex';
      titleContainer.style.alignItems = 'center';
      titleContainer.style.gap = '8px';

      const titleText = document.createElement('span');
      titleText.textContent = clipData.metadata.title;
      titleText.style.fontSize = 'var(--font-size-base)';
      titleText.style.fontWeight = '600';

      const badge = document.createElement('span');
      badge.textContent = 'Webpage';
      badge.style.padding = '2px 8px';
      badge.style.background = 'var(--color-primary-subtle)';
      badge.style.color = 'var(--color-primary)';
      badge.style.borderRadius = 'var(--radius-full)';
      badge.style.fontSize = 'var(--font-size-xs)';
      badge.style.fontWeight = '500';

      titleContainer.appendChild(titleText);
      titleContainer.appendChild(badge);
      textPreview.appendChild(titleContainer);
    } else {
      // Text selection mode - show selected text
      previewLabel.textContent = 'Selected Text';
      const textPreview = document.getElementById('capture-text-preview');
      let safeHtml = sanitizeHtml(clipData.html || clipData.text);
      safeHtml = enhanceRichMedia(safeHtml);
      if (safeHtml) {
        textPreview.innerHTML = safeHtml;
      } else {
        // Fallback to plain text if HTML is empty
        textPreview.textContent = clipData.text;
      }
    }
  } else {
    // Manual note mode - hide source and preview
    sourceBar.style.display = 'none';
    textPreviewSection.style.display = 'none';
  }

  // [NOT-16] Clear and auto-focus notes textarea
  const notesInput = document.getElementById('capture-notes');
  notesInput.value = ''; // Clear previous content
  notesInput.focus();

  // [NOT-22] Ensure notes are loaded for autocomplete (Capture Mode might load before Library Mode)
  if (allNotes.length === 0) {
    try {
      allNotes = await window.database.getAllNotes();
      log(`📚 Loaded ${allNotes.length} notes for tag autocomplete`);
    } catch (error) {
      error('❌ Error loading notes for autocomplete:', error);
    }
  }

  // [NOT-22] [NOT-16] Initialize TagInput component (clear container first to prevent duplication)
  const tagsContainer = document.getElementById('capture-tags-container');
  tagsContainer.innerHTML = ''; // Clear any existing tag input
  captureTagInput = new TagInput(tagsContainer, []);

  // [NOT-58] Tier 1: Local Tag Suggestions via Vector Search
  // Search for related notes based on page title to suggest contextual tags
  try {
    const localSuggestions = await fetchLocalTagSuggestions(clipData);
    if (localSuggestions.length > 0) {
      log(`🏷️  [NOT-58] Found ${localSuggestions.length} local tag suggestions`);
      captureTagInput.setLocalSuggestions(localSuggestions);
    }
  } catch (err) {
    error('❌ [NOT-58] Error in tag suggestions (non-fatal):', err);
  }

  // [NOT-33] Render image previews
  renderImagePreviews('capture-image-preview-list', currentImages, false);

  // [NOT-16] Store clipData for save handler
  window.currentClipData = clipData;
}

/**
 * [NOT-58] Render dynamic source bar based on content type
 * Adds type-specific UI elements (repo stats, video timestamp, reading time)
 *
 * @param {Object} clipData - The clip data with metadata
 * @param {HTMLElement} sourceBar - The source bar container element
 */
function renderDynamicSourceBar(clipData, sourceBar) {
  // Remove any existing dynamic content
  const existingDynamicContent = sourceBar.querySelector('.source-bar-dynamic');
  if (existingDynamicContent) {
    existingDynamicContent.remove();
  }

  // Check if flexible_metadata exists and has a type
  const flexibleMetadata = clipData.metadata?.flexible_metadata;
  if (!flexibleMetadata || !flexibleMetadata.type) {
    return; // No special rendering needed
  }

  const dynamicContent = document.createElement('div');
  dynamicContent.className = 'source-bar-dynamic';

  switch (flexibleMetadata.type) {
    case 'repo':
      // Render GitHub repo stats (stars, language)
      renderRepoStats(flexibleMetadata, dynamicContent);
      break;

    case 'video':
      // Render video timestamp toggle
      renderVideoTimestamp(flexibleMetadata, dynamicContent);
      break;

    case 'article':
      // Render reading time if available
      renderReadingTime(flexibleMetadata, dynamicContent);
      break;

    default:
      return; // Unknown type, no special rendering
  }

  // Append dynamic content to source bar
  sourceBar.appendChild(dynamicContent);
}

/**
 * [NOT-58] Render repository stats for GitHub repos
 *
 * @param {Object} metadata - The flexible metadata object
 * @param {HTMLElement} container - The container to append to
 */
function renderRepoStats(metadata, container) {
  const statsWrapper = document.createElement('div');
  statsWrapper.className = 'repo-stats';

  // Stars count
  if (metadata.stars !== undefined) {
    const starsElement = document.createElement('div');
    starsElement.className = 'repo-stat';
    starsElement.innerHTML = `
      <svg class="icon icon-sm" style="color: var(--color-warning);">
        <use href="#icon-star"></use>
      </svg>
      <span>${formatNumber(metadata.stars)}</span>
    `;
    statsWrapper.appendChild(starsElement);
  }

  // Language
  if (metadata.language) {
    const languageElement = document.createElement('div');
    languageElement.className = 'repo-stat';

    const languageDot = document.createElement('span');
    languageDot.className = 'language-dot';
    languageDot.style.backgroundColor = getLanguageColor(metadata.language);

    const languageText = document.createElement('span');
    languageText.textContent = metadata.language;

    languageElement.appendChild(languageDot);
    languageElement.appendChild(languageText);
    statsWrapper.appendChild(languageElement);
  }

  container.appendChild(statsWrapper);
}

/**
 * [NOT-58] Render video timestamp information
 *
 * @param {Object} metadata - The flexible metadata object
 * @param {HTMLElement} container - The container to append to
 */
function renderVideoTimestamp(metadata, container) {
  if (!metadata.duration) {
    return;
  }

  const timestampElement = document.createElement('div');
  timestampElement.className = 'video-timestamp';

  const durationText = document.createElement('span');
  durationText.textContent = `Duration: ${metadata.duration}`;
  durationText.style.fontSize = 'var(--font-size-sm)';
  durationText.style.color = 'var(--color-text-secondary)';

  timestampElement.appendChild(durationText);
  container.appendChild(timestampElement);
}

/**
 * [NOT-58] Render reading time for articles
 *
 * @param {Object} metadata - The flexible metadata object
 * @param {HTMLElement} container - The container to append to
 */
function renderReadingTime(metadata, container) {
  if (!metadata.readingTime) {
    return;
  }

  const readingTimeElement = document.createElement('div');
  readingTimeElement.className = 'reading-time';

  const timeText = document.createElement('span');
  timeText.textContent = `📖 ${metadata.readingTime}`;
  timeText.style.fontSize = 'var(--font-size-sm)';
  timeText.style.color = 'var(--color-text-secondary)';

  readingTimeElement.appendChild(timeText);
  container.appendChild(readingTimeElement);
}

/**
 * [NOT-58] Format large numbers with K/M suffixes
 *
 * @param {number} num - The number to format
 * @returns {string} - Formatted number string
 */
function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

/**
 * [NOT-58] Get color for programming language
 * Based on GitHub's language colors
 *
 * @param {string} language - The programming language name
 * @returns {string} - Hex color code
 */
function getLanguageColor(language) {
  const colors = {
    'JavaScript': '#f1e05a',
    'TypeScript': '#3178c6',
    'Python': '#3572A5',
    'Java': '#b07219',
    'Go': '#00ADD8',
    'Rust': '#dea584',
    'Ruby': '#701516',
    'PHP': '#4F5D95',
    'C++': '#f34b7d',
    'C': '#555555',
    'C#': '#178600',
    'Swift': '#ffac45',
    'Kotlin': '#A97BFF',
    'Dart': '#00B4AB',
    'HTML': '#e34c26',
    'CSS': '#563d7c',
    'Shell': '#89e051',
    'Vue': '#41b883',
    'React': '#61dafb'
  };
  return colors[language] || '#8b8b8b'; // Default gray
}

/**
 * [NOT-58] Fetch local tag suggestions using vector search
 * Searches for semantically related notes and extracts unique tags
 *
 * @param {Object} clipData - The current clip data with metadata
 * @returns {Promise<Array<string>>} - Array of suggested tag names (without # prefix)
 */
async function fetchLocalTagSuggestions(clipData) {
  try {
    // Use page title as search query for finding related notes
    const query = clipData.metadata?.title || clipData.text?.substring(0, 100) || '';
    if (!query.trim()) {
      return [];
    }

    // Search for top 5 related notes using vector similarity
    const response = await chrome.runtime.sendMessage({
      action: 'SEARCH_NOTES',
      query: query,
      limit: 5
    });

    if (!response.success || !response.results) {
      warn('⚠️  [NOT-58] Vector search failed or returned no results');
      return [];
    }

    // Extract unique tags from search results
    const tagSet = new Set();
    response.results.forEach(result => {
      if (result.note && result.note.tags) {
        result.note.tags.forEach(tag => {
          const cleanTag = tag.startsWith('#') ? tag.substring(1) : tag;
          tagSet.add(cleanTag);
        });
      }
    });

    return Array.from(tagSet).slice(0, 8); // Limit to 8 suggestions
  } catch (err) {
    error('❌ [NOT-58] Error fetching local tag suggestions:', err);
    return [];
  }
}

/**
 * [NOT-16] Save a clip or manual note
 * @param {Object} clipData - The clip data (can be empty for manual notes)
 */
async function handleSaveClip(clipData = {}) {
  log('💾 Saving clip...');

  const saveButton = document.getElementById('save-button');
  const notesInput = document.getElementById('capture-notes');

  // Disable button to prevent double-click
  saveButton.disabled = true;

  try {
    // Get user input
    const userNote = notesInput.value.trim();
    // [NOT-22] Get tags from TagInput component
    const tags = captureTagInput ? captureTagInput.getTags() : [];

    // [NOT-16] [NOT-27] Distinguish between manual notes and bookmarks
    // Manual note: No URL, no text/html (completely blank)
    // Bookmark: Has URL but no text/html
    // Text capture: Has URL and text/html
    const isManualNote = !clipData.url && !clipData.text && !clipData.html;
    const isBookmark = clipData.url && !clipData.text && !clipData.html;

    // Validate that manual notes have at least some content
    if (isManualNote && !userNote.trim()) {
      alert('Please add some content to your note before saving.');
      saveButton.disabled = false;
      return;
    }

    // [NOT-20] [NOT-16] [NOT-27] [NOT-33] [NOT-59] Create note object
    // Manual note: userNote becomes the main text
    // Bookmark: metadata title becomes the main text, userNote is the user's comment
    // Text capture: clipData.text is the main text, userNote is the user's comment
    const note = {
      id: crypto.randomUUID(),
      html: clipData.html || '',
      text: isManualNote ? userNote : (isBookmark ? clipData.metadata.title : clipData.text),
      userNote: isManualNote ? '' : userNote, // For manual notes, don't duplicate
      tags: tags,
      url: clipData.url || '',
      metadata: clipData.metadata || {
        title: 'Manual Note',
        siteName: 'Knowledge Clipper',
        favicon: 'icons/icon32.png'
      },
      // [NOT-59] Extract flexible_metadata from clipData.metadata if present
      flexible_metadata: (clipData.metadata && clipData.metadata.flexible_metadata) || {},
      timestamp: Date.now(),
      readLater: false, // [NOT-18] Initialize Read Later flag
      starred: false, // [NOT-35] Initialize starred flag for consistency
      images: currentImages // [NOT-33] Store images array (replaces legacy imageData)
    };

    // Save note to IndexedDB
    await window.database.addNote(note);

    // [NOT-38] Index note for semantic search
    try {
      await chrome.runtime.sendMessage({
        action: 'INDEX_NOTE',
        note: note
      });
      log('✅ [NOT-38] Note indexed for semantic search');
    } catch (error) {
      // Don't fail the save if indexing fails
      warn('⚠️  [NOT-38] Failed to index note for search:', error);
    }

    // Remove pending clip data from chrome.storage
    await chrome.storage.local.remove('pendingClipData');

    log('✅ Clip saved successfully:', note);

    // Show success feedback
    saveButton.classList.add('success');
    saveButton.querySelector('.button-text').textContent = 'Saved!';
    const iconEl = saveButton.querySelector('.button-icon use');
    if (iconEl) {
      iconEl.setAttribute('href', '#icon-check');
    }

    // [NOT-34] Navigate back to previous view instead of closing
    setTimeout(async () => {
      await navigateToLibrary();
    }, 800);

  } catch (error) {
    error('❌ Error saving clip:', error);
    saveButton.disabled = false;
    alert('Failed to save clip. Please try again.');
  }
}

/**
 * [NOT-59] Handle Pulse Pill (Analyze Page) button click
 * Triggers AI metadata enhancement with 3-state animation:
 * - Idle -> Processing (shimmer animation)
 * - Processing -> Done (success state with checkmark)
 * - Done -> Idle (fade back after 2 seconds)
 *
 * Uses AIHarness to extract structured metadata from page content
 */
async function handlePulsePillClick() {
  const pulsePillButton = document.getElementById('pulse-pill-button');
  const pulsePillText = pulsePillButton.querySelector('.pulse-pill-text');

  if (!pulsePillButton || pulsePillButton.dataset.state !== 'idle') {
    return; // Already processing or done
  }

  log('✨ [NOT-59] Pulse Pill clicked - triggering AI metadata enhancement');

  // State A -> B: Idle to Processing
  pulsePillButton.dataset.state = 'processing';
  pulsePillText.textContent = 'Analyzing...';

  try {
    // [NOT-59] Collect page text from current clip data
    if (!window.currentClipData) {
      throw new Error('No page content available for analysis');
    }

    const clipData = window.currentClipData;

    // Build text content for AI analysis
    // Priority: captured text > page title + metadata
    let pageText = '';

    if (clipData.text && clipData.text.trim()) {
      // Use captured text selection
      pageText = clipData.text;
    } else if (clipData.metadata) {
      // Use metadata for bookmark-style captures
      pageText = `Title: ${clipData.metadata.title || 'Untitled'}\n`;
      if (clipData.metadata.author) {
        pageText += `Author: ${clipData.metadata.author}\n`;
      }
      pageText += `URL: ${clipData.url || 'No URL'}\n`;
      if (clipData.metadata.siteName) {
        pageText += `Site: ${clipData.metadata.siteName}\n`;
      }
    } else {
      throw new Error('No content available for analysis');
    }

    log('📄 [NOT-59] Content to analyze:', pageText.substring(0, 200) + '...');

    // [NOT-59] Call AIHarness to extract structured data
    const extractedMetadata = await window.aiHarness.extractStructuredData(
      pageText,
      {}, // schema (optional, currently using default prompt)
      { modelId: 'auto' } // Use smart fallback chain
    );

    log('✅ [NOT-59] AI metadata extracted:', extractedMetadata);

    // [NOT-59] Merge extracted metadata into flexible_metadata
    if (!clipData.metadata.flexible_metadata) {
      clipData.metadata.flexible_metadata = {};
    }

    // Merge AI-extracted fields into flexible_metadata
    // Preserve existing fields, but allow AI to add new ones
    Object.assign(clipData.metadata.flexible_metadata, extractedMetadata);

    log('📦 [NOT-59] Updated flexible_metadata:', clipData.metadata.flexible_metadata);

    // [NOT-59] Update the UI to reflect enhanced metadata
    // Re-render the dynamic source bar to show new metadata
    const sourceBar = document.querySelector('.source-bar');
    if (sourceBar) {
      renderDynamicSourceBar(clipData, sourceBar);
    }

    // State B -> C: Processing to Done
    pulsePillButton.dataset.state = 'done';
    pulsePillText.textContent = 'Metadata Enhanced';

    log('✅ [NOT-59] AI metadata enhancement complete');

    // State C -> A: Done to Idle (after 2 seconds)
    setTimeout(() => {
      pulsePillButton.dataset.state = 'idle';
      pulsePillText.textContent = 'Analyze Page';
    }, 2000);

  } catch (error) {
    error('❌ [NOT-59] Pulse Pill error:', error);

    // Show user-friendly error message
    pulsePillButton.dataset.state = 'idle';
    pulsePillText.textContent = 'Analysis Failed';

    // Show error details in console
    if (error.message.includes('API key')) {
      alert('AI analysis requires an API key. Please configure your OpenRouter API key in Settings.');
    } else {
      alert(`AI analysis failed: ${error.message}`);
    }

    // Reset to idle after showing error
    setTimeout(() => {
      pulsePillButton.dataset.state = 'idle';
      pulsePillText.textContent = 'Analyze Page';
    }, 2000);
  }
}

/**
 * Navigation
 */
async function navigateToLibrary() {
  // [NOT-34] Navigate back to previous view, or library if no previous view
  await chrome.storage.local.remove('pendingClipData');

  // Return to previous mode, default to library
  switch (previousMode) {
    case 'ai-chat':
      await renderAIChatMode();
      break;
    case 'settings':
      await renderSettingsMode();
      break;
    default:
      await renderLibraryMode();
  }
}

/**
 * [NOT-16] Toggle expand/collapse state for all note cards
 */
function handleToggleExpandAll() {
  // Toggle state and apply
  setAllNotesExpanded(!isExpandedAll);
}

// =============================================================================
// @LIBRARY - List rendering, filtering, sorting
// =============================================================================

/**
 * Library Mode
 */
async function renderLibraryMode() {
  currentMode = 'library';
  navigateToView('library-mode');

  // Hide loading
  document.getElementById('loading').classList.add('hidden');

  // Show library-specific expand button
  const expandButton = document.getElementById('expand-all-button');
  if (expandButton) expandButton.classList.remove('hidden');

  // [NOT-31] Preserve expand state if context filter is active, otherwise reset
  if (!filterState.contextFilter) {
    isExpandedAll = false;
    if (expandButton) {
      const iconUse = expandButton.querySelector('use');
      if (iconUse) {
        iconUse.setAttribute('href', '#icon-maximize');
        expandButton.setAttribute('title', 'Expand all notes');
        expandButton.setAttribute('aria-label', 'Expand all notes');
      }
    }
  }

  // Load notes from IndexedDB
  allNotes = await window.database.getAllNotes();
  filteredNotes = [...allNotes];

  log(`📚 Loaded ${allNotes.length} notes`);

  // [NOT-16] Setup event listeners only once to prevent duplicates
  if (!libraryListenersInitialized) {
    setupLibraryEventListeners();
    libraryListenersInitialized = true;
  }

  // [NOT-31] Check for contextual recall (existing notes for current page)
  await checkContextualRecall();

  // Render notes
  renderNotesList();

  // Populate filter dropdown
  populateFilterDropdown();

  // Render active filters
  renderActiveFilters();

  // Update placeholder based on current filter state
  updatePlaceholder();
}

function setupLibraryEventListeners() {
  const filterInput = document.getElementById('filter-input');
  const filterDropdown = document.getElementById('filter-dropdown');
  const clearAllButton = document.getElementById('clear-all-filters');

  // [NOT-16] Expand all button
  const expandAllButton = document.getElementById('expand-all-button');
  if (expandAllButton) {
    expandAllButton.addEventListener('click', handleToggleExpandAll);
  }

  // [NOT-31] Context pill click and keyboard handlers
  const contextPill = document.getElementById('context-pill');
  if (contextPill) {
    contextPill.addEventListener('click', handleContextPillClick);

    // Keyboard accessibility: Enter and Space keys
    contextPill.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleContextPillClick();
      }
    });
  }

  // Filter input focus/blur
  filterInput.addEventListener('focus', () => {
    filterDropdown.classList.remove('hidden');
    filterInput.setAttribute('aria-expanded', 'true');
  });

  filterInput.addEventListener('blur', (e) => {
    // Delay to allow clicking on dropdown items
    setTimeout(() => {
      filterDropdown.classList.add('hidden');
      filterInput.setAttribute('aria-expanded', 'false');
    }, 200);
  });

  // Filter input typing (search)
  let searchTimeout;
  filterInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);

    // Show loading indicator
    const loadingDots = document.getElementById('search-loading');
    if (loadingDots) loadingDots.classList.remove('hidden');

    searchTimeout = setTimeout(() => {
      filterState.search = e.target.value.trim().toLowerCase();
      filterAndRenderNotes();
      saveFilterState();

      // Hide loading indicator
      if (loadingDots) loadingDots.classList.add('hidden');
    }, 200); // Debounce 200ms (reduced from 300ms)
  });

  // Filter dropdown options click
  filterDropdown.addEventListener('click', (e) => {
    const option = e.target.closest('.filter-option');
    if (!option) return;

    const type = option.dataset.type;
    const value = option.dataset.value;

    if (type === 'sort') {
      filterState.sort = value;
    } else if (type === 'tag') {
      if (filterState.tags.includes(value)) {
        // Remove tag
        filterState.tags = filterState.tags.filter(t => t !== value);
      } else {
        // Add tag
        filterState.tags.push(value);
      }
    } else if (type === 'readLater') {
      // [NOT-18] Toggle Read Later filter
      filterState.readLater = !filterState.readLater;
    } else if (type === 'starred') {
      // [NOT-35] Toggle Starred filter
      filterState.starred = !filterState.starred;
    }

    filterAndRenderNotes();
    renderActiveFilters();
    updateFilterDropdownActiveStates();
    saveFilterState();
  });

  // Keyboard navigation in dropdown
  filterDropdown.addEventListener('keydown', (e) => {
    const options = Array.from(filterDropdown.querySelectorAll('.filter-option'));
    const currentIndex = options.indexOf(document.activeElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = (currentIndex + 1) % options.length;
      options[nextIndex].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = currentIndex === 0 ? options.length - 1 : currentIndex - 1;
      options[prevIndex].focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (document.activeElement.classList.contains('filter-option')) {
        document.activeElement.click();
      }
    }
  });

  // Clear All Filters button
  clearAllButton.addEventListener('click', () => {
    filterState.search = '';
    filterState.sort = 'newest';
    filterState.tags = [];
    filterState.readLater = false; // [NOT-18] Reset Read Later filter
    filterState.starred = false; // [NOT-35] Reset Starred filter
    filterState.contextFilter = null; // [NOT-31] Reset context filter
    filterInput.value = '';

    // [NOT-31] Reset context pill active state
    const contextPill = document.getElementById('context-pill');
    if (contextPill) {
      contextPill.classList.remove('active');
    }

    // [NOT-31] Reset expand all state
    isExpandedAll = false;
    const expandButton = document.getElementById('expand-all-button');
    if (expandButton) {
      const iconUse = expandButton.querySelector('use');
      if (iconUse) {
        iconUse.setAttribute('href', '#icon-maximize');
        expandButton.setAttribute('title', 'Expand all notes');
        expandButton.setAttribute('aria-label', 'Expand all notes');
      }
    }

    filterAndRenderNotes();
    renderActiveFilters();
    updateFilterDropdownActiveStates();
    saveFilterState();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Cmd+F / Ctrl+F to focus filter input (Library mode only)
    if ((e.metaKey || e.ctrlKey) && e.key === 'f' && currentMode === 'library') {
      e.preventDefault();
      filterInput.focus();
    }

    // Escape key handling
    if (e.key === 'Escape') {
      if (!filterDropdown.classList.contains('hidden')) {
        // Close dropdown if open
        filterDropdown.classList.add('hidden');
        filterInput.setAttribute('aria-expanded', 'false');
      } else if (filterInput.value) {
        // Clear input if dropdown is closed but has text
        filterInput.value = '';
        filterState.search = '';
        filterState.readLater = false; // [NOT-18] Also clear Read Later filter
        filterState.contextFilter = null; // [NOT-31] Also clear context filter

        // [NOT-31] Reset context pill active state
        const contextPillEl = document.getElementById('context-pill');
        if (contextPillEl) {
          contextPillEl.classList.remove('active');
        }

        filterAndRenderNotes();
        renderActiveFilters();
        updateFilterDropdownActiveStates();
        saveFilterState();
      }
    }
  });
}

function populateFilterDropdown() {
  // Populate tags in dropdown
  const tagsListEl = document.getElementById('filter-tags-list');
  tagsListEl.innerHTML = '';

  // Extract unique tags
  const uniqueTags = new Set();
  allNotes.forEach(note => {
    note.tags.forEach(tag => uniqueTags.add(tag));
  });

  if (uniqueTags.size === 0) {
    // Hide tags section if no tags
    document.getElementById('tags-filter-section').style.display = 'none';
  } else {
    document.getElementById('tags-filter-section').style.display = 'block';
    uniqueTags.forEach(tag => {
      const option = document.createElement('div');
      option.className = 'filter-option';
      option.dataset.type = 'tag';
      option.dataset.value = tag;
      option.setAttribute('role', 'menuitem');
      option.setAttribute('tabindex', '0');

      // [NOT-18] Create icon element safely
      const iconSpan = document.createElement('span');
      iconSpan.className = 'filter-option-icon';
      iconSpan.textContent = '#';

      // [NOT-18] Use textContent to prevent XSS from malicious tag names
      const tagText = document.createTextNode(tag.replace('#', ''));

      option.appendChild(iconSpan);
      option.appendChild(tagText);
      tagsListEl.appendChild(option);
    });
  }

  // [NOT-26] Update active state for Read Later filter option
  updateFilterDropdownActiveStates();
}

/**
 * [NOT-26] Update the visual active state of filter options in the dropdown
 * Highlights currently active filters (sort, read later, tags)
 */
function updateFilterDropdownActiveStates() {
  const filterDropdown = document.getElementById('filter-dropdown');
  if (!filterDropdown) return;

  // Update Read Later filter option
  const readLaterOption = filterDropdown.querySelector('[data-type="readLater"]');
  if (readLaterOption) {
    if (filterState.readLater) {
      readLaterOption.classList.add('active');
    } else {
      readLaterOption.classList.remove('active');
    }
  }

  // [NOT-35] Update Starred filter option
  const starredOption = filterDropdown.querySelector('[data-type="starred"]');
  if (starredOption) {
    if (filterState.starred) {
      starredOption.classList.add('active');
    } else {
      starredOption.classList.remove('active');
    }
  }

  // Update Sort options
  const sortOptions = filterDropdown.querySelectorAll('[data-type="sort"]');
  sortOptions.forEach(option => {
    if (option.dataset.value === filterState.sort) {
      option.classList.add('active');
    } else {
      option.classList.remove('active');
    }
  });

  // Update Tag options
  const tagOptions = filterDropdown.querySelectorAll('[data-type="tag"]');
  tagOptions.forEach(option => {
    const isActive = filterState.tags.some(
      filterTag => filterTag.toLowerCase() === option.dataset.value.toLowerCase()
    );
    if (isActive) {
      option.classList.add('active');
    } else {
      option.classList.remove('active');
    }
  });
}

function filterAndRenderNotes() {
  // Start with all notes
  filteredNotes = [...allNotes];

  // [NOT-31] Apply context filter first (if active) with precise matching
  if (filterState.contextFilter) {
    filteredNotes = filteredNotes.filter(note => {
      if (!note.url) return false;

      // Exact URL match (if filter contains protocol)
      if (filterState.contextFilter.startsWith('http')) {
        return note.url === filterState.contextFilter;
      }

      // Domain match (extract hostname from note URL)
      try {
        const noteUrl = new URL(note.url);
        return noteUrl.hostname === filterState.contextFilter;
      } catch (e) {
        return false;
      }
    });
  }

  // Apply search filter
  if (filterState.search) {
    filteredNotes = filteredNotes.filter(note => {
      const searchableText = [
        note.text,
        note.userNote,
        note.metadata.siteName,
        note.metadata.title
      ].join(' ').toLowerCase();

      return searchableText.includes(filterState.search);
    });
  }

  // [NOT-26] Apply tag filters (case-insensitive)
  if (filterState.tags.length > 0) {
    filteredNotes = filteredNotes.filter(note =>
      filterState.tags.some(filterTag =>
        note.tags.some(noteTag =>
          noteTag.toLowerCase() === filterTag.toLowerCase()
        )
      )
    );
  }

  // [NOT-18] Apply Read Later filter
  if (filterState.readLater) {
    filteredNotes = filteredNotes.filter(note => note.readLater === true);
  }

  // [NOT-35] Apply Starred filter
  if (filterState.starred) {
    filteredNotes = filteredNotes.filter(note => note.starred === true);
  }

  // Apply sort
  if (filterState.sort === 'newest') {
    filteredNotes.sort((a, b) => b.timestamp - a.timestamp);
  } else if (filterState.sort === 'oldest') {
    filteredNotes.sort((a, b) => a.timestamp - b.timestamp);
  }

  // Update ARIA live region for screen readers
  const filterStatus = document.getElementById('filter-status');
  if (filterStatus) {
    const activeFiltersCount = (filterState.sort !== 'newest' ? 1 : 0) + filterState.tags.length + (filterState.readLater ? 1 : 0) + (filterState.starred ? 1 : 0);
    filterStatus.textContent = `Showing ${filteredNotes.length} of ${allNotes.length} clips${activeFiltersCount > 0 ? ` with ${activeFiltersCount} filter${activeFiltersCount === 1 ? '' : 's'} active` : ''}`;
  }

  // Update search input placeholder
  updatePlaceholder();

  renderNotesList();
}

function renderActiveFilters() {
  const activeFiltersEl = document.getElementById('active-filters');
  const chipsContainer = document.getElementById('active-filters-chips');
  chipsContainer.innerHTML = '';

  let hasActiveFilters = false;

  // Add sort chip (only if not default)
  if (filterState.sort !== 'newest') {
    hasActiveFilters = true;
    const chip = createFilterChip('sort', filterState.sort, filterState.sort === 'newest' ? '↓ Newest' : '↑ Oldest');
    chipsContainer.appendChild(chip);
  }

  // [NOT-18] Add Read Later chip
  if (filterState.readLater) {
    hasActiveFilters = true;
    const chip = createFilterChip('readLater', 'true', '🕐 Read Later');
    chipsContainer.appendChild(chip);
  }

  // [NOT-35] Add Starred chip
  if (filterState.starred) {
    hasActiveFilters = true;
    const chip = createFilterChip('starred', 'true', '⭐ Starred');
    chipsContainer.appendChild(chip);
  }

  // Add tag chips
  filterState.tags.forEach(tag => {
    hasActiveFilters = true;
    const chip = createFilterChip('tag', tag, tag);
    chipsContainer.appendChild(chip);
  });

  // Show/hide active filters section
  if (hasActiveFilters) {
    activeFiltersEl.classList.remove('hidden');
  } else {
    activeFiltersEl.classList.add('hidden');
  }
}

function updatePlaceholder() {
  const filterInput = document.getElementById('filter-input');
  if (!filterInput) return;

  const activeFiltersCount = (filterState.sort !== 'newest' ? 1 : 0) + filterState.tags.length + (filterState.readLater ? 1 : 0) + (filterState.starred ? 1 : 0);

  if (activeFiltersCount > 0) {
    filterInput.placeholder = `Search, filter, or sort... (${activeFiltersCount} filter${activeFiltersCount === 1 ? '' : 's'} active)`;
  } else {
    filterInput.placeholder = 'Search, filter, or sort...';
  }
}

function createFilterChip(type, value, label) {
  const chip = document.createElement('div');
  chip.className = 'filter-chip';

  // [NOT-18] Use textContent to prevent XSS from malicious tag names
  const labelSpan = document.createElement('span');
  labelSpan.textContent = label;

  const removeSpan = document.createElement('span');
  removeSpan.className = 'filter-chip-remove';
  removeSpan.textContent = '×';

  chip.appendChild(labelSpan);
  chip.appendChild(removeSpan);

  removeSpan.addEventListener('click', (e) => {
    // [NOT-23] Add removing animation
    chip.classList.add('removing');

    // [NOT-23] Wait for animation to finish before removing
    // Duration matches CSS variable --duration-base (200ms)
    // If you change --duration-base in styles.css, update this value to match
    setTimeout(() => {
      if (type === 'sort') {
        filterState.sort = 'newest'; // Reset to default
      } else if (type === 'tag') {
        filterState.tags = filterState.tags.filter(t => t !== value);
      } else if (type === 'readLater') {
        // [NOT-18] Remove Read Later filter
        filterState.readLater = false;
      } else if (type === 'starred') {
        // [NOT-35] Remove Starred filter
        filterState.starred = false;
      }
      filterAndRenderNotes();
      renderActiveFilters();
      saveFilterState();
    }, 200);
  });

  return chip;
}

/**
 * [NOT-18] [NOT-39] Render the notes list with focus preservation
 * Supports hybrid view rendering for semantic/hybrid context states
 * Saves and restores keyboard focus to prevent UX regression during re-renders
 */
function renderNotesList() {
  const notesListEl = document.getElementById('notes-list');
  const emptyStateEl = document.getElementById('empty-state');
  const searchEmptyStateEl = document.getElementById('search-empty-state');

  // [NOT-18] Save focused element to restore after re-render
  const activeElement = document.activeElement;
  const focusedNoteId = activeElement?.closest('.note-card, .insight-card')?.dataset?.noteId;
  const focusedElementSelector = activeElement?.className;

  // [NOT-48] Clear existing notes and sections (but keep empty states)
  // Explicitly clear AI elements to prevent duplication on re-renders
  const existingCards = notesListEl.querySelectorAll('.note-card, .insight-card, .hybrid-section-header, .ai-action-header, .synthesis-output');
  existingCards.forEach(card => card.remove());

  // Handle empty states
  if (allNotes.length === 0) {
    // No notes at all
    emptyStateEl.classList.remove('hidden');
    searchEmptyStateEl.classList.add('hidden');
    return;
  }

  // [NOT-39] Check if we should render hybrid view (semantic or hybrid context state with active pill)
  const pillElement = document.getElementById('context-pill');
  const isHybridViewActive = pillElement && pillElement.classList.contains('active') &&
    (contextMatchType === 'semantic' || contextMatchType === 'hybrid');

  if (isHybridViewActive) {
    // Render hybrid view with sections
    renderHybridView(notesListEl);
    emptyStateEl.classList.add('hidden');
    searchEmptyStateEl.classList.add('hidden');
    return;
  }

  // Standard rendering (no hybrid view)
  if (filteredNotes.length === 0) {
    // Has notes but search/filter returned nothing
    emptyStateEl.classList.add('hidden');
    searchEmptyStateEl.classList.remove('hidden');
    document.getElementById('search-empty-query').textContent =
      filterState.search ? `No results for "${filterState.search}"` : 'No notes match your filters';
    return;
  }

  // Has notes to display
  emptyStateEl.classList.add('hidden');
  searchEmptyStateEl.classList.add('hidden');

  // [NOT-23] Render each note with staggered entrance animation
  filteredNotes.forEach((note, index) => {
    const noteCard = createNoteCard(note, index);

    // [NOT-16] Apply expand all state to maintain consistency
    if (isExpandedAll) {
      noteCard.classList.add('expanded');
      noteCard.setAttribute('aria-expanded', 'true');
    }

    notesListEl.appendChild(noteCard);
  });

  // [NOT-18] Restore focus to prevent keyboard navigation regression
  if (focusedNoteId && focusedElementSelector) {
    const restoredCard = notesListEl.querySelector(`[data-note-id="${focusedNoteId}"]`);
    if (restoredCard) {
      const restoredElement = restoredCard.querySelector(`.${focusedElementSelector}`);
      if (restoredElement && typeof restoredElement.focus === 'function') {
        // Use setTimeout to ensure DOM is fully rendered
        setTimeout(() => restoredElement.focus(), 0);
      } else {
        // Fallback: focus the card itself
        setTimeout(() => restoredCard.focus(), 0);
      }
    }
  }

  log(`📝 Rendered ${filteredNotes.length} notes`);
}

function createNoteCard(note, index = 0) {
  const template = document.getElementById('note-card-template');
  const card = template.content.cloneNode(true).querySelector('.note-card');

  // Set note ID
  card.dataset.noteId = note.id;

  // [NOT-23] Apply staggered entrance animation delay
  card.style.animationDelay = `${index * 30}ms`;

  // Make card keyboard accessible
  card.setAttribute('tabindex', '0');
  card.setAttribute('role', 'article');
  card.setAttribute('aria-label', `Clip from ${note.metadata.siteName}`);

  // Populate source info
  card.querySelector('.note-favicon').src = note.metadata.favicon;
  card.querySelector('.note-site-name').textContent = note.metadata.siteName;
  card.querySelector('.note-date').textContent = formatDate(note.timestamp);

  // [NOT-33] Handle image thumbnails if present
  const hasImages = note.images && note.images.length > 0;
  const hasLegacyImage = note.imageData && typeof note.imageData === 'string';

  if (hasImages || hasLegacyImage) {
    const thumbnailContainer = card.querySelector('.note-thumbnail');
    const thumbnailImg = thumbnailContainer.querySelector('img');

    // [NOT-33] Get images array (support both new and legacy format)
    let images = [];
    if (hasImages) {
      images = note.images;
    } else if (hasLegacyImage) {
      // Backward compatibility for old single imageData
      images = [{
        id: 'legacy',
        data: note.imageData,
        timestamp: note.timestamp || Date.now()
      }];
    }

    // Show first image as thumbnail
    thumbnailImg.src = images[0].data;
    thumbnailContainer.classList.remove('hidden');

    // [NOT-33] Add multiple images indicator
    if (images.length > 1) {
      const badge = document.createElement('div');
      badge.className = 'image-count-badge';
      badge.textContent = `+${images.length - 1}`;
      badge.title = `${images.length} images`;
      thumbnailContainer.appendChild(badge);
    }

    // Add click listener to open lightbox gallery
    thumbnailContainer.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent card expansion
      openLightbox(images, 0);
    });
  }

  // [NOT-21] Make source link (favicon + site name) clickable and prevent card expansion
  const noteSourceLink = card.querySelector('.note-source-link');

  // [NOT-21] Validate URL protocol to prevent javascript: XSS attacks
  try {
    const url = new URL(note.url.trim(), window.location.origin);
    const protocol = url.protocol.toLowerCase();

    if (protocol === 'http:' || protocol === 'https:') {
      noteSourceLink.href = note.url.trim();
    } else {
      warn('⚠️  Blocked dangerous protocol:', protocol, 'for URL:', note.url);
      // Set to empty to prevent navigation
      noteSourceLink.href = '#';
      noteSourceLink.style.cursor = 'not-allowed';
    }
  } catch (e) {
    warn('⚠️  Invalid URL:', note.url);
    // Set to empty to prevent navigation
    noteSourceLink.href = '#';
    noteSourceLink.style.cursor = 'not-allowed';
  }

  noteSourceLink.addEventListener('click', (e) => {
    e.stopPropagation(); // Prevent card expand/collapse

    // Prevent navigation if URL is invalid
    if (noteSourceLink.href === '#' || noteSourceLink.href.endsWith('#')) {
      e.preventDefault();
    }
  });

  // [NOT-20] Populate text preview with sanitized HTML and smart chips
  const textPreview = card.querySelector('.note-text-preview');
  let safeHtml = sanitizeHtml(note.html || note.text);
  safeHtml = enhanceRichMedia(safeHtml);
  if (safeHtml) {
    textPreview.innerHTML = safeHtml;
  } else {
    // Fallback to plain text if HTML is empty
    textPreview.textContent = note.text;
  }

  // Populate user note (if exists)
  if (note.userNote) {
    card.querySelector('.note-user-note').textContent = note.userNote;
  } else {
    card.querySelector('.note-user-note').style.display = 'none';
  }

  // [NOT-26] Populate tags with click-to-filter functionality
  const tagsContainer = card.querySelector('.note-tags');
  if (note.tags.length > 0) {
    note.tags.forEach(tag => {
      const tagEl = document.createElement('span');
      tagEl.className = 'note-tag';
      tagEl.textContent = tag;

      // [NOT-26] Add click listener to toggle tag filter (case-insensitive)
      tagEl.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent card expansion

        // Check if tag is already in filter (case-insensitive)
        const existingTagIndex = filterState.tags.findIndex(
          filterTag => filterTag.toLowerCase() === tag.toLowerCase()
        );

        if (existingTagIndex !== -1) {
          // Remove tag if already in filter
          filterState.tags.splice(existingTagIndex, 1);
        } else {
          // Add tag to filter if not present
          filterState.tags.push(tag);
        }

        filterAndRenderNotes();
        renderActiveFilters();
        updateFilterDropdownActiveStates();
        saveFilterState();
      });

      tagsContainer.appendChild(tagEl);
    });
  } else {
    tagsContainer.style.display = 'none';
  }

  // [NOT-20] Populate expanded content with sanitized HTML and smart chips
  const textFull = card.querySelector('.note-text-full');
  // Note: safeHtml is already enhanced with smart chips from above
  if (safeHtml) {
    textFull.innerHTML = safeHtml;
  } else {
    // Fallback to plain text if HTML is empty
    textFull.textContent = note.text;
  }

  // [NOT-26] Validate URL protocol before setting href (prevent XSS)
  const noteLinkEl = card.querySelector('.note-link');
  try {
    const url = new URL(note.url.trim(), window.location.origin);
    const protocol = url.protocol.toLowerCase();

    if (protocol === 'http:' || protocol === 'https:') {
      noteLinkEl.href = note.url.trim();
    } else {
      warn('⚠️  Blocked dangerous protocol in expanded view:', protocol, 'for URL:', note.url);
      noteLinkEl.href = '#';
      noteLinkEl.style.cursor = 'not-allowed';
    }
  } catch (e) {
    warn('⚠️  Invalid URL in expanded view:', note.url);
    noteLinkEl.href = '#';
    noteLinkEl.style.cursor = 'not-allowed';
  }

  // [NOT-26] Toggle expand/collapse only on header empty space click
  const cardHeader = card.querySelector('.note-card-header');
  cardHeader.addEventListener('click', (e) => {
    // Only toggle if clicking on the header itself or .note-source container
    // Don't toggle if clicking on buttons, links, or other interactive elements
    const isButton = e.target.closest('button');
    const isLink = e.target.closest('a');
    const isInteractive = isButton || isLink;

    if (!isInteractive) {
      card.classList.toggle('expanded');
      card.setAttribute('aria-expanded', card.classList.contains('expanded'));
    }
  });

  // Keyboard interaction for note card
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      card.classList.toggle('expanded');
      card.setAttribute('aria-expanded', card.classList.contains('expanded'));
    }
  });

  // [NOT-35] Star button
  const starButton = card.querySelector('.star-button');
  if (note.starred) {
    starButton.classList.add('active');
    starButton.setAttribute('title', 'Unstar note');
    starButton.setAttribute('aria-label', 'Unstar note');
  }
  starButton.addEventListener('click', async (e) => {
    e.stopPropagation();
    await handleToggleStar(note.id, starButton);
  });

  // [NOT-18] Read Later button
  const readLaterButton = card.querySelector('.read-later-button');
  if (note.readLater) {
    readLaterButton.classList.add('active');
    readLaterButton.setAttribute('title', 'Remove from read later');
    readLaterButton.setAttribute('aria-label', 'Remove from read later');
  }
  readLaterButton.addEventListener('click', async (e) => {
    e.stopPropagation();
    await handleToggleReadLater(note.id, readLaterButton);
  });

  // [NOT-19] Edit button
  const editButton = card.querySelector('.edit-button');
  editButton.addEventListener('click', (e) => {
    e.stopPropagation();
    handleEnterEditMode(note.id, card);
  });

  // Delete button
  const deleteButton = card.querySelector('.delete-button');
  deleteButton.addEventListener('click', async (e) => {
    e.stopPropagation();
    await handleDeleteNote(note.id, deleteButton);
  });

  return card;
}

/**
 * [NOT-18] [NOT-23] Delete a note from the database with smooth animation
 * Implements safe async pattern with button disabling and rollback on error
 *
 * @param {string} noteId - The ID of the note to delete
 * @param {HTMLElement} button - The delete button to disable during operation
 */
async function handleDeleteNote(noteId, button) {
  if (!confirm('Delete this clip?')) {
    return;
  }

  log('🗑️  Deleting note:', noteId);

  // Store original state for rollback
  const originalNotes = [...allNotes];

  // [NOT-35] Disable button to prevent rapid clicks
  // Opacity is handled by CSS :disabled state
  if (button) {
    button.disabled = true;
  }

  // [NOT-23] Find the card element and trigger exit animation
  const cardElement = button.closest('.note-card');
  if (cardElement) {
    cardElement.classList.add('removing');

    // [NOT-23] Wait for animation to complete
    // Duration matches CSS variable --duration-base (200ms)
    // If you change --duration-base in styles.css, update this value to match
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  try {
    // Delete from IndexedDB
    await window.database.deleteNote(noteId);

    // Remove from local array
    allNotes = allNotes.filter(note => note.id !== noteId);

    log('✅ Note deleted');

    // Re-render
    filterAndRenderNotes();
    populateFilterDropdown();

  } catch (error) {
    error('❌ Error deleting note:', error);

    // Rollback local state on error
    allNotes = originalNotes;

    // [NOT-23] Remove the .removing class if deletion failed
    if (cardElement) {
      cardElement.classList.remove('removing');
    }

    // Re-render to show correct state
    filterAndRenderNotes();
    populateFilterDropdown();

    alert('Failed to delete clip. Please try again.');
  } finally {
    // Always re-enable button
    if (button) {
      button.disabled = false;
    }
  }
}

/**
 * [NOT-18] Toggle the Read Later status of a note
 * Updates the database and refreshes the UI to reflect the change
 * Prevents race conditions by disabling the button during the async operation
 *
 * @param {string} noteId - The ID of the note to toggle
 * @param {HTMLElement} button - The button element to disable during operation
 */
async function handleToggleReadLater(noteId, button) {
  log('🕐 Toggling read later for note:', noteId);

  // Find the note in local array
  const note = allNotes.find(n => n.id === noteId);
  if (!note) {
    error('❌ Note not found:', noteId);
    return;
  }

  // Store original state for rollback
  const originalState = note.readLater;

  // [NOT-35] Disable button to prevent rapid clicks
  // Opacity is handled by CSS :disabled state
  if (button) {
    button.disabled = true;
  }

  try {
    // Optimistically update local state
    note.readLater = !note.readLater;

    // Update in IndexedDB
    await window.database.updateNote(noteId, { readLater: note.readLater });

    log(`✅ Read later toggled: ${note.readLater}`);

    // [NOT-18] Update button visual state without full re-render to prevent flash
    if (button) {
      if (note.readLater) {
        button.classList.add('active');
        button.setAttribute('title', 'Remove from read later');
        button.setAttribute('aria-label', 'Remove from read later');
      } else {
        button.classList.remove('active');
        button.setAttribute('title', 'Mark as read later');
        button.setAttribute('aria-label', 'Mark as read later');
      }
    }

    // Only re-render if Read Later filter is active (note might need to be hidden)
    if (filterState.readLater) {
      filterAndRenderNotes();
    }

  } catch (error) {
    error('❌ Error toggling read later:', error);

    // Revert local state on error
    note.readLater = originalState;

    // Revert button visual state
    if (button) {
      if (originalState) {
        button.classList.add('active');
        button.setAttribute('title', 'Remove from read later');
        button.setAttribute('aria-label', 'Remove from read later');
      } else {
        button.classList.remove('active');
        button.setAttribute('title', 'Mark as read later');
        button.setAttribute('aria-label', 'Mark as read later');
      }
    }

    // Only re-render if filter is active
    if (filterState.readLater) {
      filterAndRenderNotes();
    }

    alert('Failed to update read later status. Please try again.');
  } finally {
    // Re-enable button
    if (button) {
      button.disabled = false;
    }
  }
}

/**
 * [NOT-35] Toggle the Starred status of a note
 * Updates the database and refreshes the UI to reflect the change
 * Prevents race conditions by disabling the button during the async operation
 *
 * @param {string} noteId - The ID of the note to toggle
 * @param {HTMLElement} button - The button element to disable during operation
 */
async function handleToggleStar(noteId, button) {
  log('⭐ Toggling star for note:', noteId);

  // Find the note in local array
  const note = allNotes.find(n => n.id === noteId);
  if (!note) {
    error('❌ Note not found:', noteId);
    return;
  }

  // Store original state for rollback
  const originalState = note.starred;

  // [NOT-35] Disable button to prevent rapid clicks
  // Opacity is handled by CSS :disabled state
  if (button) {
    button.disabled = true;
  }

  try {
    // Optimistically update local state
    note.starred = !note.starred;

    // Update in IndexedDB
    await window.database.updateNote(noteId, { starred: note.starred });

    log(`✅ Star toggled: ${note.starred}`);

    // [NOT-35] Update button visual state without full re-render to prevent flash
    if (button) {
      if (note.starred) {
        button.classList.add('active');
        button.setAttribute('title', 'Unstar note');
        button.setAttribute('aria-label', 'Unstar note');
      } else {
        button.classList.remove('active');
        button.setAttribute('title', 'Star note');
        button.setAttribute('aria-label', 'Star note');
      }
    }

    // Only re-render if Starred filter is active (note might need to be hidden)
    if (filterState.starred) {
      filterAndRenderNotes();
    }

  } catch (error) {
    error('❌ Error toggling star:', error);

    // Revert local state on error
    note.starred = originalState;

    // Revert button visual state
    if (button) {
      if (originalState) {
        button.classList.add('active');
        button.setAttribute('title', 'Unstar note');
        button.setAttribute('aria-label', 'Unstar note');
      } else {
        button.classList.remove('active');
        button.setAttribute('title', 'Star note');
        button.setAttribute('aria-label', 'Star note');
      }
    }

    // Only re-render if filter is active
    if (filterState.starred) {
      filterAndRenderNotes();
    }

    alert('Failed to update star status. Please try again.');
  } finally {
    // Re-enable button
    if (button) {
      button.disabled = false;
    }
  }
}

/**
 * [NOT-19] Enter edit mode for a note
 * Replaces the static note content with an editable form
 *
 * @param {string} noteId - The ID of the note to edit
 * @param {HTMLElement} cardElement - The note card DOM element
 */
function handleEnterEditMode(noteId, cardElement) {
  // [NOT-19] Prevent duplicate edit forms
  if (cardElement.classList.contains('editing')) {
    return;
  }

  const note = allNotes.find(n => n.id === noteId);
  if (!note) {
    error('❌ Note not found:', noteId);
    return;
  }

  log('✏️  Entering edit mode for note:', noteId);

  // [NOT-33] Set edit mode flags
  isEditModeActive = true;
  editModeNoteId = noteId;

  // Mark card as being in edit mode
  cardElement.classList.add('editing');

  // Hide read-only elements
  const userNoteEl = cardElement.querySelector('.note-user-note');
  const tagsEl = cardElement.querySelector('.note-tags');

  // Create edit form
  const editForm = document.createElement('div');
  editForm.className = 'note-edit-form';

  // User note textarea
  const noteLabel = document.createElement('label');
  noteLabel.className = 'edit-label';
  noteLabel.textContent = 'Your Notes';

  const noteTextarea = document.createElement('textarea');
  noteTextarea.className = 'edit-textarea';
  noteTextarea.value = note.userNote || '';
  noteTextarea.placeholder = 'Add your thoughts, context, or questions...';
  noteTextarea.rows = 4;

  // [NOT-22] Tags input using TagInput component
  const tagsLabel = document.createElement('label');
  tagsLabel.className = 'edit-label';
  tagsLabel.textContent = 'Tags';

  const tagsContainer = document.createElement('div');
  const editTagInput = new TagInput(tagsContainer, note.tags);

  // Store reference to TagInput on the card element for later retrieval
  cardElement._editTagInput = editTagInput;

  // [NOT-33] Image management section for edit mode
  // Initialize editModeImages with note's existing images
  editModeImages = [];
  if (note.images && Array.isArray(note.images)) {
    editModeImages = [...note.images];
  } else if (note.imageData && typeof note.imageData === 'string') {
    // Backward compatibility for legacy single imageData
    editModeImages = [{
      id: crypto.randomUUID(),
      data: note.imageData,
      timestamp: note.timestamp || Date.now()
    }];
  }

  const imagesLabel = document.createElement('label');
  imagesLabel.className = 'edit-label';
  imagesLabel.textContent = 'Images';

  // Hidden file input for edit mode
  const editFileInput = document.createElement('input');
  editFileInput.type = 'file';
  editFileInput.accept = 'image/*';
  editFileInput.multiple = true;
  editFileInput.className = 'hidden';
  editFileInput.id = `edit-file-input-${noteId}`;

  editFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileUpload(e.target.files, true); // Pass isEditMode = true
      e.target.value = ''; // Reset for reuse
    }
  });

  // Add Image Controls for edit mode
  const editImageControls = document.createElement('div');
  editImageControls.className = 'add-image-controls';

  const uploadButton = document.createElement('button');
  uploadButton.className = 'add-image-button';
  uploadButton.type = 'button';
  uploadButton.title = 'Upload images from device';

  const uploadIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  uploadIcon.classList.add('icon', 'icon-sm');
  const uploadUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  uploadUse.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#icon-upload');
  uploadIcon.appendChild(uploadUse);

  const uploadSpan = document.createElement('span');
  uploadSpan.textContent = 'Upload';

  uploadButton.appendChild(uploadIcon);
  uploadButton.appendChild(uploadSpan);
  uploadButton.addEventListener('click', (e) => {
    e.preventDefault();
    editFileInput.click();
  });

  editImageControls.appendChild(uploadButton);

  // [NOT-33] Add "Capture from Webpage" button for edit mode
  const captureButton = document.createElement('button');
  captureButton.className = 'add-image-button';
  captureButton.type = 'button';
  captureButton.id = 'edit-capture-webpage-image-button';
  captureButton.title = 'Capture image from webpage';

  const captureIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  captureIcon.classList.add('icon', 'icon-sm');
  const captureUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  captureUse.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#icon-image');
  captureIcon.appendChild(captureUse);

  const captureSpan = document.createElement('span');
  captureSpan.textContent = 'Capture from Webpage';

  captureButton.appendChild(captureIcon);
  captureButton.appendChild(captureSpan);
  captureButton.addEventListener('click', (e) => {
    e.preventDefault();
    activateWebCaptureMode('edit-capture-webpage-image-button');
  });

  editImageControls.appendChild(captureButton);

  // Action buttons
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'edit-actions';

  const saveButton = document.createElement('button');
  saveButton.className = 'edit-save-button';
  saveButton.textContent = 'Save';
  saveButton.addEventListener('click', (e) => {
    e.stopPropagation();
    // [NOT-22] [NOT-33] Get tags and images
    const tags = cardElement._editTagInput ? cardElement._editTagInput.getTags() : [];
    handleSaveEdit(noteId, cardElement, noteTextarea.value, tags, editModeImages);
  });

  const cancelButton = document.createElement('button');
  cancelButton.className = 'edit-cancel-button';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', (e) => {
    e.stopPropagation();
    handleCancelEdit(noteId, cardElement);
  });

  actionsDiv.appendChild(saveButton);
  actionsDiv.appendChild(cancelButton);

  // Assemble form
  editForm.appendChild(noteLabel);
  editForm.appendChild(noteTextarea);
  editForm.appendChild(tagsLabel);
  editForm.appendChild(tagsContainer);
  // [NOT-33] Add image management UI
  editForm.appendChild(imagesLabel);
  editForm.appendChild(editFileInput);
  editForm.appendChild(editImageControls);
  editForm.appendChild(actionsDiv);

  // [NOT-33] Render images in the existing thumbnail area with delete buttons
  renderEditModeImageGallery(cardElement, editModeImages);

  // [NOT-19] Prevent edit form clicks from triggering card expand/collapse
  editForm.addEventListener('click', (e) => e.stopPropagation());

  // [NOT-33] Insert form after the note-card-body for better space utilization
  // This places the edit form below the thumbnail/title area
  const cardBody = cardElement.querySelector('.note-card-body');
  if (cardBody) {
    cardBody.insertAdjacentElement('afterend', editForm);
  } else {
    // Fallback to old behavior if structure is different
    if (tagsEl) {
      tagsEl.insertAdjacentElement('afterend', editForm);
    } else if (userNoteEl) {
      userNoteEl.insertAdjacentElement('afterend', editForm);
    }
  }

  // Hide original elements in the card body
  if (userNoteEl) userNoteEl.style.display = 'none';
  if (tagsEl) tagsEl.style.display = 'none';

  // [NOT-33] Hide the expanded content section to avoid duplication
  const expandedContent = cardElement.querySelector('.note-expanded-content');
  if (expandedContent) expandedContent.style.display = 'none';

  // Focus the textarea
  noteTextarea.focus();

  // Keyboard shortcuts (Cmd+Enter to save, Esc to cancel)
  noteTextarea.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      saveButton.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelButton.click();
    }
  });
}

/**
 * [NOT-19] Save edits to a note
 * Implements safe async pattern with button disabling and rollback on error
 *
 * @param {string} noteId - The ID of the note to save
 * @param {HTMLElement} cardElement - The note card DOM element
 * @param {string} newUserNote - The updated user note text
 * @param {Array<string>} newTags - The updated tags array (already with # prefix)
 */
async function handleSaveEdit(noteId, cardElement, newUserNote, newTags, newImages = null) {
  const note = allNotes.find(n => n.id === noteId);
  if (!note) {
    error('❌ Note not found:', noteId);
    return;
  }

  log('💾 [NOT-33] Saving edits for note:', noteId);

  // Store original state for rollback
  const originalUserNote = note.userNote;
  const originalTags = [...note.tags];
  const originalImages = note.images ? [...note.images] : [];

  // Find buttons
  const saveButton = cardElement.querySelector('.edit-save-button');
  const cancelButton = cardElement.querySelector('.edit-cancel-button');

  // Disable buttons during async operation
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.style.opacity = '0.5';
  }
  if (cancelButton) {
    cancelButton.disabled = true;
    cancelButton.style.opacity = '0.5';
  }

  try {
    // [NOT-22] Tags already come with # prefix from TagInput component

    // Optimistically update local state
    note.userNote = newUserNote.trim();
    note.tags = newTags;

    // [NOT-33] Update images if provided
    if (newImages !== null) {
      note.images = newImages;
    }

    // Update in IndexedDB
    const updates = {
      userNote: note.userNote,
      tags: note.tags
    };

    // [NOT-33] Include images in update if changed
    if (newImages !== null) {
      updates.images = note.images;
    }

    await window.database.updateNote(noteId, updates);

    log('✅ [NOT-33] Note updated successfully');

    // [NOT-38] Re-index note for semantic search if content changed
    try {
      await chrome.runtime.sendMessage({
        action: 'INDEX_NOTE',
        note: note
      });
      log('✅ [NOT-38] Note re-indexed for semantic search');
    } catch (error) {
      // Don't fail the update if indexing fails
      warn('⚠️  [NOT-38] Failed to re-index note for search:', error);
    }

    // [NOT-33] Reset edit mode flags before exiting (handleCancelEdit will do this too, but let's be explicit)
    isEditModeActive = false;
    editModeNoteId = null;
    editModeImages = [];

    // Stop listening mode if active
    if (isWebCaptureListening) {
      isWebCaptureListening = false;
      log('⏹️  [NOT-33] Stopped web capture listening (edit saved)');
    }

    // Exit edit mode
    handleCancelEdit(noteId, cardElement);

    // [NOT-19] Re-render to ensure note is filtered correctly if search/filters active
    filterAndRenderNotes();

    // If tags changed, update the filter dropdown
    if (JSON.stringify(originalTags) !== JSON.stringify(newTags)) {
      populateFilterDropdown();
    }

  } catch (error) {
    error('❌ Error saving note edits:', error);

    // Rollback local state on error
    note.userNote = originalUserNote;
    note.tags = originalTags;
    note.images = originalImages;

    alert('Failed to save changes. Please try again.');
  } finally {
    // Re-enable buttons
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.style.opacity = '';
    }
    if (cancelButton) {
      cancelButton.disabled = false;
      cancelButton.style.opacity = '';
    }
  }
}

/**
 * [NOT-19] Cancel edit mode and revert to read-only view
 * Removes the edit form and shows the original note content
 *
 * @param {string} noteId - The ID of the note
 * @param {HTMLElement} cardElement - The note card DOM element
 */
function handleCancelEdit(noteId, cardElement) {
  log('↩️  Canceling edit mode for note:', noteId);

  const note = allNotes.find(n => n.id === noteId);
  if (!note) {
    error('❌ Note not found:', noteId);
    return;
  }

  // [NOT-33] Reset edit mode flags
  isEditModeActive = false;
  editModeNoteId = null;
  editModeImages = [];

  // [NOT-33] Stop listening mode if active
  if (isWebCaptureListening) {
    isWebCaptureListening = false;
    log('⏹️  [NOT-33] Stopped web capture listening (edit cancelled)');
  }

  // Remove edit mode class
  cardElement.classList.remove('editing');

  // [NOT-22] Clean up TagInput reference
  delete cardElement._editTagInput;

  // Remove edit form
  const editForm = cardElement.querySelector('.note-edit-form');
  if (editForm) {
    editForm.remove();
  }

  // Show original elements and update their content
  const userNoteEl = cardElement.querySelector('.note-user-note');
  const tagsEl = cardElement.querySelector('.note-tags');

  if (userNoteEl) {
    userNoteEl.style.display = '';
    if (note.userNote) {
      userNoteEl.textContent = note.userNote;
      userNoteEl.style.display = '';
    } else {
      userNoteEl.style.display = 'none';
    }
  }

  if (tagsEl) {
    tagsEl.style.display = '';
    // [NOT-19] Clear tags using proper DOM removal (not innerHTML)
    while (tagsEl.firstChild) {
      tagsEl.removeChild(tagsEl.firstChild);
    }
    // Re-populate tags
    if (note.tags.length > 0) {
      note.tags.forEach(tag => {
        const tagEl = document.createElement('span');
        tagEl.className = 'note-tag';
        tagEl.textContent = tag;
        tagsEl.appendChild(tagEl);
      });
      tagsEl.style.display = '';
    } else {
      tagsEl.style.display = 'none';
    }
  }

  // [NOT-33] Restore expanded content visibility
  const expandedContent = cardElement.querySelector('.note-expanded-content');
  if (expandedContent) expandedContent.style.display = '';

  // [NOT-33] Restore thumbnail area to normal display
  const thumbnailContainer = cardElement.querySelector('.note-thumbnail');
  if (thumbnailContainer) {
    thumbnailContainer.classList.remove('edit-mode-gallery');
    thumbnailContainer.innerHTML = ''; // Clear gallery items

    // Restore original thumbnail display if note has images
    if (note.images && note.images.length > 0) {
      const img = document.createElement('img');
      img.src = note.images[0].data;
      img.alt = 'Note thumbnail';
      thumbnailContainer.appendChild(img);

      // Add badge if multiple images
      if (note.images.length > 1) {
        const badge = document.createElement('div');
        badge.className = 'image-count-badge';
        badge.textContent = `+${note.images.length - 1}`;
        badge.title = `${note.images.length} images`;
        thumbnailContainer.appendChild(badge);
      }

      // Restore click handler
      thumbnailContainer.addEventListener('click', (e) => {
        e.stopPropagation();
        openLightbox(note.images, 0);
      });

      thumbnailContainer.classList.remove('hidden');
    } else if (note.imageData) {
      // Legacy single image support
      const img = document.createElement('img');
      img.src = note.imageData;
      img.alt = 'Note thumbnail';
      thumbnailContainer.appendChild(img);
      thumbnailContainer.classList.remove('hidden');
    } else {
      thumbnailContainer.classList.add('hidden');
    }
  }
}

/**
 * [NOT-29] [NOT-33] Open lightbox to view images at full size with gallery navigation
 * @param {Array<Object>|string} imagesOrData - Array of image objects [{id, data, timestamp}] or single image data URL
 * @param {number} startIndex - Starting index for gallery (default: 0)
 * @param {string} containerId - Optional container ID for edit mode (enables delete button)
 */
function openLightbox(imagesOrData, startIndex = 0, containerId = null) {
  log('🔍 [NOT-33] Opening lightbox');

  const lightbox = document.getElementById('lightbox-modal');
  const lightboxImage = lightbox.querySelector('.lightbox-image');
  const closeButton = lightbox.querySelector('.lightbox-close');
  const downloadButton = lightbox.querySelector('.lightbox-download');
  const backdrop = lightbox.querySelector('.lightbox-backdrop');
  const prevButton = lightbox.querySelector('.lightbox-prev');
  const nextButton = lightbox.querySelector('.lightbox-next');
  const counter = lightbox.querySelector('.lightbox-counter');
  const counterCurrent = lightbox.querySelector('.lightbox-counter-current');
  const counterTotal = lightbox.querySelector('.lightbox-counter-total');

  // [NOT-33] Get or create delete button for edit mode
  let deleteButton = lightbox.querySelector('.lightbox-delete');
  if (!deleteButton) {
    deleteButton = document.createElement('button');
    deleteButton.className = 'lightbox-delete';
    deleteButton.title = 'Delete image';
    deleteButton.setAttribute('aria-label', 'Delete image');

    const deleteIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    deleteIcon.classList.add('icon', 'icon-sm');
    const deleteUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    deleteUse.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#icon-trash');
    deleteIcon.appendChild(deleteUse);
    deleteButton.appendChild(deleteIcon);

    // Insert before download button
    downloadButton.parentNode.insertBefore(deleteButton, downloadButton);
  }

  // [NOT-33] Normalize input to array format
  let images = [];
  if (typeof imagesOrData === 'string') {
    // Single image data URL (backward compatibility)
    images = [{ id: 'single', data: imagesOrData, timestamp: Date.now() }];
  } else if (Array.isArray(imagesOrData)) {
    images = imagesOrData;
  } else {
    error('❌ Invalid images data:', imagesOrData);
    return;
  }

  let currentIndex = Math.max(0, Math.min(startIndex, images.length - 1));

  // [NOT-33] Show/hide delete button based on edit mode
  if (containerId) {
    // Edit mode - show delete button
    deleteButton.classList.remove('hidden');
  } else {
    // View mode - hide delete button
    deleteButton.classList.add('hidden');
  }

  // [NOT-33] Function to show image at current index
  const showImage = (index) => {
    currentIndex = index;
    const currentImage = images[currentIndex];

    lightboxImage.src = currentImage.data;

    // Update counter
    if (counterCurrent && counterTotal) {
      counterCurrent.textContent = currentIndex + 1;
      counterTotal.textContent = images.length;
    }

    // Show/hide navigation buttons
    if (images.length > 1) {
      if (prevButton) {
        prevButton.classList.remove('hidden');
        prevButton.disabled = currentIndex === 0;
      }
      if (nextButton) {
        nextButton.classList.remove('hidden');
        nextButton.disabled = currentIndex === images.length - 1;
      }
      if (counter) {
        counter.classList.remove('hidden');
      }
    } else {
      if (prevButton) prevButton.classList.add('hidden');
      if (nextButton) nextButton.classList.add('hidden');
      if (counter) counter.classList.add('hidden');
    }

    log(`🖼️  [NOT-33] Showing image ${currentIndex + 1} of ${images.length}`);
  };

  // [NOT-33] Delete current image (edit mode only)
  const handleDelete = () => {
    if (!containerId) return; // Safety check

    if (!confirm('Delete this image?')) {
      return;
    }

    log(`🗑️  [NOT-33] Deleting image ${currentIndex + 1} of ${images.length}`);

    // Remove from array
    images.splice(currentIndex, 1);

    // Re-render the preview list
    const isEditMode = containerId.includes('edit');
    renderImagePreviews(containerId, images, isEditMode);

    // Decide what to do next
    if (images.length === 0) {
      // No more images - close lightbox
      closeLightbox();
    } else {
      // Show next image, or previous if we deleted the last one
      if (currentIndex >= images.length) {
        currentIndex = images.length - 1;
      }
      showImage(currentIndex);
    }
  };

  // [NOT-33] Navigation handlers
  const goToPrev = () => {
    if (currentIndex > 0) {
      showImage(currentIndex - 1);
    }
  };

  const goToNext = () => {
    if (currentIndex < images.length - 1) {
      showImage(currentIndex + 1);
    }
  };

  // [NOT-33] Keyboard navigation
  const handleKeyboard = (e) => {
    if (e.key === 'Escape') {
      closeLightbox();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goToPrev();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      goToNext();
    }
  };

  // Show initial image
  showImage(currentIndex);

  // Show lightbox
  lightbox.classList.remove('hidden');

  // Set up event listeners
  backdrop.onclick = closeLightbox;
  closeButton.onclick = closeLightbox;

  if (prevButton) {
    prevButton.onclick = goToPrev;
  }

  if (nextButton) {
    nextButton.onclick = goToNext;
  }

  downloadButton.onclick = () => handleDownloadImage(images[currentIndex].data);

  // [NOT-33] Delete button handler (edit mode only)
  deleteButton.onclick = handleDelete;

  document.addEventListener('keydown', handleKeyboard);

  // Store cleanup function
  lightbox._cleanup = () => {
    document.removeEventListener('keydown', handleKeyboard);
  };
}

/**
 * [NOT-29] [NOT-33] Close the lightbox modal
 */
function closeLightbox() {
  log('❌ Closing lightbox');

  const lightbox = document.getElementById('lightbox-modal');

  // [NOT-33] Clean up event listeners
  if (lightbox._cleanup) {
    lightbox._cleanup();
    delete lightbox._cleanup;
  }

  lightbox.classList.add('hidden');
}

/**
 * [NOT-29] [NOT-33] Download image to local disk
 * Detects MIME type from Base64 prefix to use correct file extension
 *
 * @param {string} imageData - Base64 image data URL (e.g., data:image/jpeg;base64,...)
 */
function handleDownloadImage(imageData) {
  log('💾 Downloading image');

  try {
    // [NOT-29] Extract MIME type from data URL to determine correct extension
    let extension = 'png'; // Safe default
    const mimeMatch = imageData.match(/^data:image\/([a-z]+);base64,/i);

    if (mimeMatch && mimeMatch[1]) {
      const mimeType = mimeMatch[1].toLowerCase();

      // Map common MIME types to extensions
      const mimeToExt = {
        'jpeg': 'jpg',
        'jpg': 'jpg',
        'png': 'png',
        'gif': 'gif',
        'webp': 'webp',
        'svg+xml': 'svg',
        'bmp': 'bmp',
        'ico': 'ico'
      };

      extension = mimeToExt[mimeType] || 'png';
      log(`📝 Detected MIME type: image/${mimeType}, using extension: .${extension}`);
    }

    // Create a temporary link element
    const link = document.createElement('a');
    link.href = imageData;
    link.download = `knowledge-clipper-image-${Date.now()}.${extension}`;

    // Trigger download
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    log('✅ Image download initiated');
  } catch (error) {
    error('❌ Error downloading image:', error);
    alert('Failed to download image. Please try again.');
  }
}



// =============================================================================
// @AI - Chat, Contextual Recall & Synthesis
// =============================================================================

/**
 * [NOT-34] AI Chat Mode
 */
/**
 * [NOT-46] AI Chat Mode - Renders the chat interface
 * Loads chat history, initializes AI harness, and sets up event listeners
 */
async function renderAIChatMode() {
  currentMode = 'ai-chat';
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
  } catch (error) {
    error('[NOT-51] Failed to load preferred model:', error);
  }

  // State for current chat
  let currentChatId = null;
  let isStreaming = false;

  /**
   * Load or create chat session
   * [NOT-51] Now uses preferredModel from storage instead of selector
   * [NOT-51] Fixed: Clear only message bubbles, not empty state element
   */
  async function loadChat() {
    try {
      const latestChat = await window.database.getLatestChat();

      if (latestChat) {
        currentChatId = latestChat.id;
        log('[NOT-46] Loaded existing chat:', currentChatId);

        // Load message history
        const messages = await window.database.getChatHistory(currentChatId);

        // [NOT-51] Clear only message bubbles, preserve empty state element
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
        // [NOT-51] Create new chat with preferred model
        currentChatId = await window.database.createChat('New Chat', preferredModel);
        log('[NOT-46] Created new chat:', currentChatId);
        emptyState.classList.remove('hidden');
      }
    } catch (error) {
      error('[NOT-46] Failed to load chat:', error);
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
    if (!text || isStreaming) return;

    // Disable input
    chatInput.disabled = true;
    sendButton.disabled = true;
    sendButton.classList.add('loading');
    isStreaming = true;

    try {
      // Render user message
      renderMessage('user', text);
      await window.database.addMessage(currentChatId, 'user', text);

      // Clear input
      chatInput.value = '';
      chatInput.style.height = 'auto';

      // Get message history for context
      const messages = await window.database.getChatHistory(currentChatId);
      const messageHistory = messages.map(m => ({
        role: m.role,
        content: m.content
      }));

      // Create AI message bubble with streaming cursor
      const aiContentDiv = renderMessage('assistant', '');
      const cursor = document.createElement('span');
      cursor.className = 'streaming-cursor';
      aiContentDiv.appendChild(cursor);

      let fullResponse = '';

      // Initialize harness
      await window.aiHarness.initialize('openrouter');

      // [NOT-51] Send message with streaming using preferred model
      await window.aiHarness.sendMessage(
        text,
        {
          messages: messageHistory.slice(0, -1), // Don't include the message we just added
          modelId: preferredModel
        },
        // onChunk
        (chunk) => {
          fullResponse += chunk;
          aiContentDiv.textContent = fullResponse;
          aiContentDiv.appendChild(cursor); // Re-add cursor after text update
          chatMessages.scrollTop = chatMessages.scrollHeight;
        },
        // onComplete
        async () => {
          cursor.remove();
          await window.database.addMessage(currentChatId, 'assistant', fullResponse);
          log('[NOT-46] Message sent and saved');
          isStreaming = false;
          chatInput.disabled = false;
          sendButton.disabled = false;
          sendButton.classList.remove('loading');
          chatInput.focus();
        },
        // onError
        (error) => {
          cursor.remove();
          aiContentDiv.textContent = `Error: ${error.message}`;
          aiContentDiv.style.color = 'var(--color-error)';
          error('[NOT-46] Chat error:', error);
          isStreaming = false;
          chatInput.disabled = false;
          sendButton.disabled = false;
          sendButton.classList.remove('loading');
        }
      );
    } catch (error) {
      error('[NOT-46] Failed to send message:', error);
      isStreaming = false;
      chatInput.disabled = false;
      sendButton.disabled = false;
      sendButton.classList.remove('loading');
    }
  }

  /**
   * Clear chat history
   * [NOT-51] Fixed: Use preferredModel instead of deleted modelSelector
   */
  async function clearChat() {
    if (!currentChatId) return;

    const confirmed = confirm('Clear all messages in this chat?');
    if (!confirmed) return;

    try {
      await window.database.deleteChat(currentChatId);

      // [NOT-51] Create new chat with preferred model
      currentChatId = await window.database.createChat('New Chat', preferredModel);

      // [NOT-51] Clear only message bubbles, preserve empty state
      const bubbles = chatMessages.querySelectorAll('.chat-bubble');
      bubbles.forEach(bubble => bubble.remove());
      emptyState.classList.remove('hidden');

      log('[NOT-46] Chat cleared');
    } catch (error) {
      error('[NOT-46] Failed to clear chat:', error);
    }
  }

  /**
   * Handle input changes
   */
  function handleInputChange() {
    const hasText = chatInput.value.trim().length > 0;
    sendButton.disabled = !hasText || isStreaming;

    // Auto-resize textarea
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  }

  /**
   * Handle Enter key in chat input
   */
  function handleChatKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // [NOT-51] Remove old event listeners before adding new ones to prevent duplicates
  sendButton.removeEventListener('click', sendMessage);
  sendButton.addEventListener('click', sendMessage);

  chatInput.removeEventListener('input', handleInputChange);
  chatInput.addEventListener('input', handleInputChange);

  chatInput.removeEventListener('keydown', handleChatKeydown);
  chatInput.addEventListener('keydown', handleChatKeydown);

  clearButton.removeEventListener('click', clearChat);
  clearButton.addEventListener('click', clearChat);

  // Load chat on mount
  await loadChat();

  // Focus input
  chatInput.focus();
}

/**
 * [NOT-39] Render hybrid view with "From this Page" and "Related Concepts" sections
 * Used when context pill is clicked in semantic or hybrid state
 * @param {HTMLElement} notesListEl - The notes list container element
 */
async function renderHybridView(notesListEl) {
  try {
    // Get current tab URL for filtering exact matches
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;

    const currentUrl = tab.url;

    // Filter exact matches from all notes
    const exactMatches = allNotes.filter(note => note.url === currentUrl);

    let indexOffset = 0;

    // Section 1: "From this Page" (if we have exact matches)
    if (exactMatches.length > 0) {
      const header1 = document.createElement('div');
      header1.className = 'hybrid-section-header';
      header1.textContent = 'From this Page';
      notesListEl.appendChild(header1);

      exactMatches.forEach((note, index) => {
        const noteCard = createNoteCard(note, index);
        if (isExpandedAll) {
          noteCard.classList.add('expanded');
          noteCard.setAttribute('aria-expanded', 'true');
        }
        notesListEl.appendChild(noteCard);
      });

      indexOffset = exactMatches.length;
    }

    // Section 2: "Related Concepts" (if we have semantic matches)
    if (semanticMatches.length > 0) {
      // [NOT-40] AI Action Header (Synthesize Connections)
      const aiAction = document.createElement('button');
      aiAction.className = 'ai-action-header';
      aiAction.id = 'synthesize-button';
      aiAction.innerHTML = `
        <svg class="icon icon-sm" style="margin-right: 8px;">
          <use href="#icon-sparkle"></use>
        </svg>
        <span>Synthesize Connections</span>
      `;

      // [NOT-40] Disable button if Gemini Nano is not available
      if (!geminiAvailable) {
        aiAction.disabled = true;
        aiAction.classList.add('disabled');
        aiAction.title = 'Enable Gemini Nano in Chrome flags to use this feature';
        log('⚠️  [NOT-40] Synthesize button disabled - Gemini Nano unavailable');
      } else {
        aiAction.addEventListener('click', () => handleSynthesizeClick(semanticMatches));
      }

      notesListEl.appendChild(aiAction);

      const header2 = document.createElement('div');
      header2.className = 'hybrid-section-header ai-section';
      header2.textContent = 'Related Concepts';
      notesListEl.appendChild(header2);

      // [NOT-48] Use createNoteCard for semantic matches instead of renderInsightCard
      semanticMatches.forEach((matchResult, index) => {
        const { note } = matchResult;

        // [NOT-48] Hydrate with full note data from allNotes to ensure:
        // 1. Current state (starred, readLater) is reflected
        // 2. Complete metadata (siteName, favicon) is available
        const fullNote = allNotes.find(n => n.id === note.id);

        if (!fullNote) {
          warn(`⚠️ [NOT-48] Note ${note.id} not found in allNotes, skipping`);
          return; // Skip this note if not found
        }

        const noteCard = createNoteCard(fullNote, indexOffset + index);

        // [NOT-48] Add .related class for visual distinction
        noteCard.classList.add('related');

        // [NOT-48] Inject "Thumbs Down" feedback button into .note-actions
        const noteActions = noteCard.querySelector('.note-actions');
        if (noteActions) {
          const feedbackButton = document.createElement('button');
          feedbackButton.className = 'delete-button feedback-button';
          feedbackButton.title = 'Mark as not relevant';
          feedbackButton.setAttribute('aria-label', 'Mark this connection as not relevant');
          feedbackButton.innerHTML = `
            <svg class="icon icon-sm">
              <use href="#icon-x"></use>
            </svg>
          `;

          // [NOT-48] Add feedback handler
          feedbackButton.addEventListener('click', async (e) => {
            e.stopPropagation();
            await handleRelatedNoteFeedback(fullNote.id, noteCard);
          });

          // Insert feedback button as first action (before edit)
          noteActions.insertBefore(feedbackButton, noteActions.firstChild);
        }

        // Apply expand state if needed
        if (isExpandedAll) {
          noteCard.classList.add('expanded');
          noteCard.setAttribute('aria-expanded', 'true');
        }

        notesListEl.appendChild(noteCard);
      });
    }

    log(`📝 [NOT-39] [NOT-48] Rendered hybrid view: ${exactMatches.length} exact, ${semanticMatches.length} semantic`);
  } catch (err) {
    error('[NOT-39] [NOT-48] Error rendering hybrid view:', err);
  }
}

/**
 * [NOT-48] Handle feedback on related note card - mark connection as not relevant
 * Stores exclusion in database, removes card with animation, triggers context recall update
 * @param {string} noteId - The ID of the note to mark as irrelevant
 * @param {HTMLElement} cardElement - The note card element to remove
 * @returns {Promise<void>}
 */
async function handleRelatedNoteFeedback(noteId, cardElement) {
  try {
    // Get current tab URL for context
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      warn('[NOT-48] Cannot get current URL for feedback');
      return;
    }

    const currentUrl = tab.url;

    // Disable the feedback button to prevent duplicate clicks
    const feedbackButton = cardElement.querySelector('.feedback-button');
    if (feedbackButton) {
      feedbackButton.disabled = true;
      feedbackButton.style.opacity = '0.5';
    }

    // Store exclusion in database
    await window.database.addIgnoredConnection(noteId, currentUrl);
    log(`✅ [NOT-48] Marked connection as not relevant: ${noteId} on ${currentUrl}`);

    // Remove from semanticMatches array
    semanticMatches = semanticMatches.filter(match => match.note.id !== noteId);

    // Add removing animation class
    cardElement.classList.add('removing');

    // Show tooltip notification
    showTooltip(cardElement, 'Marked as not relevant');

    // Remove card after animation completes
    setTimeout(() => {
      cardElement.remove();

      // If no more semantic matches, refresh context pill to update count
      if (semanticMatches.length === 0) {
        checkContextualRecall();
      }
    }, 200); // Match animation duration

  } catch (err) {
    error('[NOT-48] Error handling related note feedback:', err);

    // Re-enable button on error
    const feedbackButton = cardElement.querySelector('.feedback-button');
    if (feedbackButton) {
      feedbackButton.disabled = false;
      feedbackButton.style.opacity = '1';
    }

    alert('Failed to mark connection as not relevant. Please try again.');
  }
}

/**
 * [NOT-40] Handle Synthesize button click
 * Generates AI synthesis from current page context and related notes
 * @param {Array} semanticMatches - Array of semantic match results
 */
async function handleSynthesizeClick(semanticMatches) {
  log('✨ [NOT-40] Synthesize Connections clicked');

  // Prevent multiple simultaneous syntheses
  if (window.geminiService.isSynthesizing) {
    log('⚠️  [NOT-40] Synthesis already in progress, ignoring click');
    return;
  }

  const button = document.getElementById('synthesize-button');
  if (!button) {
    error('❌ [NOT-40] Synthesize button not found');
    return;
  }

  try {
    // Disable button and show loading state
    button.disabled = true;
    button.classList.add('loading');
    const buttonText = button.querySelector('span');
    const originalText = buttonText.textContent;
    buttonText.textContent = 'Synthesizing...';

    // Get current page context
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentContext = {
      title: activeTab.title,
      url: activeTab.url
    };
    log('📄 [NOT-40] Current context:', currentContext);

    // Prepare related notes (already have them from semanticMatches)
    const relatedNotes = semanticMatches.map(match => ({
      note: match.note,
      similarity: match.similarity
    }));
    log('📚 [NOT-40] Related notes:', relatedNotes.length);

    // Generate synthesis using Gemini Nano
    const stream = await window.geminiService.generateSynthesis(currentContext, relatedNotes);
    log('🌊 [NOT-40] Stream received, starting output');

    // Display streaming output
    await displaySynthesisStream(stream, button);

    // Re-enable button after completion
    button.disabled = false;
    button.classList.remove('loading');
    buttonText.textContent = originalText;
    log('✅ [NOT-40] Synthesis completed successfully');

  } catch (error) {
    error('❌ [NOT-40] Synthesis failed:', error);

    // Show error message to user
    const notesListEl = document.getElementById('notes-list');
    const errorContainer = document.getElementById('synthesis-output');

    if (errorContainer) {
      errorContainer.innerHTML = `
        <div class="synthesis-error">
          <strong>Synthesis Failed</strong>
          <p>${error.message || 'An unexpected error occurred. Please try again.'}</p>
        </div>
      `;
    }

    // Re-enable button
    if (button) {
      button.disabled = false;
      button.classList.remove('loading');
      const buttonText = button.querySelector('span');
      if (buttonText) {
        buttonText.textContent = 'Synthesize Connections';
      }
    }
  }
}

/**
 * [NOT-40] Display streaming synthesis output
 * Consumes a ReadableStream and updates the DOM token-by-token
 * @param {ReadableStream} stream - The AI-generated text stream
 * @param {HTMLElement} button - The synthesize button element
 */
async function displaySynthesisStream(stream, button) {
  log('🌊 [NOT-40] Starting synthesis stream display');

  const notesListEl = document.getElementById('notes-list');
  if (!notesListEl) {
    error('❌ [NOT-40] Notes list element not found');
    return;
  }

  // Find or create synthesis output container
  let outputContainer = document.getElementById('synthesis-output');
  if (!outputContainer) {
    outputContainer = document.createElement('div');
    outputContainer.id = 'synthesis-output';
    outputContainer.className = 'synthesis-output';

    // Insert right after the synthesize button
    if (button && button.nextSibling) {
      notesListEl.insertBefore(outputContainer, button.nextSibling);
    } else {
      notesListEl.insertBefore(outputContainer, notesListEl.firstChild);
    }
  }

  // Clear previous content and show streaming cursor
  outputContainer.innerHTML = '<div class="synthesis-content streaming"></div>';
  const contentDiv = outputContainer.querySelector('.synthesis-content');

  try {
    let fullText = '';

    // Consume the stream token by token
    for await (const chunk of stream) {
      fullText += chunk;

      // Update the DOM with formatted content
      contentDiv.innerHTML = formatMarkdown(fullText) + '<span class="streaming-cursor"></span>';

      // Scroll to keep the output visible
      contentDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Remove streaming cursor when done
    contentDiv.classList.remove('streaming');
    contentDiv.innerHTML = formatMarkdown(fullText);

    log('✅ [NOT-40] Stream display completed');
  } catch (error) {
    error('❌ [NOT-40] Error displaying stream:', error);
    contentDiv.innerHTML = `<div class="synthesis-error">Error displaying synthesis: ${error.message}</div>`;
  }
}

/**
 * [NOT-40] Format markdown text to HTML
 * Handles basic markdown: bold, lists, paragraphs
 * @param {string} text - Raw markdown text
 * @returns {string} - HTML string
 */
function formatMarkdown(text) {
  if (!text) return '';

  // Escape HTML to prevent XSS
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Bold text: **text** or __text__
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic text: *text* or _text_
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Convert bullet points to list items
  // Handle lines starting with - or *
  const lines = html.split('\n');
  let inList = false;
  const processedLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check if line is a bullet point
    if (line.match(/^[-*]\s+/)) {
      const content = line.replace(/^[-*]\s+/, '');

      if (!inList) {
        processedLines.push('<ul>');
        inList = true;
      }

      processedLines.push(`<li>${content}</li>`);
    } else {
      // Not a bullet point
      if (inList) {
        processedLines.push('</ul>');
        inList = false;
      }

      // Add as paragraph if not empty
      if (line) {
        processedLines.push(`<p>${line}</p>`);
      }
    }
  }

  // Close list if still open
  if (inList) {
    processedLines.push('</ul>');
  }

  return processedLines.join('');
}

/**
 * [NOT-39] Show a temporary tooltip notification
 * @param {HTMLElement} anchorElement - Element to position tooltip near
 * @param {string} message - Message to display
 */
function showTooltip(anchorElement, message) {
  const tooltip = document.createElement('div');
  tooltip.className = 'feedback-tooltip';
  tooltip.textContent = message;
  tooltip.style.cssText = `
    position: fixed;
    background: var(--color-text-primary);
    color: white;
    padding: var(--spacing-sm) var(--spacing-md);
    border-radius: var(--radius-md);
    font-size: var(--font-size-sm);
    z-index: 1000;
    pointer-events: none;
    animation: enter-scale var(--duration-base) var(--ease-out-spring);
  `;

  // Position near the anchor element
  const rect = anchorElement.getBoundingClientRect();
  tooltip.style.top = `${rect.top}px`;
  tooltip.style.left = `${rect.left + rect.width / 2}px`;
  tooltip.style.transform = 'translateX(-50%)';

  document.body.appendChild(tooltip);

  // Remove after 2 seconds
  setTimeout(() => {
    tooltip.style.animation = 'exit-scale var(--duration-base) var(--ease-out-spring) forwards';
    setTimeout(() => tooltip.remove(), 200);
  }, 2000);
}

// =============================================================================
// @SETTINGS - Config & API Keys
// =============================================================================

/**
 * [NOT-40] Settings Mode - Shows Gemini Nano download status and settings
 */
async function renderSettingsMode() {
  currentMode = 'settings';
  navigateToView('settings-mode');

  // [NOT-46] Set up OpenRouter API key handlers
  await setupOpenRouterSettings();

  // [NOT-40] Load and display Gemini Nano status
  await updateGeminiStatusDisplay();

  // [NOT-40] Start polling for status updates if downloading
  startGeminiStatusPolling();
}

/**
 * [NOT-46] Set up OpenRouter API key settings
 * [NOT-51] Also handles preferred model selection
 * Loads saved key, sets up event handlers for save/test/visibility toggle
 */
async function setupOpenRouterSettings() {
  const apiKeyInput = document.getElementById('openrouter-api-key');
  const toggleVisibilityButton = document.getElementById('toggle-api-key-visibility');
  const saveButton = document.getElementById('save-settings-button');
  const testButton = document.getElementById('test-api-key-button');
  const statusDiv = document.getElementById('settings-status');
  const modelSelector = document.getElementById('preferred-model-selector'); // [NOT-51]

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
    } catch (error) {
      error('[NOT-46] Failed to load API key:', error);
    }
  }

  /**
   * [NOT-51] Populate model selector with available models
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
        option.title = model.description; // Tooltip with description
        modelSelector.appendChild(option);
      });

      log('[NOT-51] Populated model selector with', models.length, 'models');
    } catch (error) {
      error('[NOT-51] Failed to populate model selector:', error);
    }
  }

  /**
   * [NOT-51] Load saved preferred model
   */
  async function loadPreferredModel() {
    try {
      const { preferredModel } = await chrome.storage.local.get('preferredModel');
      const modelId = preferredModel || 'auto'; // Default to 'auto'
      modelSelector.value = modelId;
      log('[NOT-51] Loaded preferred model:', modelId);
    } catch (error) {
      error('[NOT-51] Failed to load preferred model:', error);
    }
  }

  /**
   * Save API key and preferred model
   * [NOT-51] Now also saves the preferred model selection
   */
  async function saveApiKey() {
    const apiKey = apiKeyInput.value.trim();
    const preferredModel = modelSelector.value; // [NOT-51]

    if (!apiKey) {
      showStatus('Please enter an API key', 'error');
      return;
    }

    saveButton.disabled = true;

    try {
      // [NOT-51] Save both API key and preferred model
      await chrome.storage.local.set({
        openRouterApiKey: apiKey,
        preferredModel: preferredModel
      });
      showStatus('Settings saved successfully!', 'success');
      log('[NOT-46] API key saved');
      log('[NOT-51] Preferred model saved:', preferredModel);
    } catch (error) {
      showStatus('Failed to save settings', 'error');
      error('[NOT-46] Failed to save settings:', error);
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
    } catch (error) {
      showStatus('❌ Test failed: ' + error.message, 'error');
      error('[NOT-46] API key test failed:', error);
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

  // Set up event listeners (remove old ones first to avoid duplicates)
  saveButton.removeEventListener('click', saveApiKey);
  saveButton.addEventListener('click', saveApiKey);

  testButton.removeEventListener('click', testApiKey);
  testButton.addEventListener('click', testApiKey);

  if (toggleVisibilityButton) {
    toggleVisibilityButton.removeEventListener('click', toggleVisibility);
    toggleVisibilityButton.addEventListener('click', toggleVisibility);
  }

  // Keyboard shortcut: Cmd/Ctrl + Enter to save
  apiKeyInput.removeEventListener('keydown', handleKeydown);
  apiKeyInput.addEventListener('keydown', handleKeydown);

  function handleKeydown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      saveApiKey();
    }
  }

  // [NOT-51] Populate model selector and load saved preferences
  populateModelSelector();
  await loadApiKey();
  await loadPreferredModel();
}

/**
 * [NOT-40] Update the Gemini Nano status display in settings
 */
async function updateGeminiStatusDisplay() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'GET_GEMINI_STATUS' });
    if (!response.success) {
      error('[NOT-40] Failed to get Gemini status:', response.error);
      return;
    }

    const status = response.status;
    log('[NOT-40] Gemini status:', status);

    const settingsContainer = document.getElementById('settings-mode');
    const statusSection = settingsContainer.querySelector('.gemini-status-section') ||
                          createGeminiStatusSection();

    if (!settingsContainer.querySelector('.gemini-status-section')) {
      // Clear placeholder and add status section
      const emptyState = settingsContainer.querySelector('.empty-state');
      if (emptyState) emptyState.remove();
      settingsContainer.appendChild(statusSection);
    }

    updateStatusUI(statusSection, status);
  } catch (error) {
    error('[NOT-40] Error updating Gemini status:', error);
  }
}

/**
 * [NOT-40] [NOT-43] Create the Gemini status section UI
 * Compact, modular layout that integrates seamlessly with other settings
 * @private
 */
function createGeminiStatusSection() {
  const section = document.createElement('div');
  section.className = 'gemini-status-section';
  section.innerHTML = `
    <div class="settings-header">
      <h2>AI Synthesis (Gemini Nano)</h2>
      <p class="settings-description">On-device AI for generating insights from your notes</p>
    </div>

    <div class="status-card">
      <div class="status-header">
        <div class="status-icon"></div>
        <div class="status-info">
          <div class="status-title"></div>
          <div class="status-message"></div>
        </div>
      </div>
      <div class="status-progress hidden">
        <div class="progress-bar">
          <div class="progress-fill"></div>
        </div>
        <div class="progress-text"></div>
      </div>
      <div class="status-actions hidden">
        <button id="initialize-gemini-button" class="primary-button">
          Download Gemini Nano
        </button>
      </div>
      <div class="status-error hidden">
        <div class="error-message"></div>
      </div>
    </div>

    <details class="settings-info">
      <summary>Show system requirements</summary>
      <div class="requirements-content">
        <ul>
          <li>Chrome 138+ (stable release)</li>
          <li>22 GB free storage</li>
          <li>16 GB RAM + 4 cores, OR 4 GB VRAM GPU</li>
          <li>Windows 10+, macOS 13+, Linux, or ChromeOS</li>
        </ul>
      </div>
    </details>
  `;

  // Wire up the initialize button
  const initButton = section.querySelector('#initialize-gemini-button');
  if (initButton) {
    initButton.addEventListener('click', handleInitializeGemini);
  }

  return section;
}

/**
 * [NOT-40] Update the status UI based on current state
 * @private
 */
function updateStatusUI(section, status) {
  const statusIcon = section.querySelector('.status-icon');
  const statusTitle = section.querySelector('.status-title');
  const statusMessage = section.querySelector('.status-message');
  const statusProgress = section.querySelector('.status-progress');
  const progressFill = section.querySelector('.progress-fill');
  const progressText = section.querySelector('.progress-text');
  const statusActions = section.querySelector('.status-actions');
  const statusError = section.querySelector('.status-error');
  const errorMessage = section.querySelector('.error-message');

  // Hide all optional elements by default
  statusProgress.classList.add('hidden');
  statusActions.classList.add('hidden');
  statusError.classList.add('hidden');

  switch (status.status) {
    case 'ready':
      statusIcon.textContent = '✅';
      statusTitle.textContent = 'Ready';
      statusMessage.textContent = 'Gemini Nano is installed and ready to synthesize your notes.';
      break;

    case 'downloading':
      statusIcon.textContent = '📥';
      statusTitle.textContent = 'Downloading...';
      statusMessage.textContent = 'Gemini Nano is being downloaded. This may take a few minutes.';
      statusProgress.classList.remove('hidden');
      const percentage = Math.round(status.progress * 100);
      progressFill.style.width = `${percentage}%`;
      progressText.textContent = `${percentage}% complete`;
      break;

    case 'checking':
      statusIcon.textContent = '🔍';
      statusTitle.textContent = 'Checking...';
      statusMessage.textContent = 'Checking if Gemini Nano is available on your system.';
      break;

    case 'unavailable':
      statusIcon.textContent = '⚠️';
      statusTitle.textContent = 'Not Available';
      statusMessage.textContent = 'Gemini Nano is not available on this system.';
      statusError.classList.remove('hidden');
      errorMessage.textContent = status.error || 'System does not meet requirements.';
      break;

    case 'error':
      statusIcon.textContent = '❌';
      statusTitle.textContent = 'Error';
      statusMessage.textContent = 'Failed to initialize Gemini Nano.';
      statusError.classList.remove('hidden');
      errorMessage.textContent = status.error || 'Unknown error occurred.';
      statusActions.classList.remove('hidden');
      break;

    case 'unknown':
    default:
      statusIcon.textContent = '⏳';
      statusTitle.textContent = 'Unknown';
      statusMessage.textContent = 'Gemini Nano status has not been checked yet.';
      statusActions.classList.remove('hidden');
      break;
  }
}

/**
 * [NOT-40] Handle Initialize Gemini button click
 */
async function handleInitializeGemini() {
  const button = document.getElementById('initialize-gemini-button');
  if (!button) return;

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Initializing...';

  try {
    log('[NOT-40] Manually triggering Gemini Nano initialization...');
    const response = await chrome.runtime.sendMessage({ action: 'INITIALIZE_GEMINI' });

    if (!response.success) {
      throw new Error(response.error || 'Initialization failed');
    }

    log('[NOT-40] Gemini Nano initialization triggered successfully');
    await updateGeminiStatusDisplay();

  } catch (error) {
    error('[NOT-40] Failed to initialize Gemini Nano:', error);
    alert(`Failed to initialize Gemini Nano: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

/**
 * [NOT-40] Start polling for Gemini status updates
 * Polls every 2 seconds while downloading or checking
 * Stops when status reaches a final state
 * @private
 */

function startGeminiStatusPolling() {
  // Clear any existing interval
  if (geminiStatusPollInterval) {
    clearInterval(geminiStatusPollInterval);
  }

  // Poll every 2 seconds
  geminiStatusPollInterval = setInterval(async () => {
    // Only poll if we're still on settings page
    if (currentMode !== 'settings') {
      clearInterval(geminiStatusPollInterval);
      geminiStatusPollInterval = null;
      log('[NOT-40] Stopped polling - left settings page');
      return;
    }

    // Get current status
    try {
      const response = await chrome.runtime.sendMessage({ action: 'GET_GEMINI_STATUS' });
      if (response.success) {
        const status = response.status.status;

        // Stop polling if we reached a final state
        if (status === 'ready' || status === 'unavailable' || status === 'error') {
          clearInterval(geminiStatusPollInterval);
          geminiStatusPollInterval = null;
          log(`[NOT-40] Stopped polling - final status reached: ${status}`);
        }

        // Update display
        await updateGeminiStatusDisplay();
      }
    } catch (error) {
      error('[NOT-40] Error polling Gemini status:', error);
    }
  }, 2000);
}



/**
 * [NOT-39] Render hybrid view with "From this Page" and "Related Concepts" sections
 * Used when context pill is clicked in semantic or hybrid state
 * @param {HTMLElement} notesListEl - The notes list container element
 */





/**
 * Utilities
 */
function formatDate(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

/**
 * [NOT-31] Expand or collapse all note cards with proper UI updates
 * @param {boolean} expand - True to expand, false to collapse
 */
function setAllNotesExpanded(expand) {
  isExpandedAll = expand;

  const noteCards = document.querySelectorAll('.note-card');
  noteCards.forEach(card => {
    if (expand) {
      card.classList.add('expanded');
      card.setAttribute('aria-expanded', 'true');
    } else {
      card.classList.remove('expanded');
      card.setAttribute('aria-expanded', 'false');
    }
  });

  // Update expand button icon
  const expandButton = document.getElementById('expand-all-button');
  if (expandButton) {
    const iconUse = expandButton.querySelector('use');
    if (expand) {
      iconUse?.setAttribute('href', '#icon-minimize');
      expandButton.setAttribute('title', 'Collapse all notes');
      expandButton.setAttribute('aria-label', 'Collapse all notes');
    } else {
      iconUse?.setAttribute('href', '#icon-maximize');
      expandButton.setAttribute('title', 'Expand all notes');
      expandButton.setAttribute('aria-label', 'Expand all notes');
    }
  }
}

// =============================================================================
// @INIT - Global Event Listeners & Boot
// =============================================================================

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', async () => {
  log('🎯 Initializing panel...');

  // [NOT-16] Set up create note button listener
  const createNoteButton = document.getElementById('create-note-button');
  if (createNoteButton) {
    createNoteButton.addEventListener('click', handleCreateNote);
  }

  // [NOT-16] Set up capture mode event listeners (once)
  const notesInput = document.getElementById('capture-notes');
  const saveButton = document.getElementById('save-button');

  // Keyboard shortcut (Cmd+Enter to save)
  if (notesInput) {
    notesInput.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        saveButton.click();
      }
    });
  }

  // Save button click handler
  if (saveButton) {
    saveButton.addEventListener('click', () => {
      handleSaveClip(window.currentClipData || {});
    });
  }

  // [NOT-58] Pulse Pill button handler
  const pulsePillButton = document.getElementById('pulse-pill-button');
  if (pulsePillButton) {
    pulsePillButton.addEventListener('click', handlePulsePillClick);
  }

  // [NOT-33] Image upload button handler
  const uploadImageButton = document.getElementById('upload-image-button');
  const imageUploadInput = document.getElementById('image-upload-input');

  if (uploadImageButton && imageUploadInput) {
    uploadImageButton.addEventListener('click', () => {
      imageUploadInput.click();
    });

    imageUploadInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFileUpload(e.target.files, false);
        // Reset input so same file can be selected again
        e.target.value = '';
      }
    });
  }

  // [NOT-33] [NOT-36] Webpage image capture button handler - wrap to pass buttonId
  const captureWebpageImageButton = document.getElementById('capture-webpage-image-button');
  if (captureWebpageImageButton) {
    captureWebpageImageButton.addEventListener('click', () => activateWebCaptureMode('capture-webpage-image-button'));
  }

  // [NOT-34] Navigation button handlers
  const libraryButton = document.getElementById('library-button');
  const aiButton = document.getElementById('ai-button');
  const settingsButton = document.getElementById('settings-button');

  if (libraryButton) {
    libraryButton.addEventListener('click', renderLibraryMode);
  }
  if (aiButton) {
    aiButton.addEventListener('click', renderAIChatMode);
  }
  if (settingsButton) {
    settingsButton.addEventListener('click', renderSettingsMode);
  }

  // [NOT-31] Listen for tab changes to refresh contextual recall pill
  chrome.tabs.onActivated.addListener(async () => {
    if (currentMode === 'library') {
      await checkContextualRecall();
    }
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.url && currentMode === 'library') {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab && activeTab.id === tabId) {
        await checkContextualRecall();
      }
    }
  });

  try {
    // Run data migration (if needed)
    await window.database.migrateFromChromeStorage();

    // [NOT-38] Auto-reindex for semantic search on first run
    await checkAndReindexIfNeeded();

    // Load persisted filter state
    await loadFilterState();

    // Check for pending clip data from chrome.storage.local
    const { pendingClipData } = await chrome.storage.local.get('pendingClipData');

    if (pendingClipData) {
      log('📋 Found pending clip data, rendering Capture Mode');
      renderCaptureMode(pendingClipData);
    } else {
      log('⏳ No pending data yet, waiting for it or showing library...');

      // Set up listener for when pendingClipData arrives
      let timeoutId = setTimeout(() => {
        log('📚 No clip data received, showing Library Mode');
        renderLibraryMode();
      }, 500); // Wait 500ms for data to arrive

      // [NOT-36] Listen for storage changes (boot-time listener only for initial capture)
      // Web capture listening mode is now handled by dedicated listener in activateWebCaptureMode
      const listener = (changes, area) => {
        if (area === 'local' && changes.pendingClipData && changes.pendingClipData.newValue) {
          const newClipData = changes.pendingClipData.newValue;

          // [NOT-36] Web capture mode is now handled by dedicated listener
          // This boot-time listener only handles normal flow (new clip data rendering)
          if (!isWebCaptureListening) {
            log('📋 Pending clip data arrived, rendering Capture Mode');
            clearTimeout(timeoutId);
            chrome.storage.onChanged.removeListener(listener);
            renderCaptureMode(newClipData);
          }
          // If in web capture listening mode, the dedicated listener will handle it
        }
      };

      chrome.storage.onChanged.addListener(listener);
    }

    // [NOT-40] Check Gemini Nano availability for AI synthesis
    try {
      geminiAvailable = await window.geminiService.checkAvailability();
      if (geminiAvailable) {
        log('✅ [NOT-40] Gemini Nano is available for synthesis');
      } else {
        log('⚠️  [NOT-40] Gemini Nano is not available. Synthesis features will be disabled.');
      }
    } catch (error) {
      error('❌ [NOT-40] Error checking Gemini availability:', error);
      geminiAvailable = false;
    }
  } catch (error) {
    error('❌ Error initializing panel:', error);
  }
});
