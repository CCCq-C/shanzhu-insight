# Content Archive Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/content` into a compact two-column magazine-card archive that emphasizes covers and always shows all three platform metrics without a click.

**Architecture:** Replace the current expandable `details` rows with static content cards while keeping the API. Change only the rendered information hierarchy and CSS grid; use the existing tokens, breakpoints, accessibility behavior, and platform metadata.

**Tech Stack:** Vanilla HTML/CSS/ES modules, Node.js test runner, Playwright Core.

**Spec:** `docs/superpowers/specs/2026-11-20-content-archive-redesign-design.md`

## Global Constraints

- No new dependency, modal, drawer, drag, sort, pagination, API, database, collector, or grouping change.
- Desktop uses two columns; every card always exposes three platform metric blocks; tablet and mobile use one column.
- Reuse existing navigation, filters, colors, typography, and reduced-motion behavior.
- Use existing `PLATFORMS`, `formatDateTime`, `formatMetric`, and `formatRate` interfaces.

## Review Focus

- Long titles: clamp without widening cards or hiding the full title from the native summary.
- Missing cover: keep a deliberate placeholder at the same dimensions.
- One, two, or three collected platforms: the card always reserves three labeled platform blocks and marks missing ones as “未采集”.
- No-click access: all available platform metrics and original links are visible without expanding a card.
- Narrow viewport: cards, filters, post metrics, and navigation remain usable at `390px` width.

---

### Task 1: Two-column content archive

**Files:**
- Modify: `src/web/content.js`
- Modify: `src/web/styles.css`
- Modify: `test/visual.test.mjs`

**Interfaces:**
- Consumes: `content.posts`, `content.coverPath`, `PLATFORMS`, and current `/api/contents` response.
- Produces: `.content-platforms`, `.content-kicker`, two-column `.content-list`, and always-visible `.post-grid`.

- [ ] **Step 1: Write failing structural and browser tests**

Add `content archive uses two-column magazine cards with visible platform metrics`. Assert two desktop grid columns, a cover width of at least `100px`, three visible platform blocks without interaction, static `article` semantics, and one grid column at `760px`.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node --test test/web.test.mjs test/visual.test.mjs`

Expected: FAIL because the new content classes and two-column computed layout do not exist.

- [ ] **Step 3: Update `renderContents(contents)`**

Render a static `article` card, add a small date/platform-count kicker, retain the total-play metric, and always render the three platforms in `PLATFORMS` order. Missing posts render a labeled “未采集” block.

- [ ] **Step 4: Implement the magazine-card CSS**

Set `.content-list` to two columns. Use an approximately `112 × 150px` portrait thumbnail, compact card hierarchy, restrained hover lift, and three equal metric blocks under the header. At `max-width: 980px`, switch the archive to one column; keep the existing mobile post-grid stack.

- [ ] **Step 5: Run focused and full checks**

Run: `node --test test/web.test.mjs test/visual.test.mjs`

Expected: PASS.

Run: `npm test && npm run check && git diff --check`

Expected: all tests pass; syntax and whitespace checks exit `0`.

### Task 2: Review surface and live acceptance

**Files:**
- Create: `.frontend-design/content-archive/2026-11-20-double-column-magazine.html`
- Create: `screenshots/content-archive-magazine-desktop.png`
- Create: `screenshots/content-archive-magazine-mobile.png`
- Modify: `docs/superpowers/specs/2026-11-20-content-archive-redesign-design.md`
- Create: `docs/superpowers/plans/2026-11-20-content-archive-redesign.md`

**Interfaces:**
- Consumes: the live `/content` structure and CSS tokens from Task 1.
- Produces: self-contained design review preview, verified screenshots, and committed design records.

- [ ] **Step 1: Build the self-contained existing-app preview**

Use the frontend-design behavior scaffold only. Mirror the real navigation, filters, two-column cards, always-visible three-platform metrics, and current CSS tokens. Expose only the project’s actual card-radius, gap, shadow, and body-size dimensions.

- [ ] **Step 2: Verify preview behavior**

Open via `file://`. Test one token control, one text edit, one element comment, and markdown export. Confirm no external script, stylesheet, font, or image URL.

- [ ] **Step 3: Restart the hidden local server and verify the real route**

Open `http://127.0.0.1:8789/content` at `1440 × 1000` and `390 × 844`. Verify filters, all three platform blocks without interaction, original links, keyboard focus, and one-column mobile fallback.

- [ ] **Step 4: Capture screenshots and commit**

Capture both viewports, inspect them, then run `git status --short`.

Commit tracked product code, tests, spec, and plan with:

`git commit -m "feat: redesign content archive cards"`

Push `main` to `origin` and confirm the local server remains healthy.
