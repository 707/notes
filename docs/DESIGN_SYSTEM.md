# Klue Design System
## Inspired by Linear.app

### Overview
This document outlines the design system for the Klue Chrome extension, inspired by the clean, structured aesthetic of Linear.app.

## Color Palette

### Primary Brand Colors
- **Primary**: `#5E6AD2` - Main brand color (purple/violet)
- **Primary Hover**: `#4E5BCC` - Interactive states
- **Primary Active**: `#3E4BC2` - Pressed states
- **Primary Light**: `#E5E7FF` - Subtle backgrounds
- **Primary Subtle**: `#F5F6FF` - Very light accents

### Surfaces & Backgrounds
- **Surface**: `#FFFFFF` - Main background
- **Surface Secondary**: `#F7F8F9` - Secondary backgrounds
- **Surface Hover**: `#F0F1F3` - Hover states
- **Surface Accent**: `#FAFBFC` - Accent backgrounds
- **Surface Elevated**: `#FFFFFF` - Cards, modals

### Text Hierarchy
- **Text Primary**: `#16171A` - Main text
- **Text Secondary**: `#68707C` - Secondary text
- **Text Tertiary**: `#9BA1A8` - Tertiary text
- **Text Disabled**: `#C1C6CC` - Disabled states
- **Text Inverse**: `#FFFFFF` - Text on dark backgrounds

### Borders & Dividers
- **Border**: `#E6E8EB` - Default borders
- **Border Medium**: `#D3D6DB` - Medium emphasis
- **Border Strong**: `#B4B9C2` - Strong emphasis

### Semantic Colors
- **Success**: `#00BC6F` with background `#E6FAF3`
- **Warning**: `#FFAB00` with background `#FFF5E6`
- **Error**: `#FF5247` with background `#FFE8E6`
- **Info**: `#5E6AD2` with background `#E5E7FF`

### Platform Colors (Smart Chips)
- **YouTube**: `#FF0000` with background `#FFF5F5` and border `#FFE0E0`
- **Twitter/X**: `#1DA1F2` with background `#F5F8FF` and border `#E0EEFF`

### Opacity
- **Disabled**: `0.5` (`--opacity-disabled`) - Used for disabled buttons and inputs

## Typography

### Font Family
```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
```

### Font Sizes
- **XS**: 11px - Small labels
- **SM**: 12px - Secondary text
- **Base**: 13px - Body text
- **MD**: 14px - Emphasized body text
- **LG**: 15px - Subheadings
- **XL**: 18px - Headings
- **2XL**: 20px - Large headings

### Line Heights
- **Tight**: 1.25 - Headings
- **Base**: 1.5 - Body text
- **Relaxed**: 1.75 - Long-form content

## Spacing Scale
- **XS**: 4px
- **SM**: 8px
- **MD**: 12px
- **LG**: 16px
- **XL**: 24px
- **2XL**: 32px

## Border Radius
- **SM**: 4px - Small elements
- **MD**: 6px - Medium elements
- **LG**: 8px - Large elements
- **XL**: 12px - Extra large elements
- **Full**: 9999px - Fully rounded

## Shadows
- **SM**: `0 1px 2px 0 rgba(22, 23, 26, 0.05)`
- **MD**: `0 4px 6px -1px rgba(22, 23, 26, 0.08), 0 2px 4px -2px rgba(22, 23, 26, 0.05)`
- **LG**: `0 10px 15px -3px rgba(22, 23, 26, 0.08), 0 4px 6px -4px rgba(22, 23, 26, 0.05)`
- **XL**: `0 20px 25px -5px rgba(22, 23, 26, 0.08), 0 8px 10px -6px rgba(22, 23, 26, 0.05)`

## Motion System (Unified)

### Core Tokens
- **Ease Spring**: `cubic-bezier(0.2, 0, 0, 1)` - Use for almost everything (Apple/Linear feel).
- **Ease Expo**: `cubic-bezier(0.16, 1, 0.3, 1)` - Use for complex layouts.

