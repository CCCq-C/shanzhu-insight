import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const blockedAddresses = new net.BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4]
]) blockedAddresses.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['fc00::', 7],
  ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32]
]) blockedAddresses.addSubnet(network, prefix, 'ipv6');

const PLACEHOLDER = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#eef3ff"/><stop offset="1" stop-color="#ffeef1"/></linearGradient></defs>
  <rect width="800" height="1000" rx="48" fill="url(#g)"/>
  <circle cx="400" cy="430" r="88" fill="#fff" opacity=".8"/>
  <path d="M370 380l105 50-105 50z" fill="#0071e3"/>
  <text x="400" y="620" text-anchor="middle" font-family="system-ui,sans-serif" font-size="44" fill="#52606d">暂无封面</text>
</svg>`.trim());

export function createCoverStore({
  cacheDir,
  fetchImpl = fetch,
  timeoutMs = 10000,
  maxBytes = 10 * 1024 * 1024,
  urlAllowed = isPublicTarget
}) {
  fs.mkdirSync(cacheDir, { recursive: true });

  return {
    async getCover({ platform, postId, url }) {
      if (!validIdentity(platform, postId)) return placeholder();
      const cachePath = path.join(cacheDir, crypto.createHash('sha256')
        .update(`${platform}:${postId}`)
        .digest('hex'));

      if (fs.existsSync(cachePath)) {
        const buffer = fs.readFileSync(cachePath);
        const contentType = detectImageType(buffer);
        if (contentType) return { buffer, contentType, placeholder: false, cached: true };
      }

      try {
        const target = new URL(url);
        if (!['http:', 'https:'].includes(target.protocol)) return placeholder();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let response;
        try {
          response = await fetchApproved(target, { fetchImpl, signal: controller.signal, urlAllowed });
          if (!response) return placeholder();
          if (!response.ok) return placeholder();
          if (!response.headers.get('content-type')?.toLowerCase().startsWith('image/')) return placeholder();
          const declaredSize = Number(response.headers.get('content-length'));
          if (Number.isFinite(declaredSize) && declaredSize > maxBytes) return placeholder();
          const buffer = await readLimited(response.body, maxBytes);
          const contentType = detectImageType(buffer);
          if (!contentType) return placeholder();
          const temporary = `${cachePath}.${process.pid}.tmp`;
          fs.writeFileSync(temporary, buffer);
          fs.renameSync(temporary, cachePath);
          return { buffer, contentType, placeholder: false, cached: false };
        } finally {
          clearTimeout(timer);
        }
      } catch {
        return placeholder();
      }
    }
  };
}

async function fetchApproved(initialUrl, { fetchImpl, signal, urlAllowed }) {
  let target = initialUrl;
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    if (!await urlAllowed(target)) return null;
    const response = await fetchImpl(target, { signal, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location || redirects === 5) return null;
    await response.body?.cancel();
    target = new URL(location, target);
  }
  return null;
}

async function isPublicTarget(target) {
  if (!['http:', 'https:'].includes(target.protocol)) return false;
  const hostname = target.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return false;
  const family = net.isIP(hostname);
  if (family) return isPublicAddress(hostname, family);
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  return addresses.length > 0 && addresses.every(({ address, family: resolvedFamily }) => isPublicAddress(address, resolvedFamily));
}

function isPublicAddress(address, family) {
  const type = Number(family) === 6 ? 'ipv6' : 'ipv4';
  return !blockedAddresses.check(address, type);
}

async function readLimited(stream, maxBytes) {
  if (!stream) throw new Error('Image response has no body');
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error('Image exceeds size limit');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

function detectImageType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function validIdentity(platform, postId) {
  return /^[a-z][a-z0-9_-]{0,31}$/.test(String(platform ?? ''))
    && /^[A-Za-z0-9_-]{1,200}$/.test(String(postId ?? ''));
}

function placeholder() {
  return {
    buffer: PLACEHOLDER,
    contentType: 'image/svg+xml',
    placeholder: true,
    cached: false
  };
}
