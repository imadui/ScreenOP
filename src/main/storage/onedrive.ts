import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { StorageOrigin } from '@app-types';

export interface RegistryOneDriveAccount {
  /** Registry key name, e.g. `Business1` or `Personal`. */
  key: string;
  userFolder: string;
}

/** Everything the resolver needs from the machine, injectable for tests. */
export interface OneDriveProbe {
  env: Record<string, string | undefined>;
  dirExists(path: string): Promise<boolean>;
  readRegistryAccounts(): Promise<RegistryOneDriveAccount[]>;
}

export interface OneDriveResolution {
  root: string;
  origin: StorageOrigin;
  accountType: 'business' | 'personal' | 'unknown';
}

export const RECORDINGS_SUBPATH = ['loom', 'recording'] as const;

export function recordingsDirFor(oneDriveRoot: string): string {
  return join(oneDriveRoot, ...RECORDINGS_SUBPATH);
}

const same = (a: string | undefined, b: string | undefined) =>
  !!a && !!b && resolve(a).toLowerCase() === resolve(b).toLowerCase();

/**
 * Resolve the OneDrive root without hard-coding any user name:
 * `%OneDrive%` → `%OneDriveCommercial%` → `%OneDriveConsumer%` → HKCU OneDrive accounts.
 * Candidates pointing to folders that do not exist (unlinked accounts) are skipped.
 */
export async function resolveOneDriveRoot(probe: OneDriveProbe): Promise<OneDriveResolution | null> {
  const { env } = probe;
  const envCandidates: Array<{ value: string | undefined; origin: StorageOrigin }> = [
    { value: env.OneDrive, origin: 'env:OneDrive' },
    { value: env.OneDriveCommercial, origin: 'env:OneDriveCommercial' },
    { value: env.OneDriveConsumer, origin: 'env:OneDriveConsumer' }
  ];

  for (const { value, origin } of envCandidates) {
    const candidate = value?.trim();
    if (!candidate) continue;
    if (!(await probe.dirExists(candidate))) continue;
    let accountType: OneDriveResolution['accountType'] = 'unknown';
    if (origin === 'env:OneDriveCommercial' || same(candidate, env.OneDriveCommercial)) accountType = 'business';
    else if (origin === 'env:OneDriveConsumer' || same(candidate, env.OneDriveConsumer)) accountType = 'personal';
    return { root: resolve(candidate), origin, accountType };
  }

  let accounts: RegistryOneDriveAccount[] = [];
  try {
    accounts = await probe.readRegistryAccounts();
  } catch {
    accounts = [];
  }
  // Prefer business accounts (Business1, Business2…) then personal, matching Windows' own env precedence.
  const ordered = [...accounts].sort((a, b) => rankKey(a.key) - rankKey(b.key) || a.key.localeCompare(b.key));
  for (const account of ordered) {
    if (!account.userFolder || !(await probe.dirExists(account.userFolder))) continue;
    const accountType = /^business/i.test(account.key) ? 'business' : /^personal/i.test(account.key) ? 'personal' : 'unknown';
    return { root: resolve(account.userFolder), origin: 'registry', accountType };
  }
  return null;
}

function rankKey(key: string): number {
  if (/^business/i.test(key)) return 0;
  if (/^personal/i.test(key)) return 1;
  return 2;
}

/** Parse `Key|UserFolder` lines produced by {@link readRegistryAccountsViaPowerShell}. */
export function parseRegistryAccounts(stdout: string): RegistryOneDriveAccount[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf('|');
      return idx > 0 ? { key: line.slice(0, idx).trim(), userFolder: line.slice(idx + 1).trim() } : null;
    })
    .filter((a): a is RegistryOneDriveAccount => !!a && !!a.userFolder);
}

/** Read `HKCU\Software\Microsoft\OneDrive\Accounts\*\UserFolder` (no elevation needed). */
export function readRegistryAccountsViaPowerShell(timeoutMs = 5000): Promise<RegistryOneDriveAccount[]> {
  const script = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    "Get-ChildItem 'HKCU:\\Software\\Microsoft\\OneDrive\\Accounts' -ErrorAction SilentlyContinue | ForEach-Object {",
    '  $p = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue',
    "  if ($p -and $p.UserFolder) { $_.PSChildName + '|' + $p.UserFolder }",
    '}'
  ].join('\n');
  return new Promise((resolvePromise) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: timeoutMs, windowsHide: true, encoding: 'utf8' },
      (err, stdout) => resolvePromise(err ? [] : parseRegistryAccounts(stdout))
    );
  });
}

export const systemOneDriveProbe: OneDriveProbe = {
  env: process.env,
  async dirExists(path: string) {
    try {
      return (await stat(path)).isDirectory();
    } catch {
      return false;
    }
  },
  readRegistryAccounts: () => (process.platform === 'win32' ? readRegistryAccountsViaPowerShell() : Promise.resolve([]))
};
