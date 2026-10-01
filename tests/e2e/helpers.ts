import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { RecorderPhase, RecorderState } from '../../src/types';

export const ROOT = resolve(__dirname, '..', '..');

export interface Launched {
  app: ElectronApplication;
  main: Page;
  logs: string[];
}

export async function launchApp(env: Record<string, string>): Promise<Launched> {
  const app = await electron.launch({ args: ['.'], cwd: ROOT, env: { ...process.env, ...env } as Record<string, string>, timeout: 90_000 });
  const logs: string[] = [];
  app.process().stdout?.on('data', (d) => logs.push(String(d)));
  app.process().stderr?.on('data', (d) => logs.push(String(d)));
  const main = await mainWindow(app);
  await main.waitForSelector('[data-testid="new-recording"]', { timeout: 90_000 });
  return { app, main, logs };
}

/** The library window (the hidden engine window loads the same bundle at #/engine). */
async function mainWindow(app: ElectronApplication, timeoutMs = 90_000): Promise<Page> {
  const isMain = (p: Page) => /index\.html#\/($|new|recording|settings)/.test(p.url()) || /:\d+\/#\/($|new|recording)/.test(p.url());
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const found = app.windows().find(isMain);
    if (found) return found;
    await app.waitForEvent('window', { timeout: 2000 }).catch(() => undefined);
  }
  throw new Error(`main window not found; windows: ${app.windows().map((w) => w.url()).join(', ')}`);
}

export async function recorderState(page: Page): Promise<RecorderState> {
  return page.evaluate(() => window.oneloom.recorder.getState());
}

export async function waitForPhase(page: Page, phase: RecorderPhase, timeoutMs = 90_000): Promise<RecorderState> {
  const end = Date.now() + timeoutMs;
  let last: RecorderState | null = null;
  while (Date.now() < end) {
    last = await recorderState(page);
    if (last.phase === phase) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for phase ${phase}; last state ${JSON.stringify(last)}`);
}

export async function windowByRoute(app: ElectronApplication, route: string, timeoutMs = 45_000): Promise<Page> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const w = app.windows().find((p) => p.url().includes(`#${route}`));
    if (w) return w;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No window for ${route}; windows: ${app.windows().map((w) => w.url()).join(', ')}`);
}

/** Probe the player <video>: duration, seeking and decoded audio. */
export async function probePlayback(page: Page) {
  await page.waitForSelector('[data-testid="player-video"]', { timeout: 30_000 });
  return page.evaluate(async () => {
    const v = document.querySelector<HTMLVideoElement>('[data-testid="player-video"]')!;
    v.muted = true;
    if (v.readyState < 1) await new Promise((res) => v.addEventListener('loadedmetadata', res, { once: true }));
    const duration = v.duration;
    const seekTo = Math.min(2, duration / 2);
    v.currentTime = seekTo;
    await new Promise((res) => v.addEventListener('seeked', res, { once: true }));
    const afterSeek = v.currentTime;
    await v.play().catch(() => undefined);
    await new Promise((r) => setTimeout(r, 1500));
    const vx = v as HTMLVideoElement & { webkitAudioDecodedByteCount?: number; webkitVideoDecodedByteCount?: number };
    const result = {
      duration,
      width: v.videoWidth,
      height: v.videoHeight,
      seekableEnd: v.seekable.length ? v.seekable.end(0) : 0,
      afterSeek,
      playedTo: v.currentTime,
      audioBytes: vx.webkitAudioDecodedByteCount ?? -1,
      videoBytes: vx.webkitVideoDecodedByteCount ?? -1,
      error: v.error?.message ?? null
    };
    v.pause();
    return result;
  });
}

/** Opens the recorder panel, waits for the live preview, optionally picks a source. */
export async function openRecorder(main: Page, pick?: (sources: Array<{ id: string; category: string; processName?: string; displayName: string; minimized?: boolean }>) => string | undefined) {
  await main.click('[data-testid="new-recording"]');
  await main.waitForSelector('.setup');
  if (pick) {
    // A window that was just opened can take a few seconds to show up in the list.
    let res = await main.evaluate(() => window.oneloom.sources.list({ thumbnailWidth: 64, includeIcons: false }));
    let id = res.ok ? pick(res.value) : undefined;
    for (let i = 0; i < 10 && !id; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      res = await main.evaluate(() => window.oneloom.sources.list({ thumbnailWidth: 64, includeIcons: false }));
      id = res.ok ? pick(res.value) : undefined;
    }
    if (!res.ok) throw new Error(res.error.message);
    if (!id) throw new Error('source not found');
    const source = res.value.find((s) => s.id === id)!;
    const tabLabel = { screen: 'Screens', window: 'Windows', browser: 'Browsers', remote: 'Remote & VMs' }[source.category]!;
    await main.click(`.picker-tab:has-text("${tabLabel}")`);
    await main.waitForSelector(`.source-tile[title="${source.name.replace(/"/g, '\\"')}"]`, { timeout: 30_000 });
    await main.click(`.source-tile[title="${source.name.replace(/"/g, '\\"')}"]`);
  }
  // The live preview is cosmetic; recording opens its own capture. Wait for it, but don't fail on it.
  const live = await main
    .waitForFunction(() => (document.querySelector<HTMLVideoElement>('.preview video.source')?.videoWidth ?? 0) > 0, null, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  if (!live) console.warn(`  preview did not start: ${await main.locator('.preview-wrap').innerText().catch(() => '?')}`);
}

