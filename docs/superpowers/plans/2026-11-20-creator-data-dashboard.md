# Creator Data Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan. Review tasks at checkpoints and stop on failed verification.

**Goal:** Build `maitian-insight`, a local-first open-source dashboard that collects the owner’s Douyin, Xiaohongshu, and WeChat Channels creator data and displays it with a polished visual design.

**Architecture:** One Node.js 22 process drives a persistent local Chrome profile, normalizes three platform responses, and stores daily snapshots in SQLite. A local-only HTTP server reads SQLite and serves two vanilla web pages. Windows Task Scheduler runs the same `collect` command once per day. A minimal MV3 bridge is conditional and exists only if live Channels verification proves Playwright cannot access the required response.

**Tech Stack:** Node.js 22, `playwright-core`, `node:sqlite`, native HTTP, vanilla HTML/CSS/JS, locally served Apache ECharts, Windows PowerShell.

**Spec:** `docs/superpowers/specs/2026-11-20-creator-data-dashboard-design.md`

## Global Constraints

- Keep exactly three platform collectors, six business tables, two pages, and four CLI commands.
- Reuse mature MIT/Apache patterns only. Do not copy unlicensed or proprietary source.
- Store cookies, profiles, databases, cached covers, logs, and raw fixtures only under ignored local paths.
- Never persist cookies, tokens, full private responses, or user-identifying live values in tests.
- Treat missing metrics as `NULL`, never `0`.
- Preserve old data when a collection fails or returns partial results.
- Bind the dashboard to `127.0.0.1` only.
- Do not add React, TypeScript, Tailwind, an ORM, Docker, cloud services, publishing, AI analysis, or multi-account support.
- Each task ends with its named verification and commit before the next task starts.

## Review Focus

1. Expired login returns `needs_login` and never deletes prior snapshots.
2. Pagination mismatch returns `partial` with fetched and reported totals.
3. Repeated collection on the same local date updates one snapshot instead of duplicating it.
4. Concurrent manual collection returns `409` or `already_running`.
5. Bad cover URLs fall back to a placeholder without exposing arbitrary local or remote resources.

---

## Task 1: Project foundation, data contract, and SQLite

**Files:**

- Create: `package.json`
- Create: `.gitignore`
- Create: `LICENSE`
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `src/config.mjs`
- Create: `src/normalize.mjs`
- Create: `src/db.mjs`
- Create: `test/db.test.mjs`
- Create: `test/normalize.test.mjs`

**Public interfaces:**

```js
openDatabase(databasePath) -> DatabaseSync
initSchema(db) -> void
saveCollection(db, result, capturedAt) -> void
getOverview(db, now) -> object
getContents(db, filters) -> object[]
normalizeTitle(title) -> string
pairContent(db, post) -> contentId
```

**Schema details:**

- `accounts`: one row per `platform`; retain platform account ID, display name, and avatar URL.
- `account_snapshots`: unique `(platform, snapshot_date)`; retain full `captured_at` for display.
- `contents`: integer ID, normalized title, representative title, cover path, and earliest publish time.
- `platform_posts`: unique `(platform, post_id)`; foreign key to `contents`.
- `metric_snapshots`: unique `(platform, post_id, snapshot_date)`; nullable metrics.
- `collector_runs`: append-only run history with status, fetched count, reported total, partial flag, schema version, and sanitized error.

**Steps:**

- [ ] Add `package.json` with ESM, Node `>=22.5`, scripts `test`, `check`, and dependencies only `playwright-core` and `echarts`.
- [ ] Add `.gitignore` entries for `node_modules/`, `data/`, browser profiles, databases, cached covers, screenshots, logs, and live response dumps.
- [ ] Add MIT `LICENSE`. Add ECharts and behavior-reference attribution to `THIRD_PARTY_NOTICES.md`; do not claim copied source from restricted projects.
- [ ] Write failing tests for schema creation, same-day upsert, `NULL` preservation, 72-hour exact-title pairing, and non-pairing outside 72 hours.
- [ ] Run `node --test test/db.test.mjs test/normalize.test.mjs`. Expected: failures because modules do not exist.
- [ ] Implement only the schema, data access, normalization, and pairing needed by those tests.
- [ ] Run `npm install`, then `npm test`. Expected: all Task 1 tests pass.
- [ ] Commit: `git add . && git commit -m "feat: add dashboard data foundation"`.

## Task 2: Persistent browser lifecycle and collection orchestration

**Files:**

