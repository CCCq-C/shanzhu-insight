import { saveCollection } from './db.mjs';
import { channelsCollector } from './platforms/channels.mjs';
import { douyinCollector } from './platforms/douyin.mjs';
import { xiaohongshuCollector } from './platforms/xiaohongshu.mjs';

export const defaultCollectors = [douyinCollector, xiaohongshuCollector, channelsCollector];

export async function collectAll({
  db,
  context,
  collectors,
  now = new Date(),
  delayMs = 2000,
  since = new Date(new Date(now).getTime() - 90 * 24 * 60 * 60 * 1000),
  limit = 100
}) {
  const results = [];

  for (const [index, collector] of collectors.entries()) {
    const startedAt = new Date(now).toISOString();
    const run = db.prepare(`
      INSERT INTO collector_runs (platform, started_at, status)
      VALUES (?, ?, 'running')
    `).run(collector.platform, startedAt);

    let outcome;
    try {
      const login = await collector.checkLogin({ context });
      if (!login.ok) {
        outcome = {
          platform: collector.platform,
          status: 'needs_login',
          items: 0,
          reportedTotal: null,
          partial: false,
          error: 'Login required'
        };
      } else {
        const result = await collector.collect({ context, since, limit, now: new Date(now) });
        const normalized = { platform: collector.platform, ...result };
        saveCollection(db, normalized, now);
        outcome = {
          platform: collector.platform,
          status: result.partial ? 'partial' : 'success',
          items: result.posts.length,
          reportedTotal: result.reportedTotal ?? null,
          partial: Boolean(result.partial),
          warnings: result.warnings ?? [],
          error: result.partial ? (result.warnings ?? []).join('；') || '数据未完整获取' : null
        };
      }
    } catch (error) {
      outcome = {
        platform: collector.platform,
        status: 'error',
        items: 0,
        reportedTotal: null,
        partial: false,
        error: sanitizeError(error)
      };
    }

    db.prepare(`
      UPDATE collector_runs
      SET finished_at = ?, status = ?, items = ?, reported_total = ?, partial = ?, error = ?
      WHERE id = ?
    `).run(
      new Date(now).toISOString(),
      outcome.status,
      outcome.items,
      outcome.reportedTotal,
      outcome.partial ? 1 : 0,
      outcome.status === 'error' ? outcome.error : outcome.error ?? null,
      run.lastInsertRowid
    );
    results.push(outcome);

    if (delayMs > 0 && index < collectors.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return results;
}

function sanitizeError(error) {
  const name = error instanceof Error ? error.name : 'Error';
  return `${name}: collection failed`;
}
