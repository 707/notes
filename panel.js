// Klue - Side Panel Logic

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

// Modules
import {
  getState,
  setState,
  setMode,
  setNotes,
  setFilteredNotes,
  resetEditMode,
  resetCaptureState
} from './modules/state.js';

import {
  sanitizeHtml,
  formatDate,
  enhanceRichMedia
} from './modules/utils.js';

import {
  TagInput,
  showTooltip
} from './modules/ui.js';

import {
  initNavigation,
  renderStackContextBar,
  updateContextBars,
  getNotesForUrl,
  getContextAwareTags,
  getAllTags,
  toggleStackMenu,
  renderStackMenu,
  getStackFilteredNotes,
  getPageTextContent,
  clearStackContext,
  togglePageContext,
  toggleTagFilter,
  toggleSystemFilter,
  navigateToView
} from './modules/navigation.js';

import {
  db,
  migrateFromChromeStorage,
  addNote,
  getAllNotes,
  deleteNote,
  getNotesByTag,
  searchNotes,
  updateNote,
  getNotesCount,
  addIgnoredConnection,
  isConnectionIgnored,
  getIgnoredConnectionsForContext,
  saveOramaIndex,
  loadOramaIndex,
  createChat,
  addMessage,
  getChatHistory,
  getLatestChat,
  deleteChat
} from './modules/database.js';

import {
  initCapture,
  handleFileUpload,
  handleWebCaptureStorageChange,
  activateWebCaptureMode,
  fetchLocalTagSuggestions,
  handleSaveClip
} from './modules/capture.js';

import {
  initAIChat,
  renderAIChatMode
} from './modules/ai-chat.js';

import {
  initSettings,
  renderSettingsMode
} from './modules/settings.js';

// [NOT-34] Debug flag - set to false for production
const DEBUG = true;
const log = DEBUG ? console.log.bind(console) : () => { };
const warn = DEBUG ? console.warn.bind(console) : () => { };
const error = console.error.bind(console); // Always log errors

log('📱 Panel script loaded (ES Module)');

// Initialize modules
initAIChat({ log, warn, error });
initSettings({ log, warn, error });

// Note: initNavigation() will be called after saveFilterState and filterAndRenderNotes are defined
// See initialization sequence at the end of this file

// =============================================================================
// @STATE - Global Variables & Persistence
// =============================================================================

// Access state via getState() or modify via setters
// For convenience in refactoring, we can alias some properties locally if needed, 
// but direct usage of getState().prop is preferred to avoid stale references.

// Dexie instance is now imported as `db`

// [NOT-31] Filter & View State

let libraryListenersInitialized = false;

// [NOT-76] Chat State (Module Scope)
let chatListenersInitialized = false;

// [NOT-39] Contextual Recall State - Moved to modules/state.js
// let contextPillAnimated = false;
// let contextMatchType = null;
// let semanticMatches = [];

// [NOT-22] Global TagInput instance for Capture Mode
let captureTagInput = null;

// Load persisted filter state
async function loadFilterState() {
  try {
    const metadata = await db.metadata.get('filterState');
    if (metadata && metadata.value) {
      let loadedFilterState = metadata.value;
      // [NOT-31] Always reset context filter on load (page-specific, shouldn't persist)
      loadedFilterState.contextFilter = null;
      // [NOT-35] Ensure starred property exists (for backward compatibility)
      if (loadedFilterState.starred === undefined) {
        loadedFilterState.starred = false;
      }
      setState({ filterState: loadedFilterState });
      log('📂 Loaded persisted filter state:', getState().filterState);
    }
  } catch (error) {
    error('❌ Error loading filter state:', error);
  }
}

// Save filter state
// Save filter state
async function saveFilterState() {
  try {
    await db.metadata.put({ key: 'filterState', value: getState().filterState });
  } catch (error) {
    error('❌ Error saving filter state:', error);
  }
}

