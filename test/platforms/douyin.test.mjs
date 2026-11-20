import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  collectDouyin,
  douyinCollector,
  parseDouyinAccount,
  parseDouyinWorkList
} from '../../src/platforms/douyin.mjs';

const workFixture = readFixture('douyin-work-list.json');
const accountFixture = readFixture('douyin-account.json');

test('parseDouyinWorkList maps structured work metrics and cursor pagination', () => {
  const result = parseDouyinWorkList(workFixture);

  assert.equal(result.reportedTotal, 3);
  assert.equal(result.hasMore, true);
  assert.equal(result.cursor, 'cursor-2');
  assert.deepEqual(result.posts[0], {
    postId: 'dy-001',
    title: 'AI 产品经理快速入门',
    url: 'https://www.douyin.com/video/dy-001',
    coverUrl: 'https://example.test/douyin/cover-001.jpg',
    publishedAt: '2026-11-18T08:00:00.000Z'
  });
  assert.deepEqual(result.metrics[0], {
    postId: 'dy-001',
    views: 1200,
    likes: 80,
    comments: 12,
    favorites: 35,
    shares: 9
  });
});

test('parseDouyinWorkList preserves absent metrics as null', () => {
  const result = parseDouyinWorkList(workFixture);

  assert.deepEqual(result.metrics[1], {
    postId: 'dy-002',
    views: 400,
    likes: 20,
    comments: 3,
    favorites: null,
    shares: null
  });
});

test('parseDouyinAccount maps the owner account without storing private payloads', () => {
  assert.deepEqual(parseDouyinAccount([accountFixture.userInfo, accountFixture.overview]), {
    account: {
      platformAccountId: 'dy-account-001',
      displayName: '示例创作者',
      avatarUrl: 'https://example.test/douyin/avatar.jpg'
    },
    accountSnapshot: {
      followers: 128,
      following: 18,
      likesReceived: 2400
    }
  });
});

test('collectDouyin captures the first response and fetches later cursor pages in page context', async () => {
  const secondPage = {
    status_code: 0,
    total: 3,
    has_more: false,
    max_cursor: 'cursor-3',
    items: [{
      id: 'dy-003',
      description: '第三条作品',
      create_time: 1794816000,
      cover: { url_list: ['https://example.test/douyin/cover-003.jpg'] },
      metrics: { view_count: 300, like_count: 10, comment_count: 1, favorite_count: 2, share_count: 1 }
    }],
    aweme_list: []
  };
  const { context, requestedUrls } = fakeContext({ secondPage });

  const result = await collectDouyin({
    context,
    since: new Date('2026-11-01T00:00:00.000Z'),
    limit: 3,
    now: new Date('2026-11-20T00:00:00.000Z')
  });

  assert.equal(result.posts.length, 3);
  assert.equal(result.partial, false);
  assert.equal(requestedUrls.some(url => url.includes('max_cursor=cursor-2')), true);
  assert.equal(result.accountSnapshot.followers, 128);
});

test('collectDouyin stops at 100 items and marks the result partial', async () => {
  const many = structuredClone(workFixture);
  many.total = 101;
  many.has_more = true;
  many.items = Array.from({ length: 100 }, (_, index) => ({
    id: `dy-${String(index).padStart(3, '0')}`,
    description: `作品 ${index}`,
    create_time: 1794988800 - index,
    cover: { url_list: [] },
    metrics: { view_count: index }
  }));
  many.aweme_list = [];
  const { context, requestedUrls } = fakeContext({ firstPage: many });

  const result = await collectDouyin({
    context,
    since: new Date('2026-11-01T00:00:00.000Z'),
    limit: 100,
    now: new Date('2026-11-20T00:00:00.000Z')
  });

  assert.equal(result.posts.length, 100);
  assert.equal(result.partial, true);
  assert.equal(requestedUrls.filter(url => url.includes('/work_list')).length, 0);
});

test('douyinCollector reports login redirects', async () => {
  const page = {
    goto: async () => {},
    url: () => 'https://creator.douyin.com/login',
    close: async () => {}
  };

  assert.deepEqual(await douyinCollector.checkLogin({
    context: { newPage: async () => page }
  }), { ok: false, reason: 'Login required' });
});

function fakeContext({ firstPage = workFixture, secondPage } = {}) {
  const requestedUrls = [];
  const firstUrl = 'https://creator.douyin.com/janus/douyin/creator/pc/work_list?status=0&count=40&max_cursor=0';
  const response = {
    url: () => firstUrl,
    json: async () => structuredClone(firstPage)
  };
  const page = {
    waitForResponse: async predicate => {
      assert.equal(predicate(response), true);
      return response;
    },
    goto: async () => {},
    evaluate: async (_function, url) => {
      requestedUrls.push(url);
      if (url.includes('/web/api/media/user/info/')) return structuredClone(accountFixture.userInfo);
      if (url.includes('/overview/all/')) return structuredClone(accountFixture.overview);
      if (url.includes('/work_list') && secondPage) return structuredClone(secondPage);
      throw new Error(`Unexpected URL: ${url}`);
    },
    close: async () => {}
  };
  return {
    context: { newPage: async () => page },
    requestedUrls
  };
}

function readFixture(name) {
  return JSON.parse(fs.readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
}
