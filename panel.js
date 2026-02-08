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

// [NOT-76] Chat State (Module Scope)
let chatListenersInitialized = false;
let currentChatId = null;
let isStreaming = false;

// [NOT-39] Contextual Recall State
let contextPillAnimated = false;
let contextMatchType = null;
let semanticMatches = [];

// [NOT-22] Global TagInput instance for Capture Mode
let captureTagInput = null;

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
          
                      // Allow http, https, relative URLs, and internal extension protocols
                      if (protocol === 'http:' || protocol === 'https:' || protocol === 'chrome-extension:' || protocol === 'data:') {
                        cleanElement.setAttribute('href', href.trim());
                        cleanElement.setAttribute('target', '_blank');
                        cleanElement.setAttribute('rel', 'noopener noreferrer');
                      }
                    } catch (e) {            // Invalid URL or dangerous protocol - skip this link but preserve text
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

    // [NOT-67] Unified context logic: Show pill if exact OR semantic matches exist
    const totalRelated = exactCount + semanticCount;

    if (totalRelated > 0) {
      // Show pill with simple count
      contextMatchType = exactCount > 0 ? 'exact' : 'semantic';
      pillText.textContent = `${totalRelated} Related Note${totalRelated === 1 ? '' : 's'}`;
      showPillWithAnimation(pillElement, contextMatchType === 'exact' ? 'exact' : 'pulse');
    } else if (domainCount > 0) {
      // Domain matches (fallback) - keep existing behavior
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
 * @param {string} state - The state class to apply: 'pulse' or 'exact'
 */
function showPillWithAnimation(pillElement, state = 'exact') {
  pillElement.classList.remove('hidden');

  // [NOT-48] Preserve active class if it was already present
  const wasActive = pillElement.classList.contains('active');

  // [NOT-67] Remove state classes first (removed 'hybrid')
  pillElement.classList.remove('pulse', 'active');

  // [NOT-67] Apply the appropriate state class and icon
  const iconUse = pillElement.querySelector('.icon use');
  if (state === 'pulse') {
    pillElement.classList.add('pulse');
    if (iconUse) iconUse.setAttribute('href', '#icon-file-text');
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
 * [NOT-68] Render Stack Context Bar - Unified context UI for Library and Chat
 * [NOT-73] Restructured with pinned controls and scrollable tags
 * Displays active context as chips: "This Page", active tags, starred/read later, and suggestions
 * @param {string} containerId - The container element ID ('library-stack-context' or 'chat-stack-context')
 * @returns {void}
 */
async function renderStackContextBar(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // [NOT-73] Completely clear and recreate the container structure to avoid duplicates
  container.innerHTML = '';

  // Create pinned and scroll containers
  const pinnedContainer = document.createElement('div');
  pinnedContainer.className = 'stack-pinned';

  const scrollContainer = document.createElement('div');
  scrollContainer.className = 'stack-scroll';

  container.appendChild(pinnedContainer);
  container.appendChild(scrollContainer);

  // Get current URL for "This Page" chip
  let currentUrl = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      currentUrl = tab.url;
    }
  } catch (error) {
    warn('[NOT-68] Could not get current URL:', error);
  }

  // [NOT-73] 1. Render "#" Add button (PINNED - first element)
  const addButton = document.createElement('button');
  addButton.className = 'stack-add-button';
  addButton.textContent = '#';
  addButton.setAttribute('title', 'Add filter');
  addButton.setAttribute('data-action', 'add-filter');
  pinnedContainer.appendChild(addButton);

  // [NOT-73] 2. Render "This Page" chip (PINNED - second element)
  if (currentUrl) {
    const pageChip = document.createElement('button');
    pageChip.className = 'stack-chip stack-chip-page';
    pageChip.setAttribute('data-type', 'page');
    pageChip.setAttribute('title', 'Filter to notes from this page');

    // Check if active
    const isActive = filterState.contextFilter &&
      (filterState.contextFilter === currentUrl ||
       (currentUrl.includes('://') && new URL(currentUrl).hostname === filterState.contextFilter));

    if (isActive) {
      pageChip.classList.add('active');
    }

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'icon icon-sm');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#icon-file-text');
    icon.appendChild(use);

    // [NOT-69] Calculate note count for this URL
    const notesOnPage = getNotesForUrl(currentUrl);
    const noteCount = notesOnPage.length;

    const text = document.createElement('span');
    text.textContent = noteCount > 0 ? `This Page (+${noteCount})` : 'This Page';

    pageChip.appendChild(icon);
    pageChip.appendChild(text);
    pinnedContainer.appendChild(pageChip);
  }

  // [NOT-73] 3. Render active Tag chips (SCROLLABLE)
  // [NOT-69] Removed × icon - clicking chip body toggles it off
  if (filterState.tags && filterState.tags.length > 0) {
    filterState.tags.forEach(tag => {
      const tagChip = document.createElement('button');
      tagChip.className = 'stack-chip stack-chip-tag';
      tagChip.setAttribute('data-type', 'tag');
      tagChip.setAttribute('data-value', tag);
      tagChip.setAttribute('title', `Remove ${tag} filter`);

      const text = document.createElement('span');
      text.textContent = tag;

      tagChip.appendChild(text);
      scrollContainer.appendChild(tagChip);
    });
  }

  // [NOT-73] 4. Render Starred chip if active (SCROLLABLE)
  // [NOT-69] Removed × icon - clicking chip body toggles it off
  if (filterState.starred) {
    const starredChip = document.createElement('button');
    starredChip.className = 'stack-chip stack-chip-tag';
    starredChip.setAttribute('data-type', 'starred');
    starredChip.setAttribute('title', 'Remove starred filter');

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'icon icon-sm');
    const use = document.createElementNS('http://www.w3.org/1999/xlink', 'use');
    use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#icon-star');
    icon.appendChild(use);

    const text = document.createElement('span');
    text.textContent = 'Starred';

    starredChip.appendChild(icon);
    starredChip.appendChild(text);
    scrollContainer.appendChild(starredChip);
  }

  // [NOT-73] 5. Render Read Later chip if active (SCROLLABLE)
  // [NOT-69] Removed × icon - clicking chip body toggles it off
  if (filterState.readLater) {
    const readLaterChip = document.createElement('button');
    readLaterChip.className = 'stack-chip stack-chip-tag';
    readLaterChip.setAttribute('data-type', 'readLater');
    readLaterChip.setAttribute('title', 'Remove read later filter');

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'icon icon-sm');
    const use = document.createElementNS('http://www.w3.org/1999/xlink', 'use');
    use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#icon-clock');
    icon.appendChild(use);

    const text = document.createElement('span');
    text.textContent = 'Read Later';

    readLaterChip.appendChild(icon);
    readLaterChip.appendChild(text);
    scrollContainer.appendChild(readLaterChip);
  }

  // [NOT-73] 6. Render Ghost chips (SCROLLABLE - Context-aware suggested tags)
  // [NOT-69] Use context-aware tags that prioritize tags from current page
  const suggestedTags = await getContextAwareTags(currentUrl);

  suggestedTags.forEach(tag => {
    const ghostChip = document.createElement('button');
    ghostChip.className = 'stack-chip stack-chip-ghost';
    ghostChip.setAttribute('data-type', 'ghost-tag');
    ghostChip.setAttribute('data-value', tag);
    ghostChip.textContent = tag;
    ghostChip.setAttribute('title', `Filter by ${tag}`);
    scrollContainer.appendChild(ghostChip);
  });
}

/**
 * [NOT-68] Update all Stack Context Bars
 * Refreshes both library and chat stack context bars
 * @returns {void}
 */
async function updateContextBars() {
  await renderStackContextBar('library-stack-context');
  await renderStackContextBar('chat-stack-context');
}

/**
 * [NOT-69] Get notes filtered by URL
 * @param {string} url - The URL to filter by
 * @returns {Array} Array of notes matching the URL
 */
function getNotesForUrl(url) {
  if (!url) return [];
  return allNotes.filter(note => note.url === url);
}

/**
 * [NOT-69] [NOT-77] Get context-aware tags for ghost chips
 * Priority 1: Tags from notes on the current page
 * Priority 2: Semantically related tags from vector search
 * Priority 3: Global popular tags as fallback
 * @param {string} url - The current page URL
 * @returns {Promise<string[]>} Array of suggested tags (max 3)
 */
