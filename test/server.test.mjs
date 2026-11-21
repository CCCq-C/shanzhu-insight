import assert from 'node:assert/strict';
import test from 'node:test';

import { initSchema, openDatabase, saveCollection } from '../src/db.mjs';
import { startServer } from '../src/server.mjs';

test('server binds to loopback and serves no-store JSON APIs', async t => {
  const db = seededDatabase();
  const server = await startServer({ db, port: 0, write: () => {} });
  t.after(() => close(server));
  const address = server.address();

  assert.equal(address.address, '127.0.0.1');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^application\/json/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).ok, true);
});

test('overview and content APIs expose stored data and platform filters', async t => {
  const db = seededDatabase();
  const server = await startServer({ db, port: 0, write: () => {} });
  t.after(() => close(server));
  const base = `http://127.0.0.1:${server.address().port}`;

  const overview = await fetch(`${base}/api/overview`).then(response => response.json());
  const contents = await fetch(`${base}/api/contents?platform=xiaohongshu`).then(response => response.json());

  assert.equal(overview.totalFollowers, 30);
  assert.equal(overview.platforms.length, 2);
  assert.equal(overview.platforms.find(row => row.platform === 'xiaohongshu').history.length, 1);
  assert.deepEqual(
    overview.latestContent.posts.map(post => post.platform).sort(),
    ['douyin', 'xiaohongshu']
  );
  assert.equal(overview.recentContents.length, 1);
  assert.equal(contents.length, 1);
  assert.deepEqual(
    contents[0].posts.map(post => post.platform).sort(),
    ['douyin', 'xiaohongshu']
  );
  assert.equal(contents[0].posts.find(post => post.platform === 'xiaohongshu').metrics.views, 200);
});

test('content detail API exposes current platform metrics and history', async t => {
  const server = await startServer({ db: seededDatabase(), port: 0, write: () => {} });
  t.after(() => close(server));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/contents/1`);
  const detail = await response.json();

  assert.equal(response.status, 200);
  assert.equal(detail.id, 1);
  assert.deepEqual(detail.posts.map(post => post.platform).sort(), ['douyin', 'xiaohongshu']);
  assert.equal(detail.posts.every(post => post.history.length === 1), true);
});

test('content detail API returns 404 for invalid and missing IDs', async t => {
  const server = await startServer({ db: seededDatabase(), port: 0, write: () => {} });
  t.after(() => close(server));
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const path of ['/api/contents/not-a-number', '/api/contents/999']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { code: 'not_found' });
  }
});

test('unknown routes return JSON 404 without exposing filesystem paths', async t => {
  const server = await startServer({ db: seededDatabase(), port: 0, write: () => {} });
  t.after(() => close(server));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/../../package.json`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { code: 'not_found' });
});

test('state-changing APIs reject requests without the local request marker', async t => {
  let called = false;
  const server = await startServer({
    db: seededDatabase(),
    port: 0,
    write: () => {},
    runCollection: async () => { called = true; return []; }
  });
  t.after(() => close(server));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/collect`, {
    method: 'POST',
    headers: { Origin: 'https://attacker.example' }
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { code: 'forbidden_request' });
  assert.equal(called, false);
});

test('state-changing APIs reject a mismatched browser origin', async t => {
  let called = false;
  const server = await startServer({
    db: seededDatabase(),
    port: 0,
    write: () => {},
    runCollection: async () => { called = true; return []; }
  });
  t.after(() => close(server));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/collect`, {
    method: 'POST',
    headers: {
      Origin: 'https://attacker.example',
      'X-ShanZhu-Request': '1'
    }
  });

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { code: 'forbidden_request' });
  assert.equal(called, false);
});

test('cover route loads only the database URL for the requested post identity', async t => {
  const requested = [];
  const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const server = await startServer({
    db: seededDatabase(),
    port: 0,
    write: () => {},
    coverStore: {
      getCover: async input => {
        requested.push(input);
        return { buffer: image, contentType: 'image/png', placeholder: false };
      }
    }
  });
  t.after(() => close(server));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/covers/douyin/douyin-post?url=https://attacker.test/a`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.deepEqual(requested, [{
    platform: 'douyin',
    postId: 'douyin-post',
    url: 'https://example.test/douyin.jpg'
  }]);
});

