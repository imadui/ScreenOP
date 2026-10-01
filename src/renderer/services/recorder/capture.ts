import type { RecordingSourceRef } from '@app-types';
import type { CaptureLimits } from '@shared/codecs';
import { appError, ERROR_MESSAGES } from '@shared/errors';
import { mediaError } from './mediaErrors';

/**
 * Stream acquisition. Desktop capture uses Chromium's `chromeMediaSource: 'desktop'`
 * constraints with the desktopCapturer id chosen in OneLoom's own picker — no
 * browser-style picker and no user-gesture requirement. On Windows, desktop audio
 * is the system loopback mix (all apps), which is how redirected RDP audio is caught.
 */

export interface DisplayCapture {
  stream: MediaStream;
  systemAudio: boolean;
  warning?: string;
}

function desktopVideoConstraints(sourceId: string, limits: CaptureLimits): MediaTrackConstraints {
  return {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sourceId,
      maxWidth: limits.maxWidth,
      maxHeight: limits.maxHeight,
      maxFrameRate: limits.frameRate
    }
  } as unknown as MediaTrackConstraints;
}

const DESKTOP_AUDIO = { mandatory: { chromeMediaSource: 'desktop' } } as unknown as MediaTrackConstraints;

/**
 * Chromium occasionally fails to start a capture on a busy machine ("Timeout starting
 * video source"); one retry after a short pause almost always succeeds.
 */
export async function acquireDisplay(source: RecordingSourceRef, limits: CaptureLimits, withSystemAudio: boolean): Promise<DisplayCapture> {
  try {
    return await acquireDisplayOnce(source, limits, withSystemAudio);
  } catch (err) {
    const detail = (err as { detail?: string }).detail ?? '';
    if (!/AbortError|NotReadableError|Timeout/i.test(detail)) throw err;
    console.warn('display capture failed to start, retrying once', detail);
    await new Promise((r) => setTimeout(r, 800));
    return acquireDisplayOnce(source, limits, withSystemAudio);
  }
}

async function acquireDisplayOnce(source: RecordingSourceRef, limits: CaptureLimits, withSystemAudio: boolean): Promise<DisplayCapture> {
  const video = desktopVideoConstraints(source.id, limits);
  let audioFailure: unknown = null;
  if (withSystemAudio) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: DESKTOP_AUDIO, video });
      const hasAudio = stream.getAudioTracks().length > 0;
      return hasAudio ? { stream, systemAudio: true } : { stream, systemAudio: false, warning: ERROR_MESSAGES['system-audio-unavailable'] };
    } catch (err) {
      // Never let system audio sink the recording: retry video only.
      audioFailure = err;
    }
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
    return {
      stream,
      systemAudio: false,
      ...(withSystemAudio ? { warning: ERROR_MESSAGES['system-audio-unavailable'] } : {})
    };
  } catch (err) {
    if (audioFailure) console.warn('system audio capture failed', audioFailure);
    throw mediaError(err, 'screen');
  }
}

const PREVIEW_TIMEOUT_MS = 15_000;

/**
 * Low-resolution live preview of a source for the setup panel. Never hangs forever:
 * if Windows does not deliver the stream in time, the panel says so (recording opens
 * its own capture, so it can still start).
 */
export async function acquirePreview(sourceId: string): Promise<MediaStream> {
  let timer = 0;
  const request = navigator.mediaDevices.getUserMedia({
    audio: false,
    video: desktopVideoConstraints(sourceId, { maxWidth: 1280, maxHeight: 720, frameRate: 12 })
  });
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(appError('source-unavailable', 'Preview unavailable — you can still start recording.')), PREVIEW_TIMEOUT_MS);
  });
  try {
    return await Promise.race([request, timeout]);
  } catch (err) {
    // A late stream after the timeout must not keep the screen captured.
    void request.then(stopStream, () => undefined);
    throw mediaError(err, 'screen');
  } finally {
    clearTimeout(timer);
  }
}

/** Capture OneLoom's own camera-bubble window (for compositing into window recordings). */
export async function acquireOverlayWindow(sourceId: string): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: desktopVideoConstraints(sourceId, { maxWidth: 1024, maxHeight: 1024, frameRate: 30 })
    });
  } catch (err) {
    throw mediaError(err, 'camera');
  }
}

export async function acquireMicrophone(deviceId: string): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
  } catch (err) {
    throw mediaError(err, 'microphone');
  }
}

export async function acquireCamera(deviceId: string): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        deviceId: { exact: deviceId },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      }
    });
  } catch (err) {
    throw mediaError(err, 'camera');
  }
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}
