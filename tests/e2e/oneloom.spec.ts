import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RecordingEntry } from '../../src/types';
import {
  ensureDir,
  explorerWindowsFor,
  launchApp,
  openRecorder,
  privacyBlur,
  ROOT,
  probePlayback,
  recorderState,
  startMstsc,
  waitForPhase,
  windowByRoute,
  type Launched
} from './helpers';

/**
 * End-to-end validation on a real Windows desktop (records the actual screen).
 * By default recordings go to a temporary folder; set ONELOOM_E2E_REAL_ONEDRIVE=1
 * to validate the real %OneDrive%\loom\recording folder (test files are deleted
 * through the app, i.e. moved to the Recycle Bin).
 */
const REAL_ONEDRIVE = process.env.ONELOOM_E2E_REAL_ONEDRIVE === '1';
const SHOTS = process.env.ONELOOM_SCREENSHOTS_DIR;
const runRoot = join(tmpdir(), `oneloom-e2e-${Date.now()}`);
const env: Record<string, string> = { ONELOOM_USER_DATA_DIR: join(runRoot, 'userdata') };
if (!REAL_ONEDRIVE) env.ONELOOM_RECORDINGS_DIR = join(runRoot, 'recordings');

test.describe.configure({ mode: 'serial' });

let ctx: Launched;
let recordingsDir = '';
const created: string[] = [];
let mstsc: ChildProcess | null = null;

/** The empty mstsc dialog these tests launch ("Remote Desktop Connection"), never a user session. */
function isOurMstsc(s: { category: string; displayName: string; minimized?: boolean }): boolean {
  return s.category === 'remote' && !s.minimized && s.displayName === 'Remote Desktop Connection';
}

/** Last known path of every recording the tests created (for cleanup). */
const createdPaths = new Map<string, string>();

async function library(): Promise<RecordingEntry[]> {
  const r = await ctx.main.evaluate(() => window.oneloom.library.list());
  if (!r.ok) throw new Error(r.error.message);
  for (const e of r.value) if (created.includes(e.id)) createdPaths.set(e.id, e.absolutePath);
  return r.value;
}

async function shot(name: string, page = ctx.main) {
  if (!SHOTS) return;
  ensureDir(SHOTS);
  const unmask = await privacyBlur(page);
  await page.screenshot({ path: join(SHOTS, name) });
  await unmask();
}

test.beforeAll(async () => {
  ensureDir(runRoot);
  ctx = await launchApp(env);
  recordingsDir = (await ctx.main.evaluate(() => window.oneloom.storage.getStatus())).recordingsDir ?? '';
});

