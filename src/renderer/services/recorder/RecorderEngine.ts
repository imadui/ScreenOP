import type { AppErrorInfo, RecordingOptions } from '@app-types';
import type { OneLoomApi } from '@shared/api';
import { AUDIO_BITRATE, captureLimits, pickMimeType, videoBitrate } from '@shared/codecs';
import type { EngineCameraPlan, EngineCommand, EngineEvent, EngineRequest, EngineResult, PreparedInfo, StoppedInfo } from '@shared/engine-protocol';
import { appError, describeUnknown, isAppErrorInfo } from '@shared/errors';
import { AudioMixer } from './audioMixer';
import { acquireCamera, acquireDisplay, acquireMicrophone, acquireOverlayWindow, stopStream } from './capture';
import { CameraCompositor, canComposite } from './compositor';
import { mediaError } from './mediaErrors';
import { captureTrackThumbnail } from './thumbnail';

type EngineBridge = OneLoomApi['engine'];

const TIMESLICE_MS = 1000;
const THUMBNAIL_DELAY_MS = 1500;

interface Session {
  id: string;
  options: RecordingOptions;
  display: MediaStream;
  mic: MediaStream | null;
  camera: MediaStream | null;
  mixer: AudioMixer | null;
  compositor: CameraCompositor | null;
  stream: MediaStream;
  mimeType: string;
  width: number;
  height: number;
  frameRate: number;
  recorder: MediaRecorder | null;
  seq: number;
  writes: Promise<void>;
  bytes: number;
  chunks: number;
  activeMs: number;
  runningSince: number | null;
  writeError: AppErrorInfo | null;
  sourceEnded: boolean;
  timers: number[];
}

/**
 * Runs in the hidden engine window. Owns every MediaStream and the MediaRecorder;
 * streams recorded data to the main process in 1-second chunks so memory stays flat
 * for long recordings and a crash loses at most the last second.
 */
export class RecorderEngine {
  private session: Session | null = null;

  constructor(private readonly bridge: EngineBridge) {}

  async handle(request: EngineRequest): Promise<void> {
    try {
      const result = await this.dispatch(request.command);
      this.bridge.respond({ requestId: request.requestId, ok: true, result });
    } catch (err) {
      const error = isAppErrorInfo(err) ? err : appError('unknown', undefined, describeUnknown(err));
      this.log('warn', `command ${request.command.type} failed: ${error.code} ${error.detail ?? error.message}`);
      this.bridge.respond({ requestId: request.requestId, ok: false, error });
    }
  }

  private dispatch(command: EngineCommand): Promise<EngineResult> | EngineResult {
    if (command.type === 'prepare') return this.prepare(command.sessionId, command.options, command.camera);
    const s = this.session;
    if (!s || s.id !== command.sessionId) {
      if (command.type === 'abort' || command.type === 'stop') return { durationMs: 0, chunks: 0, bytes: 0 } satisfies StoppedInfo;
      throw appError('invalid-input', 'No matching recording session in the engine.');
    }
    switch (command.type) {
      case 'start':
        return this.start(s);
      case 'pause':
        return this.pause(s);
      case 'resume':
        return this.resume(s);
      case 'stop':
        return this.stop(s);
      case 'abort':
        this.release(s);
        return { ok: true };
      case 'set-mic-muted':
        s.mic?.getAudioTracks().forEach((t) => (t.enabled = !command.muted));
        return { ok: true };
      case 'set-camera-visible':
        s.camera?.getVideoTracks().forEach((t) => (t.enabled = command.visible));
        s.compositor?.setCameraVisible(command.visible);
        return { ok: true };
      case 'set-camera-layout':
        s.compositor?.setLayout(command.layout);
        return { ok: true };
    }
  }

