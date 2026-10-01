import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { OneLoomApi } from '@shared/api';
import { IPC } from '@shared/ipc';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

/** Narrow, typed bridge — the renderer never gets `ipcRenderer` or Node APIs. */
const api: OneLoomApi = {
  app: {
    getInfo: () => invoke(IPC.appGetInfo),
    onNavigate: (cb) => subscribe(IPC.appNavigate, cb),
    onNotice: (cb) => subscribe(IPC.appNotice, cb),
    log: (level, message) => ipcRenderer.send(IPC.appLog, level, String(message))
  },
  settings: {
    get: () => invoke(IPC.settingsGet),
    update: (patch) => invoke(IPC.settingsUpdate, patch),
    onChanged: (cb) => subscribe(IPC.settingsChanged, cb)
  },
  storage: {
    getStatus: () => invoke(IPC.storageStatus),
    chooseFolder: () => invoke(IPC.storageChooseFolder),
    useAutomatic: () => invoke(IPC.storageUseAutomatic),
    openFolder: () => invoke(IPC.storageOpenFolder),
    retryPending: () => invoke(IPC.storageRetryPending),
    onChanged: (cb) => subscribe(IPC.storageChanged, cb)
  },
  sources: {
    list: (options) => invoke(IPC.sourcesList, options ?? {}),
    restore: (sourceId) => invoke(IPC.sourcesRestore, sourceId)
  },
  library: {
    list: () => invoke(IPC.libraryList),
    rename: (id, title) => invoke(IPC.libraryRename, id, title),
    remove: (id) => invoke(IPC.libraryDelete, id),
    open: (id) => invoke(IPC.libraryOpen, id),
    showInFolder: (id) => invoke(IPC.libraryShowInFolder, id),
    copyPath: (id) => invoke(IPC.libraryCopyPath, id),
    saveThumbnail: (id, jpeg) => invoke(IPC.librarySaveThumbnail, id, jpeg),
    onChanged: (cb) => subscribe(IPC.libraryChanged, () => cb()),
    trimInfo: (id) => invoke(IPC.libraryTrimInfo, id),
    trim: (id, startMs, endMs) => invoke(IPC.libraryTrim, id, startMs, endMs),
    onTrimProgress: (cb) => subscribe(IPC.libraryTrimProgress, cb)
  },
  camera: {
    openBubble: (deviceId) => invoke(IPC.cameraOpenBubble, deviceId),
    closeBubble: () => invoke(IPC.cameraCloseBubble),
    placeBubble: (corner) => invoke(IPC.cameraPlaceBubble, corner),
    setBubbleSize: (diameter) => invoke(IPC.cameraSetBubbleSize, diameter),
    stepBubble: (direction) => invoke(IPC.cameraStepBubble, direction),
    chooseBackgroundImage: () => invoke(IPC.cameraChooseBackground),
    onBubbleStatus: (cb) => subscribe(IPC.cameraBubbleStatus, cb)
  },
  bubble: {
    ready: () => ipcRenderer.send(IPC.bubbleReady),
    onConfig: (cb) => subscribe(IPC.bubbleConfig, cb),
    step: (direction) => ipcRenderer.send(IPC.bubbleStep, direction),
    setShape: (shape) => ipcRenderer.send(IPC.bubbleShape, shape),
    close: () => ipcRenderer.send(IPC.bubbleClose),
    drag: (phase) => ipcRenderer.send(IPC.bubbleDrag, phase),
    status: (status) => ipcRenderer.send(IPC.bubbleStatus, status)
  },
  share: {
    providers: () => invoke(IPC.shareProviders),
    run: (providerId, recordingId) => invoke(IPC.shareRun, providerId, recordingId)
  },
  recorder: {
    start: (options) => invoke(IPC.recorderStart, options),
    pause: () => invoke(IPC.recorderPause),
    resume: () => invoke(IPC.recorderResume),
    stop: () => invoke(IPC.recorderStop),
    discard: () => invoke(IPC.recorderDiscard),
    setMicMuted: (muted) => invoke(IPC.recorderSetMicMuted, muted),
    setCameraVisible: (visible) => invoke(IPC.recorderSetCameraVisible, visible),
    getState: () => invoke(IPC.recorderGetState),
    onState: (cb) => subscribe(IPC.recorderState, cb)
  },
  engine: {
    ready: () => ipcRenderer.send(IPC.engineReady),
    onCommand: (cb) => subscribe(IPC.engineCommand, cb),
    respond: (response) => ipcRenderer.send(IPC.engineResponse, response),
    emit: (event) => ipcRenderer.send(IPC.engineEvent, event),
    writeChunk: (sessionId, seq, data) => invoke(IPC.engineChunk, sessionId, seq, data)
  }
};

contextBridge.exposeInMainWorld('oneloom', api);
