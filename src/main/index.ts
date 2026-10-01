import { app, BrowserWindow, Notification, shell } from 'electron';
import { join, resolve } from 'node:path';
import type { AppNotice } from '@shared/api';
import { IPC } from '@shared/ipc';
import { backgroundUrl } from './camera/backgrounds';
import { CameraBubble } from './camera/CameraBubble';
import { DesktopCapturerProvider, SourceService } from './capture/SourceService';
import { registerIpc } from './ipc';
import { LibraryService } from './library/LibraryService';
import { log } from './logger';
import { resolveAppPaths } from './paths';
import { configurePermissions, logMediaAccessStatus } from './permissions';
import { handleMediaProtocol, registerMediaScheme } from './protocol';
import { EngineHost } from './recording/EngineHost';
import { RecordingController } from './recording/RecordingController';
import { copyPathProvider, SharingService, showInOneDriveProvider } from './sharing';
import { ShortcutManager } from './shortcuts';
import { SettingsStore } from './storage/SettingsStore';
import { StorageService } from './storage/StorageService';
import { AppTray } from './tray';
import { WindowManager } from './windows/WindowManager';

// Test/dev isolation hook (ignored by the packaged app): separate profile for settings & library.
if (!app.isPackaged && process.env.ONELOOM_USER_DATA_DIR) app.setPath('userData', resolve(process.env.ONELOOM_USER_DATA_DIR));
app.setAppUserModelId('com.oneloom.desktop');
registerMediaScheme();

let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(bootstrap).catch((err) => {
    log.error('fatal startup error', err);
    app.exit(1);
  });
}