- Create: `src/browser.mjs`
- Create: `src/collect.mjs`
- Create: `src/cli.mjs`
- Create: `test/browser.test.mjs`
- Create: `test/collect.test.mjs`

**Collector contract:**

```js
{
  platform: 'douyin' | 'xiaohongshu' | 'channels',
  loginUrl: string,
  collect({ context, since, limit, now }): Promise<{
    account,
    accountSnapshot,
    posts,
    metrics,
    reportedTotal,
    partial,
    warnings
  }>,
  checkLogin({ context }): Promise<{ ok, reason }>
}
```

**Public interfaces:**

```js
findChromeExecutable() -> string
openPersistentBrowser({ profileDir, chromePath, headless }) -> Promise<{ context, close }>
collectAll({ db, context, collectors, now, delayMs }) -> Promise<object[]>
runCli(argv, dependencies) -> Promise<number>
```

**Steps:**

- [ ] Write failing browser tests for Windows Chrome path selection, missing Chrome error, and profile directory selection without opening a real browser.
- [ ] Write failing orchestration tests with fake collectors for serial order, one-platform failure isolation, `needs_login`, `partial`, and preserved old rows.
- [ ] Run `node --test test/browser.test.mjs test/collect.test.mjs`. Expected: failures because modules do not exist.
- [ ] Implement persistent Chrome launch and explicit cleanup. Default to headed mode and `data/browser-profile/`.
- [ ] Implement serial `collectAll` with a 2-second production delay, injected zero delay in tests, per-platform run records, and no cross-platform rollback.
- [ ] Implement CLI dispatch for `login`, `collect`, `doctor`, and `serve`. Commands may dynamically import later modules, but unknown commands must return exit code `2` and usage text.
- [ ] Run `npm test && npm run check`. Expected: all tests and syntax checks pass.
- [ ] Commit: `git add . && git commit -m "feat: add browser collection runtime"`.

## Task 3: Douyin structured-response collector

**Files:**

- Create: `src/platforms/douyin.mjs`
- Create: `test/platforms/douyin.test.mjs`
- Create: `test/fixtures/douyin-work-list.json`
- Create: `test/fixtures/douyin-account.json`
- Modify: `src/collect.mjs`
- Modify: `src/cli.mjs`

**Observed source:**

- Work list: `/janus/douyin/creator/pc/work_list`
- Account/followers: `/web/api/media/user/info/` and `/aweme/janus/creator/data/overview/all/`
- Pagination: `has_more` and `max_cursor`

**Public interfaces:**

```js
parseDouyinWorkList(payload) -> { posts, metrics, reportedTotal, hasMore, cursor }
parseDouyinAccount(payloads) -> { account, accountSnapshot }
collectDouyin(options) -> CollectorResult
```

**Steps:**

- [ ] Create small synthetic fixtures that preserve observed field names but contain no live IDs, titles, avatars, or counts.
- [ ] Write failing parser tests for IDs, cover, publish time, views, likes, comments, favorites, shares, cursor pagination, and missing metrics as `null`.
- [ ] Write a failing collector test using a fake page/response adapter for initial response capture, subsequent same-origin cursor requests, 100-item cap, and login redirect.
- [ ] Run `node --test test/platforms/douyin.test.mjs`. Expected: failures because collector does not exist.
- [ ] Implement response-first collection. Never read `__reactFiber`; never call publishing or interaction endpoints.
- [ ] Register the collector in `collect` and `doctor`.
- [ ] Run `npm test && npm run check`. Expected: all tests pass.
- [ ] Commit: `git add . && git commit -m "feat: collect douyin creator metrics"`.

## Task 4: Xiaohongshu structured-response collector

**Files:**

- Create: `src/platforms/xiaohongshu.mjs`
- Create: `test/platforms/xiaohongshu.test.mjs`
- Create: `test/fixtures/xiaohongshu-posted.json`
- Create: `test/fixtures/xiaohongshu-fans.json`
- Modify: `src/collect.mjs`
- Modify: `src/cli.mjs`

**Observed source:**

- Work list: `/api/galaxy/v2/creator/note/user/posted`
- Followers: `/api/galaxy/creator/data/fans/overall_new`
- Pagination: `page`, returned page metadata, and reported totals where available

**Public interfaces:**

```js
parseXiaohongshuPosted(payload) -> { posts, metrics, reportedTotal, hasMore, nextPage }
parseXiaohongshuFans(payload) -> { account, accountSnapshot }
collectXiaohongshu(options) -> CollectorResult
```

**Steps:**

