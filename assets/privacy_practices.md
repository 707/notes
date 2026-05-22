# Chrome Web Store Privacy Practices & Permissions Justifications

## Single Purpose Description
Gloss is a side-panel note-taking assistant that allows users to capture, organize, and semantically search for text and insights from any webpage they visit, acting as a "second brain" for their browsing experience.

## Permission Justifications

### ActiveTab
**Justification:**
ActiveTab is used to simplify the user experience. It allows the extension to momentarily access the title and URL of the currently active tab when the user explicitly interacts with the extension (e.g., clicking a context menu item or the extension icon). This ensures that notes taken are correctly associated with the source page without requiring broad host permissions for every interaction.

### ContextMenus
**Justification:**
This permission is required to add a "Capture selection to Gloss" item to the browser's right-click context menu. This provides users with a quick and seamless way to save specific text snippets from a webpage directly into their side panel notebook without breaking their workflow.

### Host Permissions (`<all_urls>`)
**Justification:**
Gloss is designed to work as a ubiquitous research companion across the entire web. The extension needs to be able to extract page content (text) to generate vector embeddings for semantic search and to allow users to capture notes from any site they visit. Restricting this to specific domains would fundamentally break the "capture anywhere" core functionality of the product.

### Remote Code
**Answer:** No, I am not using Remote code.
*(Explanation for your reference: All JavaScript and WebAssembly (WASM) modules are bundled locally within the extension package. The WASM files for the vector database are loaded from the local `dist/wasm/` directory and are not fetched from external servers.)*

### Scripting
**Justification:**
Scripting permission is essential for two key functions:
1. **Content Extraction:** To programmatically retrieve the text content of a page to generate embeddings for the "Contextual Recall" feature (showing relevant past notes based on current page content).
2. **Highlighting:** To visually highlight text on the webpage that the user has previously captured, providing a visual connection between their notes and the source material.

### SidePanel
**Justification:**
The Side Panel is the primary user interface of the application. It provides a persistent, non-intrusive workspace where users can view their library, chat with their notes, and manage captured content alongside the web pages they are browsing, facilitating a true split-screen research workflow.

### Storage
**Justification:**
Storage is "critical" to Gloss's privacy-first architecture. All user data—including notes, tags, settings, and the vector database indices—is stored locally on the user's device using `chrome.storage.local` and IndexedDB. This ensures that user data remains private and is not synced to any external cloud servers by default.

## Data Privacy & Safety ("User Data")

### 1. Data Collection Disclosures
Select the following categories:

*   [x] **Website content**
    *   *Justification:* "To allow users to capture text and images from webpages and save them as notes."
*   [x] **Web history**
    *   *Justification:* "To link saved notes to the specific webpage URL where they were captured for citation and context."
*   [x] **Personal communications**
    *   *Justification:* "To store the local history of conversations. Note: Messages are sent to the user's configured AI provider (e.g., OpenRouter) for processing only when the user engages with the chat."

*(Note: "Personally identifiable information", "Health", "Financial", "Authentication", "Location", and "User activity" should generally be left unchecked as Gloss is local-first.)*

### 2. Certifications
You must certify (check) all three statements:
*   [x] **I do not sell or transfer user data to third parties, outside of the approved use cases**
*   [x] **I do not use or transfer user data for purposes that are unrelated to my item's single purpose**
*   [x] **I do not use or transfer user data to determine creditworthiness or for lending purposes**

### 3. Privacy Policy URL
Use the raw GitHub link to the `PRIVACY.md` file (once pushed):
`https://github.com/707/gloss/blob/main/PRIVACY.md`

