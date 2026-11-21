import assert from 'node:assert/strict';
import test from 'node:test';

import { diagnoseCollectors, runCli } from '../src/cli.mjs';
import { collectAll } from '../src/collect.mjs';
import { initSchema, openDatabase, saveCollection } from '../src/db.mjs';

function createDatabase() {
  const db = openDatabase(':memory:');
  initSchema(db);
  return db;
}

function collection(platform, overrides = {}) {
  return {
    account: { platformAccountId: `${platform}-account`, displayName: platform, avatarUrl: null },
    accountSnapshot: { followers: 10, following: null, likesReceived: null },
    posts: [{
      postId: `${platform}-post`,
      title: `${platform} title`,
      url: null,
      coverUrl: null,
      publishedAt: '2026-11-19T08:00:00.000Z'
    }],
    metrics: [{
      postId: `${platform}-post`, views: 100, likes: 5, comments: 1, favorites: null, shares: null
    }],
    reportedTotal: 1,
    partial: false,
    warnings: [],
    ...overrides
  };
}

test('collectAll runs collectors concurrently and records successful runs', async () => {
  const db = createDatabase();
  let active = 0;
  let maximumActive = 0;
  const collector = platform => ({
    platform,
    checkLogin: async () => ({ ok: true }),
    collect: async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      return collection(platform);
    }
  });

  const results = await collectAll({
    db,
    context: {},
    collectors: [collector('douyin'), collector('xiaohongshu')],
    now: new Date('2026-11-20T10:00:00+08:00'),
    delayMs: 0
  });

  assert.equal(maximumActive, 2);
  assert.deepEqual(results.map(({ status }) => status), ['success', 'success']);
  assert.deepEqual(
    db.prepare('SELECT platform, status FROM collector_runs ORDER BY id').all()
      .map(({ platform, status }) => [platform, status]),
    [
      ['douyin', 'success'],
      ['xiaohongshu', 'success']
    ]
  );
});

test('collectAll isolates platform errors and keeps later collectors running', async () => {
  const db = createDatabase();
  const results = await collectAll({
    db,
    context: {},
    collectors: [
      {
        platform: 'douyin',
        checkLogin: async () => ({ ok: true }),
        collect: async () => { throw new Error('private token must not appear: abc123'); }
      },
      {
        platform: 'channels',
        checkLogin: async () => ({ ok: true }),
        collect: async () => collection('channels', {
          partial: true,
          reportedTotal: 8,
          warnings: ['作品列表未完整获取']
        })
      }
    ],
    now: new Date('2026-11-20T10:00:00+08:00'),
    delayMs: 0
  });

  assert.deepEqual(results.map(({ status }) => status), ['error', 'partial']);
  const runs = db.prepare('SELECT status, error FROM collector_runs ORDER BY id').all();
  assert.equal(runs[0].status, 'error');
  assert.equal(runs[0].error.includes('abc123'), false);
  assert.equal(runs[1].status, 'partial');
  assert.equal(runs[1].error, '作品列表未完整获取');
});

test('collectAll records needs_login without replacing existing data', async () => {
  const db = createDatabase();
  saveCollection(db, { platform: 'douyin', ...collection('douyin') }, new Date('2026-11-19T10:00:00+08:00'));
  let collected = false;

  const results = await collectAll({
    db,
    context: {},
    collectors: [{
      platform: 'douyin',
      checkLogin: async () => ({ ok: false, reason: 'login expired token=abc123' }),
      collect: async () => { collected = true; }
    }],
    now: new Date('2026-11-20T10:00:00+08:00'),
    delayMs: 0
  });

  assert.equal(collected, false);
  assert.equal(results[0].status, 'needs_login');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM platform_posts').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM metric_snapshots').get().count, 1);
  assert.equal(db.prepare('SELECT error FROM collector_runs').get().error.includes('abc123'), false);
});

test('runCli dispatches known commands and rejects unknown commands', async () => {
  const called = [];
  const output = [];
  const commands = Object.fromEntries(
    ['login', 'collect', 'doctor', 'serve'].map(command => [command, async () => { called.push(command); }])
  );

  for (const command of Object.keys(commands)) {
    assert.equal(await runCli([command], { commands, write: line => output.push(line) }), 0);
  }
  assert.equal(await runCli(['publish'], { commands, write: line => output.push(line) }), 2);
  assert.deepEqual(called, ['login', 'collect', 'doctor', 'serve']);
  assert.match(output.at(-1), /Usage:/);
});

test('runCli propagates an integer command exit code', async () => {
  const commands = {
    login: async () => 0,
    collect: async () => 1,
    doctor: async () => 0,
    serve: async () => 0
  };

  assert.equal(await runCli(['collect'], { commands }), 1);
});

test('diagnoseCollectors isolates platform errors and marks login expiry', async () => {
  const statuses = await diagnoseCollectors({
    context: {},
    collectors: [
      { platform: 'douyin', checkLogin: async () => { throw new Error('secret token'); } },
      { platform: 'channels', checkLogin: async () => ({ ok: false, reason: 'Login required' }) }
    ]
  });

  assert.deepEqual(statuses, [
    { platform: 'douyin', ok: false, reason: 'Check failed' },
    { platform: 'channels', ok: false, reason: 'Login required' }
  ]);
});