async function bootstrap(): Promise<void> {
  const paths = resolveAppPaths();
  log.init(paths.logs);
  log.info('OneLoom starting', {
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    packaged: app.isPackaged,
    userData: paths.userData
  });

  const settings = new SettingsStore(paths.settingsFile);
  await settings.load();
  const storage = new StorageService(settings);
  await storage.refresh();
  const library = new LibraryService(storage, paths);
  await library.load();

  handleMediaProtocol({
    recordingsDir: () => storage.recordingsDir,
    thumbnailsDir: paths.thumbnails,
    assetsDir: join(paths.resources, 'mediapipe'),
    backgroundsDir: paths.backgrounds
  });
  const bubble = new CameraBubble(settings, backgroundUrl);
  configurePermissions();
  logMediaAccessStatus();

  let tray: AppTray | null = null;
  const windows = new WindowManager(join(paths.resources, 'icon.png'), (event, win) => {
    if (quitting) return;
    if (settings.get().closeToTray || recorder.active) {
      event.preventDefault();
      win.hide();
      if (!settings.get().trayHintShown) {
        tray?.displayBalloon('OneLoom is still running', 'OneLoom keeps running in the system tray. Right-click the tray icon and choose “Quit OneLoom” to exit.');
        void settings.update({ trayHintShown: true });
      }
    } else {
      quitting = true;
      app.quit();
    }
  });

  const notice = (n: AppNotice) => {
    const main = windows.main;
    if (main && !main.isDestroyed()) main.webContents.send(IPC.appNotice, n);
  };

  const engine = new EngineHost();
  const recorder = new RecordingController(engine, storage, library, paths.sessions, {
    beforeCapture: () => windows.hideMain(),
    showCountdown: (id) => windows.showCountdown(id),
    hideCountdown: () => windows.hideCountdown(),
    showController: (id) => windows.showController(id),
    hideController: () => windows.hideController(),
    stateChanged: (state) => {
      windows.broadcast(IPC.recorderState, state);
      tray?.update(state);
      shortcuts.setRecording(state.phase !== 'idle');
    },
    planCamera: (options) => {
      const layout = options.cameraLayout;
      if (!options.cameraDeviceId) return { mode: 'none', layout, mirror: false };
      if (bubble.isOpen) {
        bubble.setRecording(true);
        if (options.source.kind === 'screen') {
          // The bubble is part of the screen: keep it on the display being recorded.
          if (options.source.displayId) bubble.moveToDisplay(options.source.displayId);
          return { mode: 'none', layout, mirror: false };
        }
        const sourceId = bubble.mediaSourceId();
        if (sourceId) return { mode: 'window-overlay', sourceId, layout: bubble.layout(), mirror: false };
      }
      return { mode: 'device', deviceId: options.cameraDeviceId, layout, mirror: settings.get().camera.mirror };
    },
    setCameraVisible: (visible) => bubble.setHidden(!visible),
    finished: (outcome) => {
      bubble.close();
      windows.showMain(outcome.recordingId ? `/recording/${outcome.recordingId}` : '/');
      if (outcome.error && outcome.notice) notice({ kind: 'warning', message: outcome.notice, detail: outcome.error.message });
      else if (outcome.error) notice({ kind: 'error', message: outcome.error.message });
      else if (outcome.notice) notice({ kind: 'info', message: outcome.notice });
      else if (outcome.recordingId) notice({ kind: 'success', message: 'Recording saved to your recordings folder.' });
    },
    notify: (title, body) => {
      if (Notification.isSupported()) new Notification({ title, body }).show();
      notice({ kind: 'info', message: body });
    }
  });

  const openRecordings = async () => {
    const dir = await storage.ensureReady();
    if (dir.ok) void shell.openPath(dir.value);
    else windows.showMain('/');
  };

  const shortcuts = new ShortcutManager([
    {
      accelerator: 'CommandOrControl+Shift+R',
      action: 'Open recorder',
      scope: 'always',
      run: () => {
        if (!recorder.active) windows.showMain('/new');
      }
    },
    { accelerator: 'CommandOrControl+Shift+P', action: 'Pause / resume', scope: 'recording', run: () => void recorder.togglePause() },
    { accelerator: 'CommandOrControl+Shift+S', action: 'Stop recording', scope: 'recording', run: () => void recorder.stop('user') }
  ]);
  shortcuts.setEnabled(settings.get().shortcutsEnabled);

  tray = new AppTray(paths.resources, {
    newRecording: () => windows.showMain('/new'),
    openApp: () => windows.showMain(),
    openRecordings: () => void openRecordings(),
    togglePause: () => void recorder.togglePause(),
    stop: () => void recorder.stop('user'),
    quit: () => app.quit()
  });

  const sources = new SourceService([new DesktopCapturerProvider(() => windows.ownMediaSourceIds())]);
  const sharing = new SharingService([copyPathProvider, showInOneDriveProvider]);

  registerIpc({
    windows,
    settings,
    storage,
    library,
    sources,
    recorder,
    engine,
    sharing,
    shortcuts,
    bubble,
    backgroundsDir: paths.backgrounds,
    logFile: () => log.file
  });

  // The bubble follows the user's drags/resizes into window recordings.
  bubble.on('layout', (layout) => recorder.updateCameraLayout(layout));
  bubble.on('status', (status) => windows.broadcast(IPC.cameraBubbleStatus, status));
  bubble.on('closedByUser', () => {
    if (recorder.active) void recorder.setCameraVisible(false);
    else void settings.update({ cameraEnabled: false });
  });

  storage.on('changed', (s) => windows.broadcast(IPC.storageChanged, s));
  library.on('changed', () => windows.broadcast(IPC.libraryChanged));
  settings.on('changed', (s) => {
    windows.broadcast(IPC.settingsChanged, s);
    shortcuts.setEnabled(s.shortcutsEnabled);
  });

  // `--hidden` is passed by the sign-in launch: stay in the tray, but warm everything up.
  const startHidden = process.argv.includes('--hidden');
  const main = windows.createMain(!startHidden);
  // Let the visible window load first; then warm the recorder engine and the recording
  // overlays so starting a recording never waits for a new renderer process.
  let warmed = false;
  const warmUp = () => {
    if (warmed) return;
    warmed = true;
    void engine.ensure();
    windows.prewarmOverlays();
    bubble.prewarm();
  };
  main.once('ready-to-show', warmUp);
  setTimeout(warmUp, 20_000).unref();

  const applyLoginItem = (enabled: boolean) => {
    if (!app.isPackaged || process.platform !== 'win32') return;
    try {
      app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: ['--hidden'] });
    } catch (err) {
      log.warn('could not update sign-in launch', err);
    }
  };
  applyLoginItem(settings.get().launchAtLogin);
  settings.on('changed', (s) => applyLoginItem(s.launchAtLogin));
  void recorder.recoverSessions().catch((err) => log.error('session recovery failed', err));

  // Deliver recordings that were waiting for the OneDrive folder.
  setInterval(() => {
    if (storage.get().pendingCount > 0 && !recorder.active) {
      void storage.refresh().then(() => recorder.recoverSessions());
    }
  }, 60_000).unref();

  app.on('second-instance', () => windows.showMain());
  app.on('activate', () => windows.showMain());
  app.on('window-all-closed', () => {
    // Stay alive in the tray; quitting is explicit.
  });

  app.on('before-quit', (event) => {
    if (recorder.active && !quitting) {
      event.preventDefault();
      quitting = true;
      log.info('quit requested during recording; saving first');
      void recorder.shutdown().finally(() => app.quit());
      return;
    }
    quitting = true;
  });
  app.on('will-quit', () => {
    shortcuts.unregisterAll();
    tray?.destroy();
    bubble.destroy();
    engine.destroy();
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.destroy();
  });
}
