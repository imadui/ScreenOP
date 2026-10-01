#!/usr/bin/env node
// Runs a project tool with every download cache redirected into ./.cache so the
// project stays self-contained (no machine-wide Electron / electron-builder caches).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, '.cache');
const env = {
  ...process.env,
  electron_config_cache: join(cache, 'electron'),
  ELECTRON_CACHE: join(cache, 'electron'),
  ELECTRON_BUILDER_CACHE: join(cache, 'electron-builder')
};
for (const dir of [env.ELECTRON_CACHE, env.ELECTRON_BUILDER_CACHE]) mkdirSync(dir, { recursive: true });

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('usage: node scripts/run-local.mjs <bin> [...args]');
  process.exit(2);
}

const bin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? `${command}.cmd` : command);
// .cmd shims need a shell on Windows, so the command line goes through cmd.exe. cmd has no
// reliable escape for `%` or `"`, so such arguments are refused instead of being "escaped".
const quote = (s) => {
  if (/["%^&|<>\r\n]/.test(s)) throw new Error(`run-local: unsupported character in argument: ${s}`);
  return /^[\w@+=:,./\\-]+$/.test(s) ? s : `"${s}"`;
};
const child =
  process.platform === 'win32'
    ? spawn([quote(bin), ...args.map(quote)].join(' '), { cwd: root, env, stdio: 'inherit', shell: true })
    : spawn(bin, args, { cwd: root, env, stdio: 'inherit' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
