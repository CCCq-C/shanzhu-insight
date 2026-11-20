import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { openPersistentBrowser } from './browser.mjs';
import { collectAll, defaultCollectors } from './collect.mjs';
import { config } from './config.mjs';
import { createCoverStore } from './covers.mjs';
import { getContents, getOverview, initSchema, openDatabase } from './db.mjs';
import { loginToPlatform } from './login.mjs';

const DEFAULT_COLLECTION_INTERVAL_MS = 15 * 60 * 1000;
const LOGIN_PLATFORMS = new Set(defaultCollectors.map(collector => collector.platform));

export function createServer({
  db,
  runCollection,
  runLogin,
  collectionIntervalMs = DEFAULT_COLLECTION_INTERVAL_MS,
  now = Date.now,
  coverStore = createCoverStore({ cacheDir: path.join(config.dataDir, 'covers') }),
  webRoot = path.join(config.projectRoot, 'src', 'web')
}) {
  let job = null;
  const logins = new Map();
  let nextCollectionAt = new Date(now() + collectionIntervalMs).toISOString();

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/api/health') {
        return sendJson(response, 200, getHealth(db, { job, nextCollectionAt, logins }));
      }
      if (request.method === 'GET' && url.pathname === '/api/overview') {
        return sendJson(response, 200, getOverview(db));
      }
      if (request.method === 'GET' && url.pathname === '/api/contents') {
        return sendJson(response, 200, getContents(db, {
          platform: url.searchParams.get('platform') || undefined,
          from: url.searchParams.get('from') || undefined,
          to: url.searchParams.get('to') || undefined
        }));
      }
      if (request.method === 'POST' && url.pathname === '/api/collect') {
        if (job) return sendJson(response, 409, { code: 'already_running' });
        return sendJson(response, 200, { ok: true, results: await collect() });
      }
      const loginMatch = request.method === 'POST' && url.pathname.match(/^\/api\/login\/([a-z][a-z0-9_-]{0,31})$/);
      if (loginMatch) {
        const platform = loginMatch[1];
        if (!LOGIN_PLATFORMS.has(platform)) return sendJson(response, 404, { code: 'unsupported_platform' });
        if (job) return sendJson(response, 409, { code: 'already_running' });
        startLogin(platform);
        return sendJson(response, 202, { ok: true, platform, status: 'running' });
      }
      const coverMatch = request.method === 'GET'
        && url.pathname.match(/^\/covers\/([a-z][a-z0-9_-]{0,31})\/([A-Za-z0-9_-]{1,200})$/);
      if (coverMatch) {
        const row = db.prepare(`
          SELECT cover_url FROM platform_posts WHERE platform = ? AND post_id = ?
        `).get(coverMatch[1], coverMatch[2]);
        const cover = await coverStore.getCover({
          platform: coverMatch[1],
          postId: coverMatch[2],
          url: row?.cover_url
        });
        response.writeHead(200, {
          'Content-Type': cover.contentType,
          'Cache-Control': cover.placeholder ? 'no-store' : 'private, max-age=86400',
          'Content-Length': cover.buffer.length
        });
        return response.end(cover.buffer);
      }
      const staticFile = staticPath(url.pathname, webRoot);
      if (request.method === 'GET' && staticFile && fs.existsSync(staticFile.path)) {
        const body = fs.readFileSync(staticFile.path);
        response.writeHead(200, {
          'Content-Type': staticFile.contentType,
          'Content-Length': body.length
        });
        return response.end(body);
      }
      return sendJson(response, 404, { code: 'not_found' });
    } catch {
      return sendJson(response, 500, { code: 'internal_error' });
    }
  });

  const timer = setInterval(() => {
    nextCollectionAt = new Date(now() + collectionIntervalMs).toISOString();
    if (!job) void collect().catch(() => {});
  }, collectionIntervalMs);
  timer.unref?.();
  server.once('close', () => clearInterval(timer));
  return server;

  async function collect() {
    job = { type: 'collect', platform: null, startedAt: new Date(now()).toISOString() };
    try {
      return await runCollection();
    } finally {
      job = null;
    }
  }

  function startLogin(platform) {
    const startedAt = new Date(now()).toISOString();
    job = { type: 'login', platform, startedAt };
    logins.set(platform, { platform, status: 'running', startedAt, finishedAt: null, error: null });
    void Promise.resolve().then(() => runLogin(platform)).then(() => {
      logins.set(platform, { platform, status: 'success', startedAt, finishedAt: new Date(now()).toISOString(), error: null });
    }).catch(() => {
      logins.set(platform, { platform, status: 'error', startedAt, finishedAt: new Date(now()).toISOString(), error: 'Login failed' });
    }).finally(() => {
      job = null;
    });
  }
}

export async function startServer({
  db = openDatabase(config.databasePath),
  host = config.host,
  port = config.port,
  runCollection,
  runLogin = loginToPlatform,
  collectionIntervalMs = DEFAULT_COLLECTION_INTERVAL_MS,
  now = Date.now,
  coverStore,
  webRoot,
  write = line => console.log(line)
} = {}) {
  initSchema(db);
  const collect = runCollection ?? (() => collectWithBrowser(db));
  const server = createServer({ db, runCollection: collect, runLogin, collectionIntervalMs, now, coverStore, webRoot });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  write(`shanzhu-insight: http://${host}:${address.port}`);
  return server;
}

async function collectWithBrowser(db) {
  const browser = await openPersistentBrowser();
  try {
    return await collectAll({ db, context: browser.context, collectors: defaultCollectors });
  } finally {
    await browser.close();
  }
}

function getHealth(db, { job, nextCollectionAt, logins }) {
  const rows = db.prepare(`
    SELECT platform, status, started_at, finished_at, partial, error
    FROM collector_runs runs
    WHERE id = (SELECT MAX(latest.id) FROM collector_runs latest WHERE latest.platform = runs.platform)
    ORDER BY platform
  `).all();
  return {
    ok: true,
    job,
    nextCollectionAt,
    logins: [...logins.values()].sort((left, right) => left.platform.localeCompare(right.platform)),
    lastCollectedAt: rows.map(row => row.finished_at).filter(Boolean).sort().at(-1) ?? null,
    platforms: rows.map(row => ({
      platform: row.platform,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      partial: Boolean(row.partial),
      error: row.error
    }))
  };
}

function staticPath(pathname, webRoot) {
  const routes = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/content': ['content.html', 'text/html; charset=utf-8'],
    '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
    '/content.js': ['content.js', 'text/javascript; charset=utf-8'],
    '/shared.js': ['shared.js', 'text/javascript; charset=utf-8'],
    '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
    '/vendor/echarts.min.js': [path.join(config.projectRoot, 'node_modules', 'echarts', 'dist', 'echarts.min.js'), 'text/javascript; charset=utf-8']
  };
  const route = routes[pathname];
  if (!route) return null;
  return {
    path: path.isAbsolute(route[0]) ? route[0] : path.join(webRoot, route[0]),
    contentType: route[1]
  };
}

function sendJson(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': body.length
  });
  response.end(body);
}
