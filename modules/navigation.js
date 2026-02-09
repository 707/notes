import { getState, setState } from './state.js';
import { db } from './database.js';

/**
 * Navigation Module
 * Handles view navigation, context bars, filters, and contextual recall
 */

// Module will need access to these functions from panel.js:
// - saveFilterState() - for persisting filter changes
// - filterAndRenderNotes() / renderNotesList() - for re-rendering after filter changes
// These will be passed as callbacks or imported later

let saveFilterStateCallback = null;
let renderNotesCallback = null;

/**
 * Initialize navigation module with callbacks
 * @param {Function} saveFilterStateFn - Callback to save filter state
 * @param {Function} renderNotesFn - Callback to render notes list
 */
export function initNavigation(saveFilterStateFn, renderNotesFn) {
    saveFilterStateCallback = saveFilterStateFn;
    renderNotesCallback = renderNotesFn;
}



/**
 * [NOT-68] Render Stack Context Bar - Unified context UI for Library and Chat
 * [NOT-73] Restructured with pinned controls and scrollable tags
 * Displays active context as chips: "This Page", active tags, starred/read later, and suggestions
 * @param {string} containerId - The container element ID ('library-stack-context' or 'chat-stack-context')
 * @returns {void}
 */
export async function renderStackContextBar(containerId) {
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
        console.warn('[NOT-68] Could not get current URL:', error);
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
        const isActive = getState().filterState.contextFilter &&
            (getState().filterState.contextFilter === currentUrl ||
                (currentUrl.includes('://') && new URL(currentUrl).hostname === getState().filterState.contextFilter));

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
    if (getState().filterState.tags && getState().filterState.tags.length > 0) {
        getState().filterState.tags.forEach(tag => {
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
    if (getState().filterState.starred) {
        const starredChip = document.createElement('button');
        starredChip.className = 'stack-chip stack-chip-tag';
        starredChip.setAttribute('data-type', 'starred');
        starredChip.setAttribute('title', 'Remove starred filter');

        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('class', 'icon icon-sm');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#icon-star');
        icon.appendChild(use);

        const text = document.createElement('span');
        text.textContent = 'Starred';

        starredChip.appendChild(icon);
        starredChip.appendChild(text);
        scrollContainer.appendChild(starredChip);
    }

    // [NOT-73] 5. Render Read Later chip if active (SCROLLABLE)
    if (getState().filterState.readLater) {
        const readLaterChip = document.createElement('button');
        readLaterChip.className = 'stack-chip stack-chip-tag';
        readLaterChip.setAttribute('data-type', 'readLater');
        readLaterChip.setAttribute('title', 'Remove read later filter');

        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('class', 'icon icon-sm');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#icon-clock');
        icon.appendChild(use);

        const text = document.createElement('span');
        text.textContent = 'Read Later';

        readLaterChip.appendChild(icon);
        readLaterChip.appendChild(text);
        scrollContainer.appendChild(readLaterChip);
    }

    // [NOT-73] 6. Render Ghost chips (SCROLLABLE - Context-aware suggested tags)
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
export async function updateContextBars() {
    await renderStackContextBar('library-stack-context');
    await renderStackContextBar('chat-stack-context');
}

/**
 * [NOT-69] Get notes filtered by URL
 * @param {string} url - The URL to filter by
 * @returns {Array} Array of notes matching the URL
 */
export function getNotesForUrl(url) {
    if (!url) return [];
    return getState().allNotes.filter(note => note.url === url);
}

/**
 * [NOT-69] [NOT-77] Get context-aware tags for ghost chips
 * Priority 1: Tags from notes on the current page
 * Priority 2: Semantically related tags from vector search
 * Priority 3: Global popular tags as fallback
 * @param {string} url - The current page URL
 * @returns {Promise<string[]>} Array of suggested tags (max 3)
 */
export async function getContextAwareTags(url) {
    const activeTags = new Set(getState().filterState.tags || []);
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
                    console.warn('[NOT-77] Could not get page text for semantic search:', err);
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
            }
        } catch (err) {
            console.warn('[NOT-77] Error fetching semantic tags (non-fatal):', err);
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
export async function getAllTags() {
    const tagCounts = {};

    getState().allNotes.forEach(note => {
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
export function toggleStackMenu() {
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
export async function renderStackMenu() {
    const tagsList = document.getElementById('stack-menu-tags-list');
    if (!tagsList) return;

    // Clear existing tags
    tagsList.innerHTML = '';

    // Get all tags
    const allTags = await getAllTags();
    const activeTags = new Set(getState().filterState.tags || []);

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
        starredItem.classList.toggle('active', getState().filterState.starred === true);
    }
    if (readLaterItem) {
        readLaterItem.classList.toggle('active', getState().filterState.readLater === true);
    }
}

/**
 * [NOT-68] [NOT-78] Get filtered notes based on Stack context (excluding search filter)
 * Shared helper to avoid logic duplication between Library and Chat
 * Fallback: If "This Page" filter is active but has 0 notes, shows all notes instead of empty state
 * @returns {Array} Filtered notes array
 */
export function getStackFilteredNotes() {
    let filtered = [...getState().allNotes];

    // [NOT-92] Apply context filter (page URL filter) with fallback
    if (getState().filterState.contextFilter) {
        const notesOnPage = getState().allNotes.filter(note => {
            if (!note.url) return false;

            // Exact URL match (if filter contains protocol)
            if (getState().filterState.contextFilter.startsWith('http')) {
                return note.url === getState().filterState.contextFilter;
            }

            // Domain match (extract hostname from note URL)
            try {
                const noteUrl = new URL(note.url);
                return noteUrl.hostname === getState().filterState.contextFilter;
            } catch (e) {
                return false;
            }
        });

        // [NOT-92] Fallback: If no notes on this page, show all notes instead of empty state
        if (notesOnPage.length === 0) {
            filtered = [...getState().allNotes]; // Use all notes as base set
        } else {
            filtered = notesOnPage; // Use page-specific notes as base set
        }
    }

    // Apply tag filters (case-insensitive, normalize # prefix)
    if (getState().filterState.tags.length > 0) {
        filtered = filtered.filter(note =>
            getState().filterState.tags.some(filterTag => {
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
    if (getState().filterState.readLater) {
        filtered = filtered.filter(note => note.readLater === true);
    }

    // Apply Starred filter
    if (getState().filterState.starred) {
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
export async function getPageTextContent(tabId) {
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
        console.warn('[NOT-68] Failed to get page text content:', error);
        return null;
    }
}

/**
 * [NOT-60] Clear stack context - removes all active filters
 * @returns {void}
 */
export function clearStackContext() {
    // Clear all filters
    getState().filterState.contextFilter = null;
    getState().filterState.tags = [];
    getState().filterState.readLater = false;
    getState().filterState.starred = false;
    getState().filterState.search = '';

    // Clear search input
    const filterInput = document.getElementById('filter-input');
    if (filterInput) filterInput.value = '';

    // Save and re-render
    if (saveFilterStateCallback) saveFilterStateCallback();
    if (renderNotesCallback) renderNotesCallback();
    updateContextBars();
}

/**
 * [NOT-68] Toggle "This Page" context filter
 * Sets filterState.contextFilter to current URL or null
 * @returns {Promise<void>}
 */
export async function togglePageContext() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.url) return;

        const currentUrl = tab.url;

        // Toggle: if already active, deactivate
        const isCurrentlyActive = getState().filterState.contextFilter &&
            (getState().filterState.contextFilter === currentUrl ||
                (currentUrl.includes('://') && new URL(currentUrl).hostname === getState().filterState.contextFilter));

        if (isCurrentlyActive) {
            // Deactivate
            getState().filterState.contextFilter = null;
        } else {
            // Activate - use full URL for exact matching
            getState().filterState.contextFilter = currentUrl;
        }

        // Save and re-render
        if (saveFilterStateCallback) await saveFilterStateCallback();
        if (renderNotesCallback) renderNotesCallback();
        await updateContextBars();
    } catch (error) {
        console.error('[NOT-68] Error toggling page context:', error);
    }
}

/**
 * [NOT-68] Toggle tag filter
 * Adds or removes a tag from filterState.tags
 * @param {string} tag - The tag to toggle
 * @returns {void}
 */
export function toggleTagFilter(tag) {
    if (!tag) return;

    const index = getState().filterState.tags.indexOf(tag);
    if (index > -1) {
        // Remove tag
        getState().filterState.tags.splice(index, 1);
    } else {
        // Add tag
        getState().filterState.tags.push(tag);
    }

    // Save and re-render
    if (saveFilterStateCallback) saveFilterStateCallback();
    if (renderNotesCallback) renderNotesCallback();
}

/**
 * [NOT-68] Toggle system filter (Starred or Read Later)
 * @param {string} type - The filter type ('starred' or 'readLater')
 * @returns {void}
 */
export function toggleSystemFilter(type) {
    if (type === 'starred') {
        getState().filterState.starred = !getState().filterState.starred;
    } else if (type === 'readLater') {
        getState().filterState.readLater = !getState().filterState.readLater;
    }

    // Save and re-render
    if (saveFilterStateCallback) saveFilterStateCallback();
    if (renderNotesCallback) renderNotesCallback();
}

/**
 * [NOT-34] Navigate to a specific view and update header button states
 * [NOT-75] Added smooth fade transition between views
 * @param {string} viewId - The view to navigate to (library-mode, ai-chat-mode, settings-mode, capture-mode)
 */
export async function navigateToView(viewId) {
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
            console.warn('⚠️  [NOT-58] Vector search failed or returned no results');
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
        console.error('❌ [NOT-58] Error fetching local tag suggestions:', err);
        return [];
    }
}
