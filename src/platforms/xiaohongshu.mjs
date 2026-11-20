const HOME_URL = 'https://creator.xiaohongshu.com/new/home';
const NOTES_URL = 'https://creator.xiaohongshu.com/new/note-manager';
const POSTED_PATH = '/api/galaxy/v2/creator/note/user/posted';
const USER_PATH = '/api/galaxy/user/info';
const FANS_PATH = '/api/galaxy/creator/data/fans/overall_new';

export const xiaohongshuCollector = {
  platform: 'xiaohongshu',
  loginUrl: HOME_URL,
  checkLogin: checkXiaohongshuLogin,
  collect: collectXiaohongshu
};

export function parseXiaohongshuPosted(payload) {
  assertSuccessful(payload);
  const data = payload?.data ?? {};
  const notes = Array.isArray(data.notes) ? data.notes : [];
  const posts = [];
  const metrics = [];

  for (const note of notes) {
    const postId = identifier(note?.id ?? note?.note_id);
    const publishedAt = epochToIso(note?.visible_time ?? note?.time);
    if (!postId || !publishedAt) continue;
    posts.push({
      postId,
      title: String(note?.display_title ?? note?.title ?? '').trim() || '未命名笔记',
      url: `https://www.xiaohongshu.com/explore/${postId}`,
      coverUrl: firstImageUrl(note?.images_list ?? note?.cover),
      publishedAt
    });
    metrics.push({
      postId,
      views: metric(note?.view_count),
      likes: metric(note?.likes),
      comments: metric(note?.comments_count),
      favorites: metric(note?.collected_count),
      shares: metric(note?.shared_count)
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
    }
  };
}

export async function collectXiaohongshu({ context, since, limit = 100 }) {
  const page = await context.newPage();
  const warnings = [];
  try {
    const responsePromise = page.waitForResponse(
      response => response.url().includes(POSTED_PATH),
      { timeout: 30000 }
    );
    await page.goto(NOTES_URL, { waitUntil: 'domcontentloaded' });
    const firstResponse = await responsePromise;
    const firstPayload = await firstResponse.json();
    const account = parseXiaohongshuFans(await Promise.all([
      fetchJson(page, USER_PATH),
      fetchJson(page, FANS_PATH)
    ]));

    const allPosts = new Map();
    const allMetrics = new Map();
    let parsed = parseXiaohongshuPosted(firstPayload);
    let reportedTotal = parsed.reportedTotal;
    let hasMore = parsed.hasMore;
    let nextPage = parsed.nextPage;
    let cursorStuck = false;
    addPage(parsed, allPosts, allMetrics, limit);

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
      const next = parseXiaohongshuPosted(payload);
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
      partial: cursorStuck || hasMore,
      warnings
    };
  } finally {
    await page.close();
  }
}

async function checkXiaohongshuLogin({ context }) {
  const page = await context.newPage();
  try {
    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
    return /\/login(?:[/?#]|$)/i.test(page.url())
      ? { ok: false, reason: 'Login required' }
      : { ok: true };
  } finally {
    await page.close();
  }
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
