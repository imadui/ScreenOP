import { describe, expect, it } from 'vitest';
import { bubbleRect, clampCenter, cornerLayout, nearestCorner } from '../../src/shared/camera-layout';
import { captureLimits, fitWithin, pickMimeType, videoBitrate } from '../../src/shared/codecs';
import { elapsedFrom, formatBytes, formatDuration } from '../../src/shared/format';
import { parseRange } from '../../src/shared/http-range';
import { sanitizeRecordingOptions } from '../../src/shared/recording-options';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../src/shared/settings';

describe('codec selection', () => {
  it('prefers VP9/Opus, falls back to VP8, and never assumes support', () => {
    expect(pickMimeType(true, () => true)).toBe('video/webm;codecs=vp9,opus');
    expect(pickMimeType(true, (m) => m.includes('vp8'))).toBe('video/webm;codecs=vp8,opus');
    expect(pickMimeType(false, (m) => m === 'video/webm;codecs=vp9')).toBe('video/webm;codecs=vp9');
    expect(pickMimeType(true, () => false)).toBeNull();
    expect(
      pickMimeType(false, () => {
        throw new Error('boom');
      })
    ).toBeNull();
  });
  it('keeps bitrates in a sane range', () => {
    expect(videoBitrate(1920, 1080, 30, 'standard')).toBeGreaterThan(2_000_000);
    expect(videoBitrate(1920, 1080, 30, 'standard')).toBeLessThanOrEqual(8_000_000);
    expect(videoBitrate(320, 200, 30, 'standard')).toBe(1_500_000);
    expect(videoBitrate(3840, 2160, 30, 'high')).toBeLessThanOrEqual(16_000_000);
    expect(captureLimits('standard')).toEqual({ maxWidth: 1920, maxHeight: 1080, frameRate: 30 });
  });
  it('fits sizes preserving aspect ratio with even dimensions', () => {
    expect(fitWithin(2560, 1600, 1920, 1080)).toEqual({ width: 1728, height: 1080 });
    expect(fitWithin(1280, 720, 1920, 1080)).toEqual({ width: 1280, height: 720 });
  });
});

describe('camera layout', () => {
  it('keeps the bubble fully inside the frame', () => {
    const c = clampCenter({ x: 0, y: 1, size: 'large', shape: 'circle' }, 1920, 1080);
    const r = bubbleRect({ x: c.x, y: c.y, size: 'large', shape: 'circle' }, 1920, 1080);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y + r.diameter).toBeLessThanOrEqual(1080);
  });
  it('builds corner presets and recognises them back', () => {
    expect(nearestCorner(cornerLayout('bottom-left', 'medium', 'circle'))).toBe('bottom-left');
    expect(nearestCorner(cornerLayout('bottom-right', 'small', 'rounded'))).toBe('bottom-right');
    const br = bubbleRect(cornerLayout('bottom-right', 'medium', 'circle'), 1920, 1080);
    expect(br.x + br.diameter).toBeLessThanOrEqual(1920);
    expect(br.x).toBeGreaterThan(1920 / 2);
  });
});

describe('input validation', () => {
  const valid = {
    source: { id: 'window:6360062:0', kind: 'window', category: 'remote', name: 'X - Remote Desktop Connection', displayName: 'Remote Desktop — X' },
    microphoneDeviceId: 'default',
    cameraDeviceId: null,
    cameraLayout: { x: 0.1, y: 0.9, size: 'medium', shape: 'circle' },
    systemAudio: true,
    quality: 'standard',
    countdown: true
  };
  it('accepts well-formed recording options', () => {
    expect(sanitizeRecordingOptions(valid)).toMatchObject({ source: { id: 'window:6360062:0', category: 'remote' }, microphoneDeviceId: 'default', systemAudio: true });
  });
  it('rejects malformed source ids and clamps layout', () => {
    expect(sanitizeRecordingOptions({ ...valid, source: { ...valid.source, id: '../../etc' } })).toBeNull();
    expect(sanitizeRecordingOptions(null)).toBeNull();
    const o = sanitizeRecordingOptions({ ...valid, cameraLayout: { x: 5, y: -2, size: 'huge', shape: 'star' } })!;
    expect(o.cameraLayout).toEqual({ x: 1, y: 0, size: 'medium', shape: 'circle' });
  });
  it('sanitises settings from disk/IPC', () => {
    const s = sanitizeSettings({ closeToTray: 'yes', quality: 'high', cameraLayout: { x: 0.5 }, bogus: 1 });
    expect(s.closeToTray).toBe(DEFAULT_SETTINGS.closeToTray);
    expect(s.quality).toBe('high');
    expect(s.cameraLayout.x).toBe(0.5);
    expect('bogus' in s).toBe(false);
  });
});

describe('formatting & ranges', () => {
  it('formats durations and sizes', () => {
    expect(formatDuration(5_400)).toBe('0:05');
    expect(formatDuration(3_723_000)).toBe('1:02:03');
    expect(formatDuration(null)).toBe('—');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
    expect(elapsedFrom(4000, 10_000, 12_500)).toBe(6500);
    expect(elapsedFrom(4000, null, 99_999)).toBe(4000);
  });
  it('parses HTTP byte ranges for video seeking', () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=200-', 100)).toBe('invalid');
    expect(parseRange('bytes=0-1,5-6', 100)).toBe('invalid');
  });
});