async function getContextAwareTags(url) {
  const activeTags = new Set(filterState.tags || []);
  const contextTags = [];

  // Priority 1: Tags from notes on this page
  if (url) {
    const notesOnPage = getNotesForUrl(url);
    const tagCounts = {};

    notesOnPage.forEach(note => {
      if (note.tags && Array.isArray(note.tags)) {
        note.tags.forEach(tag => {
          if (!activeTags.has(tag)) {
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
          }
        });
      }
    });

    // Sort by frequency and add to contextTags
    const sortedContextTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);

    contextTags.push(...sortedContextTags);
  }

  // [NOT-77] Priority 2: If we have fewer than 3 tags, use semantic search for related tags
  if (contextTags.length < 3) {
    try {
      // Get current page metadata
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.title && tab?.id) {
        // Attempt to get page text content (best effort, non-blocking)
        let pageText = '';
        try {
          pageText = await getPageTextContent(tab.id) || '';
        } catch (err) {
          warn('[NOT-77] Could not get page text for semantic search:', err);
        }

        // Call semantic search with page metadata
        const semanticTags = await fetchLocalTagSuggestions({
          metadata: { title: tab.title },
          text: pageText
        });

        // Append unique semantic tags
        semanticTags.forEach(tag => {
          if (!activeTags.has(tag) && !contextTags.includes(tag) && contextTags.length < 3) {
            contextTags.push(tag);
          }
        });

        if (semanticTags.length > 0) {
          log(`[NOT-77] Added ${semanticTags.filter(tag => !activeTags.has(tag) && !contextTags.includes(tag)).length} semantic tag suggestions`);
        }
      }
    } catch (err) {
      warn('[NOT-77] Error fetching semantic tags (non-fatal):', err);
    }
  }

  // Priority 3: If we still have fewer than 3 tags, fill with global popular tags
  if (contextTags.length < 3) {
    const allTags = await getAllTags();
    const globalTags = allTags
      .filter(tag => !activeTags.has(tag) && !contextTags.includes(tag))
      .slice(0, 3 - contextTags.length);

    contextTags.push(...globalTags);
  }

  return contextTags.slice(0, 3);
}

/**
 * [NOT-68] Get all unique tags from notes (sorted by usage frequency)
 * @returns {Promise<string[]>} Array of tags sorted by frequency
 */
async function getAllTags() {
  const tagCounts = {};

  allNotes.forEach(note => {
    if (note.tags && Array.isArray(note.tags)) {
      note.tags.forEach(tag => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    }
  });

  return Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);
}

/**
 * [NOT-69] Toggle the Stack Menu popover
 * Opens or closes the menu anchored to the Stack Context Bar
 * @returns {void}
 */
function toggleStackMenu() {
  const menu = document.getElementById('stack-menu');
  if (!menu) return;

  if (menu.classList.contains('hidden')) {
    // Open menu
    renderStackMenu();
    menu.classList.remove('hidden');

    // Focus search input
    const searchInput = document.getElementById('stack-menu-search');
    if (searchInput) {
      setTimeout(() => searchInput.focus(), 100);
    }

    // Close menu when clicking outside
    const closeHandler = (e) => {
      if (!menu.contains(e.target) && !e.target.closest('.stack-add-button')) {
        menu.classList.add('hidden');
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 10);
  } else {
    // Close menu
    menu.classList.add('hidden');
  }
}

/**
 * [NOT-69] Render the Stack Menu content
 * Populates system filters (Starred, Read Later) and tag list
 * @returns {Promise<void>}
 */
async function renderStackMenu() {
  const tagsList = document.getElementById('stack-menu-tags-list');
  if (!tagsList) return;

  // Clear existing tags
  tagsList.innerHTML = '';

  // Get all tags
  const allTags = await getAllTags();
  const activeTags = new Set(filterState.tags || []);

  // Render each tag
  allTags.forEach(tag => {
    const tagItem = document.createElement('button');
    tagItem.className = 'stack-menu-item';
    tagItem.setAttribute('data-type', 'tag');
    tagItem.setAttribute('data-value', tag);

    if (activeTags.has(tag)) {
      tagItem.classList.add('active');
    }

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'icon icon-sm');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#icon-tag');
    icon.appendChild(use);

    const text = document.createElement('span');
    text.textContent = tag;

    tagItem.appendChild(icon);
    tagItem.appendChild(text);
    tagsList.appendChild(tagItem);
  });

  // Update system filter states
  const starredItem = document.querySelector('.stack-menu-item[data-type="starred"]');
  const readLaterItem = document.querySelector('.stack-menu-item[data-type="readLater"]');

  if (starredItem) {
    starredItem.classList.toggle('active', filterState.starred === true);
  }
  if (readLaterItem) {
    readLaterItem.classList.toggle('active', filterState.readLater === true);
  }
}

/**
 * [NOT-68] [NOT-78] Get filtered notes based on Stack context (excluding search filter)
 * Shared helper to avoid logic duplication between Library and Chat
 * Fallback: If "This Page" filter is active but has 0 notes, shows all notes instead of empty state
 * @returns {Array} Filtered notes array
 */
function getStackFilteredNotes() {
  let filtered = [...allNotes];

  // [NOT-78] Apply context filter (page URL filter) with fallback logic
  if (filterState.contextFilter) {
    const notesOnPage = allNotes.filter(note => {
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

    // [NOT-78] Fallback: If no notes on this page, show all notes instead of empty state
    if (notesOnPage.length === 0) {
      log('[NOT-78] No notes on this page, falling back to show all notes');
      filtered = [...allNotes]; // Use all notes as base set
    } else {
      filtered = notesOnPage; // Use page-specific notes as base set
    }
  }

  // Apply tag filters (case-insensitive, normalize # prefix)
  if (filterState.tags.length > 0) {
    filtered = filtered.filter(note =>
      filterState.tags.some(filterTag => {
        // Normalize filter tag (remove # if present)
        const normalizedFilterTag = filterTag.startsWith('#') ? filterTag.substring(1) : filterTag;

        return note.tags.some(noteTag => {
          // Normalize note tag (remove # if present)
          const normalizedNoteTag = noteTag.startsWith('#') ? noteTag.substring(1) : noteTag;
          return normalizedNoteTag.toLowerCase() === normalizedFilterTag.toLowerCase();
        });
      })
    );
  }

  // Apply Read Later filter
  if (filterState.readLater) {
    filtered = filtered.filter(note => note.readLater === true);
  }

  // Apply Starred filter
  if (filterState.starred) {
    filtered = filtered.filter(note => note.starred === true);
  }

  return filtered;
}

/**
 * [NOT-68] Get page text content from current tab
 * Used for injecting page content into AI chat context
 * @param {number} tabId - The tab ID to extract content from
 * @returns {Promise<string|null>} Page text content (truncated to 8k chars) or null
 */
async function getPageTextContent(tabId) {
  try {
    // Execute script to get page text
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // Extract main content text, excluding scripts and styles
        const body = document.body;
        if (!body) return null;

        // Remove script and style elements from clone
        const clone = body.cloneNode(true);
        const scripts = clone.querySelectorAll('script, style, noscript');
        scripts.forEach(el => el.remove());

        // Get text content
        let text = clone.innerText || clone.textContent || '';

        // Clean up whitespace
        text = text
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0)
          .join('\n');

        return text;
      }
    });

    if (!results || !results[0] || !results[0].result) {
      return null;
    }

    let pageText = results[0].result;

    // Truncate to ~8k characters (as per spec)
    const MAX_LENGTH = 8000;
    if (pageText.length > MAX_LENGTH) {
      pageText = pageText.substring(0, MAX_LENGTH) + '\n\n[Content truncated...]';
    }

    return pageText;
  } catch (error) {
    warn('[NOT-68] Failed to get page text content:', error);
    return null;
  }
}

/**
 * [NOT-60] Clear stack context - removes all active filters
 * @returns {void}
 */
function clearStackContext() {
  // Clear all filters
  filterState.contextFilter = null;
  filterState.tags = [];
  filterState.readLater = false;
  filterState.starred = false;
  filterState.search = '';

  // Clear search input
  const filterInput = document.getElementById('filter-input');
  if (filterInput) filterInput.value = '';

  // Save and re-render
  saveFilterState();
  renderNotesList();
  // [NOT-69] renderActiveFilters() removed
  updateContextBars();
}

/**
 * [NOT-68] Toggle "This Page" context filter
 * Sets filterState.contextFilter to current URL or null
 * @returns {Promise<void>}
 */
async function togglePageContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;

    const currentUrl = tab.url;

    // Toggle: if already active, deactivate
    const isCurrentlyActive = filterState.contextFilter &&
      (filterState.contextFilter === currentUrl ||
       (currentUrl.includes('://') && new URL(currentUrl).hostname === filterState.contextFilter));

    if (isCurrentlyActive) {
      // Deactivate
      filterState.contextFilter = null;
      // [NOT-74] setAllNotesExpanded removed
    } else {
      // Activate - use full URL for exact matching
      filterState.contextFilter = currentUrl;
      // [NOT-74] Auto-expand removed - notes always show full content now
    }

    // Save and re-render
    await saveFilterState();
    filterAndRenderNotes();
  } catch (error) {
    error('[NOT-68] Error toggling page context:', error);
  }
}

