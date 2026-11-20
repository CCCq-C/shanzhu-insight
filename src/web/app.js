import { PLATFORMS, escapeHtml, fetchJson, formatDateTime, formatMetric, formatRate, statusPresentation } from './shared.js';

let charts = [];

loadDashboard();
enableCoverTilt();
document.querySelector('#collect-now').addEventListener('click', collectNow);
document.querySelector('#task-close').addEventListener('click', () => document.querySelector('#task-dialog').close());
document.addEventListener('click', event => {
  const button = event.target.closest('[data-login-platform]');
  if (button) void loginPlatform(button.dataset.loginPlatform);
});
window.addEventListener('resize', () => charts.forEach(chart => chart.resize()));
setInterval(() => loadDashboard({ silent: true }), 30_000);

async function loadDashboard({ silent = false } = {}) {
  try {
    const [overview, health] = await Promise.all([fetchJson('/api/overview'), fetchJson('/api/health')]);
    charts.forEach(chart => chart.dispose());
    charts = [];
    renderHeader(overview, health);
    renderAuthAlerts(health);
    renderRuntime(health);
    renderLatest(overview);
    renderFollowers(overview);
    renderInsights(overview);
    renderPlatforms(overview, health);
    renderComparison(overview);
  } catch (error) {
    if (!silent) showToast(`看板载入失败：${error.message}`);
  }
}

function renderHeader(overview, health) {
  const statusByPlatform = new Map((health.platforms || []).map(record => [record.platform, record]));
  const loginByPlatform = new Map((health.logins || []).map(record => [record.platform, record]));
  document.querySelector('#header-status').innerHTML = Object.entries(PLATFORMS).map(([key, platform]) => {
    const presentation = platformPresentation(statusByPlatform.get(key), loginByPlatform.get(key));
    return `<span class="status-pill ${presentation.tone}" title="${presentation.label}">${platform.name}</span>`;
  }).join('');
  document.querySelector('#last-updated').textContent = formatDateTime(overview.lastCollectedAt);
}

function renderAuthAlerts(health) {
  const alert = document.querySelector('#auth-alerts');
  const loginByPlatform = new Map((health.logins || []).map(record => [record.platform, record]));
  const expired = (health.platforms || []).filter(record => (
    record.status === 'needs_login' && platformPresentation(record, loginByPlatform.get(record.platform)).label === '需要登录'
  ));
  alert.hidden = expired.length === 0;
  alert.innerHTML = expired.map(record => {
    const platform = PLATFORMS[record.platform] || { name: record.platform };
    return `<div class="auth-alert-item"><div><strong>${platform.name} Cookie 已失效</strong><span>重新登录后，后台采集会继续使用新的 Cookie。</span></div><button class="secondary-button" type="button" data-login-platform="${record.platform}">重新登录</button></div>`;
  }).join('');
}

