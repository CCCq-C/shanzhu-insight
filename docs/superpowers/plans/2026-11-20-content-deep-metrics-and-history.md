# Content Deep Metrics and History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add accurate per-content cross-platform analytics and backfill real follower history on first collection.

**Architecture:** Extend existing collector result objects with optional deep metrics and `accountHistory`. Persist them in existing daily snapshot tables through a backward-compatible migration. Serve one detail endpoint and reuse the existing content archive plus local ECharts for the comparison dialog.

**Tech Stack:** Node.js 22, `node:sqlite`, Playwright Core, browser JavaScript, local ECharts 6.

**Spec:** `docs/superpowers/specs/2026-11-20-content-deep-metrics-and-history-design.md`

## Global Constraints

- Keep platform-provided missing metrics as `null`; never fabricate parity.
- Preserve existing database rows during migration.
- Keep collection headless and serial.
- Reuse current UI components and dependencies.
- Store no cookies, request headers, or raw platform payloads.

## Review Focus

- Douyin numeric IDs above `Number.MAX_SAFE_INTEGER` must use exact string `aweme_id` and migrate the old rounded row.
- Missing deep metrics must stay `null`, not zero.
- Historical follower rows must not overwrite newer known fields with nulls.
- A content detail request for an unknown or invalid ID must return 404 without SQL errors.
- Charts must remain usable when only one platform or one history point exists.

---

### Task 1: Platform Parsers and Collectors

**Files:**
- Modify: `src/platforms/douyin.mjs`
- Modify: `src/platforms/xiaohongshu.mjs`
- Modify: `src/platforms/channels.mjs`
- Modify: `test/platforms/*.test.mjs`
- Modify: `test/fixtures/*.json`

**Interfaces:**
- Produces: collector results with `metrics[].durationSeconds`, deep metric fields, and `accountHistory[]`.

- [ ] Write parser tests for exact Douyin IDs, each platform's supported deep metrics, and follower history.
- [ ] Run `node --test test/platforms` and verify the new assertions fail for missing fields.
- [ ] Add the smallest parser and collector changes that satisfy those tests.
- [ ] Run `node --test test/platforms` and verify all platform tests pass.
- [ ] Commit as `feat: collect deep content metrics and follower history`.

### Task 2: Snapshot Persistence and Detail Query

**Files:**
- Modify: `src/db.mjs`
- Modify: `test/db.test.mjs`

**Interfaces:**
- Consumes: Task 1 collector result fields.
- Produces: `getContentDetail(db, contentId)` with posts, current metrics, and daily history.

- [ ] Write database tests for schema migration, history backfill, deep metric preservation, rounded-ID migration, and content detail history.
- [ ] Run `node --test test/db.test.mjs` and verify the new assertions fail for missing storage/query behavior.
- [ ] Extend the schema and save/query paths without replacing known values with nulls.
- [ ] Run `node --test test/db.test.mjs` and verify all database tests pass.
- [ ] Commit as `feat: persist content analytics history`.

### Task 3: Content Detail API

**Files:**
- Modify: `src/server.mjs`
- Modify: `test/server.test.mjs`

**Interfaces:**
- Consumes: `getContentDetail(db, contentId)` from Task 2.
- Produces: `GET /api/contents/:id` with 200 or 404 JSON responses.

- [ ] Write server tests for valid, invalid, and missing content IDs.
- [ ] Run `node --test test/server.test.mjs` and verify the route tests fail.
- [ ] Add the route before static-file handling.
- [ ] Run `node --test test/server.test.mjs` and verify all server tests pass.
- [ ] Commit as `feat: expose content comparison details`.

### Task 4: Comparison Dialog and Visual Verification

**Files:**
- Modify: `src/web/content.html`
- Modify: `src/web/content.js`
- Modify: `src/web/styles.css`
- Modify: `test/visual.test.mjs`
- Modify: `test/web.test.mjs`

**Interfaces:**
- Consumes: `GET /api/contents/:id`.
- Produces: accessible content comparison dialog with three charts and one platform table.

- [ ] Write browser tests for opening, rendering missing values, chart canvases, and mobile layout.
- [ ] Run `node --test test/visual.test.mjs test/web.test.mjs` and verify the new UI assertions fail.
- [ ] Add the dialog using current ECharts and shared formatters.
- [ ] Run `node --test test/visual.test.mjs test/web.test.mjs` and verify all UI tests pass.
- [ ] Run `npm test` and `npm run check`.
- [ ] Commit as `feat: add cross-platform content comparison`.
