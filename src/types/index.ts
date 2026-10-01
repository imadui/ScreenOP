/**
 * Domain types shared by the main process, preload bridge and renderer.
 * Keep this file free of runtime code and of Electron/DOM imports.
 */

export type SourceKind = 'screen' | 'window';

/** How a capture source is presented in the picker. */
export type SourceCategory = 'screen' | 'window' | 'browser' | 'remote';

export interface DisplayInfo {
  id: string;
  index: number;
  label: string;
  /** Physical pixel size (DIP size × scale factor). */
  width: number;
  height: number;
  scaleFactor: number;
  primary: boolean;
}

export interface CaptureSource {
  /** desktopCapturer id, e.g. `screen:0:0` or `window:132456:0`. */
  id: string;
  kind: SourceKind;
  category: SourceCategory;
  /** Raw window title / screen name as reported by Windows. */
  name: string;
  /** Friendly label, e.g. `Remote Desktop — VM-DEMO01`. */
  displayName: string;
  appName?: string;
  processName?: string;
  remoteHost?: string;
  thumbnailDataUrl?: string;
  appIconDataUrl?: string;
  /** True when Windows returned an empty thumbnail (typically a minimised window). */
  previewUnavailable?: boolean;
  /** Minimised (or hidden) window: not capturable until restored. */
  minimized?: boolean;
  display?: DisplayInfo;
}

export interface ListSourcesOptions {
  thumbnailWidth?: number;
  includeIcons?: boolean;
}

export type CameraShape = 'circle' | 'rounded';
export type CameraSize = 'small' | 'medium' | 'large';

/** Camera bubble placement; x/y are the bubble centre, normalised to 0..1 of the video frame. */
export interface CameraLayout {
  x: number;
  y: number;
  size: CameraSize;
  shape: CameraShape;
  /** Exact diameter as a fraction of the frame's shorter side (overrides `size`). */
  diameter?: number;
}

export type CameraBackground = 'none' | 'blur-light' | 'blur-strong' | 'image';

export interface CameraSettings {
  mirror: boolean;
  background: CameraBackground;
  /** `preset:<name>` or `custom:<file>` (stored in app data/backgrounds). */
  backgroundImage: string | null;
  /** On-screen bubble diameter in DIP. */
  bubbleDiameter: number;
  /** Last on-screen bubble position (top-left, DIP), restored when it reappears. */
  bubblePosition: { x: number; y: number } | null;
}

/** Everything the floating camera bubble window needs to render. */
export interface BubbleConfig {
  deviceId: string;
  diameter: number;
  shape: CameraShape;
  mirror: boolean;
  background: CameraBackground;
  /** Resolved URL for image backgrounds (preset images are drawn procedurally). */
  backgroundImage: string | null;
  recording: boolean;
}

export interface BubbleStatus {
  camera: 'starting' | 'live' | 'error';
  effects: 'off' | 'loading' | 'ready' | 'unavailable';
  message?: string;
}

export interface TrimInfo {
  supported: boolean;
  reason?: string;
  durationMs: number;
  /** Video keyframe times: a lossless cut can only start on one of these. */
  keyframesMs: number[];
}

export type QualityPreset = 'standard' | 'high';

export interface RecordingSourceRef {
  id: string;
  kind: SourceKind;
  category: SourceCategory;
  name: string;
  displayName: string;
  displayId?: string;
  /** Physical size of the display for screen sources. */
  width?: number;
  height?: number;
}

export interface RecordingOptions {
  source: RecordingSourceRef;
  microphoneDeviceId: string | null;
  microphoneLabel?: string;
  cameraDeviceId: string | null;
  cameraLabel?: string;
  cameraLayout: CameraLayout;
  systemAudio: boolean;
  quality: QualityPreset;
  countdown: boolean;
}

export type RecorderPhase =
  | 'idle'
  | 'preparing'
  | 'countdown'
  | 'recording'
  | 'paused'
  | 'stopping'
  | 'finalizing';

export type ErrorCode =
  | 'onedrive-not-detected'
  | 'storage-unavailable'
  | 'microphone-unavailable'
  | 'camera-unavailable'
  | 'permission-denied'
  | 'source-unavailable'
  | 'source-ended'
  | 'disk-full'
  | 'write-failed'
  | 'codec-unsupported'
  | 'system-audio-unavailable'
  | 'already-recording'
  | 'engine-unavailable'
  | 'not-found'
  | 'invalid-input'
  | 'unknown';

export interface AppErrorInfo {
  code: ErrorCode;
  message: string;
  detail?: string;
}

export interface RecorderState {
  phase: RecorderPhase;
  sessionId: string | null;
  countdownValue: number | null;
  /** Active (non-paused) time accumulated before `runningSince`. */
  elapsedMs: number;
  /** Epoch ms at which the current active segment started; null while paused/idle. */
  runningSince: number | null;
  micAvailable: boolean;
  micMuted: boolean;
  cameraAvailable: boolean;
  cameraVisible: boolean;
  systemAudioActive: boolean;
  sourceName: string | null;
  warnings: string[];
  error: AppErrorInfo | null;
  lastRecordingId: string | null;
}

export interface RecordingSourceSummary {
  kind: SourceKind | 'unknown';
  category: SourceCategory | 'unknown';
  name: string;
}

/** Persisted metadata for one recording (the video itself lives in the recordings folder). */
export interface RecordingMetadata {
  id: string;
  fileName: string;
  absolutePath: string;
  title: string;
  createdAt: string;
  durationMs: number | null;
  sizeBytes: number;
  source: RecordingSourceSummary;
  microphoneEnabled: boolean | null;
  cameraEnabled: boolean | null;
  systemAudioEnabled: boolean | null;
  width?: number;
  height?: number;
  mimeType?: string;
  fileBirthtimeMs?: number;
  recovered?: boolean;
  trimmedAt?: string;
}

/** Library row sent to the renderer. */
export interface RecordingEntry extends RecordingMetadata {
  mediaUrl: string;
  thumbnailUrl: string | null;
}

export type StorageOrigin =
  | 'env:OneDrive'
  | 'env:OneDriveCommercial'
  | 'env:OneDriveConsumer'
  | 'registry'
  | 'custom'
  | 'override';

export interface StorageStatus {
  ok: boolean;
  recordingsDir: string | null;
  oneDriveRoot: string | null;
  origin: StorageOrigin | null;
  accountType: 'business' | 'personal' | 'unknown' | null;
  error: AppErrorInfo | null;
  pendingCount: number;
}

export interface AppSettings {
  closeToTray: boolean;
  /** Start hidden in the tray at Windows sign-in so the recorder opens instantly. */
  launchAtLogin: boolean;
  shortcutsEnabled: boolean;
  countdown: boolean;
  quality: QualityPreset;
  customRecordingsDir: string | null;
  /** Last microphone deviceId, `'none'` for no microphone, null for default. */
  lastMicrophoneId: string | null;
  lastCameraId: string | null;
  cameraEnabled: boolean;
  systemAudio: boolean;
  cameraLayout: CameraLayout;
  camera: CameraSettings;
  trayHintShown: boolean;
}

export interface ShortcutStatus {
  accelerator: string;
  action: string;
  registered: boolean;
  scope: 'always' | 'recording';
}

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  platform: string;
  userDataDir: string;
  logFile: string;
  shortcuts: ShortcutStatus[];
}

export interface ShareProviderInfo {
  id: string;
  label: string;
  description: string;
}

export interface ShareResult {
  ok: boolean;
  message: string;
  url?: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppErrorInfo };
