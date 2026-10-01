/// <reference types="vite/client" />
import type { OneLoomApi } from '@shared/api';

declare global {
  interface Window {
    oneloom: OneLoomApi;
  }

  // Chromium "Breakout Box" (mediacapture-transform) — not yet in TypeScript's DOM lib.
  interface MediaStreamTrackProcessorInit {
    track: MediaStreamTrack;
    maxBufferSize?: number;
  }
  interface MediaStreamTrackProcessor<T = VideoFrame> {
    readonly readable: ReadableStream<T>;
  }
  // eslint-disable-next-line no-var
  var MediaStreamTrackProcessor: {
    prototype: MediaStreamTrackProcessor;
    new (init: MediaStreamTrackProcessorInit): MediaStreamTrackProcessor<VideoFrame>;
  };

  interface MediaStreamTrackGenerator<T = VideoFrame> extends MediaStreamTrack {
    readonly writable: WritableStream<T>;
  }
  // eslint-disable-next-line no-var
  var MediaStreamTrackGenerator: {
    prototype: MediaStreamTrackGenerator;
    new (init: { kind: 'video' | 'audio' }): MediaStreamTrackGenerator<VideoFrame>;
  };

  // Chromium implements ImageCapture.grabFrame(); TypeScript's DOM lib only declares takePhoto().
  interface ImageCapture {
    grabFrame(): Promise<ImageBitmap>;
  }

  interface MediaRecorderOptions {
    /** Chromium: force a keyframe at least this often (ms) — keeps seeking fast. */
    videoKeyFrameIntervalDuration?: number;
  }
}

export {};
