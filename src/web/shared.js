export const PLATFORMS = {
  xiaohongshu: { name: '小红书', short: '小', color: '#FF2442' },
  douyin: { name: '抖音', short: '抖', color: '#1D1D1F' },
  channels: { name: '视频号', short: '视', color: '#FA9D3B' }
};

const integer = new Intl.NumberFormat('zh-CN');
const dateTime = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

export function formatMetric(value) {
  return value == null || !Number.isFinite(Number(value)) ? '—' : integer.format(Number(value));
}

export function formatRate(value) {
  return value == null || !Number.isFinite(Number(value)) ? '未知' : `${(Number(value) * 100).toFixed(1)}%`;
}

export function formatDateTime(value) {
  if (!value) return '尚未采集';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : dateTime.format(date);
}

export function statusPresentation(record = {}) {
  if (record.status === 'running') return { label: '采集中', tone: 'working' };
  if (record.status === 'partial' || record.partial) return { label: '数据不完整', tone: 'warning' };
  if (record.status === 'success') return { label: '数据正常', tone: 'success' };
  if (record.status === 'failed' || record.status === 'error') return { label: '采集失败', tone: 'danger' };
  return { label: '等待采集', tone: 'muted' };
}

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[character]);
}

export async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.code || `HTTP ${response.status}`), { status: response.status });
  return payload;
}
