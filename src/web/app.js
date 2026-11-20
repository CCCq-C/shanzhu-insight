import { PLATFORMS, escapeHtml, fetchJson, formatDateTime, formatMetric, formatRate, statusPresentation } from './shared.js';

let charts = [];

loadDashboard();
document.querySelector('#collect-now').addEventListener('click', collectNow);
window.addEventListener('resize', () => charts.forEach(chart => chart.resize()));

async function loadDashboard() {
  try {
    const [overview, health] = await Promise.all([fetchJson('/api/overview'), fetchJson('/api/health')]);
    renderHeader(overview, health);
    renderLatest(overview);
    renderFollowers(overview);
    renderInsights(overview);
    renderPlatforms(overview);
    renderComparison(overview);
    enableCoverTilt();
  } catch (error) {
    showToast(`看板载入失败：${error.message}`);
  }
}

function renderHeader(overview, health) {
  const statusByPlatform = new Map((health.platforms || []).map(record => [record.platform, record]));
  document.querySelector('#header-status').innerHTML = Object.entries(PLATFORMS).map(([key, platform]) => {
    const presentation = statusPresentation(statusByPlatform.get(key));
    return `<span class="status-pill ${presentation.tone}" title="${presentation.label}">${platform.name}</span>`;
  }).join('');
  document.querySelector('#last-updated').textContent = formatDateTime(overview.lastCollectedAt);
}

function renderLatest(overview) {
  const content = overview.latestContent;
  if (!content) return;
  const posts = content.posts || [];
  const knownViews = posts.map(post => post.metrics?.views).filter(value => value != null);
  const knownInteractions = posts.flatMap(post => ['likes', 'comments', 'favorites', 'shares']
    .map(field => post.metrics?.[field]).filter(value => value != null));
  const totals = {
    views: knownViews.length ? knownViews.reduce((sum, value) => sum + value, 0) : null,
    interactions: knownInteractions.length ? knownInteractions.reduce((sum, value) => sum + value, 0) : null
  };
  const rate = totals.views > 0 && totals.interactions != null ? totals.interactions / totals.views : null;
  const title = content.title || '未命名内容';
  document.querySelector('#latest-title').textContent = title;
  document.querySelector('#latest-title').title = title;
  document.querySelector('#latest-date').textContent = formatDateTime(content.publishedAt);
  document.querySelector('#publish-badge').textContent = `${posts.length}/3 平台已获取`;
  document.querySelector('#latest-views').textContent = formatMetric(totals.views);
  document.querySelector('#latest-interactions').textContent = formatMetric(totals.interactions);
  document.querySelector('#latest-rate').textContent = formatRate(rate);
  document.querySelector('#latest-platforms').innerHTML = posts.map(post => {
    const platform = PLATFORMS[post.platform] || { name: post.platform, short: '?', color: '#73737B' };
    return `<div class="platform-metric"><span class="platform-icon" style="background:${platform.color}">${platform.short}</span><span>${platform.name}</span><strong>${formatMetric(post.metrics?.views)}</strong></div>`;
  }).join('');
  document.querySelector('#latest-comparison').textContent = `${posts.length} 个平台合计 ${formatMetric(totals.views)} 次播放，互动率 ${formatRate(rate)}。`;
  if (content.coverPath) {
    const cover = document.querySelector('#latest-cover');
    document.querySelector('#latest-content').style.setProperty('--cover-art', `url(${JSON.stringify(content.coverPath)})`);
    cover.src = content.coverPath;
    cover.hidden = false;
    document.querySelector('#cover-placeholder').hidden = true;
  }
}

function renderFollowers(overview) {
  document.querySelector('#total-followers').textContent = formatMetric(overview.totalFollowers);
  const knownChanges = overview.platforms.map(platform => platform.followerChange7d).filter(value => value != null);
  const totalChange = knownChanges.length ? knownChanges.reduce((sum, value) => sum + value, 0) : null;
  document.querySelector('#follower-change').textContent = `近 7 天 ${totalChange == null ? '—' : `${totalChange >= 0 ? '+' : ''}${formatMetric(totalChange)}`}`;
  charts.push(createLineChart(document.querySelector('#followers-chart'), overview.platforms));
}

