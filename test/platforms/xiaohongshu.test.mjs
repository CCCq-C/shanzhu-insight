import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  collectXiaohongshu,
  parseXiaohongshuFans,
  parseXiaohongshuPosted,
  xiaohongshuCollector
} from '../../src/platforms/xiaohongshu.mjs';

const postedFixture = readFixture('xiaohongshu-posted.json');
const fansFixture = readFixture('xiaohongshu-fans.json');
const analysisFixture = readFixture('xiaohongshu-analysis.json');

test('parseXiaohongshuPosted maps note identity, cover, publish time, and metrics', () => {
  const result = parseXiaohongshuPosted(postedFixture, analysisFixture);

  assert.equal(result.hasMore, true);
  assert.equal(result.nextPage, 2);
  assert.deepEqual(result.posts[0], {
    postId: 'xhs-001',
    title: 'AI 产品经理快速入门',
    url: 'https://www.xiaohongshu.com/explore/xhs-001',
    coverUrl: 'https://example.test/xhs/cover-001.jpg',
    publishedAt: '2026-11-18T08:00:00.000Z'
  });
  assert.deepEqual(result.metrics[0], {
    postId: 'xhs-001',
    views: 900,
    likes: 60,
    comments: 8,
    favorites: 22,
    shares: 6,
    durationSeconds: 42,
    averageWatchSeconds: 16,
    completionRate: null,
    fiveSecondCompletionRate: null,
    twoSecondBounceRate: null,
    impressions: 2400,
    coverClickRate: 0.125,
    followersGained: 7
  });
});

test('parseXiaohongshuPosted preserves absent metrics as null', () => {
  assert.deepEqual(parseXiaohongshuPosted(postedFixture).metrics[1], {
    postId: 'xhs-002',
    views: 300,
    likes: 18,
    comments: 2,
    favorites: null,
    shares: null,
    durationSeconds: null,
    averageWatchSeconds: null,
    completionRate: null,
    fiveSecondCompletionRate: null,
    twoSecondBounceRate: null,
    impressions: null,
    coverClickRate: null,
    followersGained: null
  });
});

test('parseXiaohongshuFans combines account identity and follower total', () => {
  assert.deepEqual(parseXiaohongshuFans([fansFixture.userInfo, fansFixture.fans]), {
    account: {
      platformAccountId: 'xhs-account-001',
      displayName: '示例创作者',
      avatarUrl: 'https://example.test/xhs/avatar.jpg'
    },
    accountSnapshot: {
      followers: 50,
      following: null,
      likesReceived: null
    },
    accountHistory: [
      { date: '2026-11-19', followers: 48 },
      { date: '2026-11-20', followers: 50 }
    ]
  });
});

test('parseXiaohongshuFans keeps Beijing dates for numeric history timestamps', () => {
  const fixture = structuredClone(fansFixture);
  fixture.fans.data.thirty.fans_list = [{
    date: Date.parse('2026-11-18T16:00:00.000Z'),
    count: 48
  }];

  assert.equal(parseXiaohongshuFans([fixture.userInfo, fixture.fans]).accountHistory[0].date, '2026-11-19');
});

test('collectXiaohongshu captures first response and follows the returned page cursor', async () => {
  const secondPage = {
    code: 0,
    success: true,
    data: {
      page: -1,
      notes: [{
        id: 'xhs-003',
        display_title: '第三篇笔记',
        visible_time: 1794816000,
        images_list: [{ url: 'https://example.test/xhs/cover-003.jpg' }],
        view_count: 200,
        likes: 9,
        comments_count: 1,
        collected_count: 3,
        shared_count: 1
      }]
    }
  };
  const analysisPayload = structuredClone(analysisFixture);
  analysisPayload.data.note_infos.push({ id: 'xhs-003', read_count: 200, view_time_avg: 10 });
  const { context, requestedUrls } = fakeContext({ secondPage, analysisPayload });

  const result = await collectXiaohongshu({
    context,
    since: new Date('2026-11-01T00:00:00.000Z'),
    limit: 100,
    now: new Date('2026-11-20T00:00:00.000Z')
  });

  assert.equal(result.posts.length, 3);
  assert.equal(result.partial, false);
  assert.equal(requestedUrls.some(url => url.includes('page=2')), true);
  assert.equal(result.accountSnapshot.followers, 50);
  assert.equal(result.metrics[0].averageWatchSeconds, 16);
  assert.equal(result.metrics.find(metric => metric.postId === 'xhs-003').averageWatchSeconds, 10);
});

