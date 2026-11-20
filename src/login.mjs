import { openPersistentBrowser } from './browser.mjs';
import { defaultCollectors } from './collect.mjs';

export async function loginToPlatform(platform, {
  collectors = defaultCollectors,
  openBrowser = openPersistentBrowser,
  pollIntervalMs = 2000,
  timeoutMs = 5 * 60 * 1000,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now
} = {}) {
  const collector = collectors.find(candidate => candidate.platform === platform);
  if (!collector) throw new Error(`Unsupported platform: ${platform}`);

  const browser = await openBrowser({ headless: false });
  const deadline = now() + timeoutMs;
  try {
    const page = await browser.context.newPage();
    await page.goto(collector.loginUrl, { waitUntil: 'domcontentloaded' });
    while (now() < deadline) {
      if (await collector.isLoggedIn(page)) return { platform, status: 'success' };
      await sleep(pollIntervalMs);
    }
    throw new Error('Login timed out');
  } finally {
    await browser.close();
  }
}
