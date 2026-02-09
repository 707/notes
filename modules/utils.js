// [NOT-57] Shared utility functions for Klue
// Used by both background.js and panel.js

/**
 * [NOT-57] Extract page metadata with Strategy Pattern (inline implementation)
 * This runs in the context of the webpage and is injected via chrome.scripting.executeScript
 *
 * Self-contained function with all strategies inline (no external dependencies)
 * to support chrome.scripting.executeScript's func serialization
 *
 * @returns {Object} Metadata object with title, author, siteName, favicon, and flexible_metadata
 */
export function extractPageMetadata() {
    /**
     * Helper: Extract base metadata (shared by all strategies)
     */
    function extractBaseMetadata() {
        const metadata = {
            title: document.title || 'Untitled',
            author: null,
            siteName: null,
            favicon: null,
            flexible_metadata: {} // [NOT-57] Dynamic JSON for domain-specific data
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

    /**
     * [NOT-57] GitHubStrategy - Extract rich metadata from GitHub repositories
     */
    function extractGitHubMetadata() {
        const metadata = extractBaseMetadata();
        metadata.flexible_metadata.type = 'repo';

        try {
            // Extract stars count
            const starsElement = document.querySelector('[href$="/stargazers"] .Counter, a[href*="/stargazers"] strong');
            if (starsElement) {
                const starsText = starsElement.textContent.trim();
                // Parse "1.2k" → 1200, "15" → 15
                const multipliers = { k: 1000, m: 1000000 };
                const match = starsText.toLowerCase().match(/^([\d.]+)([km])?$/);
                if (match) {
                    const num = parseFloat(match[1]);
                    const multiplier = multipliers[match[2]] || 1;
                    metadata.flexible_metadata.stars = Math.round(num * multiplier);
                }
            }

            // Extract primary language
            const languageElement = document.querySelector('[itemprop="programmingLanguage"]');
            if (languageElement) {
                metadata.flexible_metadata.language = languageElement.textContent.trim();
            }

            // Extract description
            const descElement = document.querySelector('[data-pjax="#repo-content-pjax-container"] p, .f4.my-3');
            if (descElement) {
                metadata.flexible_metadata.description = descElement.textContent.trim();
            }

            // Extract repository owner/name
            const pathParts = window.location.pathname.split('/').filter(Boolean);
            if (pathParts.length >= 2) {
                metadata.flexible_metadata.owner = pathParts[0];
                metadata.flexible_metadata.repo = pathParts[1];
            }

            // Extract topics/tags
            const topicElements = document.querySelectorAll('a[data-octo-click="topic_click"]');
            if (topicElements.length > 0) {
                metadata.flexible_metadata.topics = Array.from(topicElements)
                    .map(el => el.textContent.trim())
                    .filter(Boolean);
            }

            console.log('✅ [NOT-57] GitHub metadata extracted:', metadata.flexible_metadata);
        } catch (error) {
            console.warn('⚠️  [NOT-57] Failed to extract GitHub metadata:', error);
        }

        return metadata;
    }

    /**
     * [NOT-57] YouTubeStrategy - Extract rich metadata from YouTube videos
     */
    function extractYouTubeMetadata() {
        const metadata = extractBaseMetadata();
        metadata.flexible_metadata.type = 'video';

        try {
            // Extract video duration from meta tag
            const durationMeta = document.querySelector('meta[itemprop="duration"]');
            if (durationMeta) {
                const duration = durationMeta.content; // Format: "PT10M5S" (ISO 8601)
                // Parse PT10M5S → "10:05"
                const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
                if (match) {
                    const hours = match[1] ? parseInt(match[1]) : 0;
                    const minutes = match[2] ? parseInt(match[2]) : 0;
                    const seconds = match[3] ? parseInt(match[3]) : 0;

                    if (hours > 0) {
                        metadata.flexible_metadata.duration = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
                    } else {
                        metadata.flexible_metadata.duration = `${minutes}:${String(seconds).padStart(2, '0')}`;
                    }
                }
            }

            // Extract channel name
            const channelLink = document.querySelector('ytd-channel-name a, #owner-name a, #channel-name a');
            if (channelLink) {
                metadata.flexible_metadata.channel = channelLink.textContent.trim();
            }

            // Extract view count
            const viewsElement = document.querySelector('.view-count, ytd-video-view-count-renderer');
            if (viewsElement) {
                metadata.flexible_metadata.views = viewsElement.textContent.trim();
            }

            // Extract upload date
            const uploadDateMeta = document.querySelector('meta[itemprop="uploadDate"]');
            if (uploadDateMeta) {
                metadata.flexible_metadata.uploadDate = uploadDateMeta.content;
            }

            // Extract video category
            const categoryMeta = document.querySelector('meta[itemprop="genre"]');
            if (categoryMeta) {
                metadata.flexible_metadata.category = categoryMeta.content;
            }

            console.log('✅ [NOT-57] YouTube metadata extracted:', metadata.flexible_metadata);
        } catch (error) {
            console.warn('⚠️  [NOT-57] Failed to extract YouTube metadata:', error);
        }

        return metadata;
    }

    /**
     * [NOT-57] DefaultStrategy - Standard OpenGraph metadata extraction
     */
    function extractDefaultMetadata() {
        const metadata = extractBaseMetadata();
        metadata.flexible_metadata.type = 'article'; // Default type

        try {
            // Extract article-specific metadata if available
            const articleType = document.querySelector('meta[property="og:type"]');
            if (articleType) {
                metadata.flexible_metadata.type = articleType.content;
            }

            // Extract publish date
            const publishDate = document.querySelector('meta[property="article:published_time"]') ||
                document.querySelector('meta[name="publish_date"]');
            if (publishDate) {
                metadata.flexible_metadata.publishDate = publishDate.content;
            }

            // Extract reading time if available
            const readingTime = document.querySelector('meta[name="twitter:data1"]');
            if (readingTime && readingTime.content.includes('min read')) {
                metadata.flexible_metadata.readingTime = readingTime.content;
            }

            console.log('✅ [NOT-57] Default metadata extracted:', metadata.flexible_metadata);
        } catch (error) {
            console.warn('⚠️  [NOT-57] Failed to extract default metadata:', error);
        }

        return metadata;
    }

    // [NOT-57] Strategy selection: check URL and apply appropriate extractor
    try {
        const hostname = window.location.hostname;
        const pathname = window.location.pathname;

        // GitHub repository
        if (hostname === 'github.com' && pathname.split('/').length >= 3) {
            console.log('🎯 [NOT-57] Using GitHub strategy');
            return extractGitHubMetadata();
        }

        // YouTube video
        if (hostname.includes('youtube.com') && (pathname.includes('/watch') || pathname.includes('/shorts'))) {
            console.log('🎯 [NOT-57] Using YouTube strategy');
            return extractYouTubeMetadata();
        }

        // Default fallback
        console.log('🎯 [NOT-57] Using Default strategy');
        return extractDefaultMetadata();

    } catch (error) {
        console.error('❌ [NOT-57] Metadata extraction failed:', error);
        // Return minimal metadata on error
        return {
            title: document.title || 'Untitled',
            author: null,
            siteName: window.location.hostname.replace('www.', ''),
            favicon: `https://www.google.com/s2/favicons?domain=${window.location.hostname}&sz=32`,
            flexible_metadata: {}
        };
    }
}

/**
 * [NOT-20] Sanitize HTML content using native DOMParser
 * Only allows safe elements: text, links, and basic formatting
 * Strips all scripts, styles, and potentially dangerous content
 *
 * @param {string} htmlString - The raw HTML string to sanitize
 * @returns {string} - Safe HTML string ready for innerHTML
 */
export function sanitizeHtml(htmlString) {
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
                // [FIX] For script and style tags, remove content entirely
                if (nodeName === 'script' || nodeName === 'style') {
                    return null;
                }

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

                        // Allow http, https, relative URLs, and internal extension protocols
                        if (protocol === 'http:' || protocol === 'https:' || protocol === 'chrome-extension:' || protocol === 'data:') {
                            cleanElement.setAttribute('href', href.trim());
                            cleanElement.setAttribute('target', '_blank');
                            cleanElement.setAttribute('rel', 'noopener noreferrer');
                        }
                    } catch (e) {            // Invalid URL or dangerous protocol - skip this link but preserve text
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
export function enhanceRichMedia(htmlString) {
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

/**
 * Format date timestamp to relative or absolute string
 * @param {number} timestamp 
 * @returns {string}
 */
export function formatDate(timestamp) {
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