function renderInsights(overview) {
  const insights = [];
  const gains = overview.platforms.filter(platform => platform.followerChange7d != null).sort((a, b) => b.followerChange7d - a.followerChange7d);
  if (gains.length) {
    const winner = gains[0];
    insights.push({ title: '粉丝增长', body: `近 7 天增长最快的是 ${PLATFORMS[winner.platform]?.name || winner.platform}，净增 ${formatMetric(winner.followerChange7d)}。` });
  }
  const latestPosts = overview.latestContent?.posts || [];
  const viewTotal = latestPosts.reduce((sum, post) => sum + (post.metrics?.views || 0), 0);
  if (viewTotal > 0) {
    const top = [...latestPosts].sort((a, b) => (b.metrics?.views || 0) - (a.metrics?.views || 0))[0];
    insights.push({ title: '流量来源', body: `${PLATFORMS[top.platform]?.name || top.platform} 贡献最新内容 ${Math.round((top.metrics?.views || 0) / viewTotal * 100)}% 的播放。` });
  }
  const comparisons = latestPosts.map(post => {
    const history = (overview.recentContents || []).slice(1)
      .map(content => content.posts.find(candidate => candidate.platform === post.platform)?.metrics?.views)
      .filter(value => value != null)
      .sort((a, b) => a - b);
    const baseline = median(history);
    return baseline > 0 && post.metrics?.views != null
      ? { post, change: (post.metrics.views - baseline) / baseline }
      : null;
  }).filter(Boolean).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  if (comparisons.length) {
    const { post, change } = comparisons[0];
    insights.push({ title: '历史对比', body: `${PLATFORMS[post.platform]?.name || post.platform} 最新播放比近期中位数${change >= 0 ? '高' : '低'} ${Math.round(Math.abs(change) * 100)}%。` });
  }
  document.querySelector('#insights-list').innerHTML = insights.length
    ? insights.slice(0, 4).map((insight, index) => `<article class="insight-item" data-index="0${index + 1}"><strong>${escapeHtml(insight.title)}</strong><p>${escapeHtml(insight.body)}</p></article>`).join('')
    : '<div class="empty-block">有足够数据后，自动生成可解释洞察。</div>';
}

function renderPlatforms(overview) {
  const grid = document.querySelector('#platform-grid');
  const byPlatform = new Map(overview.platforms.map(platform => [platform.platform, platform]));
  grid.innerHTML = Object.entries(PLATFORMS).map(([key, metadata], index) => {
    const data = byPlatform.get(key) || { platform: key, history: [] };
    const state = statusPresentation(data);
    const delta = data.followerChange7d;
    return `<article class="panel platform-card" style="--platform-color:${metadata.color}">
      <div class="platform-card-head"><div class="platform-name"><span class="platform-icon" style="background:${metadata.color}">${metadata.short}</span>${metadata.name}</div><span class="platform-status">${state.label}</span></div>
      <div class="platform-followers"><span>粉丝</span><strong>${formatMetric(data.followers)}</strong></div>
      <div class="mini-chart" id="mini-chart-${index}" aria-label="${metadata.name}粉丝趋势"></div>
      <div class="platform-foot">近 7 天 ${delta == null ? '—' : `${delta >= 0 ? '+' : ''}${formatMetric(delta)}`}</div>
    </article>`;
  }).join('');
  Object.keys(PLATFORMS).forEach((key, index) => charts.push(createMiniChart(document.querySelector(`#mini-chart-${index}`), byPlatform.get(key), PLATFORMS[key].color)));
}

function renderComparison(overview) {
  const contents = (overview.recentContents || []).slice(0, 8).reverse();
  const compact = matchMedia('(max-width: 520px)').matches;
  const chart = echarts.init(document.querySelector('#comparison-chart'), null, { renderer: 'svg' });
  chart.setOption({
    animationDuration: 520,
    animationEasing: 'cubicOut',
    color: Object.values(PLATFORMS).map(platform => platform.color),
    tooltip: { trigger: 'axis', borderWidth: 0, backgroundColor: 'rgba(29,29,31,.9)', textStyle: { color: '#fff', fontSize: 11 } },
    legend: { top: 4, right: 0, itemWidth: 9, itemHeight: 9, textStyle: { color: '#777780', fontSize: 10 } },
    grid: { left: 4, right: 4, top: 42, bottom: 8, containLabel: true },
    xAxis: { type: 'category', data: contents.map(content => content.title), axisLine: { lineStyle: { color: '#E4E4E8' } }, axisTick: { show: false }, axisLabel: { color: '#818187', fontSize: 10, rotate: compact ? 28 : 0, interval: compact ? 1 : 0, formatter: value => truncate(value, compact ? 5 : 9) } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: '#EEEEF1' } }, axisLabel: { color: '#86868B', fontSize: 10 }, axisLine: { show: false }, axisTick: { show: false } },
    series: Object.entries(PLATFORMS).map(([key, platform]) => ({
      name: platform.name,
      type: 'bar',
      barMaxWidth: 18,
      itemStyle: { borderRadius: [6, 6, 2, 2] },
      data: contents.map(content => content.posts.find(post => post.platform === key)?.metrics?.views ?? null)
    }))
  });
  charts.push(chart);
}