- [ ] Create synthetic fixtures using observed response keys only.
- [ ] Write failing tests for note ID, title, first cover, publish time, views, likes, comments, favorites, shares, next page, and absent fields as `null`.
- [ ] Write a failing collector test for response capture, same-origin page requests, 90-day/100-item stop rules, and login redirect.
- [ ] Run `node --test test/platforms/xiaohongshu.test.mjs`. Expected: failures because collector does not exist.
- [ ] Implement response-first collection. Do not depend on `.note-card` order and do not add search, publish, comment, or private-message APIs.
- [ ] Register the collector in `collect` and `doctor`.
- [ ] Run `npm test && npm run check`. Expected: all tests pass.
- [ ] Commit: `git add . && git commit -m "feat: collect xiaohongshu creator metrics"`.

## Task 5: WeChat Channels collector and extension decision gate

**Files:**

- Create: `src/platforms/channels.mjs`
- Create: `test/platforms/channels.test.mjs`
- Create: `test/fixtures/channels-post-list.json`
- Create: `test/fixtures/channels-fans-trend.json`
- Modify: `src/collect.mjs`
- Modify: `src/cli.mjs`
- Conditional create only if gate fails: `extension/manifest.json`
- Conditional create only if gate fails: `extension/bridge.js`
- Conditional create only if gate fails: `extension/intercept-main.js`
- Conditional create only if gate fails: `src/extension-ingest.mjs`
- Conditional create only if gate fails: `test/extension-ingest.test.mjs`

**Known source behavior:**

- Summary action: `new_post_total_data`
- Followers action: `fans_trend`
- Work list action: `post_list`
- Statistics route family: `/micro/statistic/cgi-bin/mmfinderassistant-bin/statistic/`
- Pagination fields: `currentPage`, `pageSize`, `startTime`, `endTime`; response total: `totalCount`

**Public interfaces:**

```js
parseChannelsPostList(payload) -> { posts, metrics, reportedTotal, hasMore, nextPage }
parseChannelsFans(payload) -> { account, accountSnapshot }
collectChannels(options) -> CollectorResult
```

**Steps:**

- [ ] Create synthetic fixtures from documented field shapes. Do not copy restricted repository source or live response values.
- [ ] Write failing tests for post identity, title fallback, cover, publish time, metrics, `totalCount` pagination, 100-item cap, and missing fields as `null`.
- [ ] Write a failing collector test for Shadow DOM login detection and structured response capture. DOM statistics remain a last fallback only.
- [ ] Run `node --test test/platforms/channels.test.mjs`. Expected: failures because collector does not exist.
- [ ] Implement response-first Channels collection and register it in `collect` and `doctor`.
- [ ] Run `npm test && npm run check`. Expected: all fixture tests pass.
- [ ] Perform one read-only live check after the user scans the Channels login. Record only endpoint names and field presence in a local ignored note.
- [ ] If Playwright sees `post_list` and `fans_trend`, skip all `extension/` files and document “extension not required.”
- [ ] If Playwright cannot access those responses, implement the conditional MV3 bridge. Limit hosts to Channels and `http://127.0.0.1/*`; intercept only the named statistics actions; require an ephemeral local ingest token; send normalized fields only.
- [ ] Run `npm test && npm run check`. Expected: all tests pass, including extension ingest tests only when the extension exists.
- [ ] Commit: `git add . && git commit -m "feat: collect channels creator metrics"`.

## Task 6: Local API, collection lock, and safe cover cache

**Files:**

- Create: `src/server.mjs`
- Create: `src/covers.mjs`
- Create: `test/server.test.mjs`
- Create: `test/covers.test.mjs`
- Modify: `src/cli.mjs`

**Routes:**

```text
GET  /api/health
GET  /api/overview
GET  /api/contents?platform=&from=&to=
POST /api/collect
GET  /covers/:platform/:postId
GET  /
GET  /content
```

**Steps:**

- [ ] Write failing API tests for loopback binding, JSON content type, overview data, content filters, unknown route, and no-store headers on API responses.
- [ ] Write failing collection tests for one active run and a second request returning `409 { code: "already_running" }`.
- [ ] Write failing cover tests for valid image caching, timeout, maximum 10 MB, non-image response, invalid scheme, path traversal, and placeholder fallback.
- [ ] Run `node --test test/server.test.mjs test/covers.test.mjs`. Expected: failures because modules do not exist.
- [ ] Implement the smallest native HTTP router. Serve only known static paths; never map arbitrary URL paths to filesystem paths.
- [ ] Implement an in-memory collection mutex and call the existing orchestrator.
- [ ] Implement cover download from collector-provided HTTP(S) URLs into `data/covers/`. Validate response type and size, then serve cached files by database identity.
- [ ] Wire `node src/cli.mjs serve` to `127.0.0.1:8789` by default.
- [ ] Run `npm test && npm run check`. Expected: all tests pass.
- [ ] Commit: `git add . && git commit -m "feat: serve local creator data api"`.

