import assert from 'node:assert/strict';
import test from 'node:test';

import { chromium } from 'playwright-core';

import { findChromeExecutable } from '../src/browser.mjs';
import { initSchema, openDatabase, saveCollection } from '../src/db.mjs';
import { startServer } from '../src/server.mjs';

test('dashboard renders crisp standard typography and compact surfaces', async t => {
  const page = await dashboardPage(t);
  const visual = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const number = getComputedStyle(document.querySelector('#latest-views'));
    const supportingText = getComputedStyle(document.querySelector('.comparison-note'));
    const panel = getComputedStyle(document.querySelector('.panel'));
    return {
      bodyFont: body.fontFamily,
      bodySize: body.fontSize,
      numberWeight: number.fontWeight,
      supportingTextSize: supportingText.fontSize,
      panelBackground: panel.backgroundColor,
      panelShadow: panel.boxShadow,
      documentHeight: document.documentElement.scrollHeight
    };
  });

  assert.doesNotMatch(visual.bodyFont, /Inter/i);
  assert.match(visual.bodyFont, /Segoe UI Variable/);
  assert.equal(visual.bodySize, '14px');
  assert.equal(visual.numberWeight, '600');
  assert.equal(visual.supportingTextSize, '12px');
  assert.equal(visual.panelBackground, 'rgb(255, 255, 255)');
  assert.doesNotMatch(visual.panelShadow, /50px/);
  assert.ok(visual.documentHeight <= 1250, `document height was ${visual.documentHeight}px`);
});

test('cover tilt batches pointer movement into the next animation frame', async t => {
  const page = await dashboardPage(t);
  const result = await page.evaluate(async () => {
    const stage = document.querySelector('#cover-stage');
    const card = document.querySelector('#cover-card');
    const box = stage.getBoundingClientRect();
    stage.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true,
      clientX: box.right - 2,
      clientY: box.top + 2
    }));
    const synchronous = card.style.transform;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { synchronous, animated: card.style.transform };
  });

  assert.equal(result.synchronous, '');
  assert.match(result.animated, /rotateY\(/);
});

test('dashboard exposes three login controls and visible one-point follower trends', async t => {
  const page = await dashboardPage(t);
  const result = await page.evaluate(() => ({
    loginButtons: document.querySelectorAll('[data-login-platform]').length,
    followerSeries: echarts.getInstanceByDom(document.querySelector('#followers-chart')).getOption().series,
    miniSeries: [...document.querySelectorAll('.mini-chart')].map(element => (
      echarts.getInstanceByDom(element).getOption().series[0]
    ))
  }));

  assert.equal(result.loginButtons, 3);
  assert.equal(result.followerSeries.length, 3);
  assert.equal(result.followerSeries.every(series => series.showSymbol === true), true);
  assert.equal(result.miniSeries.length, 3);
  assert.equal(result.miniSeries.every(series => series.showSymbol === true), true);
});

test('manual collection shows webpage progress while Chrome stays in background', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const page = await dashboardPage(t, {
    runCollection: async () => {
      await gate;
      return [{ platform: 'douyin', status: 'success' }];
    }
  });
  const fallback = setTimeout(() => release(), 2000);
  t.after(() => { clearTimeout(fallback); release(); });

  await page.locator('#collect-now').click();
  await page.locator('#task-dialog[open]').waitFor({ timeout: 1000 });
  assert.match(await page.locator('#task-title').textContent(), /后台采集/);
  assert.match(await page.locator('#task-detail').textContent(), /不会显示浏览器/);

  release();
  await page.waitForFunction(() => /采集完成/.test(document.querySelector('#task-title')?.textContent || ''));
});

test('expired cookies show an actionable platform login alert', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const page = await dashboardPage(t, {
    runLogin: async () => { await gate; },
    setupDb: db => db.prepare(`
      INSERT INTO collector_runs (platform, started_at, finished_at, status, error)
      VALUES ('xiaohongshu', '2026-11-20T01:00:00.000Z', '2026-11-20T01:00:01.000Z', 'needs_login', 'Login required')
    `).run()
  });
  const fallback = setTimeout(() => release(), 2000);
  t.after(() => { clearTimeout(fallback); release(); });

  const alert = page.locator('#auth-alerts');
  await alert.waitFor();
  assert.match(await alert.textContent(), /小红书.*重新登录/);
  await alert.locator('[data-login-platform="xiaohongshu"]').click();
  await page.locator('#task-dialog[open]').waitFor({ timeout: 1000 });
  assert.match(await page.locator('#task-title').textContent(), /登录小红书/);

  release();
  await page.waitForFunction(() => /登录成功/.test(document.querySelector('#task-title')?.textContent || ''));
});

