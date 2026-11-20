import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { openPersistentBrowser } from './browser.mjs';
import { collectAll, defaultCollectors } from './collect.mjs';
import { config } from './config.mjs';
import { createCoverStore } from './covers.mjs';
import { getContents, getOverview, initSchema, openDatabase } from './db.mjs';

export function createServer({
  db,
  runCollection,
  coverStore = createCoverStore({ cacheDir: path.join(config.dataDir, 'covers') }),
  webRoot = path.join(config.projectRoot, 'src', 'web')
}) {
  let collecting = false;

  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/api/health') {
        return sendJson(response, 200, getHealth(db));
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
        if (collecting) return sendJson(response, 409, { code: 'already_running' });
        collecting = true;
        try {
          return sendJson(response, 200, { ok: true, results: await runCollection() });
        } finally {
          collecting = false;
        }
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
}

export async function startServer({
  db = openDatabase(config.databasePath),
  host = config.host,
  port = config.port,
  runCollection,
  coverStore,
  webRoot,
  write = line => console.log(line)
} = {}) {
  initSchema(db);
  const collect = runCollection ?? (() => collectWithBrowser(db));
  const server = createServer({ db, runCollection: collect, coverStore, webRoot });
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

function getHealth(db) {
  const rows = db.prepare(`
    SELECT platform, status, finished_at, partial, error
    FROM collector_runs runs
    WHERE id = (SELECT MAX(latest.id) FROM collector_runs latest WHERE latest.platform = runs.platform)
    ORDER BY platform
  `).all();
  return {
    ok: true,
    lastCollectedAt: rows.map(row => row.finished_at).filter(Boolean).sort().at(-1) ?? null,
    platforms: rows.map(row => ({
      platform: row.platform,
      status: row.status,
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
