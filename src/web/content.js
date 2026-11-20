import { PLATFORMS, escapeHtml, fetchJson, formatDateTime, formatMetric, formatRate, statusPresentation } from './shared.js';

const form = document.querySelector('#content-filters');
const list = document.querySelector('#content-list');
const insightDialog = document.querySelector('#content-insight-dialog');
let insightCharts = [];
form.addEventListener('change', loadContents);
list.addEventListener('click', event => {
  const button = event.target.closest('[data-open-content]');
  if (button) void openContentDetail(button.dataset.openContent);
});
insightDialog.addEventListener('close', disposeInsightCharts);
window.addEventListener('resize', () => insightCharts.forEach(chart => chart.resize()));
loadPage();

async function loadPage() {
  const [health] = await Promise.all([fetchJson('/api/health'), loadContents()]);
  const byPlatform = new Map((health.platforms || []).map(record => [record.platform, record]));
  document.querySelector('#header-status').innerHTML = Object.entries(PLATFORMS).map(([key, platform]) => {
    const presentation = statusPresentation(byPlatform.get(key));
    return `<span class="status-pill ${presentation.tone}" title="${presentation.label}">${platform.name}</span>`;
  }).join('');
}

async function loadContents() {
  const params = new URLSearchParams();
  const platform = document.querySelector('#platform-filter').value;
  const days = Number(document.querySelector('#date-filter').value);
  if (platform) params.set('platform', platform);
  if (days) {
    const from = new Date();
    from.setDate(from.getDate() - days + 1);
    params.set('from', from.toISOString().slice(0, 10));
  }
  try {
    const contents = await fetchJson(`/api/contents?${params}`);
    renderContents(contents);
  } catch (error) {
    document.querySelector('#content-list').innerHTML = `<div class="panel empty-block">内容载入失败：${escapeHtml(error.message)}</div>`;
  }
}

function renderContents(contents) {
  document.querySelector('#result-count').textContent = `${contents.length} 条内容`;
  document.querySelector('#content-list').innerHTML = contents.length ? contents.map(content => {
    const views = content.posts.reduce((sum, post) => sum + (post.metrics?.views || 0), 0);
    const postsByPlatform = new Map(content.posts.map(post => [post.platform, post]));
    const title = content.title || '未命名内容';
    return `<article class="panel content-item">
      <div class="content-card-main">
        <div class="content-thumb">${content.coverPath ? `<img src="${escapeHtml(content.coverPath)}" alt="" loading="lazy">` : ''}</div>
        <div class="content-copy">
          <div class="content-kicker"><span>${escapeHtml(formatDateTime(content.publishedAt))}</span><span>${content.posts.length}/3 平台已采集</span></div>
          <h2 title="${escapeHtml(title)}">${escapeHtml(title)}</h2>
          <div class="content-platforms">${Object.entries(PLATFORMS).map(([key, platform]) => `<span class="content-platform-chip${postsByPlatform.has(key) ? '' : ' is-missing'}"><i style="background:${platform.color}"></i>${platform.name}</span>`).join('')}</div>
        </div>
        <div class="content-total"><span>全平台播放</span><strong>${formatMetric(views)}</strong><button class="content-open" type="button" data-open-content="${content.id}">查看深度对比</button></div>
      </div>
      <div class="content-detail"><div class="post-grid">${Object.keys(PLATFORMS).map(key => renderPost(postsByPlatform.get(key), key)).join('')}</div></div>
    </article>`;
  }).join('') : '<div class="panel empty-block">当前筛选条件没有内容。</div>';
}

async function openContentDetail(contentId) {
  disposeInsightCharts();
  document.querySelector('#content-insight-title').textContent = '正在载入内容…';
  document.querySelector('#content-insight-meta').textContent = '正在读取三个平台的数据';
  document.querySelector('#content-insight-table tbody').innerHTML = '<tr><td colspan="9">正在读取内容指标…</td></tr>';
  if (!insightDialog.open) insightDialog.showModal();
  try {
    renderContentDetail(await fetchJson(`/api/contents/${contentId}`));
  } catch (error) {
    document.querySelector('#content-insight-title').textContent = '内容数据载入失败';
    document.querySelector('#content-insight-meta').textContent = error.message;
    document.querySelector('#content-insight-table tbody').innerHTML = '<tr><td colspan="9">请稍后重新采集再试。</td></tr>';
  }
}

function renderContentDetail(content) {
  const posts = new Map(content.posts.map(post => [post.platform, post]));
  document.querySelector('#content-insight-title').textContent = content.title || '未命名内容';
  document.querySelector('#content-insight-meta').textContent = `${formatDateTime(content.publishedAt)} · ${content.posts.length}/3 平台已采集`;
  document.querySelector('#content-insight-table tbody').innerHTML = Object.keys(PLATFORMS)
    .map(platform => renderInsightRow(posts.get(platform), platform)).join('');
  renderInsightChart('watch-progress-chart', content.posts, 'averageWatchProgress');
  renderInsightChart('interaction-rate-chart', content.posts, 'interactionRate');
  renderInsightChart('follower-conversion-chart', content.posts, 'followerConversionRate');
}