/**
 * [NOT-68] Toggle tag filter
 * Adds or removes a tag from filterState.tags
 * @param {string} tag - The tag to toggle
 * @returns {void}
 */
function toggleTagFilter(tag) {
  if (!tag) return;

  const index = filterState.tags.indexOf(tag);
  if (index > -1) {
    // Remove tag
    filterState.tags.splice(index, 1);
  } else {
    // Add tag
    filterState.tags.push(tag);
  }

  // Save and re-render
  saveFilterState();
  filterAndRenderNotes();
}

/**
 * [NOT-68] Toggle system filter (Starred or Read Later)
 * @param {string} type - The filter type ('starred' or 'readLater')
 * @returns {void}
 */
function toggleSystemFilter(type) {
  if (type === 'starred') {
    filterState.starred = !filterState.starred;
  } else if (type === 'readLater') {
    filterState.readLater = !filterState.readLater;
  }

  // Save and re-render
  saveFilterState();
  filterAndRenderNotes();
}

/**
 * [NOT-34] Navigate to a specific view and update header button states
 * [NOT-75] Added smooth fade transition between views
 * @param {string} viewId - The view to navigate to (library-mode, ai-chat-mode, settings-mode, capture-mode)
 */
async function navigateToView(viewId) {
  const views = ['library-mode', 'ai-chat-mode', 'settings-mode', 'capture-mode'];

  // [NOT-75] Find currently visible view
  const currentView = views.find(view => {
    const element = document.getElementById(view);
    return element && !element.classList.contains('hidden');
  });

  // [NOT-75] Apply fade-out to current view
  if (currentView) {
    const currentElement = document.getElementById(currentView);
    if (currentElement) {
      currentElement.classList.add('fade-out');
      // Wait for fade-out animation
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }

  // Hide all views and remove fade classes
  views.forEach(view => {
    const element = document.getElementById(view);
    if (element) {
      element.classList.add('hidden');
      element.classList.remove('fade-out', 'fade-in');
    }
  });

  // Show target view with fade-in
  const targetView = document.getElementById(viewId);
  if (targetView) {
    targetView.classList.remove('hidden');
    // Use requestAnimationFrame to ensure CSS transition triggers
    requestAnimationFrame(() => {
      targetView.classList.add('fade-in');
    });
  }

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
// [NOT-68] handleContextPillClick removed - replaced by Stack Context Bar actions

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
 * [NOT-22] [NOT-84] TagInput Component - Compact popover-based tag input
 * Creates a compact tag display with popover for tag management
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
    this.isPopoverOpen = false; // [NOT-84] Track popover state

    // [NOT-84] Create wrapper for compact trigger and popover
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'tag-input-wrapper';
    this.container.appendChild(this.wrapper);

    // [NOT-84] Bind event handlers to maintain reference for removal
    this.handleDocumentClick = this.handleDocumentClick.bind(this);
    this.handleAddTagClick = this.handleAddTagClick.bind(this);

    this.render();
  }

  /**
   * [NOT-58] [NOT-84] Set local tag suggestions from vector search
   * These will be shown in the popover when opened
   *
   * @param {Array<string>} suggestions - Array of tag names (without # prefix)
   */
  setLocalSuggestions(suggestions) {
    this.localSuggestions = suggestions.filter(tag => !this.isTagSelected(tag));

    // [NOT-84] If popover is open, update suggestions
    if (this.isPopoverOpen) {
      this.updatePopoverSuggestions();
    }
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
   * [NOT-84] Render the compact tag input component
   * Creates a trigger view with selected tags + Add button, and a popover for tag selection
   */
  render() {
    // [NOT-84] Remove old event listeners first to prevent duplicates
    if (this.addTagButton) {
      this.addTagButton.removeEventListener('click', this.handleAddTagClick);
    }
    document.removeEventListener('click', this.handleDocumentClick);

    // Clear wrapper
    this.wrapper.innerHTML = '';

    // [NOT-84] Create compact trigger container
    const triggerContainer = document.createElement('div');
    triggerContainer.className = 'tag-trigger-container';

    // [NOT-84] Render selected tags as clickable chips (click to remove)
    this.tags.forEach((tag, index) => {
      const chip = this.createSelectedChip(tag, index);
      triggerContainer.appendChild(chip);
    });

    // [NOT-84] Create "+ Add Tag" button
    this.addTagButton = document.createElement('button');
    this.addTagButton.type = 'button';
    this.addTagButton.className = 'tag-add-button';
    this.addTagButton.textContent = '+ Add Tag';
    this.addTagButton.addEventListener('click', this.handleAddTagClick);

    triggerContainer.appendChild(this.addTagButton);
    this.wrapper.appendChild(triggerContainer);

    // [NOT-84] Create popover (hidden by default)
    this.createPopover();
  }

  /**
   * [NOT-84] Create a selected tag chip (click to toggle off/remove)
   * @param {string} tag - The tag text
   * @param {number} index - The tag index in the tags array
   * @returns {HTMLElement} - The chip element
   */
  createSelectedChip(tag, index) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tag-chip tag-chip-selected';
    chip.textContent = tag;

    // [NOT-84] Click to toggle off (unselect/remove)
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      this.removeTag(index);
      // [NOT-84] Close popover if open (clicking chip should close popup)
      if (this.isPopoverOpen) {
        this.closePopover();
      }
    });

    return chip;
  }

  /**
   * [NOT-84] Create the popover element with search input and tag list
   */
  createPopover() {
    this.popover = document.createElement('div');
    this.popover.className = 'tag-popover hidden';

    // [NOT-84] Create search input (auto-focus when shown)
    this.searchInput = document.createElement('input');
    this.searchInput.type = 'text';
    this.searchInput.className = 'tag-popover-search';
    this.searchInput.placeholder = 'Search or create tags...';

    // [NOT-84] Create tags list container
    this.tagsList = document.createElement('div');
    this.tagsList.className = 'tag-popover-list';

    this.popover.appendChild(this.searchInput);
    this.popover.appendChild(this.tagsList);
    this.wrapper.appendChild(this.popover);

    // [NOT-84] Attach event listeners to search input
    this.attachPopoverListeners();
  }

  /**
   * [NOT-84] Attach event listeners to popover search input
   */
  attachPopoverListeners() {
    this.searchInput.addEventListener('input', (e) => {
      this.inputValue = e.target.value;
      this.updatePopoverSuggestions();
    });

    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.selectedIndex >= 0 && this.suggestions[this.selectedIndex]) {
          this.addTag(this.suggestions[this.selectedIndex]);
        } else if (this.inputValue.trim()) {
          this.addTag();
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.navigateSuggestions(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.navigateSuggestions(-1);
      } else if (e.key === 'Escape') {
        this.closePopover();
      }
    });

    // [NOT-84] Stop propagation to prevent document click from closing immediately
    this.popover.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  /**
   * [NOT-84] Handle Add Tag button click
   * Opens the popover and focuses the search input
   */
  handleAddTagClick(e) {
    e.stopPropagation();
    if (this.isPopoverOpen) {
      this.closePopover();
    } else {
      this.openPopover();
    }
  }

  /**
   * [NOT-84] Handle document click to close popover when clicking outside
   * Closes when clicking anywhere outside the popover itself (including the container area)
   */
  handleDocumentClick(e) {
    if (this.isPopoverOpen && !this.popover.contains(e.target)) {
      this.closePopover();
    }
  }

  /**
   * [NOT-84] Open the popover and show available tags
   */
  openPopover() {
    this.isPopoverOpen = true;
    this.popover.classList.remove('hidden');
    this.searchInput.value = '';
    this.inputValue = '';
    this.updatePopoverSuggestions();

    // [NOT-84] Auto-focus the search input
    setTimeout(() => {
      this.searchInput.focus();
    }, 50);

    // [NOT-84] Listen for clicks outside to close
    setTimeout(() => {
      document.addEventListener('click', this.handleDocumentClick);
    }, 100);
  }

  /**
   * [NOT-84] Close the popover
   */
  closePopover() {
    this.isPopoverOpen = false;
    this.popover.classList.add('hidden');
    this.selectedIndex = -1;
    document.removeEventListener('click', this.handleDocumentClick);
  }

  /**
   * [NOT-84] Add a new tag
   * @param {string} tagText - Optional tag text to add (if not provided, uses inputValue)
   */
  addTag(tagText = null) {
    const text = (tagText || this.inputValue).trim();
    if (!text) return;

    // Remove # if user typed it
    const cleanTag = text.startsWith('#') ? text.substring(1) : text;

    // [NOT-84] Don't add duplicates (case-insensitive check)
    if (this.isTagSelected(cleanTag)) {
      this.inputValue = '';
      if (this.searchInput) {
        this.searchInput.value = '';
      }
      return;
    }

    this.tags.push(cleanTag);
    this.inputValue = '';

    // [NOT-84] Re-render the trigger (selected tags)
    this.render();

    // [NOT-84] If popover is open, update suggestions
    if (this.isPopoverOpen) {
      this.updatePopoverSuggestions();
    }

    if (this.onChange) {
      this.onChange(this.getTags());
    }
  }

  /**
   * [NOT-84] Remove a tag by index (toggle off)
   * @param {number} index - The index of the tag to remove
   */
  removeTag(index) {
    this.tags.splice(index, 1);

    // [NOT-84] Re-render the trigger
    this.render();

    // [NOT-84] If popover is open, update suggestions
    if (this.isPopoverOpen) {
      this.updatePopoverSuggestions();
    }

    if (this.onChange) {
      this.onChange(this.getTags());
    }
  }


  /**
   * [NOT-84] Update popover suggestions based on search input
   */
  updatePopoverSuggestions() {
    const query = this.inputValue.toLowerCase().trim();

    if (!query) {
      // [NOT-84] Show all available tags (recent + local suggestions)
      this.suggestions = this.getAllAvailableTags();
    } else {
      // [NOT-84] Filter tags based on search query
      const allTags = this.getAllExistingTags();
      this.suggestions = allTags.filter(tag =>
        tag.toLowerCase().includes(query) && !this.isTagSelected(tag)
      );
    }

    this.selectedIndex = -1;
    this.renderPopoverSuggestions();
  }

  /**
   * [NOT-84] Get all available tags (recent + local suggestions) that aren't selected
   */
  getAllAvailableTags() {
    const tags = new Set();

    // [NOT-84] Add local suggestions first (from AI)
    this.localSuggestions.forEach(tag => {
      if (!this.isTagSelected(tag)) {
        tags.add(tag);
      }
    });

    // [NOT-84] Add recent tags
    const recentTags = this.getRecentTags(20);
    recentTags.forEach(tag => {
      if (!this.isTagSelected(tag)) {
        tags.add(tag);
      }
    });

    return Array.from(tags);
  }

  /**
   * [NOT-84] Check if a tag is already selected (case-insensitive)
   */
  isTagSelected(tag) {
    const lowerTag = tag.toLowerCase();
    return this.tags.some(t => t.toLowerCase() === lowerTag);
  }

  /**
   * [NOT-84] Render popover tag suggestions
   */
  renderPopoverSuggestions() {
    this.tagsList.innerHTML = '';

    // [NOT-84] If user is typing and no matches, show "Create" option
    if (this.suggestions.length === 0 && this.inputValue.trim()) {
      const createOption = document.createElement('button');
      createOption.type = 'button';
      createOption.className = 'tag-popover-option create';

      const iconSpan = document.createElement('span');
      iconSpan.className = 'tag-popover-icon';
      iconSpan.textContent = '+';

      createOption.appendChild(iconSpan);
      createOption.appendChild(document.createTextNode(`Create "${this.inputValue.trim()}"`));

      createOption.addEventListener('click', () => {
        this.addTag();
        this.closePopover();
      });
      this.tagsList.appendChild(createOption);
      return;
    }

    // [NOT-84] Show recent/suggested tags
    if (this.suggestions.length === 0) {
      const emptyMessage = document.createElement('div');
      emptyMessage.className = 'tag-popover-empty';
      emptyMessage.textContent = 'No tags available';
      this.tagsList.appendChild(emptyMessage);
      return;
    }

    // [NOT-84] Render tag options
    this.suggestions.forEach((tag, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'tag-popover-option';
      if (index === this.selectedIndex) {
        option.classList.add('selected');
      }

      const iconSpan = document.createElement('span');
      iconSpan.className = 'tag-popover-icon';
      iconSpan.textContent = '#';

      option.appendChild(iconSpan);
      option.appendChild(document.createTextNode(tag));

      option.addEventListener('click', () => {
        this.addTag(tag);
        // [NOT-84] Clear search after adding
        this.searchInput.value = '';
        this.inputValue = '';
        this.updatePopoverSuggestions();
        this.searchInput.focus();
      });
      this.tagsList.appendChild(option);
    });
  }

  /**
   * [NOT-84] Navigate popover suggestions with arrow keys
   */
  navigateSuggestions(direction) {
    if (this.suggestions.length === 0) return;

    this.selectedIndex += direction;

    if (this.selectedIndex < -1) {
      this.selectedIndex = this.suggestions.length - 1;
    } else if (this.selectedIndex >= this.suggestions.length) {
      this.selectedIndex = -1;
    }

    this.renderPopoverSuggestions();

    // [NOT-84] Scroll selected item into view
    if (this.selectedIndex >= 0) {
      const options = this.tagsList.querySelectorAll('.tag-popover-option');
      if (options[this.selectedIndex]) {
        options[this.selectedIndex].scrollIntoView({ block: 'nearest' });
      }
    }
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

  // [NOT-16] [NOT-27] [NOT-83] Hide or show source card based on content type
  const sourceCard = document.querySelector('.source-card');
  const sourceCardBody = document.querySelector('.source-card-body');
  const previewLabel = sourceCardBody ? sourceCardBody.querySelector('.source-card-label') : null;

  if (clipData.url && clipData.metadata) {
    // Has URL and metadata - show source info
    if (sourceCard) {
      sourceCard.style.display = 'block';
    }

    const favicon = document.getElementById('capture-favicon');
    const siteName = document.getElementById('capture-site-name');
    const url = document.getElementById('capture-url');

    if (favicon) favicon.src = clipData.metadata.favicon || '';
    // [NOT-83] Show page title instead of domain name for better UX
    if (siteName) siteName.textContent = clipData.metadata.title || clipData.metadata.siteName || '';
    if (url) url.textContent = clipData.url || '';

    // [NOT-58] [NOT-83] Render dynamic source bar based on flexible_metadata.type
    renderDynamicSourceBar(clipData, document.querySelector('.source-card-header'));

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
    // Manual note mode - hide source card
    sourceCard.style.display = 'none';
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

    // [NOT-59] [NOT-83] Update the UI to reflect enhanced metadata
    // Re-render the dynamic source bar to show new metadata
    const sourceCardHeader = document.querySelector('.source-card-header');
    if (sourceCardHeader) {
      renderDynamicSourceBar(clipData, sourceCardHeader);
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

// [NOT-74] handleToggleExpandAll removed - expand/collapse feature removed

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

  // [NOT-74] Expand button removed - expand/collapse feature removed

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

  // Populate filter dropdown
  populateFilterDropdown();

  // [NOT-66] Apply filters and sort (including default sort) before rendering
  filterAndRenderNotes();

  // [NOT-69] Render active filters removed - Stack Context Bar is now the only indicator

  // [NOT-68] Update Stack Context Bars based on active context
  updateContextBars();
}

function setupLibraryEventListeners() {
  const filterInput = document.getElementById('filter-input');
  const filterDropdown = document.getElementById('filter-dropdown');
  // [NOT-69] clear-all-filters button removed - now using Stack Menu
  // [NOT-74] Expand all button removed - expand/collapse feature removed

  // [NOT-68] Stack Context Bar event delegation
  const libraryStackContext = document.getElementById('library-stack-context');
  if (libraryStackContext) {
    libraryStackContext.addEventListener('click', async (e) => {
      const target = e.target.closest('.stack-chip, .stack-add-button, .remove');

      if (!target) return;

      // Handle "This Page" chip toggle
      if (target.classList.contains('stack-chip-page')) {
        await togglePageContext();
        return;
      }

      // [NOT-71] Handle tag chip click (toggle off when clicked)
      if (target.classList.contains('stack-chip-tag')) {
        const type = target.getAttribute('data-type');
        const value = target.getAttribute('data-value');

        if (type === 'tag' && value) {
          toggleTagFilter(value);
        } else if (type === 'starred') {
          toggleSystemFilter('starred');
        } else if (type === 'readLater') {
          toggleSystemFilter('readLater');
        }
        return;
      }

      // Handle tag chip removal (click on X) - DEPRECATED: X icon removed in NOT-69
      if (target.classList.contains('remove')) {
        const chipElement = target.closest('.stack-chip');
        const type = chipElement?.getAttribute('data-type');
        const value = chipElement?.getAttribute('data-value');

        if (type === 'tag' && value) {
          toggleTagFilter(value);
        } else if (type === 'starred') {
          toggleSystemFilter('starred');
        } else if (type === 'readLater') {
          toggleSystemFilter('readLater');
        }
        return;
      }

      // Handle ghost chip activation (click on suggested tag)
      if (target.classList.contains('stack-chip-ghost')) {
        const tag = target.getAttribute('data-value');
        if (tag) {
          toggleTagFilter(tag);
        }
        return;
      }

      // [NOT-69] Handle Add button (show Stack Menu)
      if (target.classList.contains('stack-add-button')) {
        toggleStackMenu();
        return;
      }
    });
  }

  // [NOT-60] Assistant Bar input handlers
  const assistantInput = document.getElementById('assistant-input');
  const sendAssistantButton = document.getElementById('send-assistant-button');

  if (assistantInput) {
    // Auto-resize textarea as user types
    assistantInput.addEventListener('input', () => {
      assistantInput.style.height = 'auto';
      assistantInput.style.height = assistantInput.scrollHeight + 'px';

      // Enable/disable send button based on input
      if (sendAssistantButton) {
        sendAssistantButton.disabled = !assistantInput.value.trim();
      }
    });

    // [NOT-75] Send message on Enter (Shift+Enter for line breaks)
    assistantInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (assistantInput.value.trim()) {
          handleSendAssistantMessage();
        }
      }
    });
  }

  if (sendAssistantButton) {
    sendAssistantButton.addEventListener('click', handleSendAssistantMessage);
  }

  // [NOT-60] Onboarding Chips - Auto-fill Assistant Bar
  const onboardingChips = document.querySelectorAll('.onboarding-chip');
  onboardingChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.dataset.prompt;
      if (prompt && assistantInput) {
        assistantInput.value = prompt;
        assistantInput.focus();

        // Trigger input event to enable send button and resize textarea
        assistantInput.dispatchEvent(new Event('input'));

        // Scroll to assistant bar
        const assistantBar = document.querySelector('.assistant-bar');
        if (assistantBar) {
          assistantBar.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
      }
    });
  });

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
    // [NOT-69] renderActiveFilters() removed
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

  // [NOT-69] Clear All Filters button removed - filters now managed through Stack Menu

  // [NOT-68] Search escape hatch - "Search all notes" button
  const searchAllNotesButton = document.getElementById('search-all-notes-button');
  if (searchAllNotesButton) {
    searchAllNotesButton.addEventListener('click', () => {
      // Clear all filters except search text
      const currentSearch = filterState.search;
      filterState.contextFilter = null;
      filterState.tags = [];
      filterState.readLater = false;
      filterState.starred = false;
      filterState.search = currentSearch; // Keep search text

      // Re-render
      filterAndRenderNotes();
      // [NOT-69] renderActiveFilters() removed
      updateContextBars();
      saveFilterState();

      log('[NOT-68] Cleared context filters, keeping search:', currentSearch);
    });
  }

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
        // [NOT-69] renderActiveFilters() removed
        updateFilterDropdownActiveStates();
        saveFilterState();
      }
    }
  });
}

