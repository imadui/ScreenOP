import { app, screen, type BrowserWindow, type Display, type WebPreferences } from 'electron';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function preloadPath(): string {
  return join(__dirname, '../preload/index.js');
}

/** Every window uses the same locked-down preferences: isolated, sandboxed, no Node. */
export function secureWebPreferences(extra: WebPreferences = {}): WebPreferences {
  return {
    preload: preloadPath(),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    spellcheck: false,
    ...extra
  };
}

/** Load a hash route of the single renderer bundle (dev server in development). */
export function loadRoute(win: BrowserWindow, route: string): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devUrl) {
    void win.loadURL(`${devUrl}#${route}`);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: route });
  }
}

/**
 * True only for OneLoom's own renderer page: the bundled index.html, or the dev server
 * origin in development. Compares parsed origins/paths — never string prefixes, which
 * `http://127.0.0.1:5173@evil.example/` style URLs would defeat.
 */
export function isAppUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    const dev = process.env.ELECTRON_RENDERER_URL;
    if (!app.isPackaged && dev && u.origin === new URL(dev).origin) return true;
    if (u.protocol === 'file:') {
      const page = resolve(fileURLToPath(u)).toLowerCase();
      return page === resolve(__dirname, '../renderer/index.html').toLowerCase();
    }
  } catch {
    // Unparseable URL: not ours.
  }
  return false;
}

/** Block popups and navigation away from the app bundle. */
export function hardenWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
}

export function displayFor(displayId?: string | null): Display {
  const displays = screen.getAllDisplays();
  return (
    (displayId ? displays.find((d) => String(d.id) === displayId) : undefined) ??
    screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  );
}
