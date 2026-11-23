const HOME_URL = 'https://channels.weixin.qq.com/platform';
const FANS_URL = 'https://channels.weixin.qq.com/platform/statistic/follower';
const POST_LIST_MARKER = '/statistic/post_list';
const FANS_TREND_MARKER = '/statistic/fans_trend';
const AUTH_INFO_MARKER = '/auth/get_auth_info';

export const channelsCollector = {
  platform: 'channels',
  loginUrl: HOME_URL,
  isLoggedIn: isChannelsLoggedIn,
  checkLogin: checkChannelsLogin,
  collect: collectChannels
};

export function parseChannelsPostList(payload, { currentPage = 1 } = {}) {
  assertSuccessful(payload);
  const data = payload?.data ?? {};
  const list = Array.isArray(data.list) ? data.list : [];
  const posts = [];
  const metrics = [];

  for (const item of list) {
    const postId = identifier(item?.objectId ?? item?.object_id ?? item?.id);
    const publishedAt = epochToIso(item?.createTime ?? item?.create_time);
    if (!postId || !publishedAt) continue;
    const media = item?.desc?.media?.[0] ?? {};
    const shortTitle = item?.desc?.shortTitle?.[0]?.shortTitle;
    const description = String(item?.desc?.description ?? '').trim();
    posts.push({
      postId,
      title: description || String(shortTitle ?? '').trim() || `视频号作品 ${publishedAt.slice(0, 10)}`,
      url: null,
      coverUrl: media.coverUrl ?? media.fullCoverUrl ?? media.thumbUrl ?? null,
      publishedAt
    });
    metrics.push({
      postId,
      views: metric(item?.readCount),
      likes: metric(item?.favCount),
      comments: metric(item?.commentCount),
      favorites: null,
      shares: metric(item?.forwardAggregationCount ?? item?.forwardCount),
      durationSeconds: numberMetric(media.videoPlayLen),
      averageWatchSeconds: numberMetric(item?.avgPlayTimeSec),
      completionRate: numberMetric(item?.fullPlayRate),
      fiveSecondCompletionRate: null,
      twoSecondBounceRate: null,
      impressions: null,
      coverClickRate: null,
      followersGained: metric(item?.followCount)
    });
  }

  const reportedTotal = metric(data.totalCount) ?? posts.length;
  const hasMore = data.continueFlag == null
    ? currentPage * Math.max(list.length, 1) < reportedTotal
    : Boolean(data.continueFlag);
  return {
    posts,
    metrics,
    reportedTotal,
    hasMore,
    nextPage: currentPage + 1
  };
}

export function parseChannelsFans(payloads) {
  const [fansPayload, identity = {}] = Array.isArray(payloads) ? payloads : [];
  assertSuccessful(fansPayload);
  const finderId = identifier(identity.finderId);
  if (!finderId) throw new Error('Channels account identity is missing finderId');
  const totals = Array.isArray(fansPayload?.data?.total) ? fansPayload.data.total : [];

  return {
    account: {
      platformAccountId: finderId,
      displayName: String(identity.displayName ?? '视频号创作者'),
      avatarUrl: identity.avatarUrl ?? null
    },
    accountSnapshot: {
      followers: metric(totals.at(-1)),
      following: null,
      likesReceived: null
    },
    accountHistory: (fansPayload?.data?.date ?? []).map((date, index) => ({
      date: String(date),
      followers: metric(totals[index])
    })).filter(point => /^\d{4}-\d{2}-\d{2}$/.test(point.date) && point.followers != null)
  };
}

