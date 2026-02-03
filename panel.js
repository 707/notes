// Knowledge Clipper - Side Panel Logic
console.log('📱 Panel script loaded');

// State
let currentMode = null;
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

// Unified filter state
let filterState = {
  search: '',
  sort: 'newest',
  tags: [],
  readLater: false // [NOT-18] Read Later filter
};

// [NOT-16] Expand all state
let isExpandedAll = false;

// [NOT-16] Track if library event listeners have been set up
let libraryListenersInitialized = false;

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
      console.log('📂 Loaded persisted filter state:', filterState);
    }
  } catch (error) {
    console.error('❌ Error loading filter state:', error);
  }
}

// Save filter state
async function saveFilterState() {
  try {
    await window.database.db.metadata.put({ key: 'filterState', value: filterState });
  } catch (error) {
    console.error('❌ Error saving filter state:', error);
  }
}

/**
 * [NOT-16] [NOT-27] Handle create note button click
 * Attempts to capture current page metadata, falls back to blank note for restricted pages
 */
async function handleCreateNote() {
  console.log('➕ Creating note from current page...');

  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      console.warn('⚠️  No active tab found, creating blank note');
      await chrome.storage.local.remove('pendingClipData');
      renderCaptureMode({});
      return;
    }

    // Check if URL is valid for script injection (http/https only)
    const url = tab.url;
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      console.warn('⚠️  Restricted page (chrome://, etc.), creating blank note');
      await chrome.storage.local.remove('pendingClipData');
      renderCaptureMode({});
      return;
    }

    // Extract page metadata
    console.log('📊 Extracting page metadata from:', url);
    const metadataResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageMetadata
    });

    const metadata = metadataResults[0].result;
    console.log('✅ Metadata extracted:', metadata);

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

  } catch (error) {
    console.error('❌ Error capturing page:', error);
    // Fallback to blank note on error
    await chrome.storage.local.remove('pendingClipData');
    renderCaptureMode({});
  }
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🎯 Initializing panel...');

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

  try {
    // Run data migration (if needed)
    await window.database.migrateFromChromeStorage();

    // Load persisted filter state
    await loadFilterState();

    // Check for pending clip data from chrome.storage.local
    const { pendingClipData } = await chrome.storage.local.get('pendingClipData');

    if (pendingClipData) {
      console.log('📋 Found pending clip data, rendering Capture Mode');
      renderCaptureMode(pendingClipData);
    } else {
      console.log('⏳ No pending data yet, waiting for it or showing library...');

      // Set up listener for when pendingClipData arrives
      let timeoutId = setTimeout(() => {
        console.log('📚 No clip data received, showing Library Mode');
        renderLibraryMode();
      }, 500); // Wait 500ms for data to arrive

      // Listen for storage changes
      const listener = (changes, area) => {
        if (area === 'local' && changes.pendingClipData && changes.pendingClipData.newValue) {
          console.log('📋 Pending clip data arrived, rendering Capture Mode');
          clearTimeout(timeoutId);
          chrome.storage.onChanged.removeListener(listener);
          renderCaptureMode(changes.pendingClipData.newValue);
        }
      };

      chrome.storage.onChanged.addListener(listener);
    }
  } catch (error) {
    console.error('❌ Error initializing panel:', error);
  }
});

// [NOT-22] Global TagInput instance for Capture Mode
let captureTagInput = null;

/**
 * [NOT-16] Capture Mode - Supports both web clips and manual note creation
 * @param {Object} clipData - The clip data (can be empty for manual notes)
 */
async function renderCaptureMode(clipData = {}) {
  currentMode = 'capture';

  // Hide loading and library, show capture
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('library-mode').classList.add('hidden');
  document.getElementById('capture-mode').classList.remove('hidden');

  // [NOT-16] Show back button, hide library-only buttons
  const backButton = document.getElementById('back-button');
  const createButton = document.getElementById('create-note-button');
  const expandButton = document.getElementById('expand-all-button');

  if (backButton) {
    backButton.classList.remove('hidden');
    backButton.onclick = navigateToLibrary;
  }
  if (createButton) createButton.classList.add('hidden');
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
      console.log(`📚 Loaded ${allNotes.length} notes for tag autocomplete`);
    } catch (error) {
      console.error('❌ Error loading notes for autocomplete:', error);
    }
  }

  // [NOT-22] [NOT-16] Initialize TagInput component (clear container first to prevent duplication)
  const tagsContainer = document.getElementById('capture-tags-container');
  tagsContainer.innerHTML = ''; // Clear any existing tag input
  captureTagInput = new TagInput(tagsContainer, []);

  // [NOT-16] Store clipData for save handler
  window.currentClipData = clipData;
}

/**
 * [NOT-16] Save a clip or manual note
 * @param {Object} clipData - The clip data (can be empty for manual notes)
 */