function renderRuntime(health) {
  const button = document.querySelector('#collect-now');
  button.disabled = Boolean(health.job);
  button.textContent = health.job?.type === 'collect' ? '后台采集中…' : health.job?.type === 'login' ? '登录处理中…' : '立即采集';
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

function renderPlatforms(overview, health) {
  const grid = document.querySelector('#platform-grid');
  const byPlatform = new Map(overview.platforms.map(platform => [platform.platform, platform]));
  const statusByPlatform = new Map((health.platforms || []).map(record => [record.platform, record]));
  const loginByPlatform = new Map((health.logins || []).map(record => [record.platform, record]));
  grid.innerHTML = Object.entries(PLATFORMS).map(([key, metadata], index) => {
    const data = byPlatform.get(key) || { platform: key, history: [] };
    const state = platformPresentation(statusByPlatform.get(key) || data, loginByPlatform.get(key));
    const delta = data.followerChange7d;
    return `<article class="panel platform-card" style="--platform-color:${metadata.color}">
      <div class="platform-card-head"><div class="platform-name"><span class="platform-icon" style="background:${metadata.color}">${metadata.short}</span>${metadata.name}</div><div class="platform-card-tools"><span class="platform-status">${state.label}</span><button class="login-button" type="button" data-login-platform="${key}" ${health.job ? 'disabled' : ''}>登录/更新 Cookie</button></div></div>
      <div class="platform-followers"><span>粉丝</span><strong>${formatMetric(data.followers)}</strong></div>
      <div class="mini-chart" id="mini-chart-${index}" aria-label="${metadata.name}近 30 天粉丝趋势"></div>
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
    series: platforms.map(platform => ({ name: PLATFORMS[platform.platform]?.name || platform.platform, type: 'line', smooth: .3, symbol: 'circle', symbolSize: 6, showSymbol: dates.length <= 1, lineStyle: { width: 2.5 }, areaStyle: { opacity: .06 }, data: dates.map(date => platform.history.find(point => point.date === date)?.followers ?? null) }))
  });
  return chart;
}

function createMiniChart(element, platform, color) {
  const history = platform?.history || [];
  const chart = echarts.init(element, null, { renderer: 'svg' });
  chart.setOption({
    animationDuration: 460,
    animationEasing: 'cubicOut',
    grid: { inset: 0, left: 0, right: 0, top: 8, bottom: 0 },
    xAxis: { type: 'category', show: false, data: history.map(point => point.date) },
    yAxis: { type: 'value', show: false, scale: true },
    series: [{ type: 'line', smooth: .35, symbolSize: 6, showSymbol: history.length <= 1, lineStyle: { color, width: 2 }, areaStyle: { color, opacity: .09 }, data: history.map(point => point.followers) }]
  });
  return chart;
}

async function collectNow() {
  const button = document.querySelector('#collect-now');
  openTaskDialog('后台采集中', 'Chrome 不会显示浏览器，任务会在后台完成。');
  button.disabled = true;
  button.textContent = '后台采集中…';
  const poller = setInterval(() => refreshTaskProgress(), 1000);
  try {
    const response = await fetchJson('/api/collect', { method: 'POST' });
    renderTaskRows(response.results.map(result => ({ platform: result.platform, label: statusPresentation(result).label })));
    finishTaskDialog('采集完成', '数据已经更新，看板正在刷新。', 'success');
    await loadDashboard({ silent: true });
  } catch (error) {
    finishTaskDialog('采集未完成', error.status === 409 ? '已有后台任务运行中。' : `采集失败：${error.message}`, 'error');
    button.disabled = false;
    button.textContent = '立即采集';
  } finally {
    clearInterval(poller);
  }
}

async function loginPlatform(platform) {
  const metadata = PLATFORMS[platform];
  if (!metadata) return;
  openTaskDialog(`登录${metadata.name}`, `已打开${metadata.name}创作者后台。完成登录后，窗口会自动关闭。`);
  renderTaskRows([{ platform, label: '等待登录' }]);
  try {
    await fetchJson(`/api/login/${platform}`, { method: 'POST' });
    const login = await waitForLogin(platform);
    if (login.status === 'success') {
      finishTaskDialog('登录成功', `${metadata.name} Cookie 已更新，将用于后续后台采集。`, 'success');
      await loadDashboard({ silent: true });
    } else {
      finishTaskDialog('登录失败', `${metadata.name}未完成登录，请重试。`, 'error');
    }
  } catch (error) {
    finishTaskDialog('无法开始登录', error.status === 409 ? '已有后台任务运行中。' : `登录失败：${error.message}`, 'error');
  }
}

async function waitForLogin(platform) {
  const deadline = Date.now() + 310_000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const health = await fetchJson('/api/health');
    const login = (health.logins || []).find(record => record.platform === platform);
    renderTaskRows([{ platform, label: login?.status === 'running' ? '等待登录' : login?.status === 'success' ? '登录成功' : login?.status === 'error' ? '登录失败' : '准备中' }]);
    if (login && login.status !== 'running') return login;
  }
  return { platform, status: 'error' };
}

async function refreshTaskProgress() {
  try {
    const health = await fetchJson('/api/health');
    if (health.job?.type !== 'collect') return;
    renderTaskRows(Object.keys(PLATFORMS).map(platform => {
      const record = (health.platforms || []).find(candidate => candidate.platform === platform);
      const current = record?.startedAt && record.startedAt >= health.job.startedAt;
      return { platform, label: current ? statusPresentation(record).label : '等待采集' };
    }));
  } catch {}
}

function openTaskDialog(title, detail) {
  const dialog = document.querySelector('#task-dialog');
  dialog.classList.remove('success', 'error');
  document.querySelector('#task-title').textContent = title;
  document.querySelector('#task-detail').textContent = detail;
  document.querySelector('#task-close').textContent = '收起';
  renderTaskRows(Object.keys(PLATFORMS).map(platform => ({ platform, label: '准备中' })));
  if (!dialog.open) dialog.showModal();
}

function finishTaskDialog(title, detail, tone) {
  const dialog = document.querySelector('#task-dialog');
  dialog.classList.add(tone);
  document.querySelector('#task-title').textContent = title;
  document.querySelector('#task-detail').textContent = detail;
  document.querySelector('#task-close').textContent = '完成';
}

function renderTaskRows(rows) {
  document.querySelector('#task-platforms').innerHTML = rows.map(row => {
    const platform = PLATFORMS[row.platform] || { name: row.platform, short: '?', color: '#73737B' };
    return `<div class="task-platform-row"><span class="platform-icon" style="background:${platform.color}">${platform.short}</span><strong>${platform.name}</strong><em>${row.label}</em></div>`;
  }).join('');
}

function platformPresentation(record = {}, login) {
  const collectedAt = record.finishedAt || record.lastCollectedAt;
  if (login?.status === 'success' && (!collectedAt || login.finishedAt > collectedAt)) {
    return { label: '已登录', tone: 'success' };
  }
  return statusPresentation(record);
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
