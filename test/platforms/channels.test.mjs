import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  channelsCollector,
  collectChannels,
  parseChannelsFans,
  parseChannelsPostList
} from '../../src/platforms/channels.mjs';

const postFixture = readFixture('channels-post-list.json');
const fansFixture = readFixture('channels-fans-trend.json');

test('parseChannelsPostList maps object identity, cover, publish time, and metrics', () => {
  const result = parseChannelsPostList(postFixture);

  assert.equal(result.reportedTotal, 3);
  assert.equal(result.hasMore, true);
  assert.equal(result.nextPage, 2);
  assert.deepEqual(result.posts[0], {
    postId: 'channels-001',
    title: 'AI 产品经理快速入门',
    url: null,
    coverUrl: 'https://example.test/channels/cover-001.jpg',
    publishedAt: '2026-11-18T08:00:00.000Z'
  });
  assert.deepEqual(result.metrics[0], {
    postId: 'channels-001',
    views: 700,
    likes: 42,
    comments: 7,
    favorites: null,
    shares: 5
  });
});

test('parseChannelsPostList uses short title fallback and keeps absent metrics null', () => {
  const result = parseChannelsPostList(postFixture);

  assert.equal(result.posts[1].title, '第二条视频号作品');
  assert.deepEqual(result.metrics[1], {
    postId: 'channels-002',
    views: 240,
    likes: 11,
    comments: null,
    favorites: null,
    shares: null
  });
});

test('parseChannelsFans uses the latest total and local account identity', () => {
  assert.deepEqual(parseChannelsFans([fansFixture, {
    finderId: 'example@finder',
    displayName: '示例视频号',
    avatarUrl: null
  }]), {
    account: {
      platformAccountId: 'example@finder',
      displayName: '示例视频号',
      avatarUrl: null
    },
    accountSnapshot: {
      followers: 47,
      following: null,
      likesReceived: null
    }
  });
});

test('collectChannels captures structured responses and paginates with the original request body', async () => {
  const secondPage = {
    errCode: 0,
    data: {
      list: [{
        objectId: 'channels-003',
        createTime: 1794816000,
        readCount: 100,
        favCount: 4,
        commentCount: 1,
        forwardAggregationCount: 1,
        desc: {
          description: '第三条视频号作品',
          media: [{ coverUrl: 'https://example.test/channels/cover-003.jpg' }]
        }
      }],
      totalCount: 3,
      continueFlag: false
    }
  };
  const { context, postBodies, clickedLabels } = fakeContext({ secondPage });

  const result = await collectChannels({
    context,
    since: new Date('2026-11-01T00:00:00.000Z'),
    limit: 100,
    now: new Date('2026-11-20T00:00:00.000Z')
  });

  assert.equal(result.posts.length, 3);
  assert.equal(result.partial, false);
  assert.equal(postBodies[0].currentPage, 1);
  assert.equal(postBodies[0].startTime, '1793491200');
  assert.equal(postBodies[1].currentPage, 2);
  assert.equal(postBodies[0]._log_finder_id, 'example@finder');
  assert.equal(result.accountSnapshot.followers, 47);
  assert.deepEqual(clickedLabels, ['单篇视频']);
});

test('collectChannels stops at 100 items and reports partial data', async () => {
  const many = structuredClone(postFixture);
  many.data.totalCount = 101;
  many.data.continueFlag = true;
  many.data.list = Array.from({ length: 100 }, (_, index) => ({
    objectId: `channels-${String(index).padStart(3, '0')}`,
    createTime: 1794988800 - index,
    readCount: index,
    favCount: 0,
    desc: { description: `视频号作品 ${index}`, media: [] }
  }));
  const { context, postBodies } = fakeContext({ firstPage: many });

  const result = await collectChannels({
    context,
    since: new Date('2026-11-01T00:00:00.000Z'),
    limit: 100,
    now: new Date('2026-11-20T00:00:00.000Z')
  });

  assert.equal(result.posts.length, 100);
  assert.equal(result.partial, true);
  assert.equal(postBodies.length, 1);
  assert.equal(postBodies[0].currentPage, 1);
});

test('collectChannels consumes the pending response wait when tab activation fails', async () => {
  let rejectResponse;
  const response = new Promise((_, reject) => { rejectResponse = reject; });
  const page = {
    waitForResponse: () => response,
    goto: async () => {},
    getByText: () => ({ click: async () => { throw new Error('tab activation failed'); } }),
    close: async () => { rejectResponse(new Error('response wait stopped')); }
  };

  await assert.rejects(
    collectChannels({ context: { newPage: async () => page }, since: new Date(), now: new Date() }),
    /tab activation failed/
  );
  await new Promise(resolve => setImmediate(resolve));
});

test('channelsCollector detects login UI inside the Wujie shadow root', async () => {
  const page = {
    goto: async () => {},
    url: () => 'https://channels.weixin.qq.com/platform',
    evaluate: async () => true,
    close: async () => {}
  };

  assert.deepEqual(await channelsCollector.checkLogin({
    context: { newPage: async () => page }
  }), { ok: false, reason: 'Login required' });
});

function fakeContext({ firstPage = postFixture, secondPage } = {}) {
  const postBodies = [];
  const clickedLabels = [];
  const postUrl = 'https://channels.weixin.qq.com/micro/statistic/cgi-bin/mmfinderassistant-bin/statistic/post_list?_aid=test';
  const fansUrl = 'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/statistic/fans_trend?_aid=test';
  const responses = [
    {
      url: () => postUrl,
      json: async () => structuredClone(firstPage),
      request: () => ({
        postDataJSON: () => ({
          pageSize: 100,
          currentPage: 1,
          startTime: '1787529600',
          endTime: '1795305600',
          _log_finder_id: 'example@finder'
        })
      })
    },
    {
      url: () => fansUrl,
      json: async () => structuredClone(fansFixture),
      request: () => ({ postDataJSON: () => ({ _log_finder_id: 'example@finder' }) })
    }
  ];
  const page = {
    waitForResponse: async predicate => {
      const index = responses.findIndex(response => predicate(response));
      assert.notEqual(index, -1);
      return responses.splice(index, 1)[0];
    },
    goto: async () => {},
    url: () => 'https://channels.weixin.qq.com/platform/statistic/post',
    getByText: label => ({ click: async () => { clickedLabels.push(label); } }),
    evaluate: async (_function, argument) => {
      if (argument == null) {
        return { finderId: 'example@finder', displayName: '示例视频号', avatarUrl: null };
      }
      postBodies.push(argument.body);
      if (argument.url.includes('/post_list') && argument.body.currentPage === 1) return structuredClone(firstPage);
      if (argument.url.includes('/post_list') && secondPage) return structuredClone(secondPage);
      throw new Error(`Unexpected URL: ${argument.url}`);
    },
    close: async () => {}
  };
  return {
    context: { newPage: async () => page },
    postBodies,
    clickedLabels
  };
}

function readFixture(name) {
  return JSON.parse(fs.readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
}
