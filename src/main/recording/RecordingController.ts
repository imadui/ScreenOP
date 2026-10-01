import { randomUUID } from 'node:crypto';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AppErrorInfo, CameraLayout, RecorderState, RecordingOptions, Result } from '@app-types';
import type { ChunkWriteAck, EngineCameraPlan, EngineEvent, PreparedInfo, StoppedInfo } from '@shared/engine-protocol';
import { appError, describeUnknown, fileSystemError, isAppErrorInfo } from '@shared/errors';
import { recordingBaseName } from '@shared/filenames';
import { elapsedFrom } from '@shared/format';
import { sanitizeRecordingOptions } from '@shared/recording-options';
import type { LibraryService } from '../library/LibraryService';
import { log } from '../logger';
import type { StorageService } from '../storage/StorageService';
import { ChunkFileWriter } from './ChunkFileWriter';
import type { EngineHost } from './EngineHost';
import { finalizeSession } from './finalize';
import {
  listSessionRecords,
  removeSessionFiles,
  saveSessionRecord,
  sessionPaths,
  summarizeOptions,
  type SessionRecord
} from './sessionFiles';

export type StopReason = 'user' | 'source-ended' | 'error' | 'quit' | 'engine-gone';

export interface FinishedOutcome {
  recordingId: string | null;
  error: AppErrorInfo | null;
  notice: string | null;
}

/** UI side effects, injected so the state machine stays testable and window-agnostic. */
export interface RecorderHooks {
  beforeCapture(options: RecordingOptions): void;
  showCountdown(displayId?: string): void;
  hideCountdown(): void;
  showController(displayId?: string): void;
  hideController(): void;
  stateChanged(state: RecorderState): void;
  finished(outcome: FinishedOutcome): void;
  notify(title: string, body: string): void;
  /** Decide how the camera reaches the video (on-screen bubble, composited bubble window or device). */
  planCamera?(options: RecordingOptions): EngineCameraPlan;
  /** Camera toggle during a recording (shows/hides the on-screen bubble). */
  setCameraVisible?(visible: boolean): void;
}

/** Without a bubble window (tests, fallback): composite the camera device directly. */
function defaultCameraPlan(options: RecordingOptions): EngineCameraPlan {
  return options.cameraDeviceId
    ? { mode: 'device', deviceId: options.cameraDeviceId, layout: options.cameraLayout, mirror: true }
    : { mode: 'none', layout: options.cameraLayout, mirror: true };
}

interface ActiveSession {
  id: string;
  options: RecordingOptions;
  camera: EngineCameraPlan;
  record: SessionRecord;
  writer: ChunkFileWriter;
  cancelled: boolean;
  stopping: boolean;
  discard: boolean;
  stopReason: StopReason | null;
  fatalError: AppErrorInfo | null;
}

