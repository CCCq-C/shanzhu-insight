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
    const platforms = content.posts.map(post => PLATFORMS[post.platform]?.name || post.platform).join(' · ');
    return `<details class="panel content-item">
      <summary>
        <div class="content-thumb">${content.coverPath ? `<img src="${escapeHtml(content.coverPath)}" alt="" loading="lazy">` : ''}</div>
        <div class="content-copy"><h2>${escapeHtml(content.title || '未命名内容')}</h2><div class="content-meta"><span>${escapeHtml(formatDateTime(content.publishedAt))}</span><span>${escapeHtml(platforms || '无平台记录')}</span><span>${content.posts.length}/3 平台</span></div></div>
        <div class="content-total"><span>全平台播放</span><strong>${formatMetric(views)}</strong></div>
        <span class="expand-mark" aria-hidden="true"></span>
      </summary>
      <div class="content-detail"><div class="post-grid">${content.posts.map(renderPost).join('')}</div></div>
    </details>`;
  }).join('') : '<div class="panel empty-block">当前筛选条件没有内容。</div>';
}

function renderPost(post) {
  const platform = PLATFORMS[post.platform] || { name: post.platform, short: '?', color: '#73737B' };
  const metrics = post.metrics || {};
  return `<article class="post-card">
    <div class="post-card-head"><div class="platform-name"><span class="platform-icon" style="background:${platform.color}">${platform.short}</span>${platform.name}</div>${post.url ? `<a href="${escapeHtml(post.url)}" target="_blank" rel="noreferrer">打开原文</a>` : ''}</div>
    <div class="post-stats"><div><span>播放</span><strong>${formatMetric(metrics.views)}</strong></div><div><span>互动率</span><strong>${formatRate(metrics.interactionRate)}</strong></div><div><span>点赞</span><strong>${formatMetric(metrics.likes)}</strong></div></div>
  </article>`;
}