/**
 * [NOT-69] Setup event listeners for Stack Menu
 * Handles clicks on menu items and tag search
 * @returns {void}
 */
function setupStackMenuEventListeners() {
  const stackMenu = document.getElementById('stack-menu');
  if (!stackMenu) return;

  // Handle menu item clicks
  stackMenu.addEventListener('click', async (e) => {
    const menuItem = e.target.closest('.stack-menu-item');
    if (!menuItem) return;

    const type = menuItem.getAttribute('data-type');
    const value = menuItem.getAttribute('data-value');

    if (type === 'starred') {
      // Toggle starred filter
      filterState.starred = !filterState.starred;
      filterAndRenderNotes();
      await renderStackMenu(); // Update menu state
      updateContextBars();
      saveFilterState();
    } else if (type === 'readLater') {
      // Toggle read later filter
      filterState.readLater = !filterState.readLater;
      filterAndRenderNotes();
      await renderStackMenu(); // Update menu state
      updateContextBars();
      saveFilterState();
    } else if (type === 'tag' && value) {
      // Toggle tag filter
      if (filterState.tags.includes(value)) {
        filterState.tags = filterState.tags.filter(t => t !== value);
      } else {
        filterState.tags.push(value);
      }
      filterAndRenderNotes();
      await renderStackMenu(); // Update menu state
      updateContextBars();
      saveFilterState();
    }
  });

  // Handle tag search
  const searchInput = document.getElementById('stack-menu-search');
  if (searchInput) {
    // Remove old listener if exists
    const oldHandler = searchInput._stackMenuSearchHandler;
    if (oldHandler) {
      searchInput.removeEventListener('input', oldHandler);
    }

    // Create new handler
    const searchHandler = async (e) => {
      const query = e.target.value.toLowerCase().trim();
      const tagsList = document.getElementById('stack-menu-tags-list');
      if (!tagsList) return;

      // Get all tags and filter
      const allTags = await getAllTags();
      const activeTags = new Set(filterState.tags || []);
      const filteredTags = query ? allTags.filter(tag => tag.toLowerCase().includes(query)) : allTags;

      // Re-render filtered tags
      tagsList.innerHTML = '';
      filteredTags.forEach(tag => {
        const tagItem = document.createElement('button');
        tagItem.className = 'stack-menu-item';
        tagItem.setAttribute('data-type', 'tag');
        tagItem.setAttribute('data-value', tag);

        if (activeTags.has(tag)) {
          tagItem.classList.add('active');
        }

        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('class', 'icon icon-sm');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#icon-tag');
        icon.appendChild(use);

        const text = document.createElement('span');
        text.textContent = tag;

        tagItem.appendChild(icon);
        tagItem.appendChild(text);
        tagsList.appendChild(tagItem);
      });
    };

    searchInput._stackMenuSearchHandler = searchHandler;
    searchInput.addEventListener('input', searchHandler);
  }
}