export function startMstsc(): ChildProcess | null {
  const exe = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'mstsc.exe');
  if (!existsSync(exe)) return null;
  return spawn(exe, [], { detached: false, stdio: 'ignore', windowsHide: false });
}

/** Explorer windows currently showing `folder` (via Shell.Application); closes them when `close` is true. */
export function explorerWindowsFor(folder: string, close: boolean): Promise<number> {
  const script = `
$target = '${folder.replace(/'/g, "''")}'.TrimEnd('\\').ToLower()
$n = 0
foreach ($w in (New-Object -ComObject Shell.Application).Windows()) {
  try { $p = $w.Document.Folder.Self.Path } catch { continue }
  if ($p -and $p.TrimEnd('\\').ToLower() -eq $target) { $n++; ${close ? '$w.Quit()' : ''} }
}
$n`;
  return new Promise((resolvePromise) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 30_000 }, (err, stdout) =>
      resolvePromise(err ? -1 : Number(String(stdout).trim().split(/\s+/).pop()) || 0)
    );
  });
}

export function ensureDir(p: string): string {
  mkdirSync(p, { recursive: true });
  return p;
}

/**
 * Before README screenshots: hide every real image (screen thumbnails, videos, camera)
 * behind neutral placeholders and blur text that carries window titles, user names or
 * paths — screenshots must be safe to publish.
 */
export async function privacyBlur(page: Page): Promise<() => Promise<void>> {
  const tag = await page.addStyleTag({
    content: [
      '.thumb img, .source-thumb img, .trim-strip img, video, canvas, .bubble-canvas { visibility: hidden !important; }',
      '.thumb, .source-thumb, .preview, .player-video, .trim-strip, .camera-preview { background: linear-gradient(135deg, #2a2f45, #4b4f8a 60%, #6a5acd) !important; }',
      '.source-caption, .source-sub, .preview-label, .ss-name, .path-box, [data-testid="recordings-dir"], .card-meta:last-child, .player-meta .chip:nth-child(4), .card-title, .player-title h1 { filter: blur(4px); }'
    ].join('\n')
  });
  // Callers remove the mask right after the screenshot (it would hide the real player).
  return async () => {
    await tag.evaluate((el) => (el as HTMLElement).remove());
  };
}
