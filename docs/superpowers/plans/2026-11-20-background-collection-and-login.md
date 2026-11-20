# Background Collection And Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run collection invisibly, schedule it every 15 minutes, expose login recovery, and keep follower trends visible.

**Architecture:** Reuse the persistent Playwright profile and existing server single-flight state. Add one visible-browser login path, one in-process timer, and native web dialog/status controls. Keep ECharts and current database history model.

**Tech Stack:** Node.js 22, Playwright Core, SQLite, native HTML/CSS/JS, ECharts 6

**Spec:** `docs/superpowers/specs/2026-11-20-background-collection-and-login-design.md`

## Global Constraints

- No new dependency.
- Routine collection is headless; only explicit login is headed.
- Collection interval is 15 minutes; dashboard polling interval is 30 seconds.
- Only one browser task may run at once.
- Login accepts only `douyin`, `xiaohongshu`, or `channels`.

## Review Focus

- Manual and scheduled collection cannot overlap.
- Login cannot start while collection is active.
- Invalid platform input returns 404 and never launches Chrome.
- Login errors are reported through health state without crashing the server.
- A one-point follower history remains visible.

---

### Task 1: Headless collection and visible login

**Files:**
- Modify: `src/browser.mjs`
- Create: `src/login.mjs`
- Modify: `src/cli.mjs`
- Modify: `src/platforms/douyin.mjs`
- Modify: `src/platforms/xiaohongshu.mjs`
- Modify: `src/platforms/channels.mjs`
- Test: `test/browser.test.mjs`
- Test: `test/login.test.mjs`

**Interfaces:**
- Produces: `loginToPlatform(platform, options) -> Promise<{ platform, status }>`

- [ ] Write failing tests for headless default, allowlisted login, success detection, and timeout.
- [ ] Run targeted tests and confirm expected failures.
- [ ] Implement the minimum browser mode and login loop.
- [ ] Run targeted tests and confirm they pass.

### Task 2: Scheduler, single-flight API, and health state

**Files:**
- Modify: `src/server.mjs`
- Test: `test/server.test.mjs`

**Interfaces:**
- Consumes: `loginToPlatform`
- Produces: `POST /api/login/:platform`; health fields `job`, `nextCollectionAt`, and `logins`

- [ ] Write failing integration tests for auto collection, job conflicts, login state, and invalid platform.
- [ ] Run targeted tests and confirm expected failures.
- [ ] Implement one shared job lock and a 15-minute unref timer.
- [ ] Run targeted tests and confirm they pass.

### Task 3: Dashboard status, login controls, and trend visibility

**Files:**
- Modify: `src/web/index.html`
- Modify: `src/web/app.js`
- Modify: `src/web/styles.css`
- Test: `test/web.test.mjs`
- Test: `test/visual.test.mjs`

**Interfaces:**
- Consumes: health API fields from Task 2.

- [ ] Write failing DOM and visual tests for dialog, login buttons, polling, and single-point chart symbols.
- [ ] Run targeted tests and confirm expected failures.
- [ ] Implement native dialog, platform actions, and 30-second refresh.
- [ ] Run targeted tests and confirm they pass.

### Task 4: Verification and rollout

**Files:**
- Modify: `README.md`

- [ ] Run `npm test` and `npm run check`.
- [ ] Capture desktop and mobile screenshots; inspect overflow and login/collection states.
- [ ] Restart the hidden server and verify `/api/health`.
- [ ] Commit and push the verified change.
