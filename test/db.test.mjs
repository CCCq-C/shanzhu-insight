import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getContents,
  getOverview,
  initSchema,
  openDatabase,
  pairContent,
  saveCollection
} from '../src/db.mjs';

function createDatabase() {
  const db = openDatabase(':memory:');
  initSchema(db);
  return db;
}

function result(overrides = {}) {
  return {
    platform: 'douyin',
    account: {
      platformAccountId: 'account-1',
      displayName: 'Creator',
      avatarUrl: 'https://example.test/avatar.jpg'
    },
    accountSnapshot: {
      followers: 100,
      following: null,
      likesReceived: 1200
    },
    posts: [{
      postId: 'post-1',
      title: '同一个选题',
      url: 'https://example.test/post-1',
      coverUrl: 'https://example.test/cover.jpg',
      publishedAt: '2026-11-18T08:00:00.000Z'
    }],
    metrics: [{
      postId: 'post-1',
      views: 1000,
      likes: 50,
      comments: 4,
      favorites: null,
      shares: 2
    }],
    reportedTotal: 1,
    partial: false,
    warnings: [],
    ...overrides
  };
}

test('initSchema creates exactly the six business tables', () => {
  const db = createDatabase();
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map(({ name }) => name);

  assert.deepEqual(tables, [
    'account_snapshots',
    'accounts',
    'collector_runs',
    'contents',
    'metric_snapshots',
    'platform_posts'
  ]);
});

test('saveCollection updates same-day snapshots instead of duplicating them', () => {
  const db = createDatabase();
  saveCollection(db, result(), new Date('2026-11-20T01:00:00+08:00'));
  saveCollection(db, result({
    accountSnapshot: { followers: 105, following: null, likesReceived: 1250 },
    metrics: [{
      postId: 'post-1', views: 1100, likes: 55, comments: 5, favorites: null, shares: 3
    }]
  }), new Date('2026-11-20T23:00:00+08:00'));

  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM account_snapshots').get().count, 1);
  assert.equal(db.prepare('SELECT followers FROM account_snapshots').get().followers, 105);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM metric_snapshots').get().count, 1);
  assert.equal(db.prepare('SELECT views FROM metric_snapshots').get().views, 1100);
});

test('saveCollection preserves unavailable metrics as NULL', () => {
  const db = createDatabase();
  saveCollection(db, result(), new Date('2026-11-20T10:00:00+08:00'));

  const row = db.prepare('SELECT favorites FROM metric_snapshots').get();
  assert.equal(row.favorites, null);
});

test('getOverview totals the latest follower snapshot from each platform', () => {
  const db = createDatabase();
  saveCollection(db, result(), new Date('2026-11-20T10:00:00+08:00'));
  saveCollection(db, result({
    platform: 'xiaohongshu',
    account: {
      platformAccountId: 'account-2', displayName: 'Creator', avatarUrl: null
    },
    accountSnapshot: { followers: 40, following: null, likesReceived: null },
    posts: [],
    metrics: []
  }), new Date('2026-11-20T10:05:00+08:00'));

  assert.equal(getOverview(db, new Date('2026-11-20T12:00:00+08:00')).totalFollowers, 140);
});

test('pairContent groups exact normalized titles published within 72 hours', () => {
  const db = createDatabase();
  const first = pairContent(db, {
    title: 'AI 产品经理：快速入门！',
    coverUrl: null,
    publishedAt: '2026-11-18T08:00:00.000Z'
  });
  const second = pairContent(db, {
    title: 'ＡＩ产品经理 快速入门',
    coverUrl: null,
    publishedAt: '2026-11-20T08:00:00.000Z'
  });

  assert.equal(second, first);
});

test('pairContent keeps matching titles separate outside 72 hours', () => {
  const db = createDatabase();
  const first = pairContent(db, {
    title: '同一个选题',
    coverUrl: null,
    publishedAt: '2026-11-01T08:00:00.000Z'
  });
  const second = pairContent(db, {
    title: '同一个选题',
    coverUrl: null,
    publishedAt: '2026-11-05T08:00:01.000Z'
  });

  assert.notEqual(second, first);
  assert.equal(getContents(db, {}).length, 2);
});