test('collectXiaohongshu captures signed analysis pagination without replaying the protected URL', async () => {
  const firstPage = structuredClone(postedFixture);
  firstPage.data.page = -1;
  const analysisPageOne = structuredClone(analysisFixture);
  analysisPageOne.data.total = 3;
  analysisPageOne.data.note_infos.push({
    id: 'xhs-002',
    title: '第二篇笔记',
    post_time: 1794902400,
    cover_url: 'https://example.test/xhs/cover-002.jpg',
    read_count: 300,
    view_time_avg: 8
  });
  const analysisPageTwo = {
    code: 0,
    success: true,
    data: {
      total: 3,
      note_infos: [{
        id: 'xhs-003',
        title: '第三篇笔记',
        post_time: 1794816000,
        cover_url: 'https://example.test/xhs/cover-003.jpg',
        read_count: 200,
        view_time_avg: 10,
        increase_fans_count: 2
      }]
    }
  };
  const { context, requestedUrls } = fakeContext({
    firstPage,
    analysisPages: [analysisPageOne, analysisPageTwo],
    analysisReplayError: new Error('HTTP 406')
  });

  const result = await collectXiaohongshu({
    context,
    since: new Date('2026-11-01T00:00:00.000Z'),
    limit: 100,
    now: new Date('2026-11-20T00:00:00.000Z')
  });

  assert.equal(result.posts.length, 3);
  assert.equal(result.partial, false);
  assert.equal(result.warnings.includes('内容深度指标暂不可用'), false);
  assert.equal(result.metrics.find(metric => metric.postId === 'xhs-003').averageWatchSeconds, 10);
  assert.equal(requestedUrls.some(url => url.includes('/note/analyze/list')), false);
});

test('collectXiaohongshu stops at 100 items and marks remaining pages partial', async () => {
  const many = structuredClone(postedFixture);
  many.data.page = 3;
  many.data.notes = Array.from({ length: 100 }, (_, index) => ({
    id: `xhs-${String(index).padStart(3, '0')}`,
    display_title: `笔记 ${index}`,
    visible_time: 1794988800 - index,
    images_list: [],
    view_count: index,
    likes: 0,
    comments_count: 0
  }));
  const { context, requestedUrls } = fakeContext({ firstPage: many });

  const result = await collectXiaohongshu({
    context,
    since: new Date('2026-11-01T00:00:00.000Z'),
    limit: 100,
    now: new Date('2026-11-20T00:00:00.000Z')
  });

  assert.equal(result.posts.length, 100);
  assert.equal(result.partial, true);
  assert.equal(requestedUrls.filter(url => url.includes('/note/user/posted')).length, 0);
});

test('collectXiaohongshu keeps the first page when protected pagination is rejected', async () => {
  const { context } = fakeContext({ paginationError: new Error('HTTP 406') });

  const result = await collectXiaohongshu({
    context,
    since: new Date('2026-11-01T00:00:00.000Z'),
    limit: 20,
    now: new Date('2026-11-20T00:00:00.000Z')
  });

  assert.equal(result.posts.length, postedFixture.data.notes.length);
  assert.equal(result.partial, true);
  assert.deepEqual(result.warnings, ['笔记后续分页请求被平台拒绝']);
});