/**
 * [NOT-72] Populate filter dropdown with sort and system filters only
 * Tags are now managed via Stack Menu and Stack Context Bar
 */
function populateFilterDropdown() {
  // [NOT-72] Tag population removed - tags now managed via Stack Menu
  // Only update active states for remaining filters (sort, starred, read later)
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

  // [NOT-72] Tag options removed - tags now managed via Stack Menu
}

function filterAndRenderNotes() {
  // [NOT-68] Use shared helper for stack filters (context, tags, starred, readLater)
  filteredNotes = getStackFilteredNotes();

  // Apply search filter (on top of stack filters)
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

  // [NOT-68] Show/hide search escape hatch
  const escapeHatch = document.getElementById('search-escape-hatch');
  if (escapeHatch) {
    // Show if: searching AND has active context (page, tags, starred, or read later)
    const hasActiveContext = filterState.contextFilter ||
                             filterState.tags.length > 0 ||
                             filterState.starred ||
                             filterState.readLater;
    const isSearching = filterState.search && filterState.search.trim().length > 0;

    if (isSearching && hasActiveContext) {
      escapeHatch.classList.remove('hidden');
    } else {
      escapeHatch.classList.add('hidden');
    }
  }

  renderNotesList();
}

// [NOT-69] renderActiveFilters() removed - Stack Context Bar is now the only indicator

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
      // [NOT-69] renderActiveFilters() removed
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
  // [NOT-67] Removed synthesis element references
  const existingCards = notesListEl.querySelectorAll('.note-card, .insight-card, .hybrid-section-header');
  existingCards.forEach(card => card.remove());

  // Handle empty states
  if (allNotes.length === 0) {
    // No notes at all
    emptyStateEl.classList.remove('hidden');
    searchEmptyStateEl.classList.add('hidden');
    return;
  }

  // [NOT-39] Check if we should render hybrid view (semantic context state with active pill)
  // [NOT-67] Removed 'hybrid' contextMatchType (no longer used)
  const pillElement = document.getElementById('context-pill');
  const isHybridViewActive = pillElement && pillElement.classList.contains('active') &&
    contextMatchType === 'semantic';

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

  // [NOT-68] Update Stack Context Bars to reflect current filtered state
  updateContextBars();
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
  // [NOT-83] Show page title instead of domain name for better UX
  card.querySelector('.note-site-name').textContent = note.metadata.title || note.metadata.siteName;
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
    const noteUrl = note.url ? note.url.trim() : '';
    
    if (!noteUrl) {
      // Manual notes or notes without URL
      noteSourceLink.href = '#';
      noteSourceLink.style.cursor = 'default';
      noteSourceLink.title = 'No source URL available';
    } else {
      const url = new URL(noteUrl, window.location.origin);
      const protocol = url.protocol.toLowerCase();

      // Allow http, https, and internal extension protocols
      if (protocol === 'http:' || protocol === 'https:' || protocol === 'chrome-extension:' || protocol === 'data:') {
        noteSourceLink.href = noteUrl;
      } else {
        warn('⚠️  Blocked dangerous protocol:', protocol, 'for URL:', noteUrl);
        noteSourceLink.href = '#';
        noteSourceLink.style.cursor = 'not-allowed';
      }
    }
  } catch (e) {
    warn('⚠️  Invalid URL:', note.url);
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

  // [NOT-91] Unified preview: Show userNote first if it exists, otherwise captured text
  const notePreview = card.querySelector('.note-preview');
  if (note.userNote) {
    // Show user note as preview
    notePreview.textContent = note.userNote;
  } else if (note.text) {
    // Show captured text as preview
    notePreview.textContent = note.text;
  }

  // [NOT-26] Populate tags with click-to-filter functionality
  const tagsContainer = card.querySelector('.note-tags');
  if (note.tags.length > 0) {
    note.tags.forEach(tag => {
      const tagEl = document.createElement('span');
      tagEl.className = 'note-tag';
      tagEl.textContent = tag;

      // [NOT-85] Highlight tag if it's in active filters
      const isActiveFilter = filterState.tags.some(
        filterTag => filterTag.toLowerCase() === tag.toLowerCase()
      );
      if (isActiveFilter) {
        tagEl.classList.add('active');
      }

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
        // [NOT-69] renderActiveFilters() removed
        updateFilterDropdownActiveStates();
        saveFilterState();
      });

      tagsContainer.appendChild(tagEl);
    });
  } else {
    tagsContainer.style.display = 'none';
  }

  // [NOT-91] Expanded content removed - now shown in detail modal instead

  // [NOT-91] Add click listener to card to open detail modal (excluding action buttons)
  card.addEventListener('click', (e) => {
    // Don't open modal if clicking action buttons
    if (e.target.closest('.note-actions') || e.target.closest('.note-thumbnail') || e.target.closest('.note-tag') || e.target.closest('.note-source-link')) {
      return;
    }
    openNoteDetailModal(note);
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

  // [NOT-84] Tags and Images row (no labels, combined layout)
  const tagsImagesRow = document.createElement('div');
  tagsImagesRow.className = 'tags-images-row';

  // Tags section
  const tagsSection = document.createElement('div');
  tagsSection.className = 'tags-section';
  const tagsContainer = document.createElement('div');
  const editTagInput = new TagInput(tagsContainer, note.tags);
  tagsSection.appendChild(tagsContainer);

  // Store reference to TagInput on the card element for later retrieval
  cardElement._editTagInput = editTagInput;

  // [NOT-33] [NOT-84] Image management section for edit mode
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

  // [NOT-84] Consolidated Add Image Menu (same as capture mode)
  const addImageMenuWrapper = document.createElement('div');
  addImageMenuWrapper.className = 'add-image-menu-wrapper';

  const addImageButton = document.createElement('button');
  addImageButton.className = 'add-image-menu-button';
  addImageButton.type = 'button';
  addImageButton.title = 'Add images';
  addImageButton.id = `edit-add-image-button-${noteId}`;

  const imageIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  imageIcon.classList.add('icon', 'icon-sm');
  const imageUse = document.createElementNS('http://www.w3.org/1999/xlink', 'xlink:href', 'use');
  imageUse.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#icon-image');
  imageIcon.appendChild(imageUse);

  const buttonText = document.createElement('span');
  buttonText.textContent = 'Add Image';

  const chevronIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  chevronIcon.classList.add('icon', 'icon-xs', 'chevron');
  const chevronUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  chevronUse.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#icon-chevron-down');
  chevronIcon.appendChild(chevronUse);

  addImageButton.appendChild(imageIcon);
  addImageButton.appendChild(buttonText);
  addImageButton.appendChild(chevronIcon);

  // Dropdown menu
  const imageMenuDropdown = document.createElement('div');
  imageMenuDropdown.className = 'image-menu-dropdown hidden';
  imageMenuDropdown.id = `edit-image-menu-dropdown-${noteId}`;

  // Hidden file input
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

  // Upload menu item
  const uploadMenuItem = document.createElement('button');
  uploadMenuItem.className = 'image-menu-item';
  uploadMenuItem.type = 'button';
  uploadMenuItem.setAttribute('data-action', 'upload');

  const uploadIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  uploadIcon.classList.add('icon', 'icon-sm');
  const uploadUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  uploadUse.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#icon-upload');
  uploadIcon.appendChild(uploadUse);

  const uploadSpan = document.createElement('span');
  uploadSpan.textContent = 'Upload from Device';

  uploadMenuItem.appendChild(uploadIcon);
  uploadMenuItem.appendChild(uploadSpan);
  uploadMenuItem.addEventListener('click', (e) => {
    e.preventDefault();
    editFileInput.click();
    imageMenuDropdown.classList.add('hidden');
    addImageButton.classList.remove('active');
  });

  // Capture menu item
  const captureMenuItem = document.createElement('button');
  captureMenuItem.className = 'image-menu-item';
  captureMenuItem.type = 'button';
  captureMenuItem.setAttribute('data-action', 'capture');
  captureMenuItem.id = 'edit-capture-webpage-image-button';

  const captureIcon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  captureIcon.classList.add('icon', 'icon-sm');
  const captureUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  captureUse.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#icon-image');
  captureIcon.appendChild(captureUse);

  const captureSpan = document.createElement('span');
  captureSpan.textContent = 'Capture from Webpage';

  captureMenuItem.appendChild(captureIcon);
  captureMenuItem.appendChild(captureSpan);
  captureMenuItem.addEventListener('click', (e) => {
    e.preventDefault();
    activateWebCaptureMode('edit-capture-webpage-image-button');
    imageMenuDropdown.classList.add('hidden');
    addImageButton.classList.remove('active');
  });

  imageMenuDropdown.appendChild(uploadMenuItem);
  imageMenuDropdown.appendChild(captureMenuItem);

  // Toggle dropdown
  addImageButton.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const isHidden = imageMenuDropdown.classList.contains('hidden');
    imageMenuDropdown.classList.toggle('hidden');
    addImageButton.classList.toggle('active', !isHidden);
  });

  // [NOT-84] Close dropdown when clicking outside (within edit form context)
  const closeDropdown = (e) => {
    if (!addImageMenuWrapper.contains(e.target)) {
      imageMenuDropdown.classList.add('hidden');
      addImageButton.classList.remove('active');
    }
  };

  // Store cleanup function
  cardElement._cleanupImageMenu = closeDropdown;

  addImageMenuWrapper.appendChild(addImageButton);
  addImageMenuWrapper.appendChild(imageMenuDropdown);

  tagsImagesRow.appendChild(tagsSection);
  tagsImagesRow.appendChild(addImageMenuWrapper);

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

  // [NOT-84] Assemble form with combined tags/images row
  editForm.appendChild(noteLabel);
  editForm.appendChild(noteTextarea);
  editForm.appendChild(tagsImagesRow);
  editForm.appendChild(editFileInput);
  editForm.appendChild(actionsDiv);

  // [NOT-33] Render images in the existing thumbnail area with delete buttons
  renderEditModeImageGallery(cardElement, editModeImages);

  // [NOT-19] Prevent edit form clicks from triggering card expand/collapse
  editForm.addEventListener('click', (e) => {
    e.stopPropagation();
    // [NOT-84] Also handle closing image menu dropdown
    if (cardElement._cleanupImageMenu) {
      cardElement._cleanupImageMenu(e);
    }
  });

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

  // [NOT-22] [NOT-84] Clean up TagInput reference and image menu handler
  delete cardElement._editTagInput;
  delete cardElement._cleanupImageMenu;

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
 * [NOT-91] Open the detail modal to show full note content
 * Displays large title, date, source, full user note, full captured text, tags, and image gallery
 *
 * @param {Object} note - The note object to display
 */
