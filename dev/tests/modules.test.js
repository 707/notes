// Test suite for all modules
import { sanitizeHtml, formatDate, enhanceRichMedia } from '../../modules/utils.js';
import { db, addNote, getAllNotes, deleteNote, searchNotes } from '../../modules/database.js';
import { getState, setState, setMode, setNotes, resetCaptureState, resetEditMode } from '../../modules/state.js';
import { TagInput, showPillWithAnimation, showTooltip } from '../../modules/ui.js';

console.log('Test suite loaded');

// Wait for window.testSuite to be available
const runTests = async () => {
    await window.testSuite('Environment Check', () => {
        window.assert(true, 'Test runner is working');
    });

    // ========== STATE MODULE TESTS ==========
    await window.testSuite('State Module - Initial State', () => {
        const state = getState();
        window.assert(state.currentMode === null, 'currentMode should be null');
        window.assert(Array.isArray(state.allNotes), 'allNotes is an array');
        window.assert(Array.isArray(state.currentImages), 'currentImages is an array');
        window.assert(typeof state.filterState === 'object', 'filterState exists');
    });

    await window.testSuite('State Module - setState', () => {
        setState({ testValue: 'hello' });
        window.assert(getState().testValue === 'hello', 'Sets state value');

        setState({ testValue: 'world' });
        window.assert(getState().testValue === 'world', 'Updates state value');
    });

    await window.testSuite('State Module - setNotes', () => {
        const testNotes = [{ id: '1', text: 'Test' }];
        setNotes(testNotes);
        window.assert(getState().allNotes.length === 1, 'Sets notes array');
        window.assert(getState().allNotes[0].id === '1', 'Note data is correct');
    });

    await window.testSuite('State Module - setMode', () => {
        const initialMode = getState().currentMode;

        setMode('ai-chat');
        window.assert(getState().currentMode === 'ai-chat', 'Sets mode to ai-chat');

        setMode('settings');
        window.assert(getState().currentMode === 'settings', 'Sets mode to settings');

        // Restore initial mode (if it was set)
        if (initialMode !== null) {
            setMode(initialMode);
        }
    });

    await window.testSuite('State Module - resetEditMode', () => {
        setState({
            isEditModeActive: true,
            editModeNoteId: 'test-123',
            editModeImages: [{ id: '1' }]
        });

        resetEditMode();

        window.assert(getState().isEditModeActive === false, 'Resets isEditModeActive');
        window.assert(getState().editModeNoteId === null, 'Resets editModeNoteId');
        window.assert(getState().editModeImages.length === 0, 'Clears editModeImages');
    });

    await window.testSuite('State Module - resetCaptureState', () => {
        setState({
            currentImages: [{ id: '1' }],
            isWebCaptureListening: true
        });

        resetCaptureState();

        window.assert(getState().currentImages.length === 0, 'Clears currentImages');
        window.assert(getState().isWebCaptureListening === false, 'Resets web capture listening');
    });

    // ========== UTILS MODULE TESTS ==========
    await window.testSuite('Utils Module - sanitizeHtml', () => {
        window.assert(sanitizeHtml('<b>Safe</b>') === '<b>Safe</b>', 'Keeps safe tags');
        window.assert(sanitizeHtml('<script>alert(1)</script>') === '', 'Removes script tags');
        window.assert(sanitizeHtml('<span onclick="alert(1)">Click</span>') === '<span>Click</span>', 'Removes unsafe attributes');
        window.assert(sanitizeHtml('<div>Content</div>') === 'Content', 'Strips disallowed tags but keeps content');

        const link = sanitizeHtml('<a href="javascript:alert(1)">Link</a>');
        window.assert(!link.includes('href'), 'Removes javascript: links');

        const validLink = sanitizeHtml('<a href="https://google.com">Google</a>');
        window.assert(validLink.includes('target="_blank"'), 'Adds target="_blank" to links');
    });

    await window.testSuite('Utils Module - formatDate', () => {
        const now = Date.now();
        window.assert(formatDate(now) === 'Just now', 'Formats "Just now"');
        window.assert(formatDate(now - 1000 * 60 * 5) === '5m ago', 'Formats minutes ago');
        window.assert(formatDate(now - 1000 * 60 * 60 * 2) === '2h ago', 'Formats hours ago');
    });

    await window.testSuite('Utils Module - enhanceRichMedia', () => {
        const html = 'Check out https://youtube.com/watch?v=123';
        const enhanced = enhanceRichMedia(html);
        window.assert(enhanced.includes('smart-chip-youtube'), 'Detects YouTube links');
        window.assert(enhanced.includes('(YouTube Link)'), 'Sets pill text for YouTube');
    });

    // ========== DATABASE MODULE TESTS ==========
    await window.testSuite('Database Module', async () => {
        // Clear DB first to ensure clean state
        await db.notes.clear();

        const noteId = await addNote({
            id: 'test-note-1',
            text: 'Hello World',
            tags: ['test'],
            timestamp: Date.now()
        });
        window.assert(noteId === 'test-note-1', 'Adds a note');

        const notes = await getAllNotes();
        window.assert(notes.length === 1, 'Retrieves all notes');
        window.assert(notes[0].text === 'Hello World', 'Note content matches');

        const searchResults = await searchNotes('Hello');
        window.assert(searchResults.length === 1, 'Search finds note');

        await deleteNote('test-note-1');
        const notesAfterDelete = await getAllNotes();
        window.assert(notesAfterDelete.length === 0, 'Deletes a note');
    });

    // ========== UI MODULE TESTS ==========


    await window.testSuite('UI Module - Tooltip', () => {
        const button = document.createElement('button');
        button.textContent = 'Test Button';
        document.body.appendChild(button);

        showTooltip(button, 'Test Tooltip');

        // The tooltip has class 'feedback-tooltip', not 'tooltip'
        const tooltip = document.querySelector('.feedback-tooltip');
        window.assert(tooltip !== null, 'Creates tooltip element');
        if (tooltip) {
            window.assert(tooltip.textContent === 'Test Tooltip', 'Sets tooltip text');
        }

        // Cleanup
        if (button.parentNode) {
            document.body.removeChild(button);
        }
        const remainingTooltip = document.querySelector('.feedback-tooltip');
        if (remainingTooltip && remainingTooltip.parentNode) {
            document.body.removeChild(remainingTooltip);
        }
    });

    await window.testSuite('UI Module - TagInput', () => {
        const container = document.createElement('div');
        container.id = 'test-tag-input';
        document.body.appendChild(container);

        const tagInput = new TagInput(container);
        window.assert(tagInput !== null, 'Creates TagInput instance');

        // Test initialization
        const input = container.querySelector('input');
        window.assert(input !== null, 'Renders input element');

        // Test adding tags - use setTimeout to allow for async rendering
        tagInput.addTag('javascript');
        const tags = tagInput.getTags();
        window.assert(tags && tags.includes('javascript'), 'Adds tag');
        window.assert(tags && tags.length === 1, 'Tag count is correct');

        // Test removing tags
        tagInput.removeTag('javascript');
        const tagsAfterRemove = tagInput.getTags();
        window.assert(tagsAfterRemove && tagsAfterRemove.length === 0, 'Removes tag');

        // Cleanup
        if (container.parentNode) {
            document.body.removeChild(container);
        }
    });

    // Note: Navigation, Capture, AI Chat, and Settings modules are integration-tested
    // through the main application. Unit tests would require extensive mocking of
    // Chrome APIs, DOM, and database, which is beyond the scope of this test suite.
};

if (window.testSuite) {
    runTests();
} else {
    window.addEventListener('load', runTests);
}
