import fs from 'node:fs';
import path from 'node:path';

import { chromium } from 'playwright-core';

import { config } from './config.mjs';

export function findChromeExecutable({
  candidates = defaultChromeCandidates(),
  exists = fs.existsSync
} = {}) {
  const executable = candidates.find(candidate => candidate && exists(candidate));
  if (executable) return executable;
  throw new Error('Google Chrome was not found. Install Chrome or pass chromePath.');
}

export async function openPersistentBrowser({
  profileDir = config.profileDir,
  chromePath,
  headless = true,
  launcher = chromium
} = {}) {
  const executablePath = chromePath
    ? findChromeExecutable({ candidates: [chromePath] })
    : findChromeExecutable();
  fs.mkdirSync(profileDir, { recursive: true });
  const context = await launcher.launchPersistentContext(profileDir, {
    executablePath,
    headless,
    viewport: null
  });

  return {
    context,
    close: () => context.close()
  };
}

function defaultChromeCandidates() {
  return [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean);
}