function renderInsightRow(post, platformKey) {
  const platform = PLATFORMS[platformKey];
  const platformCell = `<span class="insight-platform"><i style="background:${platform.color}">${platform.short}</i>${platform.name}</span>`;
  if (!post) return `<tr><td>${platformCell}</td><td colspan="8"><span class="metric-missing">未采集</span></td></tr>`;
  const metrics = post.metrics || {};
  const exposure = metrics.impressions == null && metrics.coverClickRate == null
    ? missingMetric()
    : `${formatMetric(metrics.impressions)} / ${formatOptionalRate(metrics.coverClickRate)}`;
  return `<tr>
    <td>${platformCell}</td>
    <td>${formatSeconds(metrics.averageWatchSeconds)}</td>
    <td>${formatOptionalRate(metrics.averageWatchProgress)}</td>
    <td>${formatOptionalRate(metrics.completionRate)}</td>
    <td>${formatOptionalRate(metrics.fiveSecondCompletionRate)}</td>
    <td>${formatOptionalRate(metrics.twoSecondBounceRate)}</td>
    <td>${formatOptionalRate(metrics.interactionRate)}</td>
    <td>${formatOptionalRate(metrics.followerConversionRate)}</td>
    <td>${exposure}</td>
  </tr>`;
}

function renderInsightChart(elementId, posts, metric) {
  const element = document.querySelector(`#${elementId}`);
  const dates = [...new Set(posts.flatMap(post => (post.history || []).map(point => point.date)))].sort();
  const chart = window.echarts.init(element);
  insightCharts.push(chart);
  chart.setOption({
    color: Object.values(PLATFORMS).map(platform => platform.color),
    animationDuration: 450,
    tooltip: { trigger: 'axis', valueFormatter: value => value == null ? '平台未提供' : `${(value * 100).toFixed(1)}%` },
    legend: { top: 0, right: 0, itemWidth: 9, itemHeight: 9, textStyle: { color: '#73737B', fontSize: 10 } },
    grid: { left: 6, right: 8, top: 36, bottom: 2, containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: dates, axisLine: { lineStyle: { color: '#E4E4E8' } }, axisTick: { show: false }, axisLabel: { color: '#9A9AA1', fontSize: 9 } },
    yAxis: { type: 'value', axisLabel: { color: '#9A9AA1', fontSize: 9, formatter: value => `${Math.round(value * 100)}%` }, splitLine: { lineStyle: { color: '#EFEFF2' } } },
    series: posts.map(post => ({
      name: PLATFORMS[post.platform]?.name || post.platform,
      type: 'line',
      smooth: .32,
      symbol: 'circle',
      symbolSize: 6,
      showSymbol: dates.length <= 2,
      connectNulls: false,
      lineStyle: { width: 2.5 },
      data: dates.map(date => post.history?.find(point => point.date === date)?.[metric] ?? null)
    }))
  });
}

function formatSeconds(value) {
  return value == null || !Number.isFinite(Number(value)) ? missingMetric() : `${Number(value).toFixed(1)}秒`;
}

function formatOptionalRate(value) {
  return value == null || !Number.isFinite(Number(value)) ? missingMetric() : formatRate(value);
}

function missingMetric() {
  return '<span class="metric-missing">平台未提供</span>';
}

function disposeInsightCharts() {
  insightCharts.forEach(chart => chart.dispose());
  insightCharts = [];
}

function renderPost(post, platformKey) {
  const platform = PLATFORMS[platformKey] || { name: platformKey, short: '?', color: '#73737B' };
  if (!post) {
    return `<article class="post-card is-empty">
      <div class="post-card-head"><div class="platform-name"><span class="platform-icon" style="background:${platform.color}">${platform.short}</span>${platform.name}</div></div>
      <span class="post-empty-label">未采集</span>
    </article>`;
  }
  const metrics = post.metrics || {};
  return `<article class="post-card">
    <div class="post-card-head"><div class="platform-name"><span class="platform-icon" style="background:${platform.color}">${platform.short}</span>${platform.name}</div>${post.url ? `<a href="${escapeHtml(post.url)}" target="_blank" rel="noreferrer">打开原文</a>` : ''}</div>
    <div class="post-stats"><div><span>播放</span><strong>${formatMetric(metrics.views)}</strong></div><div><span>互动率</span><strong>${formatRate(metrics.interactionRate)}</strong></div><div><span>点赞</span><strong>${formatMetric(metrics.likes)}</strong></div></div>
  </article>`;
}
