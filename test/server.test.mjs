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

test('unknown routes return JSON 404 without exposing filesystem paths', async t => {
  const server = await startServer({ db: seededDatabase(), port: 0, write: () => {} });
  t.after(() => close(server));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/../../package.json`);

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { code: 'not_found' });
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

  const first = fetch(url, { method: 'POST' });
  await started;
  const second = await fetch(url, { method: 'POST' });
  assert.equal(second.status, 409);
  assert.deepEqual(await second.json(), { code: 'already_running' });
  release();
  assert.equal((await first).status, 200);
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
