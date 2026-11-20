const HOME_URL = 'https://creator.douyin.com/creator-micro/home';
const WORKS_URL = 'https://creator.douyin.com/creator-micro/content/manage';
const WORK_LIST_PATH = '/janus/douyin/creator/pc/work_list';
const USER_PATH = '/web/api/media/user/info/';
const OVERVIEW_PATH = '/aweme/janus/creator/data/overview/all/?last_days_type=1';
const FANS_HISTORY_PATH = '/janus/douyin/creator/data/overview/dashboard/fans?recent_days=30';

export const douyinCollector = {
  platform: 'douyin',
  loginUrl: HOME_URL,
  isLoggedIn: isDouyinLoggedIn,
  checkLogin: checkDouyinLogin,
  collect: collectDouyin
};

export function parseDouyinWorkList(payload) {
  assertSuccessful(payload);
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const awemes = Array.isArray(payload?.aweme_list) ? payload.aweme_list : [];
  const byId = new Map();
  for (let index = 0; index < Math.max(items.length, awemes.length); index += 1) {
    const item = items[index] ?? null;
    const aweme = awemes[index] ?? null;
    const id = identifier(aweme?.aweme_id ?? aweme?.item_id ?? item?.item_id ?? item?.id);
    if (id) byId.set(id, { item, aweme });
  }

  const posts = [];
  const metrics = [];
  for (const [postId, { item, aweme }] of byId) {
    const source = item ?? aweme;
    const title = String(item?.description ?? aweme?.item_title ?? aweme?.desc ?? '').trim();
    const publishedAt = epochToIso(source?.create_time ?? aweme?.create_time);
    if (!publishedAt) continue;

    posts.push({
      postId,
      title: title || '未命名作品',
      url: `https://www.douyin.com/video/${postId}`,
      coverUrl: firstUrl(item?.cover ?? aweme?.Cover ?? aweme?.video?.cover),
      publishedAt
    });

    const itemMetrics = item?.metrics ?? {};
    const statistics = aweme?.statistics ?? {};
    metrics.push({
      postId,
      views: metric(itemMetrics.view_count ?? statistics.play_count),
      likes: metric(itemMetrics.like_count ?? statistics.digg_count),
      comments: metric(itemMetrics.comment_count ?? statistics.comment_count),
      favorites: metric(itemMetrics.favorite_count ?? statistics.collect_count),
      shares: metric(itemMetrics.share_count ?? statistics.share_count),
      durationSeconds: millisecondsToSeconds(item?.video_info?.duration ?? aweme?.duration ?? aweme?.video?.duration),
      averageWatchSeconds: numberMetric(itemMetrics.avg_view_second),
      completionRate: numberMetric(itemMetrics.completion_rate),
      fiveSecondCompletionRate: numberMetric(itemMetrics.completion_rate_5s),
      twoSecondBounceRate: numberMetric(itemMetrics.bounce_rate_2s),
      impressions: null,
      coverClickRate: null,
      followersGained: metric(itemMetrics.subscribe_count)
    });
  }

  return {
    posts,
    metrics,
    reportedTotal: metric(payload?.total) ?? posts.length,
    hasMore: Boolean(payload?.has_more),
    cursor: payload?.max_cursor ?? null
  };
}

export function parseDouyinAccount(payloads) {
  const [userPayload, overviewPayload, historyPayload] = Array.isArray(payloads) ? payloads : [];
  assertSuccessful(userPayload);
  assertSuccessful(overviewPayload);
  if (historyPayload) assertSuccessful(historyPayload);
  const user = userPayload?.user;
  const platformAccountId = identifier(user?.uid ?? user?.sec_uid);
  if (!platformAccountId) throw new Error('Douyin account response is missing uid');

  return {
    account: {
      platformAccountId,
      displayName: String(user?.nickname ?? '抖音创作者'),
      avatarUrl: firstUrl(user?.avatar_thumb ?? user?.avatar_medium ?? user?.avatar_larger)
    },
    accountSnapshot: {
      followers: metric(user?.follower_count ?? overviewPayload?.data?.fans),
      following: metric(user?.following_count),
      likesReceived: metric(user?.total_favorited)
    },
    accountHistory: followerHistory(historyPayload)
  };
}

