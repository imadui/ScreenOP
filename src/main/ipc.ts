import { app, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import type { AppInfo, BubbleStatus, ListSourcesOptions, Result } from '@app-types';
import type { CameraBubble } from './camera/CameraBubble';
import { importBackgroundImage } from './camera/backgrounds';
import type { EngineEvent, EngineResponse } from '@shared/engine-protocol';
import { appError, describeUnknown } from '@shared/errors';
import { IPC } from '@shared/ipc';
import type { LibraryService } from './library/LibraryService';
import { log } from './logger';
import type { EngineHost } from './recording/EngineHost';
import type { RecordingController } from './recording/RecordingController';
import type { SourceService } from './capture/SourceService';
import type { SettingsStore } from './storage/SettingsStore';
import type { StorageService } from './storage/StorageService';
import type { SharingService } from './sharing';
import type { ShortcutManager } from './shortcuts';
import type { WindowManager } from './windows/WindowManager';

export interface IpcContext {
  windows: WindowManager;
  settings: SettingsStore;
  storage: StorageService;
  library: LibraryService;
  sources: SourceService;
  recorder: RecordingController;
  engine: EngineHost;
  sharing: SharingService;
  shortcuts: ShortcutManager;
  bubble: CameraBubble;
  backgroundsDir: string;
  logFile: () => string;
}

const isId = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9-]{8,64}$/i.test(v);
const invalid = <T>(): Result<T> => ({ ok: false, error: appError('invalid-input') });

function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

