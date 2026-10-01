#!/usr/bin/env node
// Zips release/win-unpacked into release/OneLoom-<version>-win-x64.zip using the tar.exe
// (bsdtar) that ships with Windows 10/11 — no third-party archiver needed.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version, productName } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const release = join(root, 'release');
const source = join(release, 'win-unpacked');
const zip = join(release, `${productName}-${version}-win-x64.zip`);
const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');

if (!existsSync(join(source, `${productName}.exe`))) {
  console.error(`missing ${source}\\${productName}.exe — run electron-builder first`);
  process.exit(1);
}
if (!existsSync(tar)) {
  console.log('tar.exe not available; the unpacked build is in release/win-unpacked');
  process.exit(0);
}
rmSync(zip, { force: true });
// -a picks the format from the extension (.zip); -C keeps paths relative to the folder.
execFileSync(tar, ['-a', '-c', '-f', zip, '-C', source, '.'], { stdio: 'inherit' });
console.log(`wrote ${zip} (${(statSync(zip).size / 1024 / 1024).toFixed(1)} MB)`);