export async function collectDouyin({ context, since, limit = 100 }) {
  const page = await context.newPage();
  const warnings = [];
  try {
    const responsePromise = page.waitForResponse(
      response => response.url().includes(WORK_LIST_PATH),
      { timeout: 30000 }
    );
    await page.goto(WORKS_URL, { waitUntil: 'domcontentloaded' });
    const firstResponse = await responsePromise;
    const firstPayload = await firstResponse.json();
    const accountPayloads = await Promise.all([
      fetchJson(page, USER_PATH),
      fetchJson(page, OVERVIEW_PATH),
      fetchJson(page, FANS_HISTORY_PATH)
    ]);

    const account = parseDouyinAccount(accountPayloads);
    const allPosts = new Map();
    const allMetrics = new Map();
    let parsed = parseDouyinWorkList(firstPayload);
    let reportedTotal = parsed.reportedTotal;
    let hasMore = parsed.hasMore;
    let cursor = parsed.cursor;
    let cursorStuck = false;
    addPage(parsed, allPosts, allMetrics, limit);

    while (hasMore && allPosts.size < limit) {
      if (cursor == null) {
        warnings.push('作品分页缺少游标');
        break;
      }
      const nextUrl = new URL(firstResponse.url());
      nextUrl.searchParams.set('max_cursor', String(cursor));
      nextUrl.searchParams.set('count', String(Math.min(40, limit - allPosts.size)));
      const payload = await fetchJson(page, nextUrl.href);
      const next = parseDouyinWorkList(payload);
      reportedTotal = Math.max(reportedTotal, next.reportedTotal);
      addPage(next, allPosts, allMetrics, limit);
      hasMore = next.hasMore;
      if (hasMore && String(next.cursor) === String(cursor)) {
        cursorStuck = true;
        warnings.push('作品分页游标未推进');
        break;
      }
      cursor = next.cursor;
    }

    const sinceTime = since ? new Date(since).getTime() : Number.NEGATIVE_INFINITY;
    const posts = [...allPosts.values()]
      .filter(post => new Date(post.publishedAt).getTime() >= sinceTime)
      .slice(0, limit);
    const selected = new Set(posts.map(post => post.postId));
    const metrics = [...allMetrics.values()].filter(row => selected.has(row.postId));
    const partial = cursorStuck || hasMore || reportedTotal > posts.length || allPosts.size >= limit && reportedTotal > limit;

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

async function checkDouyinLogin({ context }) {
  const page = await context.newPage();
  try {
    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
    return isDouyinLoggedIn(page) ? { ok: true } : { ok: false, reason: 'Login required' };
  } finally {
    await page.close();
  }
}

function isDouyinLoggedIn(page) {
  return !/\/login(?:[/?#]|$)/i.test(page.url());
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

function fetchJson(page, url) {
  return page.evaluate(async target => {
    const response = await fetch(target, { credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }, url);
}

function assertSuccessful(payload) {
  if (payload?.status_code != null && Number(payload.status_code) !== 0) {
    throw new Error(`Douyin API returned status ${payload.status_code}`);
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

function millisecondsToSeconds(value) {
  const number = numberMetric(value);
  return number == null ? null : number / 1000;
}

function followerHistory(payload) {
  const metrics = payload?.metrics ?? payload?.data?.metrics ?? [];
  const total = metrics.find(row => row?.english_metric_name === 'total_fans_cnt');
  return (total?.trends ?? []).map(point => ({
    date: String(point.date_time).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'),
    followers: metric(point.value)
  })).filter(point => /^\d{4}-\d{2}-\d{2}$/.test(point.date) && point.followers != null);
}

function firstUrl(image) {
  if (!image) return null;
  if (typeof image === 'string') return image;
  if (Array.isArray(image)) return firstUrl(image[0]);
  return image.url_list?.[0] ?? image.url ?? null;
}

function epochToIso(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  const milliseconds = number > 10_000_000_000 ? number : number * 1000;
  return new Date(milliseconds).toISOString();
}