export async function collectChannels({ context, since, limit = 100, now = new Date() }) {
  const page = await context.newPage();
  const warnings = [];
  try {
    const [postResponse] = await Promise.all([
      page.waitForResponse(
        response => response.url().includes(POST_LIST_MARKER),
        { timeout: 30000 }
      ),
      (async () => {
        await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
        await page.locator('a').filter({ hasText: '视频数据' }).first().evaluate(link => link.click());
        const singlePostTab = page.getByText('单篇视频', { exact: true });
        await singlePostTab.waitFor({ state: 'attached', timeout: 10000 });
        await singlePostTab.click();
      })()
    ]);
    const identity = await readIdentity(page);
    const initialBody = postResponse.request().postDataJSON();
    const requestBody = {
      ...initialBody,
      pageSize: Math.min(100, limit),
      currentPage: 1,
      startTime: String(Math.floor(new Date(since).getTime() / 1000)),
      endTime: String(Math.floor(new Date(now).getTime() / 1000)),
      _log_finder_id: identity.finderId
    };

    const allPosts = new Map();
    const allMetrics = new Map();
    let payload = await postJson(page, postResponse.url(), requestBody);
    let parsed = parseChannelsPostList(payload, { currentPage: 1 });
    let reportedTotal = parsed.reportedTotal;
    let hasMore = parsed.hasMore;
    let nextPage = parsed.nextPage;
    addPage(parsed, allPosts, allMetrics, limit);

    while (hasMore && allPosts.size < limit) {
      payload = await postJson(page, postResponse.url(), {
        ...requestBody,
        currentPage: nextPage,
        pageSize: Math.min(100, limit - allPosts.size)
      });
      parsed = parseChannelsPostList(payload, { currentPage: nextPage });
      reportedTotal = Math.max(reportedTotal, parsed.reportedTotal);
      addPage(parsed, allPosts, allMetrics, limit);
      hasMore = parsed.hasMore;
      nextPage = parsed.nextPage;
    }

    const [fansResponse] = await Promise.all([
      page.waitForResponse(
        response => response.url().includes(FANS_TREND_MARKER),
        { timeout: 30000 }
      ),
      page.goto(FANS_URL, { waitUntil: 'domcontentloaded' })
    ]);
    const account = parseChannelsFans([await fansResponse.json(), identity]);
    const sinceTime = since ? new Date(since).getTime() : Number.NEGATIVE_INFINITY;
    const posts = [...allPosts.values()]
      .filter(post => new Date(post.publishedAt).getTime() >= sinceTime)
      .slice(0, limit);
    const selected = new Set(posts.map(post => post.postId));
    const metrics = [...allMetrics.values()].filter(row => selected.has(row.postId));
    const partial = hasMore || reportedTotal > posts.length;
    if (partial) warnings.push('作品列表未完整获取');

    return {
      ...account,
      posts,
      metrics,
      reportedTotal,
      partial,
      warnings
    };
  } finally {
    await page.close();
  }
}

async function checkChannelsLogin({ context }) {
  const page = await context.newPage();
  try {
    const authResponsePromise = page.waitForResponse
      ? page.waitForResponse(response => response.url().includes(AUTH_INFO_MARKER), { timeout: 10000 }).catch(() => null)
      : Promise.resolve(null);
    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
    const authResponse = await authResponsePromise;
    if (authResponse) {
      const payload = await authResponse.json().catch(() => null);
      if (payload?.errCode != null) {
        return Number(payload.errCode) === 0 ? { ok: true } : { ok: false, reason: 'Login required' };
      }
    }
    return await isChannelsLoggedIn(page) ? { ok: true } : { ok: false, reason: 'Login required' };
  } finally {
    await page.close();
  }
}

async function isChannelsLoggedIn(page) {
  if (/\/login(?:\.html)?(?:[/?#]|$)/i.test(page.url())) return false;
  const state = await page.evaluate(() => {
    const finderId = String(localStorage.getItem('finder_username') ?? '').trim();
    const visibleText = document.body?.innerText ?? '';
    return { finderId, visibleText };
  });
  const loginVisible = /扫码登录|登录视频号助手|请登录/.test(state.visibleText);
  const accountVisible = /视频号ID[:：]/.test(state.visibleText) && /关注者/.test(state.visibleText);
  return Boolean(state.finderId) && !loginVisible && accountVisible;
}

function readIdentity(page) {
  return page.evaluate(() => {
    const strip = value => String(value ?? '').trim().replace(/^["']|["']$/g, '');
    let finderId = strip(localStorage.getItem('finder_username'));
    if (!finderId) {
      for (const key of Object.keys(localStorage)) {
        const match = strip(localStorage.getItem(key)).match(/[A-Za-z0-9_.-]+@finder/);
        if (match) {
          finderId = match[0];
          break;
        }
      }
    }
    if (finderId && !finderId.endsWith('@finder')) finderId += '@finder';
    const root = document.querySelector('wujie-app')?.shadowRoot ?? document;
    const displayName = root.querySelector('[class*=nickname], [class*=user-name]')?.textContent?.trim();
    const avatarUrl = root.querySelector('[class*=avatar] img')?.src ?? null;
    return { finderId, displayName: displayName || '视频号创作者', avatarUrl };
  });
}

function postJson(page, url, body) {
  return page.evaluate(async request => {
    const response = await fetch(request.url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.body)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }, { url, body });
}

function addPage(page, posts, metrics, limit) {
  for (const post of page.posts) {
    if (posts.size >= limit) break;
    if (!posts.has(post.postId)) posts.set(post.postId, post);
  }
  for (const row of page.metrics) {
    if (posts.has(row.postId) && !metrics.has(row.postId)) metrics.set(row.postId, row);
  }
}

function assertSuccessful(payload) {
  if (payload?.errCode != null && Number(payload.errCode) !== 0) {
    throw new Error(`Channels API returned code ${payload.errCode}`);
  }
}

function identifier(value) {
  if (value == null || value === '') return null;
  return String(value);
}

function metric(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function numberMetric(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function epochToIso(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return new Date(number > 10_000_000_000 ? number : number * 1000).toISOString();
}
