// Knowledge Clipper - Side Panel Logic

// [NOT-34] Debug flag - set to false for production
const DEBUG = true;
const log = DEBUG ? console.log.bind(console) : () => {};
const warn = DEBUG ? console.warn.bind(console) : () => {};
const error = console.error.bind(console); // Always log errors

log('📱 Panel script loaded');

// State
let currentMode = null;
let previousMode = null; // [NOT-34] Track previous view for navigation after capture
let allNotes = [];
let filteredNotes = [];

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
 * [NOT-31] Check for Contextual Recall - show pill if notes exist for current page
 * Optimized single-pass algorithm to count exact and domain matches
 * @returns {Promise<void>}
 */
async function checkContextualRecall() {
  try {
    // Get current tab URL
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;

    const currentUrl = tab.url;

    // Extract domain from current URL
    let currentDomain = '';
    try {
      const url = new URL(currentUrl);
      currentDomain = url.hostname;
    } catch (e) {
      return; // Invalid URL, silently exit
    }

    // Single-pass counting (optimized for large libraries)
    let exactCount = 0;
    let domainCount = 0;

    for (const note of allNotes) {
      if (!note.url) continue;

      // Check exact match first
      if (note.url === currentUrl) {
        exactCount++;
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

    const pillElement = document.getElementById('context-pill');
    const pillText = pillElement?.querySelector('.pill-text');
    if (!pillElement || !pillText) return;

    // Display logic: prioritize exact matches
    if (exactCount > 0) {
      contextMatchType = 'exact';
      pillText.textContent = `${exactCount} Note${exactCount === 1 ? '' : 's'} Here`;
      showPillWithAnimation(pillElement);
    } else if (domainCount > 0) {
      contextMatchType = 'domain';
      pillText.textContent = `${domainCount} Note${domainCount === 1 ? '' : 's'} on Site`;
      showPillWithAnimation(pillElement);
    } else {
      // No matches
      pillElement.classList.add('hidden');
      contextMatchType = null;
    }
  } catch (error) {
    error('[NOT-31] Error in checkContextualRecall:', error);
  }
}

/**
 * [NOT-31] Helper to show pill with one-time animation
 * @param {HTMLElement} pillElement - The pill element
 */
function showPillWithAnimation(pillElement) {
  pillElement.classList.remove('hidden');
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

// Unified filter state
let filterState = {
  search: '',
  sort: 'newest',
  tags: [],
  readLater: false, // [NOT-18] Read Later filter
  starred: false, // [NOT-35] Starred filter
  contextFilter: null // [NOT-31] Contextual Recall filter (stores URL or domain string)
};

// [NOT-16] Expand all state
let isExpandedAll = false;

// [NOT-16] Track if library event listeners have been set up
let libraryListenersInitialized = false;

// [NOT-31] Track if context pill animation has been shown (to prevent repeat animations)
let contextPillAnimated = false;
let contextMatchType = null; // 'exact' or 'domain'

// [NOT-33] Multi-image state
let currentImages = []; // Array of {id, data, timestamp} objects for current note being created/edited
let isWebCaptureListening = false; // Track if we're waiting for webpage image capture
let editModeImages = []; // Separate array for edit mode to avoid conflicts
let isEditModeActive = false; // Track if we're currently in edit mode
let editModeNoteId = null; // Track which note is being edited

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

    // [NOT-22] Create wrapper for input and suggestions
    this.wrapper = document.createElement('div');
    this.container.appendChild(this.wrapper);

    this.render();
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

    // Get recent tags (sorted by most recent usage)
    const recentTags = this.getRecentTags(10);

    // Filter out already-added tags
    const availableTags = recentTags.filter(tag => {
      const lowerTag = tag.toLowerCase();
      return !this.tags.some(t => t.toLowerCase() === lowerTag);
    });

    if (availableTags.length === 0) {
      return; // Don't show empty suggestions
    }

    // Create suggestions container
    const suggestionsContainer = document.createElement('div');
    suggestionsContainer.className = 'tag-suggestions';

    // Add label
    const label = document.createElement('span');
    label.className = 'tag-suggestions-label';
    label.textContent = 'Recent:';
    suggestionsContainer.appendChild(label);

    // Render each suggestion chip
    availableTags.forEach(tag => {
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
  } catch (error) {
    error('❌ Error initializing panel:', error);
  }
});

// [NOT-22] Global TagInput instance for Capture Mode
let captureTagInput = null;

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

  // [NOT-33] Render image previews
  renderImagePreviews('capture-image-preview-list', currentImages, false);

  // [NOT-16] Store clipData for save handler
  window.currentClipData = clipData;
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

    // [NOT-20] [NOT-16] [NOT-27] [NOT-33] Create note object
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
      timestamp: Date.now(),
      readLater: false, // [NOT-18] Initialize Read Later flag
      starred: false, // [NOT-35] Initialize starred flag for consistency
      images: currentImages // [NOT-33] Store images array (replaces legacy imageData)
    };

    // Save note to IndexedDB
    await window.database.addNote(note);

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

/**
 * [NOT-31] [NOT-34] Handle context pill click - toggle contextual recall filter
 * When activating: navigates to library (if needed), filters notes and auto-expands them
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

      // Set filter based on match type
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

    // Toggle filter state (when already in library)
    if (filterState.contextFilter) {
      // Deactivate filter
      filterState.contextFilter = null;
      pillElement?.classList.remove('active');
      setAllNotesExpanded(false);
    } else {
      // Activate filter
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.url) return;

      const currentUrl = tab.url;

      // Set filter based on match type
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
    error('[NOT-31] Error handling context pill click:', error);
  }
}

/**
 * [NOT-34] AI Chat Mode
 */
async function renderAIChatMode() {
  currentMode = 'ai-chat';
  navigateToView('ai-chat-mode');
}

/**
 * [NOT-34] Settings Mode
 */
async function renderSettingsMode() {
  currentMode = 'settings';
  navigateToView('settings-mode');
}

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
 * [NOT-18] Render the notes list with focus preservation
 * Saves and restores keyboard focus to prevent UX regression during re-renders
 */
function renderNotesList() {
  const notesListEl = document.getElementById('notes-list');
  const emptyStateEl = document.getElementById('empty-state');
  const searchEmptyStateEl = document.getElementById('search-empty-state');

  // [NOT-18] Save focused element to restore after re-render
  const activeElement = document.activeElement;
  const focusedNoteId = activeElement?.closest('.note-card')?.dataset?.noteId;
  const focusedElementSelector = activeElement?.className;

  // Clear existing notes (but keep empty states)
  const existingCards = notesListEl.querySelectorAll('.note-card');
  existingCards.forEach(card => card.remove());

  // Handle empty states
  if (allNotes.length === 0) {
    // No notes at all
    emptyStateEl.classList.remove('hidden');
    searchEmptyStateEl.classList.add('hidden');
    return;
  }

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

/**
 * [NOT-23] Create a note card element with optional staggered animation
 * @param {Object} note - The note data
 * @param {number} index - The index for staggered animation delay
 * @returns {HTMLElement} - The note card element
 */
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
