// Klue - Capture Module
// Handles note creation, image uploads, and web capture functionality

import { getState, setState, setMode } from './state.js';
import { addNote } from './database.js';

// Debug logging (will be passed from panel.js)
let log, warn, error;

// UI function references (will be passed from panel.js)
let renderEditModeImageGallery;
let renderImagePreviews;
let openLightbox;
let navigateToLibrary;
let getCaptureTagInput; // Function that returns current captureTagInput instance

/**
 * Initialize capture module with dependencies
 * @param {Object} deps - Dependencies object
 */
export function initCapture(deps) {
    log = deps.log;
    warn = deps.warn;
    error = deps.error;
    renderEditModeImageGallery = deps.renderEditModeImageGallery;
    renderImagePreviews = deps.renderImagePreviews;
    openLightbox = deps.openLightbox;
    navigateToLibrary = deps.navigateToLibrary;
    getCaptureTagInput = deps.getCaptureTagInput;
}

/**
 * [NOT-33] Handle file upload for multi-image support
 * Reads files via FileReader, enforces 5-image limit, and adds to current images array
 *
 * @param {FileList} files - The files selected by the user
 * @param {boolean} isEditMode - Whether we're in edit mode (use editModeImages instead of currentImages)
 */
export function handleFileUpload(files, isEditMode = false) {
    const imagesArray = isEditMode ? getState().editModeImages : getState().currentImages;
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
                    renderEditModeImageGallery(cardElement, getState().editModeImages);
                }
            } else {
                renderImagePreviews('capture-image-preview-list', getState().currentImages, false);
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
export function handleWebCaptureStorageChange(changes, area) {
    if (area !== 'local' || !changes.pendingClipData || !changes.pendingClipData.newValue) {
        return;
    }

    const newClipData = changes.pendingClipData.newValue;

    // Only handle if we're in web capture listening mode and it's an image
    if (getState().isWebCaptureListening && newClipData.type === 'image' && newClipData.imageData) {
        log(`🖼️  [NOT-36] Web capture image received, appending to ${getState().isEditModeActive ? 'edit mode' : 'capture mode'} note...`);

        // Add the captured image to the correct array based on mode
        const imageObject = {
            id: crypto.randomUUID(),
            data: newClipData.imageData,
            timestamp: Date.now()
        };

        if (getState().isEditModeActive) {
            // Edit mode - append to editModeImages
            getState().editModeImages.push(imageObject);

            // Enforce 5-image limit
            if (getState().editModeImages.length >= 5) {
                log('⚠️  [NOT-36] Reached 5-image limit, deactivating listening mode');
                setState({ isWebCaptureListening: false });

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
                renderEditModeImageGallery(cardElement, getState().editModeImages);
            }
        } else {
            // Capture mode - append to currentImages
            getState().currentImages.push(imageObject);

            // Enforce 5-image limit
            if (getState().currentImages.length >= 5) {
                log('⚠️  [NOT-36] Reached 5-image limit, deactivating listening mode');
                setState({ isWebCaptureListening: false });

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
            renderImagePreviews('capture-image-preview-list', getState().currentImages, false);
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
export function activateWebCaptureMode(buttonId = 'capture-webpage-image-button') {
    log('👂 [NOT-33] Activating web capture listening mode...');

    const captureButton = document.getElementById(buttonId);

    if (!captureButton) {
        warn('⚠️  [NOT-33] Capture button not found:', buttonId);
        return;
    }

    // [NOT-33] Check 5-image limit before activating (use correct array based on mode)
    const imagesArray = getState().isEditModeActive ? getState().editModeImages : getState().currentImages;

    if (!getState().isWebCaptureListening && imagesArray.length >= 5) {
        alert('Maximum of 5 images per note. Please remove some images before capturing more.');
        return;
    }

    // Toggle listening state
    setState({ isWebCaptureListening: !getState().isWebCaptureListening });

    if (getState().isWebCaptureListening) {
        // [NOT-36] Add dedicated storage listener when activating
        chrome.storage.onChanged.addListener(handleWebCaptureStorageChange);

        // Update button to show "Listening..." state
        captureButton.classList.add('active');
        const buttonSpan = captureButton.querySelector('span');
        if (buttonSpan) {
            buttonSpan.textContent = 'Right-click any image on page to capture';
        }
        captureButton.setAttribute('title', 'Cancel listening mode');
        log(`✅ [NOT-36] Listening for webpage image capture (${getState().isEditModeActive ? 'Edit' : 'Capture'} mode)...`);
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
 * [NOT-58] Fetch local tag suggestions using vector search
 * Searches for semantically related notes and extracts unique tags
 *
 * @param {Object} clipData - The current clip data with metadata
 * @returns {Promise<Array<string>>} - Array of suggested tag names (without # prefix)
 */
export async function fetchLocalTagSuggestions(clipData) {
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
export async function handleSaveClip(clipData = {}) {
    log('💾 Saving clip...');

    const saveButton = document.getElementById('save-button');
    const notesInput = document.getElementById('capture-notes');

    // Disable button to prevent double-click
    saveButton.disabled = true;

    try {
        // Get user input
        const userNote = notesInput.value.trim();
        // [NOT-22] Get tags from TagInput component
        const captureTagInput = getCaptureTagInput ? getCaptureTagInput() : null;
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
                siteName: 'Klue',
                favicon: 'icons/icon32.png'
            },
            // [NOT-59] Extract flexible_metadata from clipData.metadata if present
            flexible_metadata: (clipData.metadata && clipData.metadata.flexible_metadata) || {},
            timestamp: Date.now(),
            readLater: false, // [NOT-18] Initialize Read Later flag
            starred: false, // [NOT-35] Initialize starred flag for consistency
            images: getState().currentImages // [NOT-33] Store images array (replaces legacy imageData)
        };

        // Save note to IndexedDB
        await addNote(note);

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
