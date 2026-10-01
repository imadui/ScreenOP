import type { AppErrorInfo, CameraLayout, RecordingOptions } from '@app-types';

/**
 * How the camera gets into the recording:
 * - `none`: no camera, or the on-screen bubble is captured as part of a screen recording;
 * - `window-overlay`: composite a capture of the bubble window (window/RDP recordings);
 * - `device`: composite the camera device directly (fallback when the bubble is unavailable).
 */
export interface EngineCameraPlan {
  mode: 'none' | 'window-overlay' | 'device';
  sourceId?: string;
  deviceId?: string;
  layout: CameraLayout;
  mirror: boolean;
}

/**
 * Protocol between the main process and the hidden recorder-engine renderer.
 * Commands are request/response; events are unsolicited notifications from the engine.
 */
export type EngineCommand =
  | { type: 'prepare'; sessionId: string; options: RecordingOptions; camera: EngineCameraPlan }
  | { type: 'set-camera-layout'; sessionId: string; layout: CameraLayout }
  | { type: 'start'; sessionId: string }
  | { type: 'pause'; sessionId: string }
  | { type: 'resume'; sessionId: string }
  | { type: 'stop'; sessionId: string }
  | { type: 'abort'; sessionId: string }
  | { type: 'set-mic-muted'; sessionId: string; muted: boolean }
  | { type: 'set-camera-visible'; sessionId: string; visible: boolean };

export interface EngineRequest {
  requestId: number;
  command: EngineCommand;
}

export interface PreparedInfo {
  mimeType: string;
  width: number;
  height: number;
  frameRate: number;
  hasMicrophone: boolean;
  hasCamera: boolean;
  hasSystemAudio: boolean;
  composited: boolean;
  warnings: string[];
}

export interface StoppedInfo {
  durationMs: number;
  chunks: number;
  bytes: number;
}

export type EngineResult = PreparedInfo | StoppedInfo | { ok: true };

export type EngineResponse =
  | { requestId: number; ok: true; result: EngineResult }
  | { requestId: number; ok: false; error: AppErrorInfo };

export type EngineEvent =
  | { type: 'source-ended'; sessionId: string }
  | { type: 'track-warning'; sessionId: string; message: string; kind: 'microphone' | 'camera' | 'system-audio' }
  | { type: 'fatal'; sessionId: string; error: AppErrorInfo }
  | { type: 'thumbnail'; sessionId: string; data: ArrayBuffer }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string };

export interface ChunkWriteAck {
  ok: boolean;
  error?: AppErrorInfo;
}
