import path from 'node:path';
import { pathToFileURL } from 'node:url';

const COMMANDS = ['login', 'collect', 'doctor', 'serve'];
const USAGE = `Usage: node src/cli.mjs <${COMMANDS.join('|')}>`;

export async function runCli(argv, {
  commands = defaultCommands(),
  write = line => console.log(line)
} = {}) {
  const command = argv[0];
  if (!COMMANDS.includes(command) || typeof commands[command] !== 'function') {
    write(USAGE);
    return 2;
  }

  await commands[command]();
  return 0;
}

function defaultCommands() {
  return Object.fromEntries(COMMANDS.map(command => [command, async () => {
    throw new Error(`${command} command is not wired yet`);
  }]));
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
