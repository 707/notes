// Shared utility functions for Knowledge Clipper
// Used by both background.js and panel.js

/**
 * [NOT-27] Injected function to extract page metadata
 * This runs in the context of the webpage and can be called from
 * background.js or panel.js via chrome.scripting.executeScript
 *
 * @returns {Object} Metadata object with title, author, siteName, and favicon
 */
function extractPageMetadata() {
  // Extract metadata from the page
  const metadata = {
    title: document.title || 'Untitled',
    author: null,
    siteName: null,
    favicon: null
  };

  // Try to get author from meta tags
  const authorMeta = document.querySelector('meta[name="author"]') ||
                     document.querySelector('meta[property="article:author"]');
  if (authorMeta) {
    metadata.author = authorMeta.content;
  }

  // Try to get site name from Open Graph
  const siteNameMeta = document.querySelector('meta[property="og:site_name"]');
  if (siteNameMeta) {
    metadata.siteName = siteNameMeta.content;
  } else {
    // Fallback: use hostname
    metadata.siteName = window.location.hostname.replace('www.', '');
  }

  // Get favicon
  const faviconLink = document.querySelector('link[rel="icon"]') ||
                      document.querySelector('link[rel="shortcut icon"]');
  if (faviconLink) {
    metadata.favicon = new URL(faviconLink.href, window.location.href).href;
  } else {
    // Fallback to Google's favicon service
    const domain = window.location.hostname;
    metadata.favicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  }

  return metadata;
}
