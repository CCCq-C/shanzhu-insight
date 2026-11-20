import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { initSchema, openDatabase } from '../src/db.mjs';
import { startServer } from '../src/server.mjs';

const webRoot = new URL('../src/web/', import.meta.url);

test('server exposes both pages and local ECharts without a CDN', async t => {
  const db = openDatabase(':memory:');
  initSchema(db);
  const server = await startServer({ db, port: 0, write: () => {} });
  t.after(() => close(server));
  const base = `http://127.0.0.1:${server.address().port}`;

  const [dashboard, content, echarts] = await Promise.all([
    fetch(`${base}/`),
    fetch(`${base}/content`),
    fetch(`${base}/vendor/echarts.min.js`)
  ]);

  assert.equal(dashboard.status, 200);
  assert.equal(content.status, 200);
  assert.equal(echarts.status, 200);
  assert.match(echarts.headers.get('content-type'), /javascript/);
});

test('dashboard HTML contains the approved information architecture', () => {
  const html = fs.readFileSync(new URL('index.html', webRoot), 'utf8');

  for (const id of [
    'collect-now',
    'latest-content',
    'followers-chart',
    'insights-list',
    'platform-grid',
    'comparison-chart',
    'auth-alerts',
    'task-dialog',
    'task-title',
    'task-platforms'
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /山竹洞察/);
  assert.doesNotMatch(html, /麦田洞察/);
  assert.match(html, /<main/);
  assert.match(html, /\/vendor\/echarts\.min\.js/);
  assert.doesNotMatch(html, /<(?:script|link)[^>]+(?:src|href)=["']https?:/i);
});

test('content HTML contains platform and date filters', () => {
  const html = fs.readFileSync(new URL('content.html', webRoot), 'utf8');

  assert.match(html, /id=["']platform-filter["']/);
  assert.match(html, /id=["']date-filter["']/);
  assert.match(html, /id=["']content-list["']/);
  assert.match(html, /<main/);
  assert.doesNotMatch(html, /<(?:script|link)[^>]+(?:src|href)=["']https?:/i);
});

test('styles use approved tokens and accessibility fallbacks', () => {
  const css = fs.readFileSync(new URL('styles.css', webRoot), 'utf8');

  for (const token of ['#F5F5F7', '#FF2442', '#1D1D1F', '#FA9D3B', '#0071E3']) {
    assert.match(css.toUpperCase(), new RegExp(token.toUpperCase()));
  }
  assert.match(css, /--panel-radius:\s*20px/);
  assert.match(css, /border-radius:\s*var\(--panel-radius\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

test('mobile comparison chart reduces crowded category labels', () => {
  const source = fs.readFileSync(new URL('app.js', webRoot), 'utf8');

  assert.match(source, /matchMedia\(['"]\(max-width:\s*520px\)['"]\)/);
  assert.match(source, /rotate:\s*compact\s*\?/);
  assert.match(source, /interval:\s*compact\s*\?/);
});

test('shared formatters distinguish missing values, rates, and partial status', async () => {
  const { escapeHtml, formatMetric, formatRate, statusPresentation } = await import('../src/web/shared.js');

  assert.equal(formatMetric(null), '—');
  assert.equal(formatMetric(1200), '1,200');
  assert.equal(formatRate(null), '未知');
  assert.equal(statusPresentation({ status: 'partial' }).label, '数据不完整');
  assert.equal(statusPresentation({ status: 'needs_login' }).label, '需要登录');
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
});

function close(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}
