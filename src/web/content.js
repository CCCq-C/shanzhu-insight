import { PLATFORMS, escapeHtml, fetchJson, formatDateTime, formatMetric, formatRate, statusPresentation } from './shared.js';

const form = document.querySelector('#content-filters');
form.addEventListener('change', loadContents);
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
        <div class="content-total"><span>全平台播放</span><strong>${formatMetric(views)}</strong></div>
      </div>
      <div class="content-detail"><div class="post-grid">${Object.keys(PLATFORMS).map(key => renderPost(postsByPlatform.get(key), key)).join('')}</div></div>
    </article>`;
  }).join('') : '<div class="panel empty-block">当前筛选条件没有内容。</div>';
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
