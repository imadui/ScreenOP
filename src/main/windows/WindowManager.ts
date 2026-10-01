import { BrowserWindow, nativeTheme } from 'electron';
import { join } from 'node:path';
import { IPC } from '@shared/ipc';
import { log } from '../logger';
import { displayFor, hardenWindow, loadRoute, secureWebPreferences } from './common';

const THEME = {
  dark: { background: '#111318', symbols: '#e7e9ee' },
  light: { background: '#f6f7f9', symbols: '#1b1e24' }
};

const CONTROLLER_SIZE = { width: 460, height: 72 };
const COUNTDOWN_SIZE = { width: 260, height: 260 };

/**
 * Owns the visible windows: the main library/recorder window, the floating
 * recording controller and the countdown overlay. Overlays use content protection
 * (WDA_EXCLUDEFROMCAPTURE on Windows 10 2004+) so they never appear in recordings.
 */
export class WindowManager {
  main: BrowserWindow | null = null;
  controller: BrowserWindow | null = null;
  countdown: BrowserWindow | null = null;
  private pendingRoute: string | null = null;
  private showRequested = false;

  constructor(
    private readonly iconPath: string,
    private readonly onMainClose: (event: Electron.Event, win: BrowserWindow) => void
  ) {
    nativeTheme.on('updated', () => this.applyTitleBarTheme());
  }

  /** @param showWhenReady false keeps the window hidden (started at sign-in into the tray). */
  createMain(showWhenReady = true): BrowserWindow {
    if (this.main && !this.main.isDestroyed()) return this.main;
    const theme = nativeTheme.shouldUseDarkColors ? THEME.dark : THEME.light;
    const win = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 900,
      minHeight: 620,
      show: false,
      title: 'OneLoom',
      icon: this.iconPath,
      backgroundColor: theme.background,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: theme.background, symbolColor: theme.symbols, height: 52 },
      webPreferences: secureWebPreferences()
    });
    hardenWindow(win);
    const createdAt = Date.now();
    win.once('ready-to-show', () => {
      log.info(`main window ready after ${Date.now() - createdAt} ms`);
      if (showWhenReady || this.showRequested) win.show();
    });
    win.on('close', (e) => this.onMainClose(e, win));
    win.on('closed', () => {
      this.main = null;
    });
    win.webContents.on('did-finish-load', () => {
      if (this.pendingRoute) {
        win.webContents.send(IPC.appNavigate, this.pendingRoute);
        this.pendingRoute = null;
      }
    });
    loadRoute(win, '/');
    this.main = win;
    return win;
  }

  /** Show (creating if needed) the main window, optionally navigating to a route. */
  showMain(route?: string): void {
    const existed = !!this.main && !this.main.isDestroyed();
    const win = this.createMain();
    if (route) {
      if (existed && !win.webContents.isLoading()) win.webContents.send(IPC.appNavigate, route);
      else this.pendingRoute = route;
    }
    this.showRequested = true;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }

  hideMain(): void {
    if (this.main && !this.main.isDestroyed()) this.main.hide();
  }

  /**
   * Create the (hidden) controller and countdown windows ahead of time. Chromium can take
   * many seconds to start a renderer on managed PCs; pre-warming makes the recording
   * controls appear the instant a recording starts.
   */
  prewarmOverlays(): void {
    this.ensureController();
    this.ensureCountdown();
  }

  showController(displayId?: string | null): void {
    const win = this.ensureController();
    const d = displayFor(displayId);
    const { width, height } = CONTROLLER_SIZE;
    win.setBounds({
      x: Math.round(d.workArea.x + (d.workArea.width - width) / 2),
      y: Math.round(d.workArea.y + d.workArea.height - height - 24),
      width,
      height
    });
    win.showInactive();
    win.setAlwaysOnTop(true, 'screen-saver');
  }

  hideController(): void {
    if (this.controller && !this.controller.isDestroyed()) this.controller.hide();
  }

  showCountdown(displayId?: string | null): void {
    const win = this.ensureCountdown();
    const d = displayFor(displayId);
    const { width, height } = COUNTDOWN_SIZE;
    win.setBounds({
      x: Math.round(d.workArea.x + (d.workArea.width - width) / 2),
      y: Math.round(d.workArea.y + (d.workArea.height - height) / 2),
      width,
      height
    });
    win.showInactive();
    win.setAlwaysOnTop(true, 'screen-saver');
  }

  hideCountdown(): void {
    if (this.countdown && !this.countdown.isDestroyed()) this.countdown.hide();
  }

  private ensureController(): BrowserWindow {
    if (this.controller && !this.controller.isDestroyed()) return this.controller;
    const { width, height } = CONTROLLER_SIZE;
    const win = new BrowserWindow({
      width,
      height,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      title: 'OneLoom recording controls',
      backgroundColor: '#00000000',
      webPreferences: secureWebPreferences({ backgroundThrottling: false })
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setContentProtection(true);
    hardenWindow(win);
    win.on('closed', () => {
      this.controller = null;
    });
    loadRoute(win, '/controller');
    this.controller = win;
    return win;
  }

  private ensureCountdown(): BrowserWindow {
    if (this.countdown && !this.countdown.isDestroyed()) return this.countdown;
    const { width, height } = COUNTDOWN_SIZE;
    const win = new BrowserWindow({
      width,
      height,
      frame: false,
      transparent: true,
      resizable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: secureWebPreferences({ backgroundThrottling: false })
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true);
    win.setContentProtection(true);
    hardenWindow(win);
    win.on('closed', () => {
      this.countdown = null;
    });
    loadRoute(win, '/countdown');
    this.countdown = win;
    return win;
  }

  /** Send to every OneLoom window (main, overlays and engine). */
  broadcast(channel: string, payload?: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  }

  /** Media source ids of our own windows, so they are hidden from the source picker. */
  ownMediaSourceIds(): Set<string> {
    const ids = new Set<string>();
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        ids.add(win.getMediaSourceId());
      } catch {
        // Window being destroyed.
      }
    }
    return ids;
  }

  private applyTitleBarTheme(): void {
    const theme = nativeTheme.shouldUseDarkColors ? THEME.dark : THEME.light;
    if (this.main && !this.main.isDestroyed()) {
      this.main.setBackgroundColor(theme.background);
      this.main.setTitleBarOverlay({ color: theme.background, symbolColor: theme.symbols, height: 52 });
    }
  }
}

export function resourcePath(resourcesDir: string, name: string): string {
  return join(resourcesDir, name);
}
