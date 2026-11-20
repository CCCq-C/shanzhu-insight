import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createCoverStore } from '../src/covers.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('cover store caches a valid image by platform and post identity', async t => {
  let requests = 0;
  const source = await listen((request, response) => {
    requests += 1;
    response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': PNG.length });
    response.end(PNG);
  });
  t.after(() => source.close());
  const cacheDir = tempDirectory(t);
  const store = createCoverStore({ cacheDir });
  const url = `http://127.0.0.1:${source.address().port}/cover.png`;

  const first = await store.getCover({ platform: 'douyin', postId: 'post-1', url });
  const second = await store.getCover({ platform: 'douyin', postId: 'post-1', url });

  assert.equal(first.contentType, 'image/png');
  assert.equal(first.placeholder, false);
  assert.deepEqual(first.buffer, PNG);
  assert.equal(second.cached, true);
  assert.equal(requests, 1);
});

test('cover store returns a placeholder on timeout', async t => {
  const source = await listen((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { 'Content-Type': 'image/png' });
      response.end(PNG);
    }, 100);
  });
  t.after(() => source.close());
  const store = createCoverStore({ cacheDir: tempDirectory(t), timeoutMs: 10 });

  const result = await store.getCover({
    platform: 'douyin',
    postId: 'post-2',
    url: `http://127.0.0.1:${source.address().port}/slow.png`
  });

  assert.equal(result.placeholder, true);
  assert.equal(result.contentType, 'image/svg+xml');
});

test('cover store rejects images above the byte limit', async t => {
  const source = await listen((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': PNG.length });
    response.end(PNG);
  });
  t.after(() => source.close());
  const store = createCoverStore({ cacheDir: tempDirectory(t), maxBytes: 8 });

  const result = await store.getCover({
    platform: 'douyin',
    postId: 'post-3',
    url: `http://127.0.0.1:${source.address().port}/large.png`
  });

  assert.equal(result.placeholder, true);
});

test('cover store rejects non-image responses', async t => {
  const source = await listen((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end('not an image');
  });
  t.after(() => source.close());
  const store = createCoverStore({ cacheDir: tempDirectory(t) });

  const result = await store.getCover({
    platform: 'douyin',
    postId: 'post-4',
    url: `http://127.0.0.1:${source.address().port}/text`
  });

  assert.equal(result.placeholder, true);
});

test('cover store rejects invalid schemes and traversal identities', async t => {
  const store = createCoverStore({ cacheDir: tempDirectory(t) });

  const invalidScheme = await store.getCover({ platform: 'douyin', postId: 'post-5', url: 'file:///secret' });
  const traversal = await store.getCover({ platform: '../douyin', postId: '../../secret', url: 'https://example.test/a.png' });

  assert.equal(invalidScheme.placeholder, true);
  assert.equal(traversal.placeholder, true);
});

function tempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'maitian-cover-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