test('partial and failed collection states stay prominently visible', async t => {
  const page = await dashboardPage(t, {
    setupDb: db => {
      db.prepare(`
        INSERT INTO collector_runs (platform, started_at, finished_at, status, partial, error)
        VALUES ('xiaohongshu', '2026-11-20T01:00:00.000Z', '2026-11-20T01:00:01.000Z', 'partial', 1, '内容深度指标暂不可用')
      `).run();
      db.prepare(`
        INSERT INTO collector_runs (platform, started_at, finished_at, status, error)
        VALUES ('douyin', '2026-11-20T01:00:00.000Z', '2026-11-20T01:00:01.000Z', 'error', 'Error: collection failed')
      `).run();
    }
  });

  const alert = page.locator('#auth-alerts');
  await alert.waitFor();
  const text = await alert.textContent();
  assert.match(text, /小红书 数据采集不完整.*内容深度指标暂不可用.*15 分钟后自动重试/s);
  assert.match(text, /抖音 数据采集失败.*15 分钟后自动重试/s);
  assert.equal(await alert.locator('.auth-alert-item.warning').count(), 1);
  assert.equal(await alert.locator('.auth-alert-item.danger').count(), 1);
});

test('content archive uses two-column magazine cards with visible platform metrics', async t => {
  const page = await contentPage(t);
  const desktop = await page.evaluate(() => {
    const list = document.querySelector('#content-list');
    const cards = [...document.querySelectorAll('.content-item')];
    const card = cards[0];
    const partialCard = cards[1];
    const platformCards = [...card.querySelectorAll('.post-card')];
    const partialPlatformCards = [...partialCard.querySelectorAll('.post-card')];
    return {
      cards: cards.length,
      columns: getComputedStyle(list).gridTemplateColumns.split(' ').length,
      coverWidth: Number.parseFloat(getComputedStyle(card.querySelector('.content-thumb')).width),
      platformCards: platformCards.length,
      allPlatformsVisible: platformCards.every(item => item.getClientRects().length > 0),
      partialPlatformCards: partialPlatformCards.length,
      missingLabels: partialCard.querySelectorAll('.post-empty-label').length,
      cardTag: card.tagName
    };
  });

  assert.equal(desktop.cards, 2);
  assert.equal(desktop.columns, 2);
  assert.ok(desktop.coverWidth >= 100, `cover width was ${desktop.coverWidth}px`);
  assert.equal(desktop.platformCards, 3);
  assert.equal(desktop.allPlatformsVisible, true);
  assert.equal(desktop.partialPlatformCards, 3);
  assert.equal(desktop.missingLabels, 2);
  assert.equal(desktop.cardTag, 'ARTICLE');

  await page.setViewportSize({ width: 760, height: 900 });
  const mobileColumns = await page.locator('#content-list').evaluate(element => (
    getComputedStyle(element).gridTemplateColumns.split(' ').length
  ));
  assert.equal(mobileColumns, 1);
});

test('content comparison dialog renders three charts and explicit missing metrics', async t => {
  const page = await contentPage(t);

  await page.locator('[data-open-content]').first().click({ timeout: 1000 });
  const dialog = page.locator('#content-insight-dialog[open]');
  await dialog.waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.insight-chart canvas').length === 3);

  const desktop = await dialog.evaluate(element => ({
    title: element.querySelector('#content-insight-title')?.textContent,
    rows: element.querySelectorAll('#content-insight-table tbody tr').length,
    charts: element.querySelectorAll('.insight-chart canvas').length,
    missing: element.textContent.includes('平台未提供'),
    width: element.getBoundingClientRect().width
  }));
  assert.match(desktop.title, /跨平台内容样片/);
  assert.equal(desktop.rows, 3);
  assert.equal(desktop.charts, 3);
  assert.equal(desktop.missing, true);
  assert.ok(desktop.width >= 900, `dialog width was ${desktop.width}px`);

  await page.setViewportSize({ width: 760, height: 900 });
  const mobileColumns = await page.locator('.insight-chart-grid').evaluate(element => (
    getComputedStyle(element).gridTemplateColumns.split(' ').length
  ));
  assert.equal(mobileColumns, 1);
});

