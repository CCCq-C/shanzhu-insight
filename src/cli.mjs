import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { openPersistentBrowser } from './browser.mjs';
import { collectAll, defaultCollectors } from './collect.mjs';
import { config } from './config.mjs';
import { initSchema, openDatabase } from './db.mjs';

const COMMANDS = ['login', 'collect', 'doctor', 'serve'];
const USAGE = `Usage: node src/cli.mjs <${COMMANDS.join('|')}>`;

export async function runCli(argv, {
  commands,
  write = line => console.log(line)
} = {}) {
  const command = argv[0];
  const handlers = commands ?? defaultCommands(write);
  if (!COMMANDS.includes(command) || typeof handlers[command] !== 'function') {
    write(USAGE);
    return 2;
  }

  await handlers[command]();
  return 0;
}

function defaultCommands(write) {
  return {
    login: async () => {
      const browser = await openPersistentBrowser();
      try {
        for (const collector of defaultCollectors) {
          const page = await browser.context.newPage();
          await page.goto(collector.loginUrl, { waitUntil: 'domcontentloaded' });
        }
        write('登录页已打开。完成扫码后按 Enter 关闭浏览器。');
        if (process.stdin.isTTY) {
          await new Promise(resolve => process.stdin.once('data', resolve));
        }
      } finally {
        await browser.close();
      }
    },
    collect: async () => {
      const db = openDatabase(config.databasePath);
      initSchema(db);
      const browser = await openPersistentBrowser();
      try {
        const results = await collectAll({ db, context: browser.context, collectors: defaultCollectors });
        write(JSON.stringify(results, null, 2));
      } finally {
        await browser.close();
        db.close();
      }
    },
    doctor: async () => {
      const browser = await openPersistentBrowser();
      try {
        const statuses = [];
        for (const collector of defaultCollectors) {
          statuses.push({ platform: collector.platform, ...await collector.checkLogin({ context: browser.context }) });
        }
        write(JSON.stringify(statuses, null, 2));
      } finally {
        await browser.close();
      }
    },
    serve: async () => {
      const { startServer } = await import('./server.mjs');
      return startServer();
    }
  };
}

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  runCli(process.argv.slice(2)).then(
    code => { process.exitCode = code; },
    error => {
      console.error(error.message);
      process.exitCode = 1;
    }
  );
}