  private async prepare(sessionId: string, options: RecordingOptions, plan: EngineCameraPlan): Promise<PreparedInfo> {
    if (this.session) this.release(this.session);
    const warnings: string[] = [];
    const limits = captureLimits(options.quality);

    const display = await acquireDisplay(options.source, limits, options.systemAudio);
    if (display.warning) warnings.push(display.warning);
    const videoTrack = display.stream.getVideoTracks()[0];
    if (!videoTrack) {
      stopStream(display.stream);
      throw appError('source-unavailable');
    }
    videoTrack.contentHint = 'detail';

    let mic: MediaStream | null = null;
    if (options.microphoneDeviceId) {
      try {
        mic = await acquireMicrophone(options.microphoneDeviceId);
      } catch (err) {
        warnings.push(`${mediaError(err, 'microphone').message} Recording continues without the microphone.`);
      }
    }

    let camera: MediaStream | null = null;
    let compositor: CameraCompositor | null = null;
    if (plan.mode !== 'none') {
      if (!canComposite()) {
        warnings.push('Camera overlay is not supported by this runtime. Recording continues without the camera.');
      } else {
        try {
          // window-overlay: capture the on-screen bubble window (already mirrored, with
          // background effects) and composite it; device: composite the camera directly.
          camera =
            plan.mode === 'window-overlay' && plan.sourceId
              ? await acquireOverlayWindow(plan.sourceId)
              : await acquireCamera(plan.deviceId ?? options.cameraDeviceId ?? 'default');
          const camTrack = camera.getVideoTracks()[0]!;
          compositor = new CameraCompositor(videoTrack, camTrack, plan.layout, limits.frameRate, plan.mode === 'device' && plan.mirror, plan.mode === 'device');
          await compositor.ready();
        } catch (err) {
          stopStream(camera);
          camera = null;
          warnings.push(`${mediaError(err, 'camera').message} Recording continues without the camera.`);
        }
      }
    }

    const audioTracks = [...display.stream.getAudioTracks(), ...(mic?.getAudioTracks() ?? [])];
    let mixer: AudioMixer | null = null;
    let audioTrack: MediaStreamTrack | null = audioTracks[0] ?? null;
    if (audioTracks.length > 1) {
      mixer = new AudioMixer(audioTracks);
      audioTrack = mixer.track;
    }

    const mimeType = pickMimeType(!!audioTrack, (m) => MediaRecorder.isTypeSupported(m));
    if (!mimeType) {
      compositor?.stop();
      mixer?.close();
      [display.stream, mic, camera].forEach(stopStream);
      throw appError('codec-unsupported');
    }

    const outVideo = compositor?.track ?? videoTrack;
    const stream = new MediaStream([outVideo, ...(audioTrack ? [audioTrack] : [])]);
    const settings = videoTrack.getSettings();
    const session: Session = {
      id: sessionId,
      options,
      display: display.stream,
      mic,
      camera,
      mixer,
      compositor,
      stream,
      mimeType,
      width: compositor?.width ?? settings.width ?? 0,
      height: compositor?.height ?? settings.height ?? 0,
      frameRate: Math.round(settings.frameRate ?? limits.frameRate),
      recorder: null,
      seq: 0,
      writes: Promise.resolve(),
      bytes: 0,
      chunks: 0,
      activeMs: 0,
      runningSince: null,
      writeError: null,
      sourceEnded: false,
      timers: []
    };
    this.session = session;
    this.watchTracks(session);

    return {
      mimeType,
      width: session.width,
      height: session.height,
      frameRate: session.frameRate,
      hasMicrophone: !!mic,
      hasCamera: !!compositor,
      hasSystemAudio: display.systemAudio,
      composited: !!compositor,
      warnings
    };
  }

  private watchTracks(s: Session): void {
    const video = s.display.getVideoTracks()[0];
    video?.addEventListener('ended', () => {
      s.sourceEnded = true;
      // Window closed (e.g. RDP disconnected), display unplugged, or capture revoked.
      if (s.recorder && this.session === s) this.emit({ type: 'source-ended', sessionId: s.id });
    });
    s.display.getAudioTracks()[0]?.addEventListener('ended', () => {
      if (this.session === s) this.emit({ type: 'track-warning', sessionId: s.id, kind: 'system-audio', message: 'System audio stopped; recording continues.' });
    });
    s.mic?.getAudioTracks()[0]?.addEventListener('ended', () => {
      if (this.session === s) this.emit({ type: 'track-warning', sessionId: s.id, kind: 'microphone', message: 'The microphone was disconnected; recording continues without it.' });
    });
    s.camera?.getVideoTracks()[0]?.addEventListener('ended', () => {
      s.compositor?.setCameraVisible(false);
      if (this.session === s) this.emit({ type: 'track-warning', sessionId: s.id, kind: 'camera', message: 'The camera was disconnected; recording continues without it.' });
    });
  }