const IDLE_STATE: RecorderState = {
  phase: 'idle',
  sessionId: null,
  countdownValue: null,
  elapsedMs: 0,
  runningSince: null,
  micAvailable: false,
  micMuted: false,
  cameraAvailable: false,
  cameraVisible: false,
  systemAudioActive: false,
  sourceName: null,
  warnings: [],
  error: null,
  lastRecordingId: null
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BOOT_TIME_MS = Date.now();

/**
 * Recording state machine (main process):
 * idle → preparing → countdown → recording ⇄ paused → stopping → finalizing → idle.
 * Media capture itself runs in the engine renderer; this class owns files and state.
 */
export class RecordingController {
  private state: RecorderState = { ...IDLE_STATE };
  private session: ActiveSession | null = null;
  /** Id of a start() in progress before its session object exists. */
  private reservedId: string | null = null;
  private stopInFlight: Promise<Result<true>> | null = null;
  private recovery: Promise<{ recovered: number; delivered: number; pending: number }> | null = null;
  /** Session ids currently being finalised (never finalise the same session twice at once). */
  private readonly finalizing = new Set<string>();

  constructor(
    private readonly engine: EngineHost,
    private readonly storage: StorageService,
    private readonly library: LibraryService,
    private readonly sessionsDir: string,
    private readonly hooks: RecorderHooks
  ) {
    engine.on('event', (e) => void this.onEngineEvent(e));
    engine.on('gone', (reason) => void this.onEngineGone(reason));
  }

  getState(): RecorderState {
    return { ...this.state, warnings: [...this.state.warnings] };
  }

  /** True from the moment start() is accepted until the recording is finalised. */
  get active(): boolean {
    return this.session !== null || this.reservedId !== null;
  }

  private setState(patch: Partial<RecorderState>): void {
    this.state = { ...this.state, ...patch };
    this.hooks.stateChanged(this.getState());
  }

  async start(input: unknown): Promise<Result<true>> {
    const options = sanitizeRecordingOptions(input);
    if (!options) return { ok: false, error: appError('invalid-input', 'Choose a screen or window to record.') };
    if (this.active) return { ok: false, error: appError('already-recording') };
    // Reserve synchronously: no second start() and no recovery pass may slip in during the awaits below.
    const id = randomUUID();
    this.reservedId = id;
    try {
      return await this.startReserved(id, options);
    } finally {
      if (this.reservedId === id) this.reservedId = null;
    }
  }

  private async startReserved(id: string, options: RecordingOptions): Promise<Result<true>> {
    const dir = await this.storage.ensureReady();
    if (!dir.ok) return { ok: false, error: dir.error };

    const startedAt = new Date();
    const paths = sessionPaths(this.sessionsDir, id);
    const record: SessionRecord = {
      version: 1,
      id,
      state: 'recording',
      createdAt: startedAt.toISOString(),
      baseName: recordingBaseName(startedAt),
      ...summarizeOptions(options)
    };

    let writer: ChunkFileWriter;
    try {
      await mkdir(this.sessionsDir, { recursive: true });
      writer = await ChunkFileWriter.create(paths.raw);
      await saveSessionRecord(this.sessionsDir, record);
    } catch (err) {
      return { ok: false, error: fileSystemError(err, 'Creating the temporary recording file') };
    }

    const camera = this.hooks.planCamera?.(options) ?? defaultCameraPlan(options);
    const session: ActiveSession = {
      id,
      options,
      camera,
      record,
      writer,
      cancelled: false,
      stopping: false,
      discard: false,
      stopReason: null,
      fatalError: null
    };
    this.session = session;
    this.reservedId = null;
    this.setState({
      ...IDLE_STATE,
      phase: 'preparing',
      sessionId: id,
      sourceName: options.source.displayName || options.source.name,
      lastRecordingId: this.state.lastRecordingId
    });
    log.info('recording requested', { id, source: options.source.displayName, kind: options.source.kind, mic: !!options.microphoneDeviceId, camera: !!options.cameraDeviceId, systemAudio: options.systemAudio, quality: options.quality });

    const prepared = await this.engine.request<PreparedInfo>({ type: 'prepare', sessionId: id, options, camera }, 30_000);
    if (!prepared.ok || session.cancelled) {
      const error = prepared.ok ? null : prepared.error;
      await this.abortSession(session, error);
      return error ? { ok: false, error } : { ok: true, value: true };
    }

    const info = prepared.value;
    record.mimeType = info.mimeType;
    record.width = info.width;
    record.height = info.height;
    // In screen recordings the on-screen bubble is captured with the screen (no compositing).
    const cameraOnScreen = camera.mode === 'none' && options.cameraDeviceId !== null;
    const hasCamera = info.hasCamera || cameraOnScreen;
    record.microphoneEnabled = info.hasMicrophone;
    record.cameraEnabled = hasCamera;
    record.systemAudioEnabled = info.hasSystemAudio;
    await saveSessionRecord(this.sessionsDir, record).catch(() => undefined);
    this.setState({
      micAvailable: info.hasMicrophone,
      cameraAvailable: hasCamera,
      cameraVisible: hasCamera,
      systemAudioActive: info.hasSystemAudio,
      warnings: info.warnings
    });
    log.info('recording prepared', info);

    const displayId = options.source.kind === 'screen' ? options.source.displayId : undefined;
    this.hooks.beforeCapture(options);
    this.hooks.showController(displayId);

    if (options.countdown) {
      this.hooks.showCountdown(displayId);
      for (let v = 3; v >= 1 && !session.cancelled; v--) {
        this.setState({ phase: 'countdown', countdownValue: v });
        await sleep(1000);
      }
      this.hooks.hideCountdown();
      // Give DWM a moment to drop the overlay before the first frame.
      await sleep(150);
    } else {
      this.setState({ phase: 'countdown', countdownValue: null });
      await sleep(350);
    }
    if (session.cancelled) {
      await this.abortSession(session, null);
      return { ok: true, value: true };
    }

    const started = await this.engine.request({ type: 'start', sessionId: id }, 10_000);
    if (!started.ok) {
      await this.abortSession(session, started.error);
      return { ok: false, error: started.error };
    }
    this.setState({ phase: 'recording', countdownValue: null, elapsedMs: 0, runningSince: Date.now() });
    log.info('recording started', { id });
    return { ok: true, value: true };
  }

  /** Cancel before recording actually began: release devices and delete temp files. */
  private async abortSession(session: ActiveSession, error: AppErrorInfo | null): Promise<void> {
    await session.writer.close();
    await removeSessionFiles(this.sessionsDir, session.id);
    // A different session owns the recorder now: clean up our files only, touch nothing shared.
    if (this.session !== session) return;
    await this.engine.request({ type: 'abort', sessionId: session.id }, 5000).catch(() => undefined);
    this.hooks.hideCountdown();
    this.hooks.hideController();
    if (this.session === session) this.session = null;
    this.setState({ ...IDLE_STATE, error, lastRecordingId: this.state.lastRecordingId });
    if (error) log.warn('recording could not start', error);
    // Start errors are returned to the caller of start(); only announce user cancellation here.
    this.hooks.finished({ recordingId: null, error: null, notice: error ? null : 'Recording cancelled.' });
  }

  async writeChunk(sessionId: string, seq: number, data: Uint8Array): Promise<ChunkWriteAck> {
    const session = this.session;
    if (!session || session.id !== sessionId) return { ok: false, error: appError('invalid-input', 'No active recording for this chunk.') };
    try {
      await session.writer.write(seq, data);
      return { ok: true };
    } catch (err) {
      const error = isAppErrorInfo(err) ? err : fileSystemError(err, 'Writing recording');
      if (!session.fatalError) {
        session.fatalError = error;
        log.error('chunk write failed', error);
        void this.stop('error', error);
      }
      return { ok: false, error };
    }
  }

  async pause(): Promise<Result<true>> {
    const s = this.session;
    if (!s || this.state.phase !== 'recording' || s.stopping) return { ok: false, error: appError('invalid-input', 'Not recording.') };
    const r = await this.engine.request({ type: 'pause', sessionId: s.id }, 5000);
    if (!r.ok) return r;
    this.setState({ phase: 'paused', elapsedMs: elapsedFrom(this.state.elapsedMs, this.state.runningSince, Date.now()), runningSince: null });
    return { ok: true, value: true };
  }

  async resume(): Promise<Result<true>> {
    const s = this.session;
    if (!s || this.state.phase !== 'paused' || s.stopping) return { ok: false, error: appError('invalid-input', 'Not paused.') };
    const r = await this.engine.request({ type: 'resume', sessionId: s.id }, 5000);
    if (!r.ok) return r;
    this.setState({ phase: 'recording', runningSince: Date.now() });
    return { ok: true, value: true };
  }

  togglePause(): Promise<Result<true>> {
    return this.state.phase === 'paused' ? this.resume() : this.pause();
  }

  async setMicMuted(muted: boolean): Promise<Result<true>> {
    const s = this.session;
    if (!s || !this.state.micAvailable) return { ok: false, error: appError('microphone-unavailable') };
    const r = await this.engine.request({ type: 'set-mic-muted', sessionId: s.id, muted }, 5000);
    if (r.ok) this.setState({ micMuted: muted });
    return r.ok ? { ok: true, value: true } : r;
  }

  async setCameraVisible(visible: boolean): Promise<Result<true>> {
    const s = this.session;
    if (!s || !this.state.cameraAvailable) return { ok: false, error: appError('camera-unavailable') };
    this.hooks.setCameraVisible?.(visible);
    if (s.camera.mode === 'none') {
      this.setState({ cameraVisible: visible });
      return { ok: true, value: true };
    }
    const r = await this.engine.request({ type: 'set-camera-visible', sessionId: s.id, visible }, 5000);
    if (r.ok) this.setState({ cameraVisible: visible });
    return r.ok ? { ok: true, value: true } : r;
  }

  /** The on-screen bubble moved or was resized: follow it in a window recording. */
  updateCameraLayout(layout: CameraLayout): void {
    const s = this.session;
    if (!s || s.camera.mode !== 'window-overlay' || s.stopping) return;
    s.camera = { ...s.camera, layout };
    void this.engine.request({ type: 'set-camera-layout', sessionId: s.id, layout }, 5000);
  }

  discard(): Promise<Result<true>> {
    return this.stop('user', undefined, true);
  }

  async stop(reason: StopReason = 'user', error?: AppErrorInfo, discard = false): Promise<Result<true>> {
    const s = this.session;
    if (!s) return { ok: true, value: true };
    // Once a stop is under way its outcome is fixed: a late "discard" must never delete a save.
    if (s.stopping) return this.stopInFlight ?? { ok: true, value: true };
    if (discard) s.discard = true;
    if (error && !s.fatalError) s.fatalError = error;
    if (this.state.phase === 'preparing' || this.state.phase === 'countdown') {
      s.cancelled = true;
      return { ok: true, value: true };
    }
    s.stopping = true;
    s.stopReason = reason;
    const run = this.runStop(s, reason).finally(() => {
      if (this.stopInFlight === run) this.stopInFlight = null;
    });
    this.stopInFlight = run;
    return run;
  }

  private async runStop(s: ActiveSession, reason: StopReason): Promise<Result<true>> {
    this.setState({ phase: 'stopping', elapsedMs: elapsedFrom(this.state.elapsedMs, this.state.runningSince, Date.now()), runningSince: null });
    log.info('stopping recording', { id: s.id, reason, discard: s.discard });

    if (reason !== 'engine-gone') {
      const stopped = await this.engine.request<StoppedInfo>({ type: 'stop', sessionId: s.id }, 30_000);
      if (stopped.ok && stopped.value.durationMs > 0) s.record.engineDurationMs = Math.round(stopped.value.durationMs);
      else if (!stopped.ok) log.warn('engine stop failed; finalising what was written', stopped.error);
    }
    await s.writer.close();
    this.hooks.hideController();

    if (s.discard) {
      await removeSessionFiles(this.sessionsDir, s.id);
      this.session = null;
      this.setState({ ...IDLE_STATE, lastRecordingId: this.state.lastRecordingId });
      this.hooks.finished({ recordingId: null, error: null, notice: 'Recording discarded.' });
      return { ok: true, value: true };
    }

    this.setState({ phase: 'finalizing' });
    const written = s.writer.bytesWritten;
    const result = written > 0 ? await this.finalizeRecord(s.record, false) : null;
    this.session = null;

    if (!result) {
      await removeSessionFiles(this.sessionsDir, s.id);
      const err = s.fatalError ?? appError('write-failed', 'Nothing was recorded.');
      this.setState({ ...IDLE_STATE, error: err, lastRecordingId: this.state.lastRecordingId });
      this.hooks.finished({ recordingId: null, error: err, notice: null });
      return { ok: false, error: err };
    }

    if (result.ok) {
      const notice =
        reason === 'source-ended'
          ? 'The recorded screen or window disappeared (for example the Remote Desktop window was closed). The recording was saved up to that point.'
          : s.fatalError
            ? `${s.fatalError.message} The recording was saved up to that point.`
            : null;
      this.setState({ ...IDLE_STATE, lastRecordingId: result.value, error: s.fatalError });
      this.hooks.finished({ recordingId: result.value, error: s.fatalError, notice });
      return { ok: true, value: true };
    }

    const pendingNotice =
      'The recording is safe but could not be moved into the recordings folder yet. OneLoom will retry automatically.';
    await this.refreshPendingCount(); // the session is no longer live, so it now counts as pending
    this.setState({ ...IDLE_STATE, error: result.error, lastRecordingId: this.state.lastRecordingId });
    this.hooks.finished({ recordingId: null, error: result.error, notice: pendingNotice });
    return { ok: false, error: result.error };
  }

  /** Finalise and register a session; returns the recording id. */
  private async finalizeRecord(record: SessionRecord, recovered: boolean): Promise<Result<string>> {
    if (this.finalizing.has(record.id)) return { ok: false, error: appError('already-recording', 'This recording is already being saved.') };
    this.finalizing.add(record.id);
    let res: Awaited<ReturnType<typeof finalizeSession>>;
    try {
      res = await finalizeSession(record, {
        sessionsDir: this.sessionsDir,
        ensureRecordingsDir: () => this.storage.ensureReady()
      });
    } finally {
      this.finalizing.delete(record.id);
    }
    await this.refreshPendingCount();
    if (!res.ok) {
      log.warn('finalisation incomplete', { id: record.id, error: res.error });
      return res;
    }
    const metadata = recovered ? { ...res.value.metadata, recovered: true } : res.value.metadata;
    await this.library.add(metadata);
    log.info('recording saved', { id: metadata.id, path: metadata.absolutePath, sizeBytes: metadata.sizeBytes, durationMs: metadata.durationMs });
    return { ok: true, value: metadata.id };
  }

  /**
   * Startup / retry path: finalise sessions left behind by a crash and deliver
   * recordings that were waiting for the OneDrive folder.
   */
  recoverSessions(): Promise<{ recovered: number; delivered: number; pending: number }> {
    // Single flight: overlapping passes (startup + "Retry now" + timer) would race on the same files.
    this.recovery ??= this.runRecovery().finally(() => {
      this.recovery = null;
    });
    return this.recovery;
  }

  private isLive(id: string): boolean {
    return this.session?.id === id || this.reservedId === id;
  }

  private async runRecovery(): Promise<{ recovered: number; delivered: number; pending: number }> {
    let recovered = 0;
    let delivered = 0;
    if (this.active) return { recovered, delivered, pending: await this.refreshPendingCount() };
    const records = await listSessionRecords(this.sessionsDir);
    await this.adoptOrphanRawFiles(records);
    for (const record of records) {
      // A recording may have started while this pass was running.
      if (this.isLive(record.id) || this.active) continue;
      const wasCrash = record.state === 'recording';
      const res = await this.finalizeRecord(record, wasCrash);
      if (res.ok) {
        if (wasCrash) recovered++;
        else delivered++;
      }
    }
    const pending = await this.refreshPendingCount();
    if (recovered + delivered > 0) {
      log.info('sessions recovered', { recovered, delivered, pending });
      this.hooks.notify(
        'OneLoom',
        recovered > 0
          ? `Recovered ${recovered} recording${recovered > 1 ? 's' : ''} from an interrupted session.`
          : `Saved ${delivered} pending recording${delivered > 1 ? 's' : ''} to your recordings folder.`
      );
    }
    return { recovered, delivered, pending };
  }

  /** Raw chunk files without a sidecar (should not happen, but never lose footage). */
  private async adoptOrphanRawFiles(records: SessionRecord[]): Promise<void> {
    let names: string[] = [];
    try {
      names = await readdir(this.sessionsDir);
    } catch {
      return;
    }
    const known = new Set(records.map((r) => r.id));
    for (const name of names) {
      const m = /^([a-f0-9-]{8,64})\.webm\.part$/i.exec(name);
      if (!m || known.has(m[1]!) || this.isLive(m[1]!)) continue;
      try {
        const s = await stat(join(this.sessionsDir, name));
        // Only files left by a previous run are orphans; anything touched since launch is ours.
        if (s.mtimeMs >= BOOT_TIME_MS) continue;
        const created = new Date(s.birthtimeMs || s.mtimeMs);
        const record: SessionRecord = {
          version: 1,
          id: m[1]!,
          state: 'recording',
          createdAt: created.toISOString(),
          baseName: recordingBaseName(created),
          source: { kind: 'unknown', category: 'unknown', name: '' },
          microphoneEnabled: false,
          cameraEnabled: false,
          systemAudioEnabled: false
        };
        await saveSessionRecord(this.sessionsDir, record);
        records.push(record);
      } catch (err) {
        log.warn('could not adopt orphan recording', name, describeUnknown(err));
      }
    }
  }

  private async refreshPendingCount(): Promise<number> {
    const records = await listSessionRecords(this.sessionsDir);
    const pending = records.filter((r) => !this.isLive(r.id)).length;
    this.storage.setPendingCount(pending);
    return pending;
  }

  /** Called on app quit: make sure an active recording is saved (including one already stopping). */
  async shutdown(): Promise<void> {
    for (let i = 0; i < 100 && this.reservedId && !this.session; i++) await sleep(100);
    if (!this.session) return;
    if (this.state.phase === 'preparing' || this.state.phase === 'countdown') {
      this.session.cancelled = true;
      for (let i = 0; i < 50 && this.session; i++) await sleep(100);
      return;
    }
    await (this.stopInFlight ?? this.stop('quit'));
  }

  private async onEngineEvent(event: EngineEvent): Promise<void> {
    if (event.type === 'log') {
      log[event.level]('[engine]', event.message);
      return;
    }
    if (event.type === 'thumbnail') {
      const res = await this.library.saveThumbnail(event.sessionId, new Uint8Array(event.data));
      if (!res.ok) log.warn('thumbnail not saved', res.error);
      else if (!this.session || this.session.id !== event.sessionId) this.library.emit('changed');
      return;
    }
    const s = this.session;
    if (!s || s.id !== event.sessionId) return;
    switch (event.type) {
      case 'source-ended':
        log.warn('capture source ended', { id: s.id, source: s.options.source.displayName });
        await this.stop('source-ended', appError('source-ended'));
        break;
      case 'fatal':
        log.error('engine fatal error', event.error);
        await this.stop('error', event.error);
        break;
      case 'track-warning': {
        const patch: Partial<RecorderState> = { warnings: [...this.state.warnings, event.message] };
        if (event.kind === 'microphone') patch.micAvailable = false;
        if (event.kind === 'camera') {
          patch.cameraAvailable = false;
          patch.cameraVisible = false;
        }
        this.setState(patch);
        break;
      }
    }
  }

  private async onEngineGone(reason: string): Promise<void> {
    const s = this.session;
    if (!s || s.stopping) return;
    if (this.state.phase === 'recording' || this.state.phase === 'paused') {
      await this.stop('engine-gone', appError('engine-unavailable', `The recorder stopped unexpectedly (${reason}).`));
    }
  }
}