test.afterAll(async () => {
  if (mstsc && !mstsc.killed) mstsc.kill();
  // Remove anything a failed test left behind: through the app (Recycle Bin) first, then by
  // path, so test recordings never stay in the user's OneDrive folder.
  const leftovers = new Map(createdPaths);
  if (ctx) {
    try {
      await ctx.main.evaluate(() => (window.location.hash = '/'));
      for (const e of (await library()).filter((x) => created.includes(x.id))) {
        leftovers.set(e.id, e.absolutePath);
        const r = await ctx.main.evaluate((id) => window.oneloom.library.remove(id), e.id);
        if (r.ok) leftovers.delete(e.id);
        else console.warn(`cleanup via app failed for ${e.fileName}: ${r.error.message}`);
      }
    } catch (err) {
      console.warn(`cleanup via app failed: ${String(err)}`);
    }
    await ctx.app.close().catch(() => undefined);
  }
  for (const [id, path] of leftovers) {
    if (!created.includes(id) || !existsSync(path)) continue;
    rmSync(path, { force: true });
    console.warn(`removed leftover test recording ${path}`);
  }
  try {
    rmSync(runRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  } catch (err) {
    console.warn(`could not remove ${runRoot}: ${String(err)}`);
  }
});

test('1-3: app starts, detects OneDrive and creates loom\\recording', async () => {
  const status = await ctx.main.evaluate(() => window.oneloom.storage.getStatus());
  expect(status.ok).toBe(true);
  recordingsDir = status.recordingsDir!;
  if (REAL_ONEDRIVE) {
    const oneDrive = process.env.OneDrive ?? process.env.OneDriveCommercial ?? process.env.OneDriveConsumer;
    expect(oneDrive).toBeTruthy();
    expect(recordingsDir.toLowerCase()).toBe(join(oneDrive!, 'loom', 'recording').toLowerCase());
    expect(status.origin).toMatch(/^env:|registry/);
  }
  expect(existsSync(recordingsDir)).toBe(true);
  expect(statSync(recordingsDir).isDirectory()).toBe(true);
  await expect(ctx.main.getByTestId('recordings-dir')).toHaveText(recordingsDir);
  console.log(`recordings folder: ${recordingsDir} (origin ${status.origin}, account ${status.accountType})`);
});

test('4-6: screens and windows are enumerated; Remote Desktop windows are recognised', async () => {
  mstsc = startMstsc();
  test.skip(!mstsc, 'mstsc.exe not available');
  let remote: { id: string; displayName: string; processName?: string } | undefined;
  let all: Array<{ id: string; kind: string; category: string; displayName: string; processName?: string }> = [];
  for (let i = 0; i < 30 && !remote; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const res = await ctx.main.evaluate(() => window.oneloom.sources.list({ thumbnailWidth: 64, includeIcons: false }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    all = res.value;
    remote = all.find((s) => s.category === 'remote' && (s.processName?.toLowerCase() === 'mstsc' || /Remote Desktop|Bureau à distance/i.test(s.displayName)));
  }
  expect(all.filter((s) => s.kind === 'screen').length).toBeGreaterThanOrEqual(1);
  expect(all.filter((s) => s.kind === 'window').length).toBeGreaterThanOrEqual(1);
  expect(remote, `sources: ${all.map((s) => `${s.category}:${s.displayName}`).join(' | ')}`).toBeTruthy();
  console.log(`remote source detected: ${remote!.displayName} (process ${remote!.processName ?? 'n/a'})`);
});

test('RDP window recording: records the Remote Desktop client window', async () => {
  test.skip(!mstsc, 'mstsc.exe not available');
  // Only ever the mstsc dialog this test launched — never another (possibly minimised) user session.
  await openRecorder(ctx.main, (sources) => sources.find(isOurMstsc)?.id);
  await ctx.main.evaluate(() => window.oneloom.settings.update({ cameraEnabled: false, countdown: false, lastMicrophoneId: 'none', systemAudio: true }));
  await ctx.main.waitForTimeout(500);
  await ctx.main.click('.btn-record');
  await waitForPhase(ctx.main, 'recording');
  await ctx.main.waitForTimeout(3500);
  await ctx.main.evaluate(() => window.oneloom.recorder.stop());
  const state = await waitForPhase(ctx.main, 'idle');
  expect(state.error).toBeNull();
  expect(state.lastRecordingId).toBeTruthy();
  created.push(state.lastRecordingId!);
  const entry = (await library()).find((e) => e.id === state.lastRecordingId)!;
  expect(entry.source.category).toBe('remote');
  const playback = await probePlayback(ctx.main);
  expect(playback.error).toBeNull();
  expect(Number.isFinite(playback.duration)).toBe(true);
  expect(playback.duration).toBeGreaterThan(2);
  mstsc?.kill();
  mstsc = null;
});

test('7-12: screen recording with microphone, pause/resume, stop → playable file in the recordings folder', async () => {
  await ctx.main.evaluate(() => window.oneloom.settings.update({ cameraEnabled: false, countdown: true, lastMicrophoneId: 'default', systemAudio: true }));
  await ctx.main.evaluate(() => (window.location.hash = '/'));
  await openRecorder(ctx.main, (sources) => sources.find((s) => s.category === 'screen')?.id);
  await ctx.main.waitForTimeout(1200);
  await shot('recorder-setup.png');
  await ctx.main.click('.btn-record');

  const recording = await waitForPhase(ctx.main, 'recording');
  expect(recording.micAvailable).toBe(true);

  const t0 = Date.now();
  const step = (label: string) => console.log(`  [+${((Date.now() - t0) / 1000).toFixed(1)}s] ${label}`);
  const controller = await windowByRoute(ctx.app, '/controller');
  await controller.waitForSelector('[data-testid="controller-time"]');
  step('controller visible');
  await controller.waitForTimeout(3000);
  if (SHOTS) await controller.screenshot({ path: join(SHOTS, 'controller.png'), timeout: 5000 }).catch(() => console.warn('  controller screenshot skipped'));
  step('before pause');
  await controller.locator('button[aria-label="Pause"]').click({ force: true });
  await expect.poll(async () => (await recorderState(ctx.main)).phase).toBe('paused');
  const pausedAt = Date.now();
  step('paused');
  await controller.waitForTimeout(2000);
  await controller.locator('button[aria-label="Resume"]').click({ force: true });
  await expect.poll(async () => (await recorderState(ctx.main)).phase).toBe('recording');
  const resumedAt = Date.now();
  step('resumed');
  await controller.waitForTimeout(2500);
  const stopAt = Date.now();
  await controller.locator('[data-testid="controller-stop"]').click({ force: true });
  step('stop clicked');
  // Wall-clock recording time minus the pause the test observed.
  const expectedActiveMs = stopAt - recording.runningSince! - (resumedAt - pausedAt);

  const state = await waitForPhase(ctx.main, 'idle');
  step('idle');
  console.log(
    ctx.logs
      .join('')
      .split('\n')
      .filter((l) => /recording started|stopping recording|\[engine\] stopped|finalised/.test(l))
      .join('\n')
  );
  expect(state.error).toBeNull();
  expect(state.lastRecordingId).toBeTruthy();
  created.push(state.lastRecordingId!);

  const entry = (await library()).find((e) => e.id === state.lastRecordingId)!;
  expect(entry.fileName).toMatch(/^Recording_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}( \(\d+\))?\.webm$/);
  expect(entry.absolutePath.toLowerCase()).toBe(join(recordingsDir, entry.fileName).toLowerCase());
  expect(existsSync(entry.absolutePath)).toBe(true);
  expect(entry.microphoneEnabled).toBe(true);
  // The ~2 s pause must not be part of the video.
  console.log(`  duration ${entry.durationMs} ms, expected active ≈ ${expectedActiveMs} ms (pause ${resumedAt - pausedAt} ms excluded)`);
  expect(Math.abs(entry.durationMs! - expectedActiveMs)).toBeLessThan(1500);

  // The main window comes back on the integrated player.
  const playback = await probePlayback(ctx.main);
  console.log(`playback: ${JSON.stringify(playback)}`);
  expect(playback.error).toBeNull();
  expect(Number.isFinite(playback.duration)).toBe(true);
  expect(Math.abs(playback.duration * 1000 - entry.durationMs!)).toBeLessThan(600);
  expect(playback.seekableEnd).toBeGreaterThan(4);
  expect(Math.abs(playback.afterSeek - 2)).toBeLessThan(0.5);
  expect(playback.playedTo).toBeGreaterThan(playback.afterSeek);
  expect(playback.width).toBeGreaterThan(0);
  expect(playback.audioBytes).toBeGreaterThan(0);
  expect(readdirSync(recordingsDir).some((f) => f.endsWith('.part') || f.includes('.final'))).toBe(false);
});

test('camera: on-screen bubble (resize, effects), recorded with the screen; composited into an RDP window recording', async () => {
  const devices = await ctx.main.evaluate(async () => (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput').length);
  test.skip(devices === 0, 'no camera on this machine');
  await ctx.main.evaluate(async () => {
    const s = await window.oneloom.settings.get();
    await window.oneloom.settings.update({ cameraEnabled: true, countdown: false, lastMicrophoneId: 'none', camera: { ...s.camera, background: 'blur-light' } });
  });
  await ctx.main.evaluate(() => (window.location.hash = '/'));
  await openRecorder(ctx.main, (sources) => sources.find((s) => s.category === 'screen')?.id);

  // The Loom-style bubble is its own always-on-top window.
  const bubble = await windowByRoute(ctx.app, '/bubble');
  const live = await bubble.waitForSelector('[data-camera="live"]', { timeout: 60_000 }).then(() => true, () => false);
  test.skip(!live, 'camera busy (in use by another app)');
  const bounds = () =>
    ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('#/bubble'))!.getBounds());
  const before = await bounds();
  await bubble.evaluate(() => document.querySelector<HTMLButtonElement>('button[aria-label="Bigger"]')!.click());
  await expect.poll(async () => (await bounds()).width).toBeGreaterThan(before.width);
  await expect
    .poll(() => bubble.getAttribute('[data-testid="camera-bubble"]', 'data-effects'), { timeout: 60_000 })
    .toMatch(/ready|unavailable/);

  // 1) Screen recording: the bubble is captured where it sits; the pill can hide it.
  await ctx.main.click('[data-testid="start-recording"]');
  const recording = await waitForPhase(ctx.main, 'recording');
  expect(recording.cameraAvailable).toBe(true);
  const controller = await windowByRoute(ctx.app, '/controller');
  await controller.waitForTimeout(1500);
  await controller.click('button[aria-label="Toggle camera"]');
  await expect.poll(async () => (await recorderState(ctx.main)).cameraVisible).toBe(false);
  await controller.click('button[aria-label="Toggle camera"]');
  await controller.waitForTimeout(1500);
  await controller.click('[data-testid="controller-stop"]');
  let state = await waitForPhase(ctx.main, 'idle');
  expect(state.error).toBeNull();
  created.push(state.lastRecordingId!);
  let entry = (await library()).find((e) => e.id === state.lastRecordingId)!;
  expect(entry.cameraEnabled).toBe(true);
  expect((await probePlayback(ctx.main)).error).toBeNull();

  // 2) RDP window recording: the bubble window is composited into the window video.
  mstsc ??= startMstsc();
  test.skip(!mstsc, 'mstsc.exe not available');
  await ctx.main.evaluate(() => (window.location.hash = '/'));
  await openRecorder(ctx.main, (sources) => sources.find(isOurMstsc)?.id);
  await bubble.waitForSelector('[data-camera="live"]', { timeout: 60_000 });
  await ctx.main.click('[data-testid="start-recording"]');
  await waitForPhase(ctx.main, 'recording');
  await new Promise((r) => setTimeout(r, 1500));
  await ctx.main.evaluate(() => window.oneloom.camera.placeBubble('bottom-right'));
  await new Promise((r) => setTimeout(r, 1500));
  await ctx.main.evaluate(() => window.oneloom.recorder.stop());
  state = await waitForPhase(ctx.main, 'idle');
  expect(state.error).toBeNull();
  created.push(state.lastRecordingId!);
  entry = (await library()).find((e) => e.id === state.lastRecordingId)!;
  expect(entry).toMatchObject({ cameraEnabled: true, source: { category: 'remote' } });
  const playback = await probePlayback(ctx.main);
  expect(playback.error).toBeNull();
  expect(playback.duration).toBeGreaterThan(2);
  await ctx.main.evaluate(() => window.oneloom.settings.update({ cameraEnabled: false }));
});

test('trim: lossless cut from the editor keeps the selected range', async () => {
  const target = (await library()).find((e) => e.id === created[0]);
  test.skip(!target, 'no recording to trim');
  await ctx.main.evaluate((id) => (window.location.hash = `/recording/${id}/trim`), target!.id);
  await ctx.main.waitForSelector('[data-testid="trim-timeline"]', { timeout: 30_000 });
  const info = await ctx.main.evaluate((id) => window.oneloom.library.trimInfo(id), target!.id);
  expect(info.ok && info.value.supported).toBe(true);
  if (!info.ok) return;
  const box = (await ctx.main.locator('[data-testid="trim-timeline"]').boundingBox())!;
  const endHandle = (await ctx.main.locator('[data-testid="trim-end"]').boundingBox())!;
  await ctx.main.mouse.move(endHandle.x + endHandle.width / 2, endHandle.y + endHandle.height / 2);
  await ctx.main.mouse.down();
  await ctx.main.mouse.move(box.x + box.width * 0.7, endHandle.y + endHandle.height / 2, { steps: 6 });
  await ctx.main.mouse.up();
  await shot('trim.png');
  await ctx.main.click('[data-testid="trim-save"]');
  await ctx.main.waitForSelector('[data-testid="player-video"]', { timeout: 60_000 });
  const after = (await library()).find((e) => e.id === target!.id)!;
  expect(after.trimmedAt).toBeTruthy();
  expect(after.durationMs!).toBeLessThan(info.value.durationMs * 0.8);
  expect(after.durationMs!).toBeGreaterThan(info.value.durationMs * 0.55);
  expect(existsSync(after.absolutePath)).toBe(true);
  expect((await probePlayback(ctx.main)).error).toBeNull();
});

test('13-14: library shows the recording; rename renames the file', async () => {
  await ctx.main.evaluate(() => (window.location.hash = '/'));
  const target = (await library()).find((e) => e.id === created[created.length - 1])!;
  const card = ctx.main.locator(`[data-recording-id="${target.id}"]`);
  await expect(card).toBeVisible();
  await shot('home.png');

  await card.locator('button[aria-haspopup="menu"]').click();
  await ctx.main.getByRole('menuitem', { name: 'Rename' }).click();
  const title = `E2E demo ${Date.now()}: client/VM`;
  await ctx.main.fill('#rename-input', title);
  await ctx.main.keyboard.press('Enter');
  await expect.poll(async () => (await library()).find((e) => e.id === target.id)?.title).toBe(title);
  const renamed = (await library()).find((e) => e.id === target.id)!;
  expect(renamed.fileName).toMatch(/^E2E demo \d+ client VM\.webm$/);
  expect(existsSync(renamed.absolutePath)).toBe(true);
  expect(existsSync(target.absolutePath)).toBe(false);
});

test('16: show in Explorer opens the recordings folder', async () => {
  const entry = (await library()).find((e) => created.includes(e.id))!;
  const res = await ctx.main.evaluate((id) => window.oneloom.library.showInFolder(id), entry.id);
  expect(res.ok).toBe(true);
  await expect.poll(() => explorerWindowsFor(recordingsDir, false), { timeout: 60_000, intervals: [2000] }).toBeGreaterThan(0);
  await explorerWindowsFor(recordingsDir, true);
});

test('17: relaunching the app still lists existing recordings with their metadata', async () => {
  const before = (await library()).filter((e) => created.includes(e.id));
  await ctx.app.close();
  ctx = await launchApp(env);
  const after = (await library()).filter((e) => created.includes(e.id));
  expect(after.map((e) => e.id).sort()).toEqual(before.map((e) => e.id).sort());
  for (const e of after) {
    const b = before.find((x) => x.id === e.id)!;
    expect(e.title).toBe(b.title);
    expect(e.durationMs).toBe(b.durationMs);
    expect(e.source).toEqual(b.source);
  }
  await expect(ctx.main.locator('[data-testid="recording-card"]').first()).toBeVisible();
});

test('tray, single instance and global shortcut registration', async () => {
  const visibleMain = () =>
    ctx.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some((w) => w.isVisible() && /#\/($|new|settings|recording)/.test(w.webContents.getURL()))
    );
  const info = await ctx.main.evaluate(() => window.oneloom.app.getInfo());
  const always = info.shortcuts.find((s) => s.scope === 'always')!;
  console.log(`  Ctrl+Shift+R registered: ${always.registered}`);
  expect(info.shortcuts.filter((s) => s.scope === 'recording').some((s) => s.registered)).toBe(false);

  // Closing the window (same path as its X button) keeps OneLoom running in the tray…
  await ctx.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((w) => /#\/($|new|settings|recording)/.test(w.webContents.getURL()))
      ?.close()
  );
  await expect.poll(visibleMain).toBe(false);
  expect(ctx.app.process().exitCode).toBeNull();
  // …and launching it again (single instance) brings the existing window back.
  const second = spawn(join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.'], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: 'ignore'
  });
  await expect.poll(visibleMain, { timeout: 60_000 }).toBe(true);
  await expect.poll(() => second.exitCode, { timeout: 60_000 }).not.toBeNull();

  // Pause/stop hotkeys are registered only for the duration of a recording.
  await ctx.main.evaluate(() => window.oneloom.settings.update({ countdown: false, cameraEnabled: false, lastMicrophoneId: 'none' }));
  await ctx.main.evaluate(() => (window.location.hash = '/'));
  await openRecorder(ctx.main, (sources) => sources.find((s) => s.category === 'screen')?.id);
  await ctx.main.click('.btn-record');
  await waitForPhase(ctx.main, 'recording');
  const during = await ctx.main.evaluate(() => window.oneloom.app.getInfo());
  expect(during.shortcuts.filter((s) => s.scope === 'recording').every((s) => s.registered)).toBe(true);
  await ctx.main.waitForTimeout(3500);
  await ctx.main.evaluate(() => window.oneloom.recorder.stop());
  const state = await waitForPhase(ctx.main, 'idle');
  expect(state.error, JSON.stringify(state.error)).toBeNull();
  expect(state.lastRecordingId).toBeTruthy();
  created.push(state.lastRecordingId!);
  const after = await ctx.main.evaluate(() => window.oneloom.app.getInfo());
  expect(after.shortcuts.filter((s) => s.scope === 'recording').some((s) => s.registered)).toBe(false);
});

test('15: delete moves recordings to the Recycle Bin and removes them from the library', async () => {
  await ctx.main.evaluate(() => (window.location.hash = '/'));
  for (const id of [...created]) {
    const entry = (await library()).find((e) => e.id === id);
    if (!entry) continue;
    const card = ctx.main.locator(`[data-recording-id="${id}"]`);
    await card.locator('button[aria-haspopup="menu"]').click();
    await ctx.main.getByRole('menuitem', { name: 'Delete' }).click();
    await ctx.main.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect.poll(async () => (await library()).some((e) => e.id === id)).toBe(false);
    expect(existsSync(entry.absolutePath)).toBe(false);
    created.splice(created.indexOf(id), 1);
  }
});
