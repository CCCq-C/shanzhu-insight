import assert from 'node:assert/strict';
import test from 'node:test';

import { loginToPlatform } from '../src/login.mjs';

test('loginToPlatform opens the selected platform visibly and closes after login', async () => {
  let browserOptions;
  let checks = 0;
  let closed = false;
  const context = {
    newPage: async () => ({ goto: async () => {} })
  };

  const result = await loginToPlatform('douyin', {
    collectors: [{
      platform: 'douyin',
      loginUrl: 'https://creator.douyin.com/',
      isLoggedIn: async () => ++checks === 2
    }],
    openBrowser: async options => {
      browserOptions = options;
      return { context, close: async () => { closed = true; } };
    },
    sleep: async () => {},
    now: () => 0
  });

  assert.deepEqual(result, { platform: 'douyin', status: 'success' });
  assert.deepEqual(browserOptions, { headless: false });
  assert.equal(checks, 2);
  assert.equal(closed, true);
});

test('loginToPlatform rejects unsupported platforms before opening a browser', async () => {
  let opened = false;

  await assert.rejects(
    loginToPlatform('unknown', {
      collectors: [],
      openBrowser: async () => { opened = true; }
    }),
    /Unsupported platform/
  );

  assert.equal(opened, false);
});

test('loginToPlatform closes the browser when login times out', async () => {
  let clock = 0;
  let closed = false;

  await assert.rejects(
    loginToPlatform('xiaohongshu', {
      collectors: [{
        platform: 'xiaohongshu',
        loginUrl: 'https://creator.xiaohongshu.com/',
        isLoggedIn: async () => false
      }],
      openBrowser: async () => ({
        context: { newPage: async () => ({ goto: async () => {} }) },
        close: async () => { closed = true; }
      }),
      timeoutMs: 10,
      sleep: async () => { clock += 10; },
      now: () => clock
    }),
    /Login timed out/
  );

  assert.equal(closed, true);
});
