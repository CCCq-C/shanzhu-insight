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
}

export function pairContent(db, post) {
  const normalizedTitle = normalizeTitle(post.title);
  const publishedAt = new Date(post.publishedAt).toISOString();
  const existing = db.prepare(`
    SELECT id
    FROM contents
    WHERE normalized_title = ?
      AND ABS(julianday(published_at) - julianday(?)) <= 3
    ORDER BY ABS(julianday(published_at) - julianday(?)), id
    LIMIT 1
  `).get(normalizedTitle, publishedAt, publishedAt);

  if (existing) return existing.id;

  return Number(db.prepare(`
    INSERT INTO contents (normalized_title, title, cover_path, published_at)
    VALUES (?, ?, NULL, ?)
  `).run(normalizedTitle, post.title, publishedAt).lastInsertRowid);
}

export function saveCollection(db, result, capturedAt) {
  const captured = new Date(capturedAt);
  const capturedIso = captured.toISOString();
  const snapshotDate = formatDate(captured);

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      INSERT INTO accounts (platform, platform_account_id, display_name, avatar_url)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(platform) DO UPDATE SET
        platform_account_id = excluded.platform_account_id,
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url
    `).run(
      result.platform,
      result.account.platformAccountId ?? null,
      result.account.displayName ?? null,
      result.account.avatarUrl ?? null
    );

    db.prepare(`
      INSERT INTO account_snapshots (
        platform, snapshot_date, captured_at, followers, following, likes_received
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform, snapshot_date) DO UPDATE SET
        captured_at = excluded.captured_at,
        followers = excluded.followers,
        following = excluded.following,
        likes_received = excluded.likes_received
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
      const saved = db.prepare(`
        SELECT content_id FROM platform_posts WHERE platform = ? AND post_id = ?
      `).get(result.platform, postId);
      const contentId = saved?.content_id ?? pairContent(db, post);

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
          views, likes, comments, favorites, shares
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(platform, post_id, snapshot_date) DO UPDATE SET
          captured_at = excluded.captured_at,
          views = excluded.views,
          likes = excluded.likes,
          comments = excluded.comments,
          favorites = excluded.favorites,
          shares = excluded.shares
      `).run(
        result.platform,
        postId,
        snapshotDate,
        capturedIso,
        nullableInteger(metric.views),
        nullableInteger(metric.likes),
        nullableInteger(metric.comments),
        nullableInteger(metric.favorites),
        nullableInteger(metric.shares)
      );
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function getContents(db, filters = {}) {
  const where = [];
  const parameters = [];
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
      m.captured_at, m.views, m.likes, m.comments, m.favorites, m.shares
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
    const posts = postsStatement.all(content.id).map(post => {
      const views = post.views == null ? null : Number(post.views);
      const interactions = [post.likes, post.comments, post.favorites, post.shares]
        .reduce((sum, value) => sum + (value == null ? 0 : Number(value)), 0);
      return {
        platform: post.platform,
        postId: post.post_id,
        title: post.title,
        url: post.url,
        coverUrl: post.cover_url,
        publishedAt: post.published_at,
        metrics: {
          capturedAt: post.captured_at,
          views,
          likes: post.likes,
          comments: post.comments,
          favorites: post.favorites,
          shares: post.shares,
          interactionRate: views > 0 ? interactions / views : null
        }
      };
    });
    return {
      id: content.id,
      title: content.title,
      coverPath: content.cover_path ?? (posts[0] ? `/covers/${posts[0].platform}/${posts[0].postId}` : null),
      publishedAt: content.published_at,
      posts
    };
  });
}

export function getOverview(db, now = new Date()) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(s.followers), 0) AS total_followers
    FROM account_snapshots s
    WHERE s.snapshot_date = (
      SELECT MAX(latest.snapshot_date)
      FROM account_snapshots latest
      WHERE latest.platform = s.platform
    )
  `).get();

  return {
    asOf: new Date(now).toISOString(),
    totalFollowers: Number(row.total_followers)
  };
}

function nullableInteger(value) {
  return value == null ? null : Math.trunc(Number(value));
}

function formatDate(date) {
  const parts = Object.fromEntries(
    SHANGHAI_DATE.formatToParts(date)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
