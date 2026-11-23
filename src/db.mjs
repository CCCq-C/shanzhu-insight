import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { normalizeTitle } from './normalize.mjs';

const SHANGHAI_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

export function openDatabase(databasePath) {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  }
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

export function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      platform TEXT PRIMARY KEY,
      platform_account_id TEXT,
      display_name TEXT,
      avatar_url TEXT
    );

    CREATE TABLE IF NOT EXISTS account_snapshots (
      platform TEXT NOT NULL,
      snapshot_date TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      followers INTEGER,
      following INTEGER,
      likes_received INTEGER,
      PRIMARY KEY (platform, snapshot_date),
      FOREIGN KEY (platform) REFERENCES accounts(platform)
    );

    CREATE TABLE IF NOT EXISTS contents (
      id INTEGER PRIMARY KEY,
      normalized_title TEXT NOT NULL,
      title TEXT NOT NULL,
      cover_path TEXT,
      published_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS contents_title_time
      ON contents(normalized_title, published_at);

    CREATE TABLE IF NOT EXISTS platform_posts (
      platform TEXT NOT NULL,
      post_id TEXT NOT NULL,
      content_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT,
      cover_url TEXT,
      published_at TEXT NOT NULL,
      PRIMARY KEY (platform, post_id),
      FOREIGN KEY (content_id) REFERENCES contents(id)
    );

    CREATE TABLE IF NOT EXISTS metric_snapshots (
      platform TEXT NOT NULL,
      post_id TEXT NOT NULL,
      snapshot_date TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      views INTEGER,
      likes INTEGER,
      comments INTEGER,
      favorites INTEGER,
      shares INTEGER,
      PRIMARY KEY (platform, post_id, snapshot_date),
      FOREIGN KEY (platform, post_id) REFERENCES platform_posts(platform, post_id)
    );

    CREATE TABLE IF NOT EXISTS collector_runs (
      id INTEGER PRIMARY KEY,
      platform TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      items INTEGER NOT NULL DEFAULT 0,
      reported_total INTEGER,
      partial INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      schema_version INTEGER NOT NULL DEFAULT 1
    );
  `);
  ensureMetricColumns(db);
  repairChannelsDurationUnits(db);
  reconcileContentGroups(db);
}

function ensureMetricColumns(db) {
  const existing = new Set(db.prepare('PRAGMA table_info(metric_snapshots)').all().map(row => row.name));
  const columns = {
    duration_seconds: 'REAL',
    average_watch_seconds: 'REAL',
    completion_rate: 'REAL',
    five_second_completion_rate: 'REAL',
    two_second_bounce_rate: 'REAL',
    impressions: 'INTEGER',
    cover_click_rate: 'REAL',
    followers_gained: 'INTEGER'
  };
  for (const [name, type] of Object.entries(columns)) {
    if (!existing.has(name)) db.exec(`ALTER TABLE metric_snapshots ADD COLUMN ${name} ${type}`);
  }
}

function repairChannelsDurationUnits(db) {
  db.exec(`
    UPDATE metric_snapshots
    SET duration_seconds = duration_seconds * 1000
    WHERE platform = 'channels'
      AND duration_seconds > 0
      AND duration_seconds < 1
      AND average_watch_seconds IS NOT NULL
      AND average_watch_seconds > duration_seconds
      AND average_watch_seconds <= duration_seconds * 1000
  `);
}

export function pairContent(db, post, platform = null) {
  const normalizedTitle = normalizeTitle(post.title);
  const publishedAt = new Date(post.publishedAt).toISOString();
  const genericTitle = isGenericTitle(normalizedTitle);
  const candidates = genericTitle ? [] : db.prepare(`
    SELECT id, title, published_at
    FROM contents
    WHERE ABS(julianday(published_at) - julianday(?)) <= 30
      AND (? IS NULL OR NOT EXISTS (
        SELECT 1 FROM platform_posts p WHERE p.content_id = contents.id AND p.platform = ?
      ))
    ORDER BY ABS(julianday(published_at) - julianday(?)), id
  `).all(publishedAt, platform, platform, publishedAt);
  const postsForContent = db.prepare('SELECT title, published_at FROM platform_posts WHERE content_id = ?');
  let existing = null;
  let confidence = 0;
  for (const candidate of candidates) {
    const variants = postsForContent.all(candidate.id);
    if (!variants.length) variants.push({ title: candidate.title, published_at: candidate.published_at });
    const score = Math.max(...variants.map(variant => contentMatchConfidence(
      { title: post.title, publishedAt },
      { title: variant.title, publishedAt: variant.published_at }
    )));
    if (score > confidence) {
      existing = candidate;
      confidence = score;
    }
  }

  if (existing && confidence > 0) return existing.id;

  return Number(db.prepare(`
    INSERT INTO contents (normalized_title, title, cover_path, published_at)
    VALUES (?, ?, NULL, ?)
  `).run(normalizedTitle, post.title, publishedAt).lastInsertRowid);
}

function reconcileContentGroups(db) {
  const rows = db.prepare(`
    SELECT c.id, c.title AS content_title, c.published_at AS content_published_at,
      p.platform, p.title, p.published_at
    FROM contents c
    LEFT JOIN platform_posts p ON p.content_id = c.id
    ORDER BY c.published_at, c.id, p.platform
  `).all();
  const groups = [];
  for (const row of rows) {
    let group = groups.at(-1);
    if (!group || group.id !== row.id) {
      group = {
        id: row.id,
        contentTitle: row.content_title,
        publishedAt: row.content_published_at,
        posts: [],
        platforms: new Set()
      };
      groups.push(group);
    }
    if (row.platform) {
      group.posts.push({ title: row.title, publishedAt: row.published_at });
      group.platforms.add(row.platform);
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (let left = 0; left < groups.length && !changed; left += 1) {
      for (let right = left + 1; right < groups.length; right += 1) {
        if ([...groups[left].platforms].some(platform => groups[right].platforms.has(platform))) continue;
        const leftPosts = groups[left].posts.length ? groups[left].posts : [{ title: groups[left].contentTitle, publishedAt: groups[left].publishedAt }];
        const rightPosts = groups[right].posts.length ? groups[right].posts : [{ title: groups[right].contentTitle, publishedAt: groups[right].publishedAt }];
        const matches = leftPosts.some(a => rightPosts.some(b => contentMatchConfidence(a, b) > 0));
        if (!matches) continue;

        const survivor = groups[left];
        const duplicate = groups[right];
        db.prepare('UPDATE platform_posts SET content_id = ? WHERE content_id = ?').run(survivor.id, duplicate.id);
        db.prepare('DELETE FROM contents WHERE id = ?').run(duplicate.id);
        survivor.posts.push(...duplicate.posts);
        duplicate.platforms.forEach(platform => survivor.platforms.add(platform));
        survivor.publishedAt = [survivor.publishedAt, duplicate.publishedAt].sort()[0];
        survivor.contentTitle = preferredTitle(survivor.posts.map(post => post.title), survivor.contentTitle);
        db.prepare(`
          UPDATE contents SET normalized_title = ?, title = ?, published_at = ? WHERE id = ?
        `).run(normalizeTitle(survivor.contentTitle), survivor.contentTitle, survivor.publishedAt, survivor.id);
        groups.splice(right, 1);
        changed = true;
        break;
      }
    }
  }
}

function contentMatchConfidence(left, right) {
  const a = normalizeTitle(left.title).slice(0, 500);
  const b = normalizeTitle(right.title).slice(0, 500);
  if (isGenericTitle(a) || isGenericTitle(b)) return 0;
  const aEpisode = episodeMarker(a);
  const bEpisode = episodeMarker(b);
  if (aEpisode && bEpisode && aEpisode !== bEpisode) return 0;
  const age = Math.abs(Date.parse(left.publishedAt) - Date.parse(right.publishedAt));
  if (!Number.isFinite(age) || age > 30 * 24 * 60 * 60 * 1000) return 0;
  if (a === b) return 1;
  if (Math.min(a.length, b.length) >= 8 && (a.includes(b) || b.includes(a))) return .99;
  if (age > 6 * 60 * 60 * 1000) return 0;
  const overlap = ngramOverlap(a, b);
  return overlap >= .3 ? overlap : 0;
}

function ngramOverlap(left, right) {
  const grams = value => new Set(Array.from({ length: Math.max(0, value.length - 1) }, (_, index) => value.slice(index, index + 2)));
  const a = grams(left);
  const b = grams(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

function episodeMarker(title) {
  const match = title.match(/(?:第)?([一二三四五六七八九十百零〇两\d]+)期/);
  return match?.[1] ?? null;
}

function preferredTitle(titles, fallback) {
  return titles.map(title => String(title ?? '').trim())
    .filter(title => title && !isGenericTitle(normalizeTitle(title)))
    .sort((left, right) => titlePenalty(left) - titlePenalty(right))[0] ?? fallback;
}

function titlePenalty(title) {
  return title.length + (title.includes('\n') ? 200 : 0) + (title.length > 80 ? 200 : 0);
}

function isGenericTitle(title) {
  return ['', '未命名作品', '无标题', '未命名内容'].includes(title);
}

export function saveCollection(db, result, capturedAt) {
  const captured = new Date(capturedAt);
  const capturedIso = captured.toISOString();
  const snapshotDate = formatDate(captured);
  const accountId = result.account.platformAccountId == null
    ? null
    : String(result.account.platformAccountId).trim() || null;
  assertSameAccount(db, result.platform, accountId);

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO accounts (platform, platform_account_id, display_name, avatar_url)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(platform) DO UPDATE SET
        platform_account_id = COALESCE(excluded.platform_account_id, accounts.platform_account_id),
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url
    `).run(
      result.platform,
      accountId,
      result.account.displayName ?? null,
      result.account.avatarUrl ?? null
    );

    const saveHistoricalAccount = db.prepare(`
      INSERT INTO account_snapshots (
        platform, snapshot_date, captured_at, followers, following, likes_received
      ) VALUES (?, ?, ?, ?, NULL, NULL)
      ON CONFLICT(platform, snapshot_date) DO UPDATE SET
        followers = COALESCE(account_snapshots.followers, excluded.followers)
    `);
    for (const point of result.accountHistory ?? []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(point.date)) || point.followers == null) continue;
      saveHistoricalAccount.run(result.platform, point.date, capturedIso, nullableInteger(point.followers));
    }

    db.prepare(`
      INSERT INTO account_snapshots (
        platform, snapshot_date, captured_at, followers, following, likes_received
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform, snapshot_date) DO UPDATE SET
        captured_at = excluded.captured_at,
        followers = COALESCE(excluded.followers, account_snapshots.followers),
        following = COALESCE(excluded.following, account_snapshots.following),
        likes_received = COALESCE(excluded.likes_received, account_snapshots.likes_received)
    `).run(
      result.platform,
      snapshotDate,
      capturedIso,
      nullableInteger(result.accountSnapshot.followers),
      nullableInteger(result.accountSnapshot.following),
      nullableInteger(result.accountSnapshot.likesReceived)
    );

    const metricByPost = new Map(result.metrics.map(metric => [String(metric.postId), metric]));
    for (const post of result.posts) {
      const postId = String(post.postId);
      let saved = db.prepare(`
        SELECT content_id FROM platform_posts WHERE platform = ? AND post_id = ?
      `).get(result.platform, postId);
      if (!saved && result.platform === 'douyin') {
        saved = migrateRoundedDouyinId(db, post, postId);
      }
      const contentId = saved?.content_id ?? pairContent(db, post, result.platform);

      db.prepare(`
        INSERT INTO platform_posts (
          platform, post_id, content_id, title, url, cover_url, published_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(platform, post_id) DO UPDATE SET
          title = excluded.title,
          url = excluded.url,
          cover_url = excluded.cover_url,
          published_at = excluded.published_at
      `).run(
        result.platform,
        postId,
        contentId,
        post.title,
        post.url ?? null,
        post.coverUrl ?? null,
        new Date(post.publishedAt).toISOString()
      );

      const metric = metricByPost.get(postId);
      if (!metric) continue;
      db.prepare(`
        INSERT INTO metric_snapshots (
          platform, post_id, snapshot_date, captured_at,
          views, likes, comments, favorites, shares,
          duration_seconds, average_watch_seconds, completion_rate,
          five_second_completion_rate, two_second_bounce_rate,
          impressions, cover_click_rate, followers_gained
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(platform, post_id, snapshot_date) DO UPDATE SET
          captured_at = excluded.captured_at,
          views = COALESCE(excluded.views, metric_snapshots.views),
          likes = COALESCE(excluded.likes, metric_snapshots.likes),
          comments = COALESCE(excluded.comments, metric_snapshots.comments),
          favorites = COALESCE(excluded.favorites, metric_snapshots.favorites),
          shares = COALESCE(excluded.shares, metric_snapshots.shares),
          duration_seconds = COALESCE(excluded.duration_seconds, metric_snapshots.duration_seconds),
          average_watch_seconds = COALESCE(excluded.average_watch_seconds, metric_snapshots.average_watch_seconds),
          completion_rate = COALESCE(excluded.completion_rate, metric_snapshots.completion_rate),
          five_second_completion_rate = COALESCE(excluded.five_second_completion_rate, metric_snapshots.five_second_completion_rate),
          two_second_bounce_rate = COALESCE(excluded.two_second_bounce_rate, metric_snapshots.two_second_bounce_rate),
          impressions = COALESCE(excluded.impressions, metric_snapshots.impressions),
          cover_click_rate = COALESCE(excluded.cover_click_rate, metric_snapshots.cover_click_rate),
          followers_gained = COALESCE(excluded.followers_gained, metric_snapshots.followers_gained)
      `).run(
        result.platform,
        postId,
        snapshotDate,
        capturedIso,
        nullableInteger(metric.views),
        nullableInteger(metric.likes),
        nullableInteger(metric.comments),
        nullableInteger(metric.favorites),
        nullableInteger(metric.shares),
        nullableNumber(metric.durationSeconds),
        nullableNumber(metric.averageWatchSeconds),
        nullableNumber(metric.completionRate),
        nullableNumber(metric.fiveSecondCompletionRate),
        nullableNumber(metric.twoSecondBounceRate),
        nullableInteger(metric.impressions),
        nullableNumber(metric.coverClickRate),
        nullableInteger(metric.followersGained)
      );
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function assertSameAccount(db, platform, accountId) {
  if (!accountId) return;
  const existing = db.prepare(`
    SELECT platform_account_id FROM accounts WHERE platform = ?
  `).get(platform)?.platform_account_id;
  if (!existing || String(existing) === accountId) return;
  const error = new Error(`Different ${platform} account detected; use a separate data directory`);
  error.name = 'AccountMismatchError';
  throw error;
}

function migrateRoundedDouyinId(db, post, exactId) {
  const publishedAt = new Date(post.publishedAt).toISOString();
  const previous = db.prepare(`
    SELECT * FROM platform_posts
    WHERE platform = 'douyin' AND title = ? AND published_at = ? AND post_id <> ?
    ORDER BY post_id LIMIT 1
  `).get(post.title, publishedAt, exactId);
  if (!previous || !likelyRoundedId(previous.post_id, exactId)) return null;
  db.prepare(`
    INSERT INTO platform_posts (platform, post_id, content_id, title, url, cover_url, published_at)
    VALUES ('douyin', ?, ?, ?, ?, ?, ?)
  `).run(exactId, previous.content_id, post.title, post.url ?? null, post.coverUrl ?? null, publishedAt);
  db.prepare(`
    UPDATE metric_snapshots SET post_id = ? WHERE platform = 'douyin' AND post_id = ?
  `).run(exactId, previous.post_id);
  db.prepare(`DELETE FROM platform_posts WHERE platform = 'douyin' AND post_id = ?`).run(previous.post_id);
  return { content_id: previous.content_id };
}

function likelyRoundedId(previousId, exactId) {
  if (!/^\d{16,}$/.test(previousId) || !/^\d{16,}$/.test(exactId)) return false;
  return previousId !== exactId && previousId === String(Number(exactId));
}

export function getContents(db, filters = {}) {
  const where = [];
  const parameters = [];
  if (filters.id != null) {
    where.push('c.id = ?');
    parameters.push(Number(filters.id));
  }
  if (filters.from) {
    where.push('c.published_at >= ?');
    parameters.push(new Date(filters.from).toISOString());
  }
  if (filters.to) {
    where.push('c.published_at <= ?');
    parameters.push(new Date(filters.to).toISOString());
  }
  if (filters.platform) {
    where.push('EXISTS (SELECT 1 FROM platform_posts p WHERE p.content_id = c.id AND p.platform = ?)');
    parameters.push(filters.platform);
  }

  const contents = db.prepare(`
    SELECT c.*
    FROM contents c
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY c.published_at DESC, c.id DESC
  `).all(...parameters);

  const postsStatement = db.prepare(`
    SELECT
      p.platform, p.post_id, p.title, p.url, p.cover_url, p.published_at,
      m.captured_at, m.views, m.likes, m.comments, m.favorites, m.shares,
      m.duration_seconds, m.average_watch_seconds, m.completion_rate,
      m.five_second_completion_rate, m.two_second_bounce_rate,
      m.impressions, m.cover_click_rate, m.followers_gained
    FROM platform_posts p
    LEFT JOIN metric_snapshots m
      ON m.platform = p.platform
      AND m.post_id = p.post_id
      AND m.snapshot_date = (
        SELECT MAX(latest.snapshot_date)
        FROM metric_snapshots latest
        WHERE latest.platform = p.platform AND latest.post_id = p.post_id
      )
    WHERE p.content_id = ?
    ORDER BY p.platform
  `);

  return contents.map(content => {
    const posts = postsStatement.all(content.id).map(post => ({
        platform: post.platform,
        postId: post.post_id,
        title: post.title,
        url: post.url,
        coverUrl: post.cover_url,
        publishedAt: post.published_at,
        metrics: presentMetrics(post)
      }));
    return {
      id: content.id,
      title: content.title,
      coverPath: content.cover_path ?? (posts[0] ? `/covers/${posts[0].platform}/${posts[0].postId}` : null),
      publishedAt: content.published_at,
      posts
    };
  });
}

export function getContentDetail(db, contentId) {
  const id = Number(contentId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const content = getContents(db, { id })[0];
  if (!content) return null;
  const historyStatement = db.prepare(`
    SELECT snapshot_date AS date, captured_at, views, likes, comments, favorites, shares,
      duration_seconds, average_watch_seconds, completion_rate,
      five_second_completion_rate, two_second_bounce_rate,
      impressions, cover_click_rate, followers_gained
    FROM metric_snapshots
    WHERE platform = ? AND post_id = ?
    ORDER BY snapshot_date
  `);
  return {
    ...content,
    posts: content.posts.map(post => ({
      ...post,
      history: historyStatement.all(post.platform, post.postId).map(row => ({
        date: row.date,
        ...presentMetrics(row)
      }))
    }))
  };
}

function presentMetrics(row) {
  const views = numberOrNull(row.views);
  const likes = numberOrNull(row.likes);
  const comments = numberOrNull(row.comments);
  const favorites = numberOrNull(row.favorites);
  const shares = numberOrNull(row.shares);
  const durationSeconds = numberOrNull(row.duration_seconds);
  const averageWatchSeconds = numberOrNull(row.average_watch_seconds);
  const followersGained = numberOrNull(row.followers_gained);
  const interactions = [likes, comments, favorites, shares]
    .reduce((sum, value) => sum + (value ?? 0), 0);
  return {
    capturedAt: row.captured_at,
    views,
    likes,
    comments,
    favorites,
    shares,
    durationSeconds,
    averageWatchSeconds,
    completionRate: numberOrNull(row.completion_rate),
    fiveSecondCompletionRate: numberOrNull(row.five_second_completion_rate),
    twoSecondBounceRate: numberOrNull(row.two_second_bounce_rate),
    impressions: numberOrNull(row.impressions),
    coverClickRate: numberOrNull(row.cover_click_rate),
    followersGained,
    averageWatchProgress: durationSeconds > 0 && averageWatchSeconds != null
      ? averageWatchSeconds / durationSeconds
      : null,
    interactionRate: views > 0 ? interactions / views : null,
    followerConversionRate: views > 0 && followersGained != null ? followersGained / views : null
  };
}

export function getOverview(db, now = new Date()) {
  const current = new Date(now);
  const historyStart = formatDate(new Date(current.getTime() - 29 * 24 * 60 * 60 * 1000));
  const sevenDayStart = formatDate(new Date(current.getTime() - 6 * 24 * 60 * 60 * 1000));
  const accountRows = db.prepare(`
    SELECT a.platform, a.display_name, a.avatar_url, s.followers, s.captured_at
    FROM accounts a
    LEFT JOIN account_snapshots s
      ON s.platform = a.platform
      AND s.snapshot_date = (
        SELECT MAX(latest.snapshot_date)
        FROM account_snapshots latest
        WHERE latest.platform = a.platform
      )
  `).all();
  const historyRows = db.prepare(`
    SELECT platform, snapshot_date, followers
    FROM account_snapshots
    WHERE snapshot_date >= ?
    ORDER BY snapshot_date
  `).all(historyStart);
  const latestRuns = db.prepare(`
    SELECT platform, status, finished_at, partial
    FROM collector_runs runs
    WHERE id = (SELECT MAX(latest.id) FROM collector_runs latest WHERE latest.platform = runs.platform)
  `).all();
  const runByPlatform = new Map(latestRuns.map(run => [run.platform, run]));
  const historyByPlatform = new Map();
  for (const row of historyRows) {
    if (!historyByPlatform.has(row.platform)) historyByPlatform.set(row.platform, []);
    historyByPlatform.get(row.platform).push({ date: row.snapshot_date, followers: row.followers });
  }
  const order = new Map(['xiaohongshu', 'douyin', 'channels'].map((platform, index) => [platform, index]));
  const platforms = accountRows.map(account => {
    const history = historyByPlatform.get(account.platform) ?? [];
    const currentFollowers = account.followers == null ? null : Number(account.followers);
    const baseline = history.find(point => point.date >= sevenDayStart)?.followers;
    const run = runByPlatform.get(account.platform);
    return {
      platform: account.platform,
      displayName: account.display_name,
      avatarUrl: account.avatar_url,
      followers: currentFollowers,
      followerChange7d: currentFollowers == null || baseline == null ? null : currentFollowers - Number(baseline),
      history,
      status: run?.status ?? 'unknown',
      partial: Boolean(run?.partial),
      lastCollectedAt: run?.finished_at ?? account.captured_at ?? null
    };
  }).sort((left, right) => (order.get(left.platform) ?? 99) - (order.get(right.platform) ?? 99));
  const recentContents = getContents(db, {}).slice(0, 12);
  const lastCollectedAt = platforms.map(platform => platform.lastCollectedAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  return {
    asOf: current.toISOString(),
    lastCollectedAt,
    totalFollowers: platforms.reduce((sum, platform) => sum + (platform.followers ?? 0), 0),
    platforms,
    latestContent: recentContents[0] ?? null,
    recentContents
  };
}

function nullableInteger(value) {
  return value == null ? null : Math.trunc(Number(value));
}

function nullableNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function numberOrNull(value) {
  return value == null ? null : Number(value);
}

function formatDate(date) {
  const parts = Object.fromEntries(
    SHANGHAI_DATE.formatToParts(date)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
