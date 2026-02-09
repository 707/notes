// State Module - Global application state
// Replaces global variables in panel.js

// Using a reactive store pattern (simplified for vanilla JS)
const state = {
    // Navigation
    currentMode: null, // 'library', 'edit', 'settings'
    previousMode: null, // For back navigation

    // Data
    allNotes: [],
    filteredNotes: [],

    // Edit Mode State
    isEditModeActive: false,
    editModeNoteId: null,
    editModeImages: [],

    // Web Capture State
    isWebCaptureListening: false,
    currentImages: [],

    // Filter & View State
    filterState: {
        search: '',
        sort: 'newest',
        tags: [],
        readLater: false,
        starred: false,
        favorites: false,
        contextFilter: null
    },

    // Contextual Recall State
    semanticMatches: [],
    contextMatchType: null,
    contextPillAnimated: false,

    // UI State
    lightboxIndex: 0,
    lightboxImages: [],

    // AI Chat State
    currentChatId: null,
    chatHistory: [],
    isTyping: false,
    isExpandedAll: false
};

// Getters
export const getState = () => state;

// Setters (Direct mutation for simplicity in this refactor, 
// could be enhanced with listeners later)
export const setState = (updates) => {
    Object.assign(state, updates);
};

// Specialized helpers for common operations
export const setNotes = (notes) => {
    state.allNotes = notes;
    // We don't automatically update filteredNotes here to avoid circular dependency with filtering logic
    // The caller should re-apply filters
};

export const setFilteredNotes = (notes) => {
    state.filteredNotes = notes;
};

export const setMode = (mode) => {
    state.previousMode = state.currentMode;
    state.currentMode = mode;
};

export const resetEditMode = () => {
    state.isEditModeActive = false;
    state.editModeNoteId = null;
    state.editModeImages = [];
};

export const resetCaptureState = () => {
    state.isWebCaptureListening = false;
    state.currentImages = [];
};