## Task 7: Polished two-page dashboard

**Files:**

- Create: `src/web/index.html`
- Create: `src/web/content.html`
- Create: `src/web/app.js`
- Create: `src/web/content.js`
- Create: `src/web/styles.css`
- Modify: `src/server.mjs`
- Create: `test/web.test.mjs`

**Page contract:**

- `/`: header status, latest 3D cover card, total followers with 30-day trend, deterministic insights, three platform cards, recent-content comparison chart.
- `/content`: time/platform filters and cross-platform content list with expandable platform metrics.
- ECharts loads locally from installed `echarts/dist/echarts.min.js`; no CDN.

**Steps:**

- [ ] Write failing static tests for two page routes, local ECharts route, required landmarks, reduced-motion CSS, keyboard-visible focus, and absence of external scripts.
- [ ] Run `node --test test/web.test.mjs`. Expected: failures because pages do not exist.
- [ ] Build semantic HTML and CSS using the approved visual tokens: `#F4F4F6`, 20px cards, 16px gaps, 22px page padding, platform colors, and `#0071E3` interaction accent.
- [ ] Implement one reusable metric formatter and one reusable status renderer in plain JavaScript. Do not create a component framework.
- [ ] Implement the latest-cover 3D card with CSS perspective, pointer tilt, keyboard-safe static rendering, and `prefers-reduced-motion` fallback.
- [ ] Implement only line and bar charts. Show `—` for `null`, “未知” for unavailable interaction rate, and “数据不完整” for partial collectors.
- [ ] Generate only the three deterministic insights from the spec. Do not call an LLM.
- [ ] Run `npm test && npm run check`. Expected: all tests pass.
- [ ] Start the server and capture local screenshots at 1440px and 390px. Expected: no horizontal overflow, readable labels, visible focus, no failed local resources.
- [ ] Commit: `git add . && git commit -m "feat: add polished creator dashboard"`.

## Task 8: Windows scheduling, documentation, and end-to-end acceptance

**Files:**

- Create: `scripts/install-task.ps1`
- Create: `scripts/uninstall-task.ps1`
- Create: `test/scripts.test.mjs`
- Create: `README.md`
- Modify: `THIRD_PARTY_NOTICES.md`

**Steps:**

- [ ] Write failing script tests for a stable task name, quoted absolute paths, daily trigger, interactive user context, and collect command.
- [ ] Run `node --test test/scripts.test.mjs`. Expected: failures because scripts do not exist.
- [ ] Implement idempotent install and uninstall scripts using Windows ScheduledTasks cmdlets. Do not require administrator rights.
- [ ] Write README sections: prerequisites, install, four commands, first login, daily task, data paths, backup, privacy, supported metrics, known fragility, extension gate, and troubleshooting.
- [ ] Run `npm test && npm run check`. Expected: all automated checks pass.
- [ ] Run `node src/cli.mjs doctor`. Expected: each platform reports `ok`, `needs_login`, or a sanitized actionable error.
- [ ] Run two consecutive collections. Expected: no duplicate posts; same-day account and metric snapshots update in place.
- [ ] Manually trigger the scheduled task. Expected: a new `collector_runs` row and unchanged task exit code `0` when at least one platform succeeds.
- [ ] Verify at least one account snapshot and one work snapshot per logged-in platform. If Channels is still logged out, report that single acceptance item as pending; do not fake success.
- [ ] Re-run 1440px and 390px visual checks after live data exists.
- [ ] Run `git status --short`. Expected: clean tree; no `data/`, profile, database, cover, screenshot, or live response file tracked.
- [ ] Commit: `git add . && git commit -m "docs: finish local dashboard setup"`.

## Final Verification

Run in this order:

```powershell
npm ci
npm test
npm run check
node src/cli.mjs doctor
node src/cli.mjs collect
node src/cli.mjs serve
```

Acceptance evidence must include:

1. Automated test and syntax-check output.
2. Sanitized `doctor` status for three platforms.
3. Duplicate-proof row counts from two consecutive runs.
4. Task Scheduler manual-run result.
5. Dashboard screenshots at 1440px and 390px.

Stop after these pass. Do not add exports, alerts, competitors, AI analysis, publishing, cloud deployment, or extra platforms.
