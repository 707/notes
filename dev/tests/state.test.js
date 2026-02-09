
// Test suite for State Module
import { getState, setState, setNotes, setMode, resetEditMode, resetCaptureState } from '../../modules/state.js';

console.log('State Test Suite Loaded');

const runStateTests = async () => {
    await window.testSuite('State Module - Initial State', () => {
        const state = getState();
        window.assert(Array.isArray(state.allNotes), 'allNotes should be an array');
        window.assert(state.isEditModeActive === false, 'isEditModeActive should be false');
        window.assert(state.isWebCaptureListening === false, 'isWebCaptureListening should be false');
        window.assert(state.currentMode === null, 'currentMode should be null');
        window.assert(state.isExpandedAll === false, 'isExpandedAll should be false');
    });

    await window.testSuite('State Module - setState', () => {
        setState({ currentMode: 'library' });
        window.assert(getState().currentMode === 'library', 'setState updates currentMode');

        setState({ isEditModeActive: true, editModeNoteId: '123' });
        const state = getState();
        window.assert(state.isEditModeActive === true, 'setState updates multiple properties (isEditModeActive)');
        window.assert(state.editModeNoteId === '123', 'setState updates multiple properties (editModeNoteId)');
    });

    await window.testSuite('State Module - setNotes', () => {
        const notes = [{ id: '1', text: 'test' }];
        setNotes(notes);
        window.assert(getState().allNotes.length === 1, 'setNotes updates allNotes');
        window.assert(getState().allNotes[0].id === '1', 'setNotes content is correct');
    });

    await window.testSuite('State Module - setMode', () => {
        setState({ currentMode: 'library' });
        setMode('edit');
        const state = getState();
        window.assert(state.currentMode === 'edit', 'setMode updates currentMode');
        window.assert(state.previousMode === 'library', 'setMode sets previousMode');
    });

    await window.testSuite('State Module - resetEditMode', () => {
        setState({ isEditModeActive: true, editModeNoteId: '123', editModeImages: ['img1'] });
        resetEditMode();
        const state = getState();
        window.assert(state.isEditModeActive === false, 'resetEditMode resets isEditModeActive');
        window.assert(state.editModeNoteId === null, 'resetEditMode resets editModeNoteId');
        window.assert(state.editModeImages.length === 0, 'resetEditMode resets editModeImages');
    });

    await window.testSuite('State Module - resetCaptureState', () => {
        setState({ isWebCaptureListening: true, currentImages: ['img1'] });
        resetCaptureState();
        const state = getState();
        window.assert(state.isWebCaptureListening === false, 'resetCaptureState resets isWebCaptureListening');
        window.assert(state.currentImages.length === 0, 'resetCaptureState resets currentImages');
    });
};

if (window.testSuite) {
    runStateTests();
} else {
    window.addEventListener('load', runStateTests);
}
