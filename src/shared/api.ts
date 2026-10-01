import type {
  AppErrorInfo,
  AppInfo,
  AppSettings,
  BubbleConfig,
  BubbleStatus,
  CameraShape,
  CaptureSource,
  TrimInfo,
  ListSourcesOptions,
  RecorderState,
  RecordingEntry,
  RecordingOptions,
  Result,
  ShareProviderInfo,
  ShareResult,
  StorageStatus
} from '@app-types';
import type { ChunkWriteAck, EngineEvent, EngineRequest, EngineResponse } from './engine-protocol';

export type Unsubscribe = () => void;

export interface AppNotice {
  kind: 'info' | 'success' | 'warning' | 'error';
  message: string;
  detail?: string;
}

/**
 * The only surface the renderer can use to reach the OS. Implemented in the preload
 * script with `contextBridge`; every call is validated again in the main process.
 */
export interface OneLoomApi {
  app: {
    getInfo(): Promise<AppInfo>;
    /** Main process asks the UI to navigate (tray "New recording", finished recording…). */
    onNavigate(cb: (route: string) => void): Unsubscribe;
    /** Transient message from the main process (recording saved, recovered, failed…). */
    onNotice(cb: (notice: AppNotice) => void): Unsubscribe;
    log(level: 'info' | 'warn' | 'error', message: string): void;
  };
  settings: {
    get(): Promise<AppSettings>;
    update(patch: Partial<AppSettings>): Promise<AppSettings>;
    onChanged(cb: (settings: AppSettings) => void): Unsubscribe;
  };
  storage: {
    getStatus(): Promise<StorageStatus>;
    chooseFolder(): Promise<StorageStatus>;
    useAutomatic(): Promise<StorageStatus>;
    openFolder(): Promise<Result<true>>;
    retryPending(): Promise<StorageStatus>;
    onChanged(cb: (status: StorageStatus) => void): Unsubscribe;
  };
  sources: {
    list(options?: ListSourcesOptions): Promise<Result<CaptureSource[]>>;
    /** Un-minimise a window listed with `minimized: true` so it can be captured. */
    restore(sourceId: string): Promise<Result<true>>;
  };
  library: {
    list(): Promise<Result<RecordingEntry[]>>;
    rename(id: string, title: string): Promise<Result<RecordingEntry>>;
    remove(id: string): Promise<Result<true>>;
    open(id: string): Promise<Result<true>>;
    showInFolder(id: string): Promise<Result<true>>;
    copyPath(id: string): Promise<Result<string>>;
    saveThumbnail(id: string, jpeg: ArrayBuffer): Promise<Result<true>>;
    onChanged(cb: () => void): Unsubscribe;
    trimInfo(id: string): Promise<Result<TrimInfo>>;
    /** Lossless trim in place; the original goes to the Recycle Bin. */
    trim(id: string, startMs: number, endMs: number): Promise<Result<RecordingEntry>>;
    onTrimProgress(cb: (progress: { id: string; fraction: number }) => void): Unsubscribe;
  };
  /** Floating on-screen camera bubble (used by the recorder setup panel). */
  camera: {
    openBubble(deviceId: string): Promise<Result<true>>;
    closeBubble(): Promise<Result<true>>;
    placeBubble(corner: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'): Promise<Result<true>>;
    setBubbleSize(diameter: number): Promise<Result<true>>;
    /** Grow (1) or shrink (-1) the bubble one step (used by the recording control pill). */
    stepBubble(direction: 1 | -1): Promise<Result<true>>;
    /** Pick an image file as camera background; returns its background id. */
    chooseBackgroundImage(): Promise<Result<string>>;
    onBubbleStatus(cb: (status: BubbleStatus) => void): Unsubscribe;
  };
  /** Only honoured from the bubble window itself. */
  bubble: {
    ready(): void;
    onConfig(cb: (config: BubbleConfig | null) => void): Unsubscribe;
    step(direction: 1 | -1): void;
    setShape(shape: CameraShape): void;
    close(): void;
    drag(phase: 'start' | 'end'): void;
    status(status: BubbleStatus): void;
  };
  share: {
    providers(): Promise<ShareProviderInfo[]>;
    run(providerId: string, recordingId: string): Promise<ShareResult>;
  };
  recorder: {
    start(options: RecordingOptions): Promise<Result<true>>;
    pause(): Promise<Result<true>>;
    resume(): Promise<Result<true>>;
    stop(): Promise<Result<true>>;
    discard(): Promise<Result<true>>;
    setMicMuted(muted: boolean): Promise<Result<true>>;
    setCameraVisible(visible: boolean): Promise<Result<true>>;
    getState(): Promise<RecorderState>;
    onState(cb: (state: RecorderState) => void): Unsubscribe;
  };
  /** Only honoured by the main process when called from the hidden engine window. */
  engine: {
    ready(): void;
    onCommand(cb: (request: EngineRequest) => void): Unsubscribe;
    respond(response: EngineResponse): void;
    emit(event: EngineEvent): void;
    writeChunk(sessionId: string, seq: number, data: ArrayBuffer): Promise<ChunkWriteAck>;
  };
}

export type { AppErrorInfo };
