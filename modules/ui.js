import { getState, setState } from './state.js';


/**
 * [NOT-39] Show a temporary tooltip notification
 * @param {HTMLElement} anchorElement - Element to position tooltip near
 * @param {string} message - Message to display
 */
export function showTooltip(anchorElement, message) {
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

/**
 * [NOT-22] [NOT-84] TagInput Component - Compact popover-based tag input
 * Creates a compact tag display with popover for tag management
 */
export class TagInput {
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
        const allNotes = getState().allNotes; // Use getState() to access global notes
        if (allNotes) {
            allNotes.forEach(note => {
                if (note.tags) {
                    note.tags.forEach(tag => {
                        const cleanTag = tag.startsWith('#') ? tag.substring(1) : tag;
                        uniqueTags.add(cleanTag);
                    });
                }
            });
        }
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
        const sortedNotes = [...getState().allNotes].sort((a, b) => b.timestamp - a.timestamp);

        // Collect tags in order of appearance (most recent first)
        const tagSet = new Set();
        for (const note of sortedNotes) {
            if (note.tags) {
                for (const tag of note.tags) {
                    const cleanTag = tag.startsWith('#') ? tag.substring(1) : tag;
                    tagSet.add(cleanTag);
                    if (tagSet.size >= limit) {
                        break;
                    }
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