test('collectXiaohongshu skips protected legacy pagination when signed analysis is complete', async () => {
  const analysisPayload = {
    code: 0,
    success: true,
    data: {
      total: 2,
      note_infos: postedFixture.data.notes.map(note => ({
        id: note.id,
        title: note.display_title,
        post_time: note.visible_time,
        cover_url: note.images_list[0].url,
        read_count: note.view_count
      }))
    }
  };
  const { context, requestedUrls } = fakeContext({
    analysisPayload,
    analysisPages: [analysisPayload],
    paginationError: new Error('HTTP 406')
  });

  const result = await collectXiaohongshu({
    context,
    since: new Date('2026-11-01T00:00:00.000Z'),
    limit: 20,
    now: new Date('2026-11-20T00:00:00.000Z')
  });

  assert.equal(result.posts.length, 2);
  assert.equal(result.partial, false);
  assert.deepEqual(result.warnings, []);
  assert.equal(requestedUrls.some(url => url.includes('/note/user/posted')), false);
});

test('collectXiaohongshu keeps basic metrics when content analysis is unavailable', async () => {
  const { context } = fakeContext({ analysisError: new Error('HTTP 404') });

  const result = await collectXiaohongshu({
    context,
    since: new Date('2026-11-01T00:00:00.000Z'),
    limit: postedFixture.data.notes.length,
    now: new Date('2026-11-20T00:00:00.000Z')
  });

  assert.equal(result.posts.length, postedFixture.data.notes.length);
  assert.equal(result.metrics[0].views, postedFixture.data.notes[0].view_count);
  assert.equal(result.metrics[0].averageWatchSeconds, null);
  assert.deepEqual(result.warnings, ['内容深度指标暂不可用']);
});

test('xiaohongshuCollector reports login redirects', async () => {
  const page = {
    goto: async () => {},
    url: () => 'https://creator.xiaohongshu.com/login',
    close: async () => {}
  };

  assert.deepEqual(await xiaohongshuCollector.checkLogin({
    context: { newPage: async () => page }
  }), { ok: false, reason: 'Login required' });
});

function fakeContext({
  firstPage = postedFixture,
  secondPage,
  paginationError,
  analysisError,
  analysisPayload = analysisFixture,
  analysisPages = [analysisPayload],
  analysisReplayError
} = {}) {
  const requestedUrls = [];
  const firstUrl = 'https://creator.xiaohongshu.com/api/galaxy/v2/creator/note/user/posted?tab=0&page=0';
  const postedResponse = {
    url: () => firstUrl,
    json: async () => structuredClone(firstPage)
  };
  const responses = analysisPages.map((payload, index) => ({
    url: () => `https://creator.xiaohongshu.com/api/galaxy/creator/datacenter/note/analyze/list?post_begin_time=1&post_end_time=2&type=0&page_size=2&page_num=${index + 1}`,
    json: async () => structuredClone(payload)
  }));
  responses.push(postedResponse);
  const consumed = new Set();
  const page = {
    waitForResponse: async predicate => {
      const analysisResponse = responses.find(response => response.url().includes('/note/analyze/list') && predicate(response));
      if (analysisResponse && analysisError) throw analysisError;
      const response = responses.find(candidate => !consumed.has(candidate) && predicate(candidate));
      assert.ok(response, 'Expected a matching platform response');
      consumed.add(response);
      return response;
    },
    goto: async () => {},
    locator: () => {
      const chain = { filter: () => chain, first: () => chain, click: async () => {} };
      return chain;
    },
    evaluate: async (_function, url) => {
      requestedUrls.push(url);
      if (url.includes('/api/galaxy/user/info')) return structuredClone(fansFixture.userInfo);
      if (url.includes('/fans/overall_new')) return structuredClone(fansFixture.fans);
      if (url.includes('/note/analyze/list') && analysisReplayError) throw analysisReplayError;
      if (url.includes('/note/analyze/list') && analysisError) throw analysisError;
      if (url.includes('/note/analyze/list')) return structuredClone(analysisPayload);
      if (url.includes('/note/user/posted') && paginationError) throw paginationError;
      if (url.includes('/note/user/posted') && secondPage) return structuredClone(secondPage);
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