test('content comparison cancels a closed request before opening another item', async t => {
  const page = await contentPage(t);
  await page.route('**/api/contents/1', async route => {
    await new Promise(resolve => setTimeout(resolve, 250));
    await route.continue().catch(() => {});
  });

  await page.locator('[data-open-content]').first().click();
  await page.locator('#content-insight-dialog[open]').waitFor();
  await page.locator('.dialog-close').click();
  await page.locator('[data-open-content]').nth(1).click();
  await page.waitForFunction(() => document.querySelector('#content-insight-title')?.textContent.includes('只有一个平台的内容'));
  await page.waitForTimeout(300);

  assert.match(await page.locator('#content-insight-title').textContent(), /只有一个平台的内容/);
});

async function dashboardPage(t, { runCollection = async () => [], runLogin = async () => {}, setupDb = () => {} } = {}) {
  const db = openDatabase(':memory:');
  initSchema(db);
  for (const [platform, views] of [['xiaohongshu', 120], ['douyin', 350], ['channels', 230]]) {
    saveCollection(db, contentCollection(platform, views), new Date('2026-11-20T04:00:00.000Z'));
  }
  setupDb(db);
  const server = await startServer({ db, port: 0, runCollection, runLogin, write: () => {} });
  const browser = await chromium.launch({ executablePath: findChromeExecutable(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle' });
  return page;
}

async function contentPage(t) {
  const db = openDatabase(':memory:');
  initSchema(db);
  for (const [platform, views] of [['xiaohongshu', 120], ['douyin', 350], ['channels', 230]]) {
    saveCollection(db, contentCollection(platform, views), new Date('2026-11-20T04:00:00.000Z'));
  }
  const server = await startServer({ db, port: 0, runCollection: async () => [], write: () => {} });
  const browser = await chromium.launch({ executablePath: findChromeExecutable(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/content`, { waitUntil: 'networkidle' });
  return page;
}

function contentCollection(platform, views) {
  const posts = [{
    postId: `${platform}-post`,
    title: '跨平台内容样片',
    url: `https://example.test/${platform}`,
    coverUrl: null,
    publishedAt: '2026-11-20T02:00:00.000Z'
  }];
  const metrics = [{
    postId: `${platform}-post`,
    views,
    likes: 10,
    comments: 2,
    favorites: 3,
    shares: 1,
    durationSeconds: 100,
    averageWatchSeconds: platform === 'xiaohongshu' ? 32 : platform === 'douyin' ? 28 : 35,
    completionRate: platform === 'xiaohongshu' ? null : .24,
    fiveSecondCompletionRate: platform === 'douyin' ? .61 : null,
    twoSecondBounceRate: platform === 'douyin' ? .18 : null,
    impressions: platform === 'xiaohongshu' ? 600 : null,
    coverClickRate: platform === 'xiaohongshu' ? .12 : null,
    followersGained: 2
  }];
  if (platform === 'xiaohongshu') {
    posts.push({
      postId: 'xiaohongshu-partial',
      title: '只有一个平台的内容',
      url: 'https://example.test/xiaohongshu-partial',
      coverUrl: null,
      publishedAt: '2026-11-19T02:00:00.000Z'
    });
    metrics.push({
      postId: 'xiaohongshu-partial',
      views: 80,
      likes: 4,
      comments: 1,
      favorites: 2,
      shares: 0,
      durationSeconds: 80,
      averageWatchSeconds: 20,
      completionRate: null,
      fiveSecondCompletionRate: null,
      twoSecondBounceRate: null,
      impressions: 300,
      coverClickRate: .1,
      followersGained: 1
    });
  }
  return {
    platform,
    account: { platformAccountId: `${platform}-account`, displayName: platform, avatarUrl: null },
    accountSnapshot: { followers: 10, following: null, likesReceived: null },
    posts,
    metrics,
    reportedTotal: posts.length,
    partial: false,
    warnings: []
  };
}