function openNoteDetailModal(note) {
  log('📄 [NOT-91] Opening note detail modal');

  const modal = document.getElementById('note-detail-modal');
  const closeButton = modal.querySelector('.note-detail-close');
  const backdrop = modal.querySelector('.note-detail-backdrop');

  // Populate header
  modal.querySelector('.note-detail-favicon').src = note.metadata.favicon;
  modal.querySelector('.note-detail-site-name').textContent = note.metadata.title || note.metadata.siteName;
  modal.querySelector('.note-detail-date').textContent = formatDate(note.timestamp);

  // Validate and set source link
  const sourceLink = modal.querySelector('.note-detail-source-link');
  try {
    const noteUrl = note.url ? note.url.trim() : '';
    if (!noteUrl) {
      sourceLink.href = '#';
      sourceLink.style.cursor = 'default';
    } else {
      const url = new URL(noteUrl, window.location.origin);
      const protocol = url.protocol.toLowerCase();
      if (protocol === 'http:' || protocol === 'https:') {
        sourceLink.href = noteUrl;
      } else {
        sourceLink.href = '#';
        sourceLink.style.cursor = 'not-allowed';
      }
    }
  } catch (e) {
    sourceLink.href = '#';
    sourceLink.style.cursor = 'not-allowed';
  }

  // Populate user note section
  const userNoteSection = modal.querySelector('.note-detail-user-note-section');
  if (note.userNote) {
    modal.querySelector('.note-detail-user-note').textContent = note.userNote;
    userNoteSection.classList.remove('hidden');
  } else {
    userNoteSection.classList.add('hidden');
  }

  // Populate captured content section
  const capturedSection = modal.querySelector('.note-detail-captured-section');
  if (note.text) {
    modal.querySelector('.note-detail-captured-text').textContent = note.text;
    capturedSection.classList.remove('hidden');
  } else {
    capturedSection.classList.add('hidden');
  }

  // Populate tags section
  const tagsSection = modal.querySelector('.note-detail-tags-section');
  const tagsContainer = modal.querySelector('.note-detail-tags');
  if (note.tags && note.tags.length > 0) {
    tagsContainer.innerHTML = ''; // Clear existing tags
    note.tags.forEach(tag => {
      const tagEl = document.createElement('span');
      tagEl.className = 'note-detail-tag';
      tagEl.textContent = tag;

      // Add click listener to close modal and filter by tag
      tagEl.addEventListener('click', () => {
        closeNoteDetailModal();

        // Check if tag is already in filter
        const existingTagIndex = filterState.tags.findIndex(
          filterTag => filterTag.toLowerCase() === tag.toLowerCase()
        );

        if (existingTagIndex === -1) {
          // Add tag to filter if not present
          filterState.tags.push(tag);
          filterAndRenderNotes();
          updateFilterDropdownActiveStates();
          saveFilterState();
        }
      });

      tagsContainer.appendChild(tagEl);
    });
    tagsSection.classList.remove('hidden');
  } else {
    tagsSection.classList.add('hidden');
  }

  // Populate images section
  const imagesSection = modal.querySelector('.note-detail-images-section');
  const imagesContainer = modal.querySelector('.note-detail-images');
  const hasImages = note.images && note.images.length > 0;
  const hasLegacyImage = note.imageData && typeof note.imageData === 'string';

  if (hasImages || hasLegacyImage) {
    imagesContainer.innerHTML = ''; // Clear existing images

    // Get images array (support both new and legacy format)
    let images = [];
    if (hasImages) {
      images = note.images;
    } else if (hasLegacyImage) {
      images = [{ id: 'legacy', data: note.imageData, timestamp: note.timestamp || Date.now() }];
    }

    images.forEach((image, index) => {
      const imgEl = document.createElement('img');
      imgEl.className = 'note-detail-image';
      imgEl.src = image.data;
      imgEl.alt = `Note image ${index + 1}`;

      // Add click listener to open lightbox
      imgEl.addEventListener('click', () => {
        openLightbox(images, index);
      });

      imagesContainer.appendChild(imgEl);
    });

    imagesSection.classList.remove('hidden');
  } else {
    imagesSection.classList.add('hidden');
  }

  // Close handlers
  const handleClose = () => {
    closeNoteDetailModal();
  };

  const handleBackdropClick = (e) => {
    if (e.target === backdrop) {
      closeNoteDetailModal();
    }
  };

  const handleKeyboard = (e) => {
    if (e.key === 'Escape') {
      closeNoteDetailModal();
    }
  };

  // Add event listeners
  closeButton.addEventListener('click', handleClose);
  backdrop.addEventListener('click', handleBackdropClick);
  document.addEventListener('keydown', handleKeyboard);

  // Store cleanup function
  modal._cleanup = () => {
    closeButton.removeEventListener('click', handleClose);
    backdrop.removeEventListener('click', handleBackdropClick);
    document.removeEventListener('keydown', handleKeyboard);
  };

  // Show modal
  modal.classList.remove('hidden');
}

