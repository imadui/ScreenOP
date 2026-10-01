import type { QualityPreset } from '@app-types';

/** MediaRecorder container/codec candidates, most preferred first. */
export const MIME_CANDIDATES_WITH_AUDIO = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm'
] as const;

export const MIME_CANDIDATES_VIDEO_ONLY = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'] as const;

/** Pick the first MIME type the runtime supports (capability detection, never assumed). */
export function pickMimeType(hasAudio: boolean, isTypeSupported: (mime: string) => boolean): string | null {
  const candidates = hasAudio ? MIME_CANDIDATES_WITH_AUDIO : MIME_CANDIDATES_VIDEO_ONLY;
  for (const mime of candidates) {
    try {
      if (isTypeSupported(mime)) return mime;
    } catch {
      // Some runtimes throw for unknown types; treat as unsupported.
    }
  }
  return null;
}

export interface CaptureLimits {
  maxWidth: number;
  maxHeight: number;
  frameRate: number;
}

export function captureLimits(quality: QualityPreset): CaptureLimits {
  return quality === 'high'
    ? { maxWidth: 3840, maxHeight: 2160, frameRate: 30 }
    : { maxWidth: 1920, maxHeight: 1080, frameRate: 30 };
}

/** Screen content compresses well; ~0.05–0.08 bits per pixel keeps text sharp at sane file sizes. */
export function videoBitrate(width: number, height: number, frameRate: number, quality: QualityPreset): number {
  const bitsPerPixel = quality === 'high' ? 0.08 : 0.05;
  const raw = Math.max(1, width) * Math.max(1, height) * Math.max(1, frameRate) * bitsPerPixel;
  const min = 1_500_000;
  const max = quality === 'high' ? 16_000_000 : 8_000_000;
  return Math.round(Math.min(max, Math.max(min, raw)));
}

export const AUDIO_BITRATE = 128_000;

/** Largest even size that fits `width×height` into the limits while keeping the aspect ratio. */
export function fitWithin(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  const even = (n: number) => Math.max(2, Math.floor((n * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}
