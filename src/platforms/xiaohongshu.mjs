const HOME_URL = 'https://creator.xiaohongshu.com/new/home';
const NOTES_URL = 'https://creator.xiaohongshu.com/new/note-manager';
const STATS_URL = 'https://creator.xiaohongshu.com/statistics/data-analysis';
const POSTED_PATH = '/api/galaxy/v2/creator/note/user/posted';
const USER_PATH = '/api/galaxy/user/info';
const FANS_PATH = '/api/galaxy/creator/data/fans/overall_new';
const ANALYSIS_PATH = '/api/galaxy/creator/datacenter/note/analyze/list';
const SHANGHAI_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
});

export const xiaohongshuCollector = {
  platform: 'xiaohongshu',
  loginUrl: HOME_URL,
  isLoggedIn: isXiaohongshuLoggedIn,
  checkLogin: checkXiaohongshuLogin,
  collect: collectXiaohongshu
};

export function parseXiaohongshuPosted(payload, analysisPayload = null) {
  assertSuccessful(payload);
  if (analysisPayload) assertSuccessful(analysisPayload);
  const data = payload?.data ?? {};
  const notes = Array.isArray(data.notes) ? data.notes : [];
  const analysis = new Map((analysisPayload?.data?.note_infos ?? []).map(row => [String(row.id), row]));
  const posts = [];
  const metrics = [];

  for (const note of notes) {
    const postId = identifier(note?.id ?? note?.note_id);
    const publishedAt = epochToIso(note?.visible_time ?? note?.time);
    if (!postId || !publishedAt) continue;
    const detail = analysis.get(postId) ?? {};
    posts.push({
      postId,
      title: String(note?.display_title ?? note?.title ?? '').trim() || '未命名笔记',
      url: `https://www.xiaohongshu.com/explore/${postId}`,
      coverUrl: firstImageUrl(note?.images_list ?? note?.cover),
      publishedAt
    });
    metrics.push({
      postId,
      views: metric(detail.read_count ?? note?.view_count),
      likes: metric(detail.like_count ?? note?.likes),
      comments: metric(detail.comment_count ?? note?.comments_count),
      favorites: metric(detail.fav_count ?? note?.collected_count),
      shares: metric(detail.share_count ?? note?.shared_count),
      durationSeconds: numberMetric(note?.video_info?.duration),
      averageWatchSeconds: numberMetric(detail.view_time_avg),
      completionRate: null,
      fiveSecondCompletionRate: null,
      twoSecondBounceRate: null,
      impressions: metric(detail.imp_count),
      coverClickRate: numberMetric(detail.coverClickRate),
      followersGained: metric(detail.increase_fans_count)
    });
  }

  const nextPage = data.page ?? -1;
  return {
    posts,
    metrics,
    reportedTotal: metric(data.total) ?? posts.length,
    hasMore: Number(nextPage) !== -1,
    nextPage
  };
}

export function parseXiaohongshuAnalysis(payload) {
  assertSuccessful(payload);
  const data = payload?.data ?? {};
  const rows = Array.isArray(data.note_infos) ? data.note_infos : [];
  const posts = [];
  const metrics = [];

  for (const row of rows) {
    const postId = identifier(row?.id ?? row?.note_id);
    const publishedAt = epochToIso(row?.post_time);
    if (!postId || !publishedAt) continue;
    posts.push({
      postId,
      title: String(row?.title ?? '').trim() || '未命名笔记',
      url: `https://www.xiaohongshu.com/explore/${postId}`,
      coverUrl: firstImageUrl(row?.cover_url),
      publishedAt
    });
    metrics.push({
      postId,
      views: metric(row?.read_count),
      likes: metric(row?.like_count),
      comments: metric(row?.comment_count),
      favorites: metric(row?.fav_count),
      shares: metric(row?.share_count),
      durationSeconds: null,
      averageWatchSeconds: numberMetric(row?.view_time_avg),
      completionRate: null,
      fiveSecondCompletionRate: null,
      twoSecondBounceRate: null,
      impressions: metric(row?.imp_count),
      coverClickRate: numberMetric(row?.coverClickRate),
      followersGained: metric(row?.increase_fans_count)
    });
  }

  return { posts, metrics, reportedTotal: metric(data.total) ?? posts.length };
}

export function parseXiaohongshuFans(payloads) {
  const [userPayload, fansPayload] = Array.isArray(payloads) ? payloads : [];
  assertSuccessful(userPayload);
  assertSuccessful(fansPayload);
  const user = userPayload?.data ?? {};
  const thirty = fansPayload?.data?.thirty ?? fansPayload?.data?.seven ?? {};
  const platformAccountId = identifier(user.userId ?? user.redId);
  if (!platformAccountId) throw new Error('Xiaohongshu account response is missing userId');

  return {
    account: {
      platformAccountId,
      displayName: String(user.userName ?? user.relatedUserName ?? '小红书创作者'),
      avatarUrl: firstImageUrl(user.userAvatar)
    },
    accountSnapshot: {
      followers: metric(thirty.fans_count),
      following: null,
      likesReceived: null
    },
    accountHistory: (thirty.fans_list ?? []).map(point => ({
      date: epochDate(point.date),
      followers: metric(point.count)
    })).filter(point => point.date && point.followers != null)
  };
}