test('a concurrent collect request receives 409 already_running', async t => {
  let start;
  let release;
  const started = new Promise(resolve => { start = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const server = await startServer({
    db: seededDatabase(),
    port: 0,
    write: () => {},
    runCollection: async () => {
      start();
      await gate;
      return [{ platform: 'douyin', status: 'success' }];
    }
  });
  t.after(() => close(server));
  const url = `http://127.0.0.1:${server.address().port}/api/collect`;

  const first = localPost(url);
  await started;
  const second = await localPost(url);
  assert.equal(second.status, 409);
  assert.deepEqual(await second.json(), { code: 'already_running' });
  release();
  assert.equal((await first).status, 200);
});

test('server schedules collection and reports the next run', async t => {
  let collections = 0;
  const server = await startServer({
    db: seededDatabase(),
    port: 0,
    write: () => {},
    collectionIntervalMs: 20,
    runCollection: async () => { collections += 1; return []; }
  });
  t.after(() => close(server));
  const base = `http://127.0.0.1:${server.address().port}`;

  await waitFor(() => collections >= 1);
  const health = await fetch(`${base}/api/health`).then(response => response.json());

  assert.ok(collections >= 1);
  assert.match(health.nextCollectionAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('platform login runs in background and blocks concurrent collection', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const server = await startServer({
    db: seededDatabase(),
    port: 0,
    write: () => {},
    runCollection: async () => [],
    runLogin: async () => { await gate; return { platform: 'douyin', status: 'success' }; }
  });
  t.after(() => close(server));
  const base = `http://127.0.0.1:${server.address().port}`;

  const started = await localPost(`${base}/api/login/douyin`);
  assert.equal(started.status, 202);
  assert.deepEqual(await started.json(), { ok: true, platform: 'douyin', status: 'running' });

  const running = await fetch(`${base}/api/health`).then(response => response.json());
  assert.equal(running.job.type, 'login');
  assert.equal(running.job.platform, 'douyin');
  assert.equal(running.logins.find(login => login.platform === 'douyin').status, 'running');

  const blocked = await localPost(`${base}/api/collect`);
  assert.equal(blocked.status, 409);
  assert.deepEqual(await blocked.json(), { code: 'already_running' });

  release();
  await waitFor(async () => {
    const health = await fetch(`${base}/api/health`).then(response => response.json());
    return health.logins.find(login => login.platform === 'douyin')?.status === 'success';
  });
});

test('login API rejects unsupported platforms without starting a job', async t => {
  let called = false;
  const server = await startServer({
    db: seededDatabase(),
    port: 0,
    write: () => {},
    runLogin: async () => { called = true; }
  });
  t.after(() => close(server));
  const response = await localPost(`http://127.0.0.1:${server.address().port}/api/login/unknown`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { code: 'unsupported_platform' });
  assert.equal(called, false);
});

test('login API records synchronous login failures without exposing error details', async t => {
  const server = await startServer({
    db: seededDatabase(),
    port: 0,
    write: () => {},
    runLogin: () => { throw new Error('cookie=private'); }
  });
  t.after(() => close(server));
  const base = `http://127.0.0.1:${server.address().port}`;

  const response = await localPost(`${base}/api/login/channels`);
  assert.equal(response.status, 202);
  await waitFor(async () => {
    const health = await fetch(`${base}/api/health`).then(result => result.json());
    return health.logins.find(login => login.platform === 'channels')?.status === 'error';
  });
  const health = await fetch(`${base}/api/health`).then(result => result.json());

  assert.equal(health.job, null);
  assert.equal(health.logins.find(login => login.platform === 'channels').error, 'Login failed');
  assert.doesNotMatch(JSON.stringify(health), /cookie=private/);
});

function seededDatabase() {
  const db = openDatabase(':memory:');
  initSchema(db);
  saveCollection(db, collection('douyin', 10, 100), new Date('2026-11-20T10:00:00+08:00'));
  saveCollection(db, collection('xiaohongshu', 20, 200), new Date('2026-11-20T10:05:00+08:00'));
  return db;
}

function collection(platform, followers, views) {
  return {
    platform,
    account: { platformAccountId: `${platform}-account`, displayName: platform, avatarUrl: null },
    accountSnapshot: { followers, following: null, likesReceived: null },
    posts: [{
      postId: `${platform}-post`,
      title: `${platform} title`,
      url: null,
      coverUrl: `https://example.test/${platform}.jpg`,
      publishedAt: '2026-11-19T08:00:00.000Z'
    }],
    metrics: [{
      postId: `${platform}-post`, views, likes: 10, comments: 2, favorites: null, shares: 1
    }],
    reportedTotal: 1,
    partial: false,
    warnings: []
  };
}

function close(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

function localPost(url, options = {}) {
  return fetch(url, {
    ...options,
    method: 'POST',
    headers: {
      Origin: new URL(url).origin,
      'X-ShanZhu-Request': '1',
      ...options.headers
    }
  });
}

async function waitFor(predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition');
}