  private start(s: Session): { ok: true } {
    if (s.recorder) return { ok: true };
    if (s.sourceEnded || s.display.getVideoTracks()[0]?.readyState !== 'live') throw appError('source-unavailable');
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(s.stream, {
        mimeType: s.mimeType,
        videoBitsPerSecond: videoBitrate(s.width, s.height, s.frameRate, s.options.quality),
        audioBitsPerSecond: AUDIO_BITRATE,
        videoKeyFrameIntervalDuration: 1000
      });
    } catch (err) {
      throw appError('codec-unsupported', undefined, describeUnknown(err));
    }
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.enqueue(s, e.data);
    };
    recorder.onerror = (e) => {
      const detail = describeUnknown((e as unknown as { error?: unknown }).error ?? e);
      this.emit({ type: 'fatal', sessionId: s.id, error: appError('write-failed', 'The video encoder failed.', detail) });
    };
    recorder.start(TIMESLICE_MS);
    s.recorder = recorder;
    s.runningSince = performance.now();
    s.timers.push(window.setTimeout(() => void this.sendThumbnail(s), THUMBNAIL_DELAY_MS));
    this.log('info', `recording ${s.id} ${s.mimeType} ${s.width}x${s.height}@${s.frameRate}`);
    return { ok: true };
  }

  private enqueue(s: Session, blob: Blob): void {
    const seq = s.seq++;
    s.writes = s.writes.then(async () => {
      if (s.writeError) return;
      try {
        const data = await blob.arrayBuffer();
        const ack = await this.bridge.writeChunk(s.id, seq, data);
        if (!ack.ok) {
          s.writeError = ack.error ?? appError('write-failed');
          return;
        }
        s.bytes += data.byteLength;
        s.chunks++;
      } catch (err) {
        s.writeError = appError('write-failed', undefined, describeUnknown(err));
        this.emit({ type: 'fatal', sessionId: s.id, error: s.writeError });
      }
    });
  }

  private pause(s: Session): { ok: true } {
    if (s.recorder?.state === 'recording') {
      s.recorder.pause();
      if (s.runningSince !== null) s.activeMs += performance.now() - s.runningSince;
      s.runningSince = null;
    }
    return { ok: true };
  }

  private resume(s: Session): { ok: true } {
    if (s.recorder?.state === 'paused') {
      s.recorder.resume();
      s.runningSince = performance.now();
    }
    return { ok: true };
  }

  private async stop(s: Session): Promise<StoppedInfo> {
    const recorder = s.recorder;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 10_000);
        recorder.addEventListener(
          'stop',
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true }
        );
        try {
          recorder.stop();
        } catch {
          clearTimeout(timer);
          resolve();
        }
      });
    }
    await s.writes;
    if (s.runningSince !== null) s.activeMs += performance.now() - s.runningSince;
    s.runningSince = null;
    const info: StoppedInfo = { durationMs: Math.round(s.activeMs), chunks: s.chunks, bytes: s.bytes };
    if (s.compositor) this.log('info', `compositor ${JSON.stringify(s.compositor.stats())}`);
    this.release(s);
    this.log('info', `stopped ${s.id}: ${info.chunks} chunks, ${info.bytes} bytes, ${info.durationMs} ms`);
    return info;
  }

  private async sendThumbnail(s: Session): Promise<void> {
    if (this.session !== s) return;
    try {
      const data = s.compositor ? await s.compositor.snapshot() : await captureTrackThumbnail(s.display.getVideoTracks()[0]!);
      if (data && this.session === s) this.emit({ type: 'thumbnail', sessionId: s.id, data });
    } catch (err) {
      this.log('warn', `thumbnail failed: ${describeUnknown(err)}`);
    }
  }

  private release(s: Session): void {
    s.timers.forEach((t) => clearTimeout(t));
    s.timers = [];
    if (s.recorder && s.recorder.state !== 'inactive') {
      try {
        s.recorder.stop();
      } catch {
        // ignore
      }
    }
    s.compositor?.stop();
    s.mixer?.close();
    [s.display, s.mic, s.camera, s.stream].forEach(stopStream);
    if (this.session === s) this.session = null;
  }

  private emit(event: EngineEvent): void {
    this.bridge.emit(event);
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.bridge.emit({ type: 'log', level, message });
  }
}