async function handleSaveClip(clipData = {}) {
  console.log('💾 Saving clip...');

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

    // [NOT-20] [NOT-16] [NOT-27] Create note object
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
      readLater: false // [NOT-18] Initialize Read Later flag
    };

    // Save note to IndexedDB
    await window.database.addNote(note);

    // Remove pending clip data from chrome.storage
    await chrome.storage.local.remove('pendingClipData');

    console.log('✅ Clip saved successfully:', note);

    // Show success feedback
    saveButton.classList.add('success');
    saveButton.querySelector('.button-text').textContent = 'Saved!';
    const iconEl = saveButton.querySelector('.button-icon use');
    if (iconEl) {
      iconEl.setAttribute('href', '#icon-check');
    }

    // Auto-close after delay
    setTimeout(() => {
      console.log('🚪 Auto-closing panel...');
      window.close();
    }, 800);

  } catch (error) {
    console.error('❌ Error saving clip:', error);
    saveButton.disabled = false;
    alert('Failed to save clip. Please try again.');
  }
}

/**
 * Navigation
 */
async function navigateToLibrary() {
  console.log('⬅️ Navigating back to library...');

  // Clear pending clip data from chrome.storage
  await chrome.storage.local.remove('pendingClipData');

  // Render library mode
  await renderLibraryMode();
}

/**
 * [NOT-16] Toggle expand/collapse state for all note cards
 */
function handleToggleExpandAll() {
  const expandButton = document.getElementById('expand-all-button');
  const noteCards = document.querySelectorAll('.note-card');

  // Toggle state
  isExpandedAll = !isExpandedAll;

  console.log(`${isExpandedAll ? '📖' : '📕'} ${isExpandedAll ? 'Expanding' : 'Collapsing'} all notes`);

  // Update all cards
  noteCards.forEach(card => {
    if (isExpandedAll) {
      card.classList.add('expanded');
      card.setAttribute('aria-expanded', 'true');
    } else {
      card.classList.remove('expanded');
      card.setAttribute('aria-expanded', 'false');
    }
  });

  // Update button icon and title
  const iconUse = expandButton.querySelector('use');
  if (isExpandedAll) {
    iconUse.setAttribute('href', '#icon-minimize');
    expandButton.setAttribute('title', 'Collapse all notes');
    expandButton.setAttribute('aria-label', 'Collapse all notes');
  } else {
    iconUse.setAttribute('href', '#icon-maximize');
    expandButton.setAttribute('title', 'Expand all notes');
    expandButton.setAttribute('aria-label', 'Expand all notes');
  }
}

/**
 * Library Mode
 */
