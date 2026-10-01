import type { CameraLayout, RecordingOptions, SourceCategory } from '@app-types';
import { DEFAULT_CAMERA_LAYOUT } from './camera-layout';

const SOURCE_ID = /^(screen|window):\d+:\d+$/;
const CATEGORIES: SourceCategory[] = ['screen', 'window', 'browser', 'remote'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 512): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined);
const deviceId = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= 512 ? v : null);
const unit = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);
const dim = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 16384 ? Math.round(v) : undefined);

function layout(v: unknown): CameraLayout {
  if (!isObj(v)) return DEFAULT_CAMERA_LAYOUT;
  return {
    x: unit(v.x, DEFAULT_CAMERA_LAYOUT.x),
    y: unit(v.y, DEFAULT_CAMERA_LAYOUT.y),
    size: v.size === 'small' || v.size === 'large' ? v.size : 'medium',
    shape: v.shape === 'rounded' ? 'rounded' : 'circle'
  };
}

/** Validate recording options arriving over IPC. Returns null when unusable. */
export function sanitizeRecordingOptions(input: unknown): RecordingOptions | null {
  if (!isObj(input) || !isObj(input.source)) return null;
  const src = input.source;
  const id = str(src.id, 64);
  if (!id || !SOURCE_ID.test(id)) return null;
  const kind = id.startsWith('screen:') ? 'screen' : 'window';
  const category = CATEGORIES.includes(src.category as SourceCategory) ? (src.category as SourceCategory) : kind;
  const name = str(src.name) ?? '';
  const displayName = str(src.displayName) ?? name;
  const width = dim(src.width);
  const height = dim(src.height);
  const displayId = str(src.displayId, 64);

  const microphoneLabel = str(input.microphoneLabel, 256);
  const cameraLabel = str(input.cameraLabel, 256);
  return {
    source: {
      id,
      kind,
      category,
      name,
      displayName,
      ...(displayId ? { displayId } : {}),
      ...(width ? { width } : {}),
      ...(height ? { height } : {})
    },
    microphoneDeviceId: deviceId(input.microphoneDeviceId),
    ...(microphoneLabel ? { microphoneLabel } : {}),
    cameraDeviceId: deviceId(input.cameraDeviceId),
    ...(cameraLabel ? { cameraLabel } : {}),
    cameraLayout: layout(input.cameraLayout),
    systemAudio: input.systemAudio === true,
    quality: input.quality === 'high' ? 'high' : 'standard',
    countdown: input.countdown !== false
  };
}