/**
 * [NOT-91] Close the note detail modal
 */
function closeNoteDetailModal() {
  log('❌ [NOT-91] Closing note detail modal');

  const modal = document.getElementById('note-detail-modal');

  // Clean up event listeners
  if (modal._cleanup) {
    modal._cleanup();
    delete modal._cleanup;
  }

  modal.classList.add('hidden');
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
 * [NOT-60] Assemble RAG context from filtered notes (the "Stack")
 * Gathers text from all notes currently in the context/filter
 * @returns {string} - Formatted context string for AI
 */
function assembleRAGContext() {
  if (filteredNotes.length === 0) {
    return '';
  }

  // Limit context to prevent token overflow
  const maxNotes = 10; // Limit to top 10 notes
  const notesToInclude = filteredNotes.slice(0, maxNotes);

  // Format each note as a context block
  const contextBlocks = notesToInclude.map((note, index) => {
    const parts = [];

    // Add source info
    parts.push(`[Note ${index + 1}]`);
    if (note.metadata?.title) {
      parts.push(`Title: ${note.metadata.title}`);
    }
    if (note.metadata?.siteName) {
      parts.push(`Source: ${note.metadata.siteName}`);
    }

    // Add note content
    if (note.text) {
      // Strip HTML tags and limit length
      const textContent = note.text.replace(/<[^>]*>/g, '').trim();
      const maxLength = 500; // Limit each note to 500 chars
      const truncated = textContent.length > maxLength
        ? textContent.substring(0, maxLength) + '...'
        : textContent;
      parts.push(`Content: ${truncated}`);
    }

    // Add user notes if present
    if (note.userNote) {
      parts.push(`My Note: ${note.userNote}`);
    }

    // Add tags if present
    if (note.tags && note.tags.length > 0) {
      parts.push(`Tags: ${note.tags.join(', ')}`);
    }

    return parts.join('\n');
  });

  // Assemble final context
  const contextHeader = `I have ${filteredNotes.length} note${filteredNotes.length === 1 ? '' : 's'} in my context${filteredNotes.length > maxNotes ? ` (showing first ${maxNotes})` : ''}:\n\n`;
  return contextHeader + contextBlocks.join('\n\n---\n\n');
}

/**
 * [NOT-60] Handle sending message from Assistant Bar
 * Gathers RAG context from filtered notes and transitions to AI Chat mode
 * @returns {Promise<void>}
 */
async function handleSendAssistantMessage() {
  const assistantInput = document.getElementById('assistant-input');
  const sendButton = document.getElementById('send-assistant-button');

  if (!assistantInput || !sendButton) return;

  const userMessage = assistantInput.value.trim();
  if (!userMessage) return;

  try {
    // Disable input during processing
    assistantInput.disabled = true;
    sendButton.disabled = true;

    // Assemble RAG context from filtered notes
    const ragContext = assembleRAGContext();

    // Build the full message with context
    let fullMessage = userMessage;
    if (ragContext) {
      fullMessage = `${ragContext}\n\nQuestion: ${userMessage}`;
    }

    // Clear the assistant input
    assistantInput.value = '';
    assistantInput.style.height = 'auto';

    // Navigate to AI Chat mode and send the message
    await renderAIChatMode();

    // Get chat elements
    const chatInput = document.getElementById('chat-input');
    const sendChatButton = document.getElementById('send-chat-button');

    if (chatInput && sendChatButton) {
      // Set the message in the chat input
      chatInput.value = fullMessage;

      // Trigger input event to enable send button and resize textarea
      chatInput.dispatchEvent(new Event('input'));

      // Auto-send the message
      setTimeout(() => {
        sendChatButton.click();
      }, 100);
    }

  } catch (error) {
    error('[NOT-60] Failed to send assistant message:', error);
    alert('Failed to send message. Please try again.');
  } finally {
    // Re-enable input
    assistantInput.disabled = false;
    sendButton.disabled = false;
  }
}

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

  // [NOT-76] Chat state moved to module scope to persist across navigations
  // No local variables needed - using module-level currentChatId and isStreaming

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

      // [NOT-68] Build context from Stack (filtered notes + page content)
      let contextPrompt = '';

      // [NOT-68] Use shared helper to get filtered notes (excluding search filter)
      const contextNotes = getStackFilteredNotes();

      // Build context prompt if there are filtered notes or page context
      if (contextNotes.length > 0 || filterState.contextFilter) {
        const contextParts = [];

        // Add filtered notes context
        if (contextNotes.length > 0) {
          contextParts.push(`You have access to ${contextNotes.length} note${contextNotes.length === 1 ? '' : 's'} from the user's library:`);

          contextNotes.slice(0, 10).forEach((note, i) => {
            const noteText = note.userNote || note.text || '';
            const truncated = noteText.length > 200 ? noteText.substring(0, 200) + '...' : noteText;
            const tags = note.tags && note.tags.length > 0 ? ` (Tags: ${note.tags.join(', ')})` : '';
            contextParts.push(`\n${i + 1}. ${note.metadata.title || 'Untitled'}${tags}\n   ${truncated}`);
          });

          if (contextNotes.length > 10) {
            contextParts.push(`\n... and ${contextNotes.length - 10} more notes.`);
          }
        }

        // [NOT-68] Add current page context with actual page content if active
        if (filterState.contextFilter) {
          try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.url && tab?.id) {
              contextParts.push(`\n\nCurrent Page Context:\n- Title: ${tab.title || 'Unknown'}\n- URL: ${tab.url}`);

              // [NOT-68] Get actual page text content (truncated to 8k chars)
              const pageText = await getPageTextContent(tab.id);
              if (pageText) {
                contextParts.push(`\n- Page Content:\n${pageText}`);
                log('[NOT-68] Injected page content:', pageText.length, 'chars');
              }
            }
          } catch (e) {
            warn('[NOT-68] Could not get current page info:', e);
          }
        }

        if (contextParts.length > 0) {
          contextPrompt = contextParts.join('\n');
          log('[NOT-68] Built context prompt with', contextNotes.length, 'notes');
        }
      }

      // Get message history for context
      const messages = await window.database.getChatHistory(currentChatId);
      const messageHistory = messages.map(m => ({
        role: m.role,
        content: m.content
      }));

      // [NOT-68] Prepend context as system message if available
      if (contextPrompt) {
        messageHistory.unshift({
          role: 'system',
          content: contextPrompt
        });
      }

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

          // [NOT-79] Parse structured response (JSON format with thought, content, actions)
          let contentToDisplay = fullResponse;
          let contentToSave = fullResponse;

          try {
            // Try to parse as JSON
            const structuredResponse = JSON.parse(fullResponse);

            if (structuredResponse.thought && structuredResponse.content) {
              // Valid structured response
              log('[NOT-79] 💭 AI Thought:', structuredResponse.thought);
              contentToDisplay = structuredResponse.content;
              contentToSave = structuredResponse.content;

              // Update the UI to show only the content
              aiContentDiv.textContent = contentToDisplay;
              log('[NOT-79] ✅ Parsed structured response successfully');
            } else {
              // JSON but not the expected structure - use raw response
              log('[NOT-79] ⚠️  JSON response missing expected fields, using raw response');
            }
          } catch (parseError) {
            // Not valid JSON - use raw response as fallback
            log('[NOT-79] ℹ️  Response is not JSON, using raw text (this is ok for fallback)');
          }

          await window.database.addMessage(currentChatId, 'assistant', contentToSave);
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

  // [NOT-76] Guard: Only attach listeners once to prevent duplicates
  if (!chatListenersInitialized) {
    sendButton.addEventListener('click', sendMessage);
    chatInput.addEventListener('input', handleInputChange);
    chatInput.addEventListener('keydown', handleChatKeydown);
    clearButton.addEventListener('click', clearChat);

    // [NOT-68] Stack Context Bar event delegation for Chat
    const chatStackContext = document.getElementById('chat-stack-context');
    if (chatStackContext) {
      // Create new handler
      const stackHandler = async (e) => {
        const target = e.target.closest('.stack-chip, .stack-add-button, .remove');

        if (!target) return;

        // Handle "This Page" chip toggle
        if (target.classList.contains('stack-chip-page')) {
          await togglePageContext();
          return;
        }

        // [NOT-71] Handle tag chip click (toggle off when clicked)
        if (target.classList.contains('stack-chip-tag')) {
          const type = target.getAttribute('data-type');
          const value = target.getAttribute('data-value');

          if (type === 'tag' && value) {
            toggleTagFilter(value);
          } else if (type === 'starred') {
            toggleSystemFilter('starred');
          } else if (type === 'readLater') {
            toggleSystemFilter('readLater');
          }
          return;
        }

        // Handle tag chip removal (click on X) - DEPRECATED: X icon removed in NOT-69
        if (target.classList.contains('remove')) {
          const chipElement = target.closest('.stack-chip');
          const type = chipElement?.getAttribute('data-type');
          const value = chipElement?.getAttribute('data-value');

          if (type === 'tag' && value) {
            toggleTagFilter(value);
          } else if (type === 'starred') {
            toggleSystemFilter('starred');
          } else if (type === 'readLater') {
            toggleSystemFilter('readLater');
          }
          return;
        }

        // Handle ghost chip activation (click on suggested tag)
        if (target.classList.contains('stack-chip-ghost')) {
          const tag = target.getAttribute('data-value');
          if (tag) {
            toggleTagFilter(tag);
          }
          return;
        }

        // [NOT-69] Handle Add button (show Stack Menu)
        if (target.classList.contains('stack-add-button')) {
          // [NOT-71] Open menu in current mode (no forced navigation)
          toggleStackMenu();
          return;
        }
      };

      // Store handler reference and add listener
      chatStackContext._stackHandler = stackHandler;
      chatStackContext.addEventListener('click', stackHandler);
    }

    // [NOT-76] Mark listeners as initialized
    chatListenersInitialized = true;
    log('[NOT-76] Chat listeners initialized once');
  }

  // Load chat on mount
  await loadChat();

  // [NOT-89] Always scroll to bottom when chat mode is rendered
  chatMessages.scrollTop = chatMessages.scrollHeight;

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
      // [NOT-67] Simplified header without synthesis button
      const header2 = document.createElement('div');
      header2.className = 'hybrid-section-header';
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

  // [NOT-67] Removed Gemini Nano settings
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