async function renderLibraryMode() {
  currentMode = 'library';

  // Hide loading and capture, show library
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('capture-mode').classList.add('hidden');
  document.getElementById('library-mode').classList.remove('hidden');

  // [NOT-16] Hide back button, show library-only buttons
  const backButton = document.getElementById('back-button');
  const createButton = document.getElementById('create-note-button');
  const expandButton = document.getElementById('expand-all-button');

  if (backButton) backButton.classList.add('hidden');
  if (createButton) createButton.classList.remove('hidden');
  if (expandButton) expandButton.classList.remove('hidden');

  // [NOT-16] Reset expand all state
  isExpandedAll = false;
  if (expandButton) {
    const iconUse = expandButton.querySelector('use');
    if (iconUse) {
      iconUse.setAttribute('href', '#icon-maximize');
      expandButton.setAttribute('title', 'Expand all notes');
      expandButton.setAttribute('aria-label', 'Expand all notes');
    }
  }

  // Load notes from IndexedDB
  allNotes = await window.database.getAllNotes();
  filteredNotes = [...allNotes];

  console.log(`📚 Loaded ${allNotes.length} notes`);

  // [NOT-16] Setup event listeners only once to prevent duplicates
  if (!libraryListenersInitialized) {
    setupLibraryEventListeners();
    libraryListenersInitialized = true;
  }

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
    filterInput.value = '';
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

  // Apply sort
  if (filterState.sort === 'newest') {
    filteredNotes.sort((a, b) => b.timestamp - a.timestamp);
  } else if (filterState.sort === 'oldest') {
    filteredNotes.sort((a, b) => a.timestamp - b.timestamp);
  }

  // Update ARIA live region for screen readers
  const filterStatus = document.getElementById('filter-status');
  if (filterStatus) {
    const activeFiltersCount = (filterState.sort !== 'newest' ? 1 : 0) + filterState.tags.length + (filterState.readLater ? 1 : 0);
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

  const activeFiltersCount = (filterState.sort !== 'newest' ? 1 : 0) + filterState.tags.length + (filterState.readLater ? 1 : 0);

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

  console.log(`📝 Rendered ${filteredNotes.length} notes`);
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

  // [NOT-21] Make source link (favicon + site name) clickable and prevent card expansion
  const noteSourceLink = card.querySelector('.note-source-link');

  // [NOT-21] Validate URL protocol to prevent javascript: XSS attacks
  try {
    const url = new URL(note.url.trim(), window.location.origin);
    const protocol = url.protocol.toLowerCase();

    if (protocol === 'http:' || protocol === 'https:') {
      noteSourceLink.href = note.url.trim();
    } else {
      console.warn('⚠️  Blocked dangerous protocol:', protocol, 'for URL:', note.url);
      // Set to empty to prevent navigation
      noteSourceLink.href = '#';
      noteSourceLink.style.cursor = 'not-allowed';
    }
  } catch (e) {
    console.warn('⚠️  Invalid URL:', note.url);
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
      console.warn('⚠️  Blocked dangerous protocol in expanded view:', protocol, 'for URL:', note.url);
      noteLinkEl.href = '#';
      noteLinkEl.style.cursor = 'not-allowed';
    }
  } catch (e) {
    console.warn('⚠️  Invalid URL in expanded view:', note.url);
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

  console.log('🗑️  Deleting note:', noteId);

  // Store original state for rollback
  const originalNotes = [...allNotes];

  // Disable button to prevent rapid clicks
  if (button) {
    button.disabled = true;
    button.style.opacity = '0.5';
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

    console.log('✅ Note deleted');

    // Re-render
    filterAndRenderNotes();
    populateFilterDropdown();

  } catch (error) {
    console.error('❌ Error deleting note:', error);

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
      button.style.opacity = '';
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
  console.log('🕐 Toggling read later for note:', noteId);

  // Find the note in local array
  const note = allNotes.find(n => n.id === noteId);
  if (!note) {
    console.error('❌ Note not found:', noteId);
    return;
  }

  // Store original state for rollback
  const originalState = note.readLater;

  // Disable button to prevent rapid clicks
  if (button) {
    button.disabled = true;
    button.style.opacity = '0.5';
  }

  try {
    // Optimistically update local state
    note.readLater = !note.readLater;

    // Update in IndexedDB
    await window.database.updateNote(noteId, { readLater: note.readLater });

    console.log(`✅ Read later toggled: ${note.readLater}`);

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
    console.error('❌ Error toggling read later:', error);

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
      button.style.opacity = '';
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
    console.error('❌ Note not found:', noteId);
    return;
  }

  console.log('✏️  Entering edit mode for note:', noteId);

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

  // Action buttons
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'edit-actions';

  const saveButton = document.createElement('button');
  saveButton.className = 'edit-save-button';
  saveButton.textContent = 'Save';
  saveButton.addEventListener('click', (e) => {
    e.stopPropagation();
    // [NOT-22] Get tags from TagInput component
    const tags = cardElement._editTagInput ? cardElement._editTagInput.getTags() : [];
    handleSaveEdit(noteId, cardElement, noteTextarea.value, tags);
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
  editForm.appendChild(actionsDiv);

  // [NOT-19] Prevent edit form clicks from triggering card expand/collapse
  editForm.addEventListener('click', (e) => e.stopPropagation());

  // Insert form after tags
  if (tagsEl) {
    tagsEl.insertAdjacentElement('afterend', editForm);
  } else if (userNoteEl) {
    userNoteEl.insertAdjacentElement('afterend', editForm);
  }

  // Hide original elements
  if (userNoteEl) userNoteEl.style.display = 'none';
  if (tagsEl) tagsEl.style.display = 'none';

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
async function handleSaveEdit(noteId, cardElement, newUserNote, newTags) {
  const note = allNotes.find(n => n.id === noteId);
  if (!note) {
    console.error('❌ Note not found:', noteId);
    return;
  }

  console.log('💾 Saving edits for note:', noteId);

  // Store original state for rollback
  const originalUserNote = note.userNote;
  const originalTags = [...note.tags];

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

    // Update in IndexedDB
    await window.database.updateNote(noteId, {
      userNote: note.userNote,
      tags: note.tags
    });

    console.log('✅ Note updated successfully');

    // Exit edit mode
    handleCancelEdit(noteId, cardElement);

    // [NOT-19] Re-render to ensure note is filtered correctly if search/filters active
    filterAndRenderNotes();

    // If tags changed, update the filter dropdown
    if (JSON.stringify(originalTags) !== JSON.stringify(newTags)) {
      populateFilterDropdown();
    }

  } catch (error) {
    console.error('❌ Error saving note edits:', error);

    // Rollback local state on error
    note.userNote = originalUserNote;
    note.tags = originalTags;

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
  console.log('↩️  Canceling edit mode for note:', noteId);

  const note = allNotes.find(n => n.id === noteId);
  if (!note) {
    console.error('❌ Note not found:', noteId);
    return;
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
