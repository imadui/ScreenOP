import { EventEmitter } from 'node:events';
import { BrowserWindow } from 'electron';
import type { Result } from '@app-types';
import type { EngineCommand, EngineEvent, EngineResponse, EngineResult } from '@shared/engine-protocol';
import { appError } from '@shared/errors';
import { IPC } from '@shared/ipc';
import { log } from '../logger';
import { hardenWindow, loadRoute, secureWebPreferences } from '../windows/common';

interface Pending {
  resolve: (r: Result<EngineResult>) => void;
  timer: NodeJS.Timeout;
  type: EngineCommand['type'];
}

const READY_TIMEOUT_MS = 45_000;

/**
 * Hosts the hidden renderer that owns MediaStreams + MediaRecorder.
 * Keeping capture out of the visible UI means the library window can be hidden,
 * reloaded or closed without touching an active recording.
 */
export class EngineHost extends EventEmitter<{ event: [EngineEvent]; gone: [string] }> {
  private win: BrowserWindow | null = null;
  private readyPromise: Promise<boolean> | null = null;
  private markReady: ((ok: boolean) => void) | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, Pending>();

  /**
   * Create the engine window if needed. Resolves true once its script registered,
   * false only if the window died. (Callers apply their own timeout, so a slow
   * first load never leaves the engine permanently "unavailable".)
   */
  ensure(): Promise<boolean> {
    if (this.win && !this.win.isDestroyed() && this.readyPromise) return this.readyPromise;
    const createdAt = Date.now();
    const win = new BrowserWindow({
      show: false,
      width: 480,
      height: 320,
      skipTaskbar: true,
      title: 'OneLoom engine',
      webPreferences: secureWebPreferences({ backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' })
    });
    hardenWindow(win);
    this.win = win;
    this.readyPromise = new Promise<boolean>((resolve) => {
      this.markReady = (ok) => {
        if (ok) log.info(`engine ready after ${Date.now() - createdAt} ms`);
        resolve(ok);
      };
    });
    win.webContents.once('did-finish-load', () => log.debug(`engine page loaded after ${Date.now() - createdAt} ms`));
    win.webContents.on('render-process-gone', (_e, details) => {
      log.error('engine renderer gone', details.reason);
      this.teardown(`engine renderer ${details.reason}`);
    });
    win.on('closed', () => this.teardown('engine window closed'));
    win.webContents.on('console-message', (event) => {
      const level = event.level;
      if (level === 'warning' || level === 'error') log.warn('[engine console]', event.message);
    });
    loadRoute(win, '/engine');
    return this.readyPromise;
  }

  isEngine(webContentsId: number): boolean {
    return !!this.win && !this.win.isDestroyed() && this.win.webContents.id === webContentsId;
  }

  handleReady(): void {
    this.markReady?.(true);
    this.markReady = null;
  }

  handleResponse(response: EngineResponse): void {
    const p = this.pending.get(response.requestId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(response.requestId);
    p.resolve(response.ok ? { ok: true, value: response.result } : { ok: false, error: response.error });
  }

  handleEvent(event: EngineEvent): void {
    this.emit('event', event);
  }

  async request<T extends EngineResult>(command: EngineCommand, timeoutMs: number): Promise<Result<T>> {
    const ready = await Promise.race([
      this.ensure(),
      new Promise<boolean>((r) => setTimeout(() => r(false), READY_TIMEOUT_MS))
    ]);
    if (!ready) log.error(`engine not ready within ${READY_TIMEOUT_MS} ms for ${command.type}`);
    if (!ready || !this.win || this.win.isDestroyed()) return { ok: false, error: appError('engine-unavailable') };
    const requestId = this.nextRequestId++;
    const win = this.win;
    return new Promise<Result<T>>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        log.warn('engine request timed out', command.type);
        resolve({ ok: false, error: appError('engine-unavailable', `The recorder did not respond (${command.type}).`) });
      }, timeoutMs);
      this.pending.set(requestId, { resolve: resolve as (r: Result<EngineResult>) => void, timer, type: command.type });
      win.webContents.send(IPC.engineCommand, { requestId, command });
    });
  }

  destroy(): void {
    const win = this.win;
    this.teardown('shutdown');
    if (win && !win.isDestroyed()) win.destroy();
  }

  private teardown(reason: string): void {
    if (!this.win && !this.readyPromise) return;
    this.win = null;
    this.readyPromise = null;
    this.markReady?.(false);
    this.markReady = null;
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: appError('engine-unavailable', `The recorder stopped unexpectedly (${reason}).`) });
      this.pending.delete(id);
    }
    this.emit('gone', reason);
  }
}
