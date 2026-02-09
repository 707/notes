import { TagInput, showTooltip } from '../../modules/ui.js';
import { getState, setState } from '../../modules/state.js';

console.log('UI Tests Loaded');

const runUiTests = async () => {


    // 2. Test showTooltip
    await window.testSuite('UI Module - showTooltip', async () => {
        const anchor = document.createElement('div');
        anchor.style.position = 'absolute';
        anchor.style.top = '100px';
        anchor.style.left = '100px';
        anchor.style.width = '20px';
        anchor.style.height = '20px';
        document.body.appendChild(anchor);

        showTooltip(anchor, 'Test Tooltip');

        const tooltip = document.querySelector('.feedback-tooltip');
        window.assert(!!tooltip, 'showTooltip creates tooltip element');
        if (tooltip) {
            window.assert(tooltip.textContent === 'Test Tooltip', 'showTooltip sets correct text');
            // Cleanup
            tooltip.remove();
        }

        // Cleanup
        anchor.remove();
    });

    // 3. Test TagInput
    await window.testSuite('UI Module - TagInput', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        // Mock global state for tags
        setState({
            allNotes: [
                { tags: ['#tag1', '#tag2'] },
                { tags: ['#tag2', '#tag3'] }
            ]
        });

        let lastTags = [];
        const onChange = (tags) => { lastTags = tags; };

        const tagInput = new TagInput(container, ['tag1'], onChange);

        window.assert(!!container.querySelector('.tag-trigger-container'), 'TagInput renders trigger container');
        window.assert(tagInput.tags.length === 1 && tagInput.tags[0] === 'tag1', 'TagInput initializes with tags');

        // Test adding a tag
        tagInput.addTag('tag2');
        window.assert(tagInput.tags.includes('tag2'), 'TagInput addTag updates internal state');
        window.assert(lastTags.length === 2 && lastTags.includes('#tag2'), 'TagInput calls onChange');

        // Test removing a tag
        tagInput.removeTag(0); // Remove tag1
        window.assert(!tagInput.tags.includes('tag1'), 'TagInput removeTag updates internal state');

        // Cleanup
        container.remove();
    });
};

if (window.testSuite) {
    runUiTests();
} else {
    window.addEventListener('load', runUiTests);
}