export function registerIpc(ctx: IpcContext): void {
  const { windows, settings, storage, library, sources, recorder, engine, sharing, shortcuts, bubble } = ctx;

  const handle = (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return await fn(event, ...args);
      } catch (err) {
        log.error(`ipc ${channel} failed`, err);
        return { ok: false, error: appError('unknown', undefined, describeUnknown(err)) };
      }
    });
  };

  // ---- app -------------------------------------------------------------------
  handle(IPC.appGetInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: `${process.platform} ${process.getSystemVersion()}`,
    userDataDir: app.getPath('userData'),
    logFile: ctx.logFile(),
    shortcuts: shortcuts.status()
  }));

  let logBudget = 200;
  setInterval(() => (logBudget = 200), 60_000).unref();
  ipcMain.on(IPC.appLog, (_e, level: unknown, message: unknown) => {
    if (logBudget-- <= 0 || typeof message !== 'string') return;
    const text = `[renderer] ${message.slice(0, 2000)}`;
    if (level === 'error') log.error(text);
    else if (level === 'warn') log.warn(text);
    else log.info(text);
  });

  // ---- settings --------------------------------------------------------------
  handle(IPC.settingsGet, () => settings.get());
  handle(IPC.settingsUpdate, async (_e, patch) => {
    if (typeof patch !== 'object' || !patch) return settings.get();
    // The recordings folder is only changed through the storage API (dialog-driven).
    const { customRecordingsDir: _ignored, ...rest } = patch as Record<string, unknown>;
    return settings.update(rest);
  });

  // ---- storage ---------------------------------------------------------------
  handle(IPC.storageStatus, () => storage.refresh());
  handle(IPC.storageChooseFolder, async () => {
    const parent = windows.main && !windows.main.isDestroyed() ? windows.main : undefined;
    const current = storage.recordingsDir ?? undefined;
    const options: Electron.OpenDialogOptions = {
      title: 'Choose the folder for OneLoom recordings',
      properties: ['openDirectory', 'createDirectory'],
      ...(current ? { defaultPath: current } : {})
    };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    if (!result.canceled && result.filePaths[0]) {
      await settings.update({ customRecordingsDir: result.filePaths[0] });
      const status = await storage.refresh();
      library.emit('changed');
      return status;
    }
    return storage.get();
  });
  handle(IPC.storageUseAutomatic, async () => {
    await settings.update({ customRecordingsDir: null });
    const status = await storage.refresh();
    library.emit('changed');
    return status;
  });
  handle(IPC.storageOpenFolder, async (): Promise<Result<true>> => {
    const dir = await storage.ensureReady();
    if (!dir.ok) return dir;
    const err = await shell.openPath(dir.value);
    return err ? { ok: false, error: appError('storage-unavailable', err) } : { ok: true, value: true };
  });
  handle(IPC.storageRetryPending, async () => {
    await storage.refresh();
    // recoverSessions() is single-flight and never touches a recording in progress.
    await recorder.recoverSessions();
    return storage.get();
  });

  // ---- sources ---------------------------------------------------------------
  handle(IPC.sourcesList, async (_e, raw) => {
    const opts = (typeof raw === 'object' && raw ? raw : {}) as ListSourcesOptions;
    try {
      const list = await sources.list({
        ...(typeof opts.thumbnailWidth === 'number' ? { thumbnailWidth: opts.thumbnailWidth } : {}),
        includeIcons: opts.includeIcons !== false
      });
      return { ok: true, value: list };
    } catch (err) {
      log.error('source enumeration failed', err);
      return { ok: false, error: appError('source-unavailable', 'Windows did not return any screens or windows to capture.', describeUnknown(err)) };
    }
  });

  handle(IPC.sourcesRestore, async (_e, id): Promise<Result<true>> => {
    if (typeof id !== 'string' || !/^window:\d+:\d+$/.test(id)) return invalid();
    const ok = await sources.restore(id);
    return ok
      ? { ok: true, value: true }
      : { ok: false, error: appError('source-unavailable', 'Windows did not let OneLoom restore this window. Restore it from the taskbar, then pick it again.') };
  });

  // ---- library ---------------------------------------------------------------
  handle(IPC.libraryList, () => library.list());
  handle(IPC.libraryRename, (_e, id, title) => (isId(id) && typeof title === 'string' ? library.rename(id, title) : invalid()));
  handle(IPC.libraryDelete, (_e, id) => (isId(id) ? library.remove(id) : invalid()));
  handle(IPC.libraryOpen, async (_e, id): Promise<Result<true>> => {
    const entry = isId(id) ? library.get(id) : undefined;
    if (!entry) return { ok: false, error: appError('not-found') };
    const err = await shell.openPath(entry.absolutePath);
    return err ? { ok: false, error: appError('unknown', `Windows could not open the file: ${err}`) } : { ok: true, value: true };
  });
  handle(IPC.libraryShowInFolder, (_e, id): Result<true> => {
    const entry = isId(id) ? library.get(id) : undefined;
    if (!entry) return { ok: false, error: appError('not-found') };
    shell.showItemInFolder(entry.absolutePath);
    return { ok: true, value: true };
  });
  handle(IPC.libraryCopyPath, (_e, id): Result<string> => {
    const entry = isId(id) ? library.get(id) : undefined;
    if (!entry) return { ok: false, error: appError('not-found') };
    clipboard.writeText(entry.absolutePath);
    return { ok: true, value: entry.absolutePath };
  });
  handle(IPC.librarySaveThumbnail, async (_e, id, data) => {
    const bytes = toBytes(data);
    if (!isId(id) || !bytes || !library.get(id)) return invalid();
    const res = await library.saveThumbnail(id, bytes);
    if (res.ok) library.emit('changed');
    return res;
  });

  handle(IPC.libraryTrimInfo, (_e, id) => (isId(id) ? library.trimInfo(id) : invalid()));
  handle(IPC.libraryTrim, async (_e, id, startMs, endMs) => {
    if (!isId(id) || typeof startMs !== 'number' || typeof endMs !== 'number') return invalid();
    if (recorder.active) return { ok: false, error: appError('already-recording', 'Finish the current recording before trimming.') };
    return library.trim(id, startMs, endMs, (fraction) => windows.broadcast(IPC.libraryTrimProgress, { id, fraction }));
  });

  // ---- camera bubble (main window side) --------------------------------------
  const corners = new Set(['bottom-left', 'bottom-right', 'top-left', 'top-right']);
  handle(IPC.cameraOpenBubble, (_e, deviceId): Result<true> => {
    if (typeof deviceId !== 'string' || !deviceId || deviceId.length > 512) return invalid();
    bubble.open(deviceId);
    return { ok: true, value: true };
  });
  handle(IPC.cameraCloseBubble, (): Result<true> => {
    // During a recording the bubble belongs to the recording; only the controller hides it.
    if (!recorder.active) bubble.close();
    return { ok: true, value: true };
  });
  handle(IPC.cameraPlaceBubble, (_e, corner): Result<true> => {
    if (typeof corner !== 'string' || !corners.has(corner)) return invalid();
    bubble.place(corner as 'bottom-left');
    return { ok: true, value: true };
  });
  handle(IPC.cameraSetBubbleSize, (_e, diameter): Result<true> => {
    if (typeof diameter !== 'number' || !Number.isFinite(diameter)) return invalid();
    bubble.resizeTo(diameter);
    return { ok: true, value: true };
  });
  handle(IPC.cameraStepBubble, (_e, direction): Result<true> => {
    if (direction !== 1 && direction !== -1) return invalid();
    bubble.step(direction);
    return { ok: true, value: true };
  });
  handle(IPC.cameraChooseBackground, async (): Promise<Result<string>> => {
    const parent = windows.main && !windows.main.isDestroyed() ? windows.main : undefined;
    const options: Electron.OpenDialogOptions = {
      title: 'Choose a background image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    };
    const res = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    if (res.canceled || !res.filePaths[0]) return { ok: false, error: appError('invalid-input', 'No image selected.') };
    return importBackgroundImage(res.filePaths[0], ctx.backgroundsDir);
  });

  // ---- camera bubble window (only from the bubble itself) ---------------------
  const fromBubble = (event: Electron.IpcMainEvent) => bubble.isBubble(event.sender.id);
  ipcMain.on(IPC.bubbleReady, (event) => fromBubble(event) && bubble.handleReady());
  ipcMain.on(IPC.bubbleStep, (event, direction: unknown) => {
    if (fromBubble(event) && (direction === 1 || direction === -1)) bubble.step(direction);
  });
  ipcMain.on(IPC.bubbleShape, (event, shape: unknown) => {
    if (fromBubble(event) && (shape === 'circle' || shape === 'rounded')) bubble.setShape(shape);
  });
  ipcMain.on(IPC.bubbleDrag, (event, phase: unknown) => {
    if (fromBubble(event) && (phase === 'start' || phase === 'end')) bubble.drag(phase);
  });
  ipcMain.on(IPC.bubbleClose, (event) => fromBubble(event) && bubble.handleUserClose());
  ipcMain.on(IPC.bubbleStatus, (event, status: BubbleStatus) => {
    if (fromBubble(event) && status && typeof status.camera === 'string') bubble.handleStatus(status);
  });

  // ---- sharing ---------------------------------------------------------------
  handle(IPC.shareProviders, () => sharing.list());
  handle(IPC.shareRun, (_e, providerId, id) => {
    const entry = isId(id) ? library.get(id) : undefined;
    if (!entry || typeof providerId !== 'string') return { ok: false, message: 'Recording not found.' };
    return sharing.run(providerId, entry);
  });

  // ---- recorder --------------------------------------------------------------
  handle(IPC.recorderStart, (_e, options) => recorder.start(options));
  handle(IPC.recorderPause, () => recorder.pause());
  handle(IPC.recorderResume, () => recorder.resume());
  handle(IPC.recorderStop, () => recorder.stop('user'));
  handle(IPC.recorderDiscard, () => recorder.discard());
  handle(IPC.recorderSetMicMuted, (_e, muted) => recorder.setMicMuted(muted === true));
  handle(IPC.recorderSetCameraVisible, (_e, visible) => recorder.setCameraVisible(visible === true));
  handle(IPC.recorderGetState, () => recorder.getState());

  // ---- engine (only from the hidden engine window) ---------------------------
  ipcMain.on(IPC.engineReady, (event) => {
    if (engine.isEngine(event.sender.id)) engine.handleReady();
  });
  ipcMain.on(IPC.engineResponse, (event, response: EngineResponse) => {
    if (engine.isEngine(event.sender.id) && response && typeof response.requestId === 'number') engine.handleResponse(response);
  });
  ipcMain.on(IPC.engineEvent, (event, payload: EngineEvent) => {
    if (engine.isEngine(event.sender.id) && payload && typeof payload.type === 'string') engine.handleEvent(payload);
  });
  ipcMain.handle(IPC.engineChunk, async (event, sessionId: unknown, seq: unknown, data: unknown) => {
    if (!engine.isEngine(event.sender.id)) return { ok: false, error: appError('invalid-input') };
    const bytes = toBytes(data);
    if (typeof sessionId !== 'string' || typeof seq !== 'number' || !bytes) return { ok: false, error: appError('invalid-input') };
    return recorder.writeChunk(sessionId, seq, bytes);
  });
}