// [NOT-74] setAllNotesExpanded removed - expand/collapse feature removed

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

  // [NOT-83] Image dropdown menu handler
  const addImageMenuButton = document.getElementById('add-image-menu-button');
  const imageMenuDropdown = document.getElementById('image-menu-dropdown');
  const imageUploadInput = document.getElementById('image-upload-input');

  if (addImageMenuButton && imageMenuDropdown) {
    // Toggle dropdown on button click
    addImageMenuButton.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = imageMenuDropdown.classList.contains('hidden');

      if (isHidden) {
        imageMenuDropdown.classList.remove('hidden');
        addImageMenuButton.classList.add('active');
      } else {
        imageMenuDropdown.classList.add('hidden');
        addImageMenuButton.classList.remove('active');
      }
    });

    // Handle menu item clicks
    const menuItems = imageMenuDropdown.querySelectorAll('.image-menu-item');
    menuItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = item.getAttribute('data-action');

        // Close dropdown
        imageMenuDropdown.classList.add('hidden');
        addImageMenuButton.classList.remove('active');

        // Execute action
        if (action === 'upload') {
          imageUploadInput.click();
        } else if (action === 'capture') {
          activateWebCaptureMode('add-image-menu-button');
        }
      });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!imageMenuDropdown.contains(e.target) && e.target !== addImageMenuButton) {
        imageMenuDropdown.classList.add('hidden');
        addImageMenuButton.classList.remove('active');
      }
    });
  }

  // [NOT-33] File input change handler
  if (imageUploadInput) {
    imageUploadInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleFileUpload(e.target.files, false);
        // Reset input so same file can be selected again
        e.target.value = '';
      }
    });
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

  // [NOT-69] Setup Stack Menu event listeners globally (works in all modes)
  setupStackMenuEventListeners();

  // [NOT-31] Listen for tab changes to refresh contextual recall pill
  // [NOT-69] Also update Stack Context Bars to refresh counts and ghost chips
  chrome.tabs.onActivated.addListener(async () => {
    if (currentMode === 'library') {
      await checkContextualRecall();
      await updateContextBars();
    }
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.url && currentMode === 'library') {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab && activeTab.id === tabId) {
        await checkContextualRecall();
        await updateContextBars();
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
    } catch (err) {
      error('❌ [NOT-40] Error checking Gemini availability:', err);
      geminiAvailable = false;
    }
  } catch (err) {
    error('❌ Error initializing panel:', err);
  }
});