function createLineChart(element, platforms) {
  const dates = [...new Set(platforms.flatMap(platform => platform.history.map(point => point.date)))].sort();
  const chart = echarts.init(element, null, { renderer: 'svg' });
  chart.setOption({
    animationDuration: 520,
    animationEasing: 'cubicOut',
    color: platforms.map(platform => PLATFORMS[platform.platform]?.color || '#73737B'),
    tooltip: { trigger: 'axis', borderWidth: 0, backgroundColor: 'rgba(29,29,31,.9)', textStyle: { color: '#fff', fontSize: 11 } },
    legend: { top: 3, right: 0, itemWidth: 8, itemHeight: 8, textStyle: { color: '#777780', fontSize: 10 } },
    grid: { top: 40, right: 8, bottom: 14, left: 5, containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: dates, axisLine: { lineStyle: { color: '#E4E4E8' } }, axisTick: { show: false }, axisLabel: { color: '#86868B', fontSize: 10, formatter: value => value.slice(5) } },
    yAxis: { type: 'value', scale: true, splitNumber: 4, splitLine: { lineStyle: { color: '#EEEEF1' } }, axisLabel: { color: '#86868B', fontSize: 10 }, axisLine: { show: false }, axisTick: { show: false } },
    series: platforms.map(platform => ({ name: PLATFORMS[platform.platform]?.name || platform.platform, type: 'line', smooth: .3, symbol: 'circle', symbolSize: 5, showSymbol: false, lineStyle: { width: 2.5 }, areaStyle: { opacity: .06 }, data: dates.map(date => platform.history.find(point => point.date === date)?.followers ?? null) }))
  });
  return chart;
}

function createMiniChart(element, platform, color) {
  const chart = echarts.init(element, null, { renderer: 'svg' });
  chart.setOption({
    animationDuration: 460,
    animationEasing: 'cubicOut',
    grid: { inset: 0, left: 0, right: 0, top: 8, bottom: 0 },
    xAxis: { type: 'category', show: false, data: platform?.history.map(point => point.date) || [] },
    yAxis: { type: 'value', show: false, scale: true },
    series: [{ type: 'line', smooth: .35, showSymbol: false, lineStyle: { color, width: 2 }, areaStyle: { color, opacity: .09 }, data: platform?.history.map(point => point.followers) || [] }]
  });
  return chart;
}

async function collectNow() {
  const button = document.querySelector('#collect-now');
  button.disabled = true;
  button.textContent = '采集中…';
  try {
    await fetchJson('/api/collect', { method: 'POST' });
    showToast('采集完成，正在刷新看板。');
    setTimeout(() => location.reload(), 500);
  } catch (error) {
    showToast(error.status === 409 ? '已有采集任务运行中。' : `采集失败：${error.message}`);
    button.disabled = false;
    button.textContent = '立即采集';
  }
}

function enableCoverTilt() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const stage = document.querySelector('#cover-stage');
  const card = document.querySelector('#cover-card');
  let frame = 0;
  let nextTransform = '';
  const render = () => {
    frame = 0;
    card.style.transform = nextTransform;
  };
  const schedule = transform => {
    nextTransform = transform;
    if (!frame) frame = requestAnimationFrame(render);
  };
  stage.addEventListener('pointermove', event => {
    const box = stage.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - .5;
    const y = (event.clientY - box.top) / box.height - .5;
    schedule(`rotateY(${x * 10}deg) rotateX(${-y * 6}deg) translateY(-2px)`);
  });
  stage.addEventListener('pointerleave', () => schedule(''));
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.hidden = false;
  setTimeout(() => { toast.hidden = true; }, 3200);
}

function truncate(value, length) {
  const text = String(value || '未命名');
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function median(values) {
  if (!values.length) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}