// =============================================================================
// @CORE_UTILS - Sanitization, Helpers, & Date Formatting
// =============================================================================

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
  // previousMode handled by setMode
  setMode('capture');

  // [NOT-33] Reset edit mode flags (in case we're coming from library with an active edit)
  setState({
    isEditModeActive: false,
    editModeNoteId: null,
    editModeImages: []
  });

  // [NOT-33] Initialize images array from clipData or start fresh
  setState({ currentImages: [] });

  // Handle legacy single imageData (backward compatibility)
  if (clipData.imageData && typeof clipData.imageData === 'string') {
    setState({
      currentImages: [{
        id: crypto.randomUUID(),
        data: clipData.imageData,
        timestamp: Date.now()
      }]
    });
  }

  // Handle new multi-image format
  if (clipData.images && Array.isArray(clipData.images)) {
    setState({ currentImages: [...clipData.images] });
  }

  // [NOT-33] Reset web capture listening state
  setState({
    isWebCaptureListening: false
  });
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
  if (getState().allNotes.length === 0) {
    try {
      setNotes(await getAllNotes());
      log(`📚 Loaded ${getState().allNotes.length} notes for tag autocomplete`);
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
  renderImagePreviews('capture-image-preview-list', getState().currentImages, false);

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
  switch (getState().previousMode) {
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
  setMode('library');
  navigateToView('library-mode');

  // Hide loading
  document.getElementById('loading').classList.add('hidden');

  // [NOT-74] Expand button removed - expand/collapse feature removed

  // Load notes from IndexedDB
  setNotes(await getAllNotes());
  setFilteredNotes([...getState().allNotes]);

  log(`📚 Loaded ${getState().allNotes.length} notes`);

  // [NOT-16] Setup event listeners only once to prevent duplicates
  if (!libraryListenersInitialized) {
    setupLibraryEventListeners();
    libraryListenersInitialized = true;
  }



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
      getState().filterState.search = e.target.value.trim().toLowerCase();
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
      getState().filterState.sort = value;
    } else if (type === 'tag') {
      if (getState().filterState.tags.includes(value)) {
        // Remove tag
        getState().filterState.tags = getState().filterState.tags.filter(t => t !== value);
      } else {
        // Add tag
        getState().filterState.tags.push(value);
      }
    } else if (type === 'readLater') {
      // [NOT-18] Toggle Read Later filter
      getState().filterState.readLater = !getState().filterState.readLater;
    } else if (type === 'starred') {
      // [NOT-35] Toggle Starred filter
      getState().filterState.starred = !getState().filterState.starred;
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
      const currentSearch = getState().filterState.search;
      getState().filterState.contextFilter = null;
      getState().filterState.tags = [];
      getState().filterState.readLater = false;
      getState().filterState.starred = false;
      getState().filterState.search = currentSearch; // Keep search text

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
    if ((e.metaKey || e.ctrlKey) && e.key === 'f' && getState().currentMode === 'library') {
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
        getState().filterState.search = '';
        getState().filterState.readLater = false; // [NOT-18] Also clear Read Later filter
        getState().filterState.contextFilter = null; // [NOT-31] Also clear context filter

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
      getState().filterState.starred = !getState().filterState.starred;
      filterAndRenderNotes();
      await renderStackMenu(); // Update menu state
      updateContextBars();
      saveFilterState();
    } else if (type === 'readLater') {
      // Toggle read later filter
      getState().filterState.readLater = !getState().filterState.readLater;
      filterAndRenderNotes();
      await renderStackMenu(); // Update menu state
      updateContextBars();
      saveFilterState();
    } else if (type === 'tag' && value) {
      // Toggle tag filter
      if (getState().filterState.tags.includes(value)) {
        getState().filterState.tags = getState().filterState.tags.filter(t => t !== value);
      } else {
        getState().filterState.tags.push(value);
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
      const activeTags = new Set(getState().filterState.tags || []);
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
        const use = document.createElementNS('http://www.w3.org/1999/xlink', 'xlink:href', '#icon-tag');
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
    if (getState().filterState.readLater) {
      readLaterOption.classList.add('active');
    } else {
      readLaterOption.classList.remove('active');
    }
  }

  // [NOT-35] Update Starred filter option
  const starredOption = filterDropdown.querySelector('[data-type="starred"]');
  if (starredOption) {
    if (getState().filterState.starred) {
      starredOption.classList.add('active');
    } else {
      starredOption.classList.remove('active');
    }
  }

  // Update Sort options
  const sortOptions = filterDropdown.querySelectorAll('[data-type="sort"]');
  sortOptions.forEach(option => {
    if (option.dataset.value === getState().filterState.sort) {
      option.classList.add('active');
    } else {
      option.classList.remove('active');
    }
  });

  // [NOT-72] Tag options removed - tags now managed via Stack Menu
}

function filterAndRenderNotes() {
  // [NOT-68] Use shared helper for stack filters (context, tags, starred, readLater)
  setFilteredNotes(getStackFilteredNotes());

  // Apply search filter (on top of stack filters)
  if (getState().filterState.search) {
    setFilteredNotes(getState().filteredNotes.filter(note => {
      const searchableText = [
        note.text,
        note.userNote,
        note.metadata.siteName,
        note.metadata.title
      ].join(' ').toLowerCase();

      return searchableText.includes(getState().filterState.search);
    }));
  }

  // Apply sort
  if (getState().filterState.sort === 'newest') {
    getState().filteredNotes.sort((a, b) => b.timestamp - a.timestamp);
  } else if (getState().filterState.sort === 'oldest') {
    getState().filteredNotes.sort((a, b) => a.timestamp - b.timestamp);
  }

  // Update ARIA live region for screen readers
  const filterStatus = document.getElementById('filter-status');
  if (filterStatus) {
    const activeFiltersCount = (getState().filterState.sort !== 'newest' ? 1 : 0) + getState().filterState.tags.length + (getState().filterState.readLater ? 1 : 0) + (getState().filterState.starred ? 1 : 0);
    filterStatus.textContent = `Showing ${getState().filteredNotes.length} of ${getState().allNotes.length} clips${activeFiltersCount > 0 ? ` with ${activeFiltersCount} filter${activeFiltersCount === 1 ? '' : 's'} active` : ''}`;
  }

  // Update search input// placeholder
  updatePlaceholder();

  // [NOT-68] Show/hide search escape hatch
  const escapeHatch = document.getElementById('search-escape-hatch');
  if (escapeHatch) {
    // Show if: searching AND has active context (page, tags, starred, or read later)
    const hasActiveContext = getState().filterState.contextFilter ||
      getState().filterState.tags.length > 0 ||
      getState().filterState.starred ||
      getState().filterState.readLater;
    const isSearching = getState().filterState.search && getState().filterState.search.trim().length > 0;

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
  const assistantInput = document.getElementById('assistant-input');
  if (!filterInput) return;

  const activeFiltersCount = (getState().filterState.sort !== 'newest' ? 1 : 0) + getState().filterState.tags.length + (getState().filterState.readLater ? 1 : 0) + (getState().filterState.starred ? 1 : 0);

  if (activeFiltersCount > 0) {
    filterInput.placeholder = `Search, filter, or sort... (${activeFiltersCount} filter${activeFiltersCount === 1 ? '' : 's'} active)`;
  } else {
    filterInput.placeholder = 'Search, filter, or sort...';
  }

  // [Option C] Dynamic Assistant Placeholder
  if (assistantInput) {
    if (getState().allNotes.length === 0) {
      assistantInput.placeholder = 'Ask about this page...';
    } else {
      assistantInput.placeholder = 'Ask about your notes...';
    }
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
        getState().filterState.sort = 'newest'; // Reset to default
      } else if (type === 'tag') {
        getState().filterState.tags = getState().filterState.tags.filter(t => t !== value);
      } else if (type === 'readLater') {
        // [NOT-18] Remove Read Later filter
        getState().filterState.readLater = false;
      } else if (type === 'starred') {
        // [NOT-35] Remove Starred filter
        getState().filterState.starred = false;
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
  if (getState().allNotes.length === 0) {
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
  if (getState().filteredNotes.length === 0) {
    // Has notes but search/filter returned nothing
    emptyStateEl.classList.add('hidden');
    searchEmptyStateEl.classList.remove('hidden');
    document.getElementById('search-empty-query').textContent =
      getState().filterState.search ? `No results for "${getState().filterState.search}"` : 'No notes match your filters';
    return;
  }

  // Has notes to display
  emptyStateEl.classList.add('hidden');
  searchEmptyStateEl.classList.add('hidden');

  // [NOT-23] Render each note with staggered entrance animation
  getState().filteredNotes.forEach((note, index) => {
    const noteCard = createNoteCard(note, index);

    // [NOT-16] Apply expand all state to maintain consistency
    if (getState().isExpandedAll) {
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

  log(`📝 Rendered ${getState().filteredNotes.length} notes`);

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
      const isActiveFilter = getState().filterState.tags.some(
        filterTag => filterTag.toLowerCase() === tag.toLowerCase()
      );
      if (isActiveFilter) {
        tagEl.classList.add('active');
      }

      // [NOT-26] Add click listener to toggle tag filter (case-insensitive)
      tagEl.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent card expansion

        // Check if tag is already in filter (case-insensitive)
        const existingTagIndex = getState().filterState.tags.findIndex(
          filterTag => filterTag.toLowerCase() === tag.toLowerCase()
        );

        if (existingTagIndex !== -1) {
          // Remove tag if already in filter
          getState().filterState.tags.splice(existingTagIndex, 1);
        } else {
          // Add tag to filter if not present
          getState().filterState.tags.push(tag);
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
  const originalNotes = [...getState().allNotes];

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
    setNotes(getState().allNotes.filter(note => note.id !== noteId));

    log('✅ Note deleted');

    // Re-render
    filterAndRenderNotes();
    populateFilterDropdown();

  } catch (error) {
    error('❌ Error deleting note:', error);

    // Rollback local state on error
    setNotes(originalNotes);

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
  const note = getState().allNotes.find(n => n.id === noteId);
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
    if (getState().filterState.readLater) {
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
    if (getState().filterState.readLater) {
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
  const note = getState().allNotes.find(n => n.id === noteId);
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
    if (getState().filterState.starred) {
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
    if (getState().filterState.starred) {
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

  const note = getState().allNotes.find(n => n.id === noteId);
  if (!note) {
    error('❌ Note not found:', noteId);
    return;
  }

  log('✏️  Entering edit mode for note:', noteId);

  // [NOT-33] Set edit mode flags
  setState({
    isEditModeActive: true,
    editModeNoteId: noteId,
    editModeImages: note.images || []
  });

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
  let initialImages = [];
  if (note.images && Array.isArray(note.images)) {
    initialImages = [...note.images];
  } else if (note.imageData && typeof note.imageData === 'string') {
    // Backward compatibility for legacy single imageData
    initialImages = [{
      id: crypto.randomUUID(),
      data: note.imageData,
      timestamp: note.timestamp || Date.now()
    }];
  }
  setState({ editModeImages: initialImages });

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
  const uploadUse = document.createElementNS('http://www.w3.org/1999/xlink', 'xlink:href', '#icon-upload');
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
  const captureUse = document.createElementNS('http://www.w3.org/1999/xlink', 'xlink:href', '#icon-image');
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
    handleSaveEdit(noteId, cardElement, noteTextarea.value, tags, getState().editModeImages);
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
  renderEditModeImageGallery(cardElement, getState().editModeImages);

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
  const note = getState().allNotes.find(n => n.id === noteId);
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
    setState({
      isEditModeActive: false,
      editModeNoteId: null,
      editModeImages: []
    });

    // Stop listening mode if active
    if (getState().isWebCaptureListening) {
      setState({ isWebCaptureListening: false });
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

  const note = getState().allNotes.find(n => n.id === noteId);
  if (!note) {
    error('❌ Note not found:', noteId);
    return;
  }

  // [NOT-33] Reset edit mode flags
  setState({
    isEditModeActive: false,
    editModeNoteId: null,
    editModeImages: []
  });

  // [NOT-33] Stop listening mode if active
  if (getState().isWebCaptureListening) {
    setState({ isWebCaptureListening: false });
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
  if (getState().filteredNotes.length === 0) {
    return '';
  }

  // Limit context to prevent token overflow
  const maxNotes = 10; // Limit to top 10 notes
  const notesToInclude = getState().filteredNotes.slice(0, maxNotes);

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
  const contextHeader = `I have ${getState().filteredNotes.length} note${getState().filteredNotes.length === 1 ? '' : 's'} in my context${getState().filteredNotes.length > maxNotes ? ` (showing first ${maxNotes})` : ''}:\n\n`;
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
 * [NOT-39] Render hybrid view with "From this Page" and "Related Concepts" sections
 * Used when context pill is clicked in semantic or hybrid state
 * @param {HTMLElement} notesListEl - The notes list container element
 */







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

  // Initialize navigation module with callbacks for state persistence and rendering
  initNavigation(saveFilterState, filterAndRenderNotes);
  log('✅ Navigation module initialized');

  // Initialize capture module with dependencies
  // Note: captureTagInput is created dynamically in renderCaptureMode,
  // so we pass a getter function that returns the current instance
  initCapture({
    log,
    warn,
    error,
    renderEditModeImageGallery,
    renderImagePreviews,
    openLightbox,
    navigateToLibrary,
    getCaptureTagInput: () => captureTagInput
  });
  log('✅ Capture module initialized');

  // [NOT-31] Listen for tab changes to refresh contextual recall pill
  // [NOT-69] Also update Stack Context Bars to refresh counts and ghost chips
  chrome.tabs.onActivated.addListener(async () => {
    if (getState().currentMode === 'library') {
      await checkContextualRecall();
      await updateContextBars();
    }
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (changeInfo.url && getState().currentMode === 'library') {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab && activeTab.id === tabId) {
        await checkContextualRecall();
        await updateContextBars();
      }
    }
  });

  try {
    // Run data migration (if needed)
    await migrateFromChromeStorage();

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
          if (!getState().isWebCaptureListening) {
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

    // [NOT-40] Gemini Nano availability check removed - no longer using built-in Gemini
    // Using OpenRouter API instead for AI features
  } catch (err) {
    error('❌ Error initializing panel:', err);
  }
});
