import assert from 'node:assert/strict';
import test from 'node:test';

import { chromium } from 'playwright-core';

import { findChromeExecutable } from '../src/browser.mjs';
import { initSchema, openDatabase } from '../src/db.mjs';
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

async function dashboardPage(t) {
  const db = openDatabase(':memory:');
  initSchema(db);
  const server = await startServer({ db, port: 0, runCollection: async () => [], write: () => {} });
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