### Durations
- **Micro**: `100ms` - Clicks, hover states, micro-interactions.
- **Base**: `200ms` - Entrance animations, dropdowns, tooltips.
- **Slow**: `300ms` - Large layout shifts, full page transitions.

### Standard Keyframes
- `enter-scale`: Opacity 0->1, Scale 0.95->1.
- `enter-slide`: Opacity 0->1, TranslateY -8px->0.
- `exit-scale`: Opacity 1->0, Scale 1->0.95.

### Interaction Patterns
- **Active State:** All clickable elements (buttons, cards) must have `transform: scale(0.95)` (or 0.98 for large cards) on `:active`.
- **Hover State:** Note cards use `border-color` change only (no lift) to prevent layout shifts.
- **List Entry:** Items in a list must have a staggered entrance delay (`index * 30ms`).
- **Deletion:** Items must play `exit-scale` before being removed from the DOM.

## Iconography

### Icon Set
Using inline SVG icons with a consistent stroke style:
- Stroke width: 2px
- Stroke linecap: round
- Stroke linejoin: round
- No fill (outline style)

### Icon Sizes
- **XS**: 12×12px - Inline with small text
- **SM**: 16×16px - Inline with base text
- **MD**: 20×20px - Standalone small icons
- **LG**: 24×24px - Standard standalone icons
- **XL**: 32×32px - Large icons
- **XXL**: 48×48px - Empty states, illustrations

### Available Icons
- `icon-search` - Search functionality
- `icon-arrow-right` - Forward navigation
- `icon-arrow-left` - Back navigation
- `icon-check` - Success, completion
- `icon-trash` - Delete actions
- `icon-x` - Close, remove
- `icon-tag` - Tags, categories
- `icon-link` - External links
- `icon-file-text` - Documents, notes
- `icon-clock` - Time, read later
- `icon-star` - Starring/Favoriting notes
- `icon-edit` - Modify, update content
- `icon-plus` - Create, add new item
- `icon-maximize` - Expand view
- `icon-minimize` - Collapse view

## Focus States
- **Focus Ring**: `0 0 0 3px rgba(94, 106, 210, 0.12)`
- **Focus Ring Offset**: `2px`

## Component Library

### Buttons
- **Primary**: Background `$primary-default`, Text `white`
- **Ghost**: Background `transparent`, Text `$text-secondary`
- **Icon Button**: Round `32px`, centered icon
  - Hover: Background `$surface-hover`, Icon `$primary-default`

### Global Actions (Header)
- **Navigation Buttons**:
  - **Styles**: Ghost button with icon. Active state uses Primary color/bg.
  - **Library (Left)**: `icon-grid`. Access to full note library.
  - **AI Chat (Right)**: `icon-sparkle`. Access to AI assistant.
  - **Settings (Right)**: `icon-settings`. Access to extension configuration.
  - **Create Note (Left)**: `icon-plus`. Opens overlay capture mode.
- **Contextual Recall Pill**:
  - **Purpose**: Dynamic notification for existing notes related to the current page.
  - **Location**: Absolute center of `menu-bar`, replacing logo/title.
  - **States**: 
    - Inactive: Hidden.
    - Active (Notes found): Primary subtle background, Primary text, 1 opacity.
    - Filtered: Primary background, White text.
  - **Interaction**:
    - **Click**: Toggles Context Filter and auto-expands matching notes.
    - **Keyboard**: Accessible via `Enter` or `Space`.
  - **Motion**: Uses `enter-slide` (300ms, spring) on first appearance per session.
- **Create Note**:
  - Location: Top-right `menu-bar`.
  - Icon: `icon-plus`.
  - Interaction: Opens Capture Mode with empty inputs for manual entry.
- **Expand/Collapse All**:
  - Location: `.filter-input-wrapper`, right of search bar.
  - Icon: Toggles `icon-maximize` / `icon-minimize`.
  - Interaction: Toggles expansion state of all note cards in view.