export async function collectXiaohongshu({ context, since, limit = 100, now = new Date() }) {
  const page = await context.newPage();
  const warnings = [];
  try {
    let analysisPayload = null;
    try {
      const analysis = await captureAnalysis(page, limit);
      analysisPayload = analysis.payload;
      if (analysis.partial) warnings.push('内容深度指标未完整获取');
    } catch {
      warnings.push('内容深度指标暂不可用');
    }

    const responsePromise = page.waitForResponse(
      response => response.url().includes(POSTED_PATH),
      { timeout: 30000 }
    );
    await page.goto(NOTES_URL, { waitUntil: 'domcontentloaded' });
    const firstResponse = await responsePromise;
    const firstPayload = await firstResponse.json();
    const [userPayload, fansPayload] = await Promise.all([
      fetchJson(page, USER_PATH),
      fetchJson(page, FANS_PATH)
    ]);
    const account = parseXiaohongshuFans([userPayload, fansPayload]);

    const allPosts = new Map();
    const allMetrics = new Map();
    let parsed = parseXiaohongshuPosted(firstPayload, analysisPayload);
    let reportedTotal = parsed.reportedTotal;
    let hasMore = parsed.hasMore;
    let nextPage = parsed.nextPage;
    let cursorStuck = false;
    let analysisComplete = false;
    addPage(parsed, allPosts, allMetrics, limit);
    if (analysisPayload) {
      const analysis = parseXiaohongshuAnalysis(analysisPayload);
      addPage(analysis, allPosts, allMetrics, limit);
      reportedTotal = Math.max(reportedTotal, analysis.reportedTotal, allPosts.size);
      analysisComplete = analysis.reportedTotal > 0 && analysis.posts.length >= analysis.reportedTotal;
      if (analysisComplete) hasMore = false;
    }

    while (hasMore && allPosts.size < limit) {
      const nextUrl = new URL(firstResponse.url());
      nextUrl.searchParams.set('page', String(nextPage));
      let payload;
      try {
        payload = await fetchJson(page, nextUrl.href);
      } catch {
        warnings.push('笔记后续分页请求被平台拒绝');
        break;
      }
      const next = parseXiaohongshuPosted(payload, analysisPayload);
      addPage(next, allPosts, allMetrics, limit);
      reportedTotal = Math.max(reportedTotal, next.reportedTotal, allPosts.size);
      hasMore = next.hasMore;
      if (hasMore && String(next.nextPage) === String(nextPage)) {
        cursorStuck = true;
        warnings.push('笔记分页游标未推进');
        break;
      }
      nextPage = next.nextPage;
    }

    const sinceTime = since ? new Date(since).getTime() : Number.NEGATIVE_INFINITY;
    const posts = [...allPosts.values()]
      .filter(post => new Date(post.publishedAt).getTime() >= sinceTime)
      .slice(0, limit);
    const selected = new Set(posts.map(post => post.postId));
    const metrics = [...allMetrics.values()].filter(row => selected.has(row.postId));

    return {
      ...account,
      posts,
      metrics,
      reportedTotal: Math.max(reportedTotal, posts.length),
      partial: cursorStuck || hasMore || warnings.length > 0,
      warnings
    };
  } finally {
    await page.close();
  }
}

async function captureAnalysis(page, limit) {
  const firstResponsePromise = page.waitForResponse(
    response => response.url().includes(ANALYSIS_PATH) && responsePage(response.url()) === 1,
    { timeout: 30000 }
  );
  await page.goto(STATS_URL, { waitUntil: 'domcontentloaded' });
  const firstResponse = await firstResponsePromise;
  const firstPayload = await firstResponse.json();
  assertSuccessful(firstPayload);

  const firstUrl = new URL(firstResponse.url());
  const pageSize = Number(firstUrl.searchParams.get('page_size')) || 10;
  const total = metric(firstPayload?.data?.total) ?? firstPayload?.data?.note_infos?.length ?? 0;
  const lastPage = Math.min(Math.ceil(total / pageSize), Math.ceil(limit / pageSize));
  const noteInfos = [...(firstPayload?.data?.note_infos ?? [])];
  let partial = false;

  for (let pageNumber = 2; pageNumber <= lastPage; pageNumber += 1) {
    try {
      const responsePromise = page.waitForResponse(
        response => response.url().includes(ANALYSIS_PATH) && responsePage(response.url()) === pageNumber,
        { timeout: 30000 }
      );
      await page.locator('span.d-pagination-page-content')
        .filter({ hasText: new RegExp(`^${pageNumber}$`) })
        .first()
        .click();
      const response = await responsePromise;
      const payload = await response.json();
      assertSuccessful(payload);
      noteInfos.push(...(payload?.data?.note_infos ?? []));
    } catch {
      partial = true;
      break;
    }
  }

  return {
    payload: {
      ...firstPayload,
      data: { ...firstPayload.data, note_infos: noteInfos, total }
    },
    partial
  };
}

async function checkXiaohongshuLogin({ context }) {
  const page = await context.newPage();
  try {
    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
    return isXiaohongshuLoggedIn(page) ? { ok: true } : { ok: false, reason: 'Login required' };
  } finally {
    await page.close();
  }
}

function isXiaohongshuLoggedIn(page) {
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
  if (payload?.success === false || payload?.code != null && Number(payload.code) !== 0) {
    throw new Error(`Xiaohongshu API returned code ${payload?.code ?? 'unknown'}`);
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

function epochDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return SHANGHAI_DATE.format(new Date(number > 10_000_000_000 ? number : number * 1000));
}

function responsePage(url) {
  return Number(new URL(url).searchParams.get('page_num'));
}

function firstImageUrl(image) {
  if (!image) return null;
  if (typeof image === 'string') return image;
  if (Array.isArray(image)) return firstImageUrl(image[0]);
  return image.url ?? image.url_list?.[0] ?? null;
}

function epochToIso(value) {
  if (typeof value === 'string' && !/^\d+$/.test(value)) {
    const parsed = Date.parse(value.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? '' : '+08:00'));
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return new Date(number > 10_000_000_000 ? number : number * 1000).toISOString();
}
