import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = Object.freeze({
  projectRoot,
  dataDir: path.join(projectRoot, 'data'),
  databasePath: path.join(projectRoot, 'data', 'insight.db'),
  profileDir: path.join(projectRoot, 'data', 'browser-profile'),
  host: '127.0.0.1',
  port: 8789,
  timeZone: 'Asia/Shanghai'
});
