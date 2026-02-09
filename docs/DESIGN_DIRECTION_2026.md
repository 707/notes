# Design Direction 2026: The "Intent-Driven" Clipper
**Status:** DRAFT | **Role:** Principal AI-Product Designer | **Date:** Jan 28, 2026

## 1. The Pivot: From "Storage" to "Synthesis"

The current *Klue* is a high-fidelity **storage bucket**. It relies 100% on user effort to organize, tag, and annotate. In 2026, this is insufficient. A user surfing the web is in a "high-velocity" flow state; asking them to stop and manually tag content breaks that flow.

**The New Core Loop:**
*   **Old:** Highlight -> Capture -> Manual Note -> Manual Tag -> Save.
*   **New:** Highlight -> Capture -> **AI Synthesis (Auto-Summary + Auto-Tag)** -> Review (Optional) -> Save.

We are shifting the cognitive load from the **User** to the **System**.

---

## 2. Implemented Foundation (The "Linear" Standard)
*The following systems have been verified in the codebase.*

### 2.1 Visual Language (Linear-Inspired)
*   **Color Palette:** A cohesive Purple/Violet (`#5E6AD2`) theme replacing generic blues.
*   **Iconography:** Full migration to 2px stroke inline SVGs (Search, Check, Trash, etc.), replacing emojis.
*   **Elevation:** A 4-tier shadow system (`shadow-sm` to `shadow-xl`) for spatial depth.

### 2.2 Functional UI
*   **Unified Filtering:** A single input field that handles Search, Sort, and Filtering (with chip-based active states).
*   **Menu Bar:** A persistent top-level navigation bar for consistent branding.

---

## 3. Proposals (The "Smart" Evolution)
*The following are new initiatives to drive "Intent" and "Affordance".*

### 3.1 Adaptive Context (Level 4: Context Awareness)
The library view must adapt to the user's current browsing session.
*   **Domain Filtering:** If the user opens the clipper on `github.com`, the library should default to showing "Code Snippets" or "Previous clips from GitHub".
*   **Why:** Reduces recall effort. "Show me what I know about *this*."

### 3.2 Systemic Token Consistency (Refactor)
**Critique:** Tokens are currently fragmented.
*   **Proposal:** Move ALL design tokens (Spacing, Radius, Typography) from `panel.css` to `styles.css`.
*   **Benefit:** A single source of truth allows for global theming updates.

### 3.3 Intent & AI Affordance ("Ghost" UI)
The UI must signal intelligence even before a backend exists.
*   **Ghost Tags:** Instead of an empty input, display *suggested* clickable tags (e.g., `[+ #javascript]`, `[+ #research]`) based on simple keyword matching.
*   **Smart Placeholder:** The "Note" field placeholder should change based on content (e.g., "Describe this code snippet..." vs "Summarize this article...").

### 3.4 Spatial Motion (Fluid Navigation)
**Critique:** Mode switching is abrupt.
*   **Proposal:** Implement a **Slide Transition** between Capture and Library modes.
    *   *Capture Mode* enters from the **Right**.
    *   *Library Mode* rests on the **Left**.
*   **Spec:** 300ms, `cubic-bezier(0.2, 0.8, 0.2, 1)`.

---

**Signed:**
*Principal AI-Product Designer*