### Smart Chips (Rich Media)
- **Purpose**: Dense, inline representation of media links (YouTube, Twitter).
- **Style**: Pill-shaped, platform-specific colors (e.g., Red for YouTube).
- Interaction: Hover lift effect, opens in new tab.
- Icon: Platform logo (SVG) on the left.

### Starred Toggle (Favorites)
- **Purpose**: Mark a note as a favorite for quick reference, distinct from "Read Later".
- **States**: 
  - Inactive: Tertiary text color, 0 opacity (visible on card hover).
  - Active: Primary color, Primary subtle background, 1 opacity.
- **Position**: Swaps to the position immediately left of the "Read Later" button in the card actions.
- **Interaction**: Snappy scale animation (1.1x) on hover and click.
- **Icon**: `icon-star`.

### Read Later Toggle
- **Purpose**: Mark a note for future reading/attention.
- **States**: 
  - Inactive: Tertiary text color, 0 opacity (visible on card hover).
  - Active: Primary color, Primary subtle background, 1 opacity.
- **Position**: Swaps to far-right (priority) position when active, displacing delete button.
- **Interaction**: Snappy scale animation (1.1x) on hover and click.
- **Icon**: `icon-clock`.

### Tag Interaction (Library)
- **Purpose**: Quick filtering by context.
- **Location**: Bottom of Note Card.
- **Interaction**:
  - **Hover**: Background `$primary-subtle`, Text `$primary`.
  - **Click**: Adds tag to active filters.
  - **Constraint**: `stopPropagation` prevents card expansion.

### Note Editing (Inline)
- **Purpose**: Modify User Note and Tags without leaving the library view.
- **Trigger**: `icon-edit` button in card header.
- **UI State**: Card swaps content for an inline form (`.note-edit-form`).
- **Interaction**:
  - Focus is automatically moved to the Note textarea.
  - `Cmd/Ctrl + Enter` to save.
  - `Esc` to cancel.
- **Visuals**: Primary color border indicates active editing state.

### Clickable Source Link
- **Purpose**: Navigate to the original URL of the clip.
- **Location**: Note card header (favicon + site name).
- **Interaction**:
  - **Hover**: Transforms into a "Pill" (Background: Surface Hover, Text: Primary).
  - **Click**: Opens URL in new tab.
  - **Constraint**: `stopPropagation` prevents card expansion.

### Tag Input (Integrated Combobox)
- **Purpose**: Manage tags with structured selection and creation.
- **Visuals**:
  - Container: Looks like an input field (`border: 1px solid var(--color-border)`).
  - Pills: Primary color background, rounded (`var(--radius-lg)`), inside container.
  - Dropdown: Absolute positioned, shadows (`var(--shadow-md)`).
- **Interaction**:
  - `Enter`/`Comma`: Create tag.
  - `Backspace`: Delete last tag.
  - `Up`/`Down`: Navigate suggestions.
- **States**:
  - Focus: Container gets `var(--focus-ring)`.
  - Hover (Dropdown Item): `var(--color-surface-hover)`.

### Webpage Capture Badge
- **Purpose**: Visual indicator for page-level bookmarks (captures with no selected text).
- **Style**:
  - Background: `$primary-subtle`.
  - Text: `$primary`.
  - Border Radius: `$radius-md`.
  - Font Size: `$font-size-xs`.
  - Weight: Medium.
- **Location**: In the Capture Mode preview area, next to the page title.

## Usage Guidelines

### Do's
- ✅ Use consistent spacing from the spacing scale
- ✅ Use semantic color names (e.g., `--color-action` not `--color-blue`)
- ✅ Maintain icon stroke consistency
- ✅ Use proper text hierarchy
- ✅ Apply appropriate focus states to interactive elements

### Don'ts
- ❌ Don't use arbitrary spacing values
- ❌ Don't mix icon styles
- ❌ Don't skip text hierarchy levels
- ❌ Don't use pure black (#000) or pure white (#FFF) for text
- ❌ Don't create new colors without documenting them

## Accessibility

### Contrast Ratios
- Primary text on backgrounds: Minimum 4.5:1
- Secondary text on backgrounds: Minimum 3:1
- Interactive elements: Minimum 3:1

### Focus Indicators
- All interactive elements must have visible focus states
- Focus rings should be consistent across components

### Motion
- Respect `prefers-reduced-motion` for animations
- Keep animations fast (100-300ms) for snappy feel

## Implementation

### CSS Variables
All design tokens are defined as CSS custom properties in `styles.css`:

```css
:root {
  --color-primary: #5E6AD2;
  --spacing-md: 12px;
  --font-size-base: 13px;
  /* ... */
}
```

### Using in Components
```css
.button {
  background: var(--color-action);
  padding: var(--spacing-md);
  font-size: var(--font-size-base);
  border-radius: var(--radius-md);
  transition: var(--transition-base);
}
```

### Using Icons
```html
<svg class="icon icon-sm">
  <use href="#icon-search"></use>
</svg>
```

## 6. AI & Semantic Design

To support the pivot from storage to synthesis, the UI employs "Ambient Intelligence" signals.

### 6.1 AI Semantic Tokens
- **AI Primary**: `#8B5CF6` (Violet-500) - used for AI-specific actions and indicators.
- **AI Surface**: `rgba(139, 92, 246, 0.1)` - subtle background for AI sections.

### 6.2 Context Pill States
- **Standard**: Solid surface, shows count of notes on current URL.
- **AI Pulse**: Pulsing purple border (`--color-ai-primary`). Indicates semantic matches are available.
- **Hybrid**: Solid primary color + Sparkle icon (`icon-sparkle`). Indicates both exact and semantic matches.

### 6.3 Compact Insight Card
Used for semantic matches in the Context View to save space.
- **Structure**: Connection Badge + Relevant Snippet + Source Favicon.
- **Interaction**: Click to expand into a full `note-card`.
- **Feedback**: "Thumbs Down" icon for marking irrelevant connections (shows notification tooltip).

### 6.4 Hybrid Library View
A split-view layout used when both Exact Matches and Semantic Matches are available.
- **AI Action Header**: A compact, collapsed banner `[ ✨ Synthesize Connections ]` at the top. Expands to show streaming AI summary.
- **Section Headers**:
    - "From this Page": Standard Note Cards (Exact Matches).
    - "Related Concepts": Insight Cards (Semantic Matches).
- **Separation**: Sections are divided by a subtle border (`var(--color-border)`).

## 7. Updates & Maintenance
- Version: 1.12.0
- Last Updated: 2026-02-04
- Maintained by: Development Team

### Note List (Library)
- **Layout:** Optimized density with reduced padding (`--spacing-sm` horizontal).
- **Media Object:** Notes containing images use a side-by-side layout.
  - **Thumbnail:** 100x100px square, `object-fit: cover`, left-aligned. Displays the first image.
  - **Gallery Badge:** If multiple images exist, a "+N" badge overlays the bottom-right corner of the thumbnail.
  - **Content:** Flex-grow area for text and metadata, right-aligned.
- **Scrollbar:** Thin (`8px`), custom-styled overlay scrollbar to maximize content width.
- **Sorting:** Defaults to "Newest First".

### Image Lightbox (Visual Overlay)
- **Purpose**: High-fidelity viewing of captured images without leaving the context.
- **Visuals**: Full-screen modal with semi-transparent backdrop (`rgba(0,0,0,0.9)`).
- **Actions**: Floating Download button (`icon-arrow-right` used as download intent).
- **Interaction**: Dismissible via Backdrop click, Close button, or Escape key.
- **Motion**: Uses `enter-scale` for a zoom-in feel.