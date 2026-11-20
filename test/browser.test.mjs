import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { findChromeExecutable, openPersistentBrowser } from '../src/browser.mjs';

test('findChromeExecutable selects the first existing Windows Chrome path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shanzhu-chrome-'));
  const installed = path.join(root, 'chrome.exe');
  fs.writeFileSync(installed, 'test');

  assert.equal(findChromeExecutable({
    candidates: [path.join(root, 'missing.exe'), installed]
  }), installed);
});

test('findChromeExecutable explains when Chrome is missing', () => {
  assert.throws(
    () => findChromeExecutable({ candidates: ['Z:\\missing\\chrome.exe'] }),
    /Google Chrome was not found/
  );
});

test('openPersistentBrowser uses the selected profile and closes explicitly', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shanzhu-browser-'));
  const chromePath = path.join(root, 'chrome.exe');
  const profileDir = path.join(root, 'profile');
  fs.writeFileSync(chromePath, 'test');
  let launch;
  let closed = false;
  const context = { close: async () => { closed = true; } };
  const launcher = {
    launchPersistentContext: async (profile, options) => {
      launch = { profile, options };
      return context;
    }
  };

  const browser = await openPersistentBrowser({ profileDir, chromePath, launcher });

  assert.equal(browser.context, context);
  assert.equal(launch.profile, profileDir);
  assert.equal(launch.options.executablePath, chromePath);
  assert.equal(launch.options.headless, true);
  await browser.close();
  assert.equal(closed, true);
});
