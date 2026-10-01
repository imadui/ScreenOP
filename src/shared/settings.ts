import type { AppSettings, CameraLayout, CameraSettings } from '@app-types';
import { BUBBLE_DIAMETER_DEFAULT, clampBubbleDiameter, DEFAULT_CAMERA_LAYOUT } from './camera-layout';

export const DEFAULT_CAMERA_SETTINGS: CameraSettings = {
  mirror: true,
  background: 'none',
  backgroundImage: null,
  bubbleDiameter: BUBBLE_DIAMETER_DEFAULT,
  bubblePosition: null
};

export const DEFAULT_SETTINGS: AppSettings = {
  closeToTray: true,
  // Opt-in: an app adding itself to sign-in without asking is intrusive on managed PCs.
  launchAtLogin: false,
  shortcutsEnabled: true,
  countdown: true,
  quality: 'standard',
  customRecordingsDir: null,
  lastMicrophoneId: null,
  lastCameraId: null,
  cameraEnabled: false,
  systemAudio: true,
  cameraLayout: DEFAULT_CAMERA_LAYOUT,
  camera: DEFAULT_CAMERA_SETTINGS,
  trayHintShown: false
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
const strOrNull = (v: unknown, d: string | null) => (typeof v === 'string' ? v.slice(0, 1024) : v === null ? null : d);
const unit = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** `preset:<name>` or `custom:<hex>.<ext>` — never a path. */
export const BACKGROUND_IMAGE_ID = /^(preset:[a-z-]{2,20}|custom:[a-f0-9]{16,64}\.(jpg|png|webp))$/;

function sanitizeLayout(v: unknown, d: CameraLayout): CameraLayout {
  if (!isObj(v)) return d;
  return {
    x: unit(v.x, d.x),
    y: unit(v.y, d.y),
    size: v.size === 'small' || v.size === 'medium' || v.size === 'large' ? v.size : d.size,
    shape: v.shape === 'circle' || v.shape === 'rounded' ? v.shape : d.shape,
    ...(finite(v.diameter) ? { diameter: Math.min(0.8, Math.max(0.05, v.diameter)) } : {})
  };
}

function sanitizeCamera(v: unknown, d: CameraSettings): CameraSettings {
  if (!isObj(v)) return d;
  const bg = v.background;
  const image = typeof v.backgroundImage === 'string' && BACKGROUND_IMAGE_ID.test(v.backgroundImage) ? v.backgroundImage : v.backgroundImage === null ? null : d.backgroundImage;
  const pos = isObj(v.bubblePosition) && finite(v.bubblePosition.x) && finite(v.bubblePosition.y) ? { x: Math.round(v.bubblePosition.x), y: Math.round(v.bubblePosition.y) } : v.bubblePosition === null ? null : d.bubblePosition;
  return {
    mirror: bool(v.mirror, d.mirror),
    background: bg === 'none' || bg === 'blur-light' || bg === 'blur-strong' || bg === 'image' ? bg : d.background,
    backgroundImage: image,
    bubbleDiameter: finite(v.bubbleDiameter) ? clampBubbleDiameter(v.bubbleDiameter) : d.bubbleDiameter,
    bubblePosition: pos
  };
}

/** Validate untrusted settings input (file on disk or IPC patch) against the defaults. */
export function sanitizeSettings(input: unknown, base: AppSettings = DEFAULT_SETTINGS): AppSettings {
  if (!isObj(input)) return { ...base };
  return {
    closeToTray: bool(input.closeToTray, base.closeToTray),
    launchAtLogin: bool(input.launchAtLogin, base.launchAtLogin),
    shortcutsEnabled: bool(input.shortcutsEnabled, base.shortcutsEnabled),
    countdown: bool(input.countdown, base.countdown),
    quality: input.quality === 'high' || input.quality === 'standard' ? input.quality : base.quality,
    customRecordingsDir: strOrNull(input.customRecordingsDir, base.customRecordingsDir),
    lastMicrophoneId: strOrNull(input.lastMicrophoneId, base.lastMicrophoneId),
    lastCameraId: strOrNull(input.lastCameraId, base.lastCameraId),
    cameraEnabled: bool(input.cameraEnabled, base.cameraEnabled),
    systemAudio: bool(input.systemAudio, base.systemAudio),
    cameraLayout: sanitizeLayout(input.cameraLayout, base.cameraLayout),
    camera: sanitizeCamera(input.camera, base.camera),
    trayHintShown: bool(input.trayHintShown, base.trayHintShown)
  };
}

/** Merge a partial camera patch into full camera settings (IPC sends partial objects). */
export function mergeCameraSettings(current: CameraSettings, patch: Partial<CameraSettings>): CameraSettings {
  return sanitizeCamera({ ...current, ...patch }, current);
}
