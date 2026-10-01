import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecorderState, RecordingMetadata, RecordingOptions, Result } from '../../src/types';
import type { EngineCommand, EngineResult, PreparedInfo } from '../../src/shared/engine-protocol';
import { RecordingController, type RecorderHooks } from '../../src/main/recording/RecordingController';
import { saveSessionRecord, sessionPaths, type SessionRecord } from '../../src/main/recording/sessionFiles';
import { buildLiveWebm, randomPayload } from './helpers/webm';

vi.mock('../../src/main/logger', () => ({ log: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }));

const PREPARED: PreparedInfo = {
  mimeType: 'video/webm;codecs=vp9,opus',
  width: 1920,
  height: 1080,
  frameRate: 30,
  hasMicrophone: true,
  hasCamera: false,
  hasSystemAudio: true,
  composited: false,
  warnings: []
};

const OPTIONS: RecordingOptions = {
  source: { id: 'window:123:0', kind: 'window', category: 'remote', name: 'VM1 - Remote Desktop Connection', displayName: 'Remote Desktop — VM1' },
  microphoneDeviceId: 'default',
  cameraDeviceId: null,
  cameraLayout: { x: 0.1, y: 0.9, size: 'medium', shape: 'circle' },
  systemAudio: true,
  quality: 'standard',
  countdown: false
};

/** Scriptable stand-in for the hidden engine window. */
class FakeEngine extends EventEmitter {
  commands: EngineCommand[] = [];
  handlers: Partial<Record<EngineCommand['type'], (c: EngineCommand) => Promise<Result<EngineResult>>>> = {};
  async request<T extends EngineResult>(command: EngineCommand): Promise<Result<T>> {
    this.commands.push(command);
    const h = this.handlers[command.type];
    if (h) return (await h(command)) as Result<T>;
    if (command.type === 'prepare') return { ok: true, value: PREPARED as unknown as T };
    if (command.type === 'stop') return { ok: true, value: { durationMs: 3000, chunks: 1, bytes: 1 } as unknown as T };
    return { ok: true, value: { ok: true } as unknown as T };
  }
}

let dir: string;
let sessions: string;
let recordings: string;
let engine: FakeEngine;
let library: { entries: RecordingMetadata[]; add: (m: RecordingMetadata) => Promise<void>; saveThumbnail: () => Promise<Result<true>>; emit: () => boolean };
let storageOk: boolean;
let states: RecorderState[];
let finished: Array<{ recordingId: string | null; error: unknown; notice: string | null }>;
let controller: RecordingController;

function webmBytes(): Uint8Array {
  return buildLiveWebm([
    { timecode: 0, blocks: Array.from({ length: 30 }, (_, i) => ({ track: 1, rel: i * 33, key: i === 0, payload: randomPayload(64, i + 1) })) },
    { timecode: 1000, blocks: Array.from({ length: 30 }, (_, i) => ({ track: 1, rel: i * 33, key: i === 0, payload: randomPayload(64, i + 99) })) }
  ]);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'oneloom-ctl-'));
  sessions = join(dir, 'sessions');
  recordings = join(dir, 'OneDrive', 'loom', 'recording');
  mkdirSync(recordings, { recursive: true });
  engine = new FakeEngine();
  storageOk = true;
  states = [];
  finished = [];
  library = {
    entries: [],
    add: async (m) => {
      library.entries.push(m);
    },
    saveThumbnail: async () => ({ ok: true, value: true }),
    emit: () => true
  };
  const storage = {
    ensureReady: async (): Promise<Result<string>> =>
      storageOk ? { ok: true, value: recordings } : { ok: false, error: { code: 'storage-unavailable', message: 'offline' } },
    setPendingCount: () => undefined
  };
  const hooks: RecorderHooks = {
    beforeCapture: () => undefined,
    showCountdown: () => undefined,
    hideCountdown: () => undefined,
    showController: () => undefined,
    hideController: () => undefined,
    stateChanged: (s) => states.push(s),
    finished: (o) => finished.push(o),
    notify: () => undefined
  };
  // The controller only uses the members faked above.
  controller = new RecordingController(engine as never, storage as never, library as never, sessions, hooks);
});

afterEach(async () => {
  await controller.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

async function startAndWrite(): Promise<string> {
  const res = await controller.start(OPTIONS);
  expect(res.ok).toBe(true);
  const id = controller.getState().sessionId!;
  expect(controller.getState().phase).toBe('recording');
  expect((await controller.writeChunk(id, 0, webmBytes())).ok).toBe(true);
  return id;
}

describe('RecordingController', () => {
  it('records, stops and delivers one seekable file into the recordings folder', async () => {
    const id = await startAndWrite();
    expect((await controller.stop()).ok).toBe(true);
    expect(controller.getState().phase).toBe('idle');
    expect(controller.getState().lastRecordingId).toBe(id);
    expect(readdirSync(recordings)).toHaveLength(1);
    expect(readdirSync(recordings)[0]).toMatch(/^Recording_.*\.webm$/);
    expect(readdirSync(sessions)).toEqual([]);
    expect(library.entries[0]).toMatchObject({ id, microphoneEnabled: true, source: { category: 'remote' } });
    expect(finished.at(-1)?.recordingId).toBe(id);
  });

  it('rejects a second start while the first is still preparing', async () => {
    let release!: () => void;
    engine.handlers.prepare = () => new Promise((r) => (release = () => r({ ok: true, value: PREPARED })));
    const first = controller.start(OPTIONS);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const second = await controller.start(OPTIONS);
    expect(second).toMatchObject({ ok: false, error: { code: 'already-recording' } });
    release();
    expect((await first).ok).toBe(true);
    expect(engine.commands.filter((c) => c.type === 'prepare')).toHaveLength(1);
  });

  it('cancelling during prepare cleans up and returns to idle', async () => {
    let release!: () => void;
    engine.handlers.prepare = () => new Promise((r) => (release = () => r({ ok: true, value: PREPARED })));
    const started = controller.start(OPTIONS);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await controller.stop();
    release();
    expect((await started).ok).toBe(true);
    expect(controller.getState().phase).toBe('idle');
    expect(existsSync(sessions) ? readdirSync(sessions) : []).toEqual([]);
    expect(engine.commands.some((c) => c.type === 'abort')).toBe(true);
    expect(engine.commands.some((c) => c.type === 'start')).toBe(false);
  });

  it('a discard that arrives while a save is in progress does not delete the recording', async () => {
    await startAndWrite();
    let releaseStop!: () => void;
    engine.handlers.stop = () => new Promise((r) => (releaseStop = () => r({ ok: true, value: { durationMs: 3000, chunks: 1, bytes: 1 } })));
    const stopping = controller.stop();
    await vi.waitFor(() => expect(releaseStop).toBeTypeOf('function'));
    const discard = controller.discard();
    releaseStop();
    await Promise.all([stopping, discard]);
    expect(readdirSync(recordings)).toHaveLength(1);
    expect(library.entries).toHaveLength(1);
  });

  it('a disk write failure stops the recording and keeps what was written', async () => {
    const id = await startAndWrite();
    // Sequence 0 again is rejected by the writer → treated as a fatal write error.
    const ack = await controller.writeChunk(id, 0, new Uint8Array([1, 2, 3]));
    expect(ack.ok).toBe(false);
    await vi.waitFor(() => expect(controller.getState().phase).toBe('idle'));
    expect(readdirSync(recordings)).toHaveLength(1);
    expect(finished.at(-1)?.notice).toMatch(/saved up to that point/);
  });

  it('finalises what was written when the engine renderer dies mid-recording', async () => {
    await startAndWrite();
    engine.emit('gone', 'crashed');
    await vi.waitFor(() => expect(controller.getState().phase).toBe('idle'));
    expect(readdirSync(recordings)).toHaveLength(1);
    expect(engine.commands.some((c) => c.type === 'stop')).toBe(false);
  });

  it('keeps the file pending when OneDrive is unavailable, then overlapping recoveries deliver it exactly once', async () => {
    await startAndWrite();
    storageOk = false;
    await controller.stop();
    expect(readdirSync(recordings)).toHaveLength(0);
    expect(readdirSync(sessions).some((f) => f.endsWith('.final.webm'))).toBe(true);

    storageOk = true;
    const [a, b, c] = await Promise.all([controller.recoverSessions(), controller.recoverSessions(), controller.recoverSessions()]);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(a.delivered).toBe(1);
    expect(readdirSync(recordings)).toHaveLength(1);
    expect(readdirSync(sessions)).toEqual([]);
    expect(library.entries).toHaveLength(1);
  });

  it('recovers a crashed session from a previous run and does not touch a live one', async () => {
    mkdirSync(sessions, { recursive: true });
    const crashedId = 'cccccccc-1111-2222-3333-444444444444';
    const record: SessionRecord = {
      version: 1,
      id: crashedId,
      state: 'recording',
      createdAt: new Date(2026, 8, 1, 9, 0, 0).toISOString(),
      baseName: '..\\..\\escape attempt',
      source: { kind: 'screen', category: 'screen', name: 'Screen 1' },
      microphoneEnabled: false,
      cameraEnabled: false,
      systemAudioEnabled: false
    };
    writeFileSync(sessionPaths(sessions, crashedId).raw, webmBytes());
    await saveSessionRecord(sessions, record);

    const result = await controller.recoverSessions();
    expect(result.recovered).toBe(1);
    const files = readdirSync(recordings);
    expect(files).toHaveLength(1);
    // The sidecar's name is sanitised: nothing is written outside the recordings folder.
    expect(files[0]).toBe('escape attempt.webm');
    expect(library.entries[0]).toMatchObject({ id: crashedId, recovered: true });

    // While recording, recovery never runs against the live session.
    await startAndWrite();
    const during = await controller.recoverSessions();
    expect(during).toMatchObject({ recovered: 0, delivered: 0 });
    await controller.stop();
    expect(readdirSync(recordings)).toHaveLength(2);
  });

  it('shutdown waits for a stop that is already in progress', async () => {
    await startAndWrite();
    let releaseStop!: () => void;
    engine.handlers.stop = () => new Promise((r) => (releaseStop = () => r({ ok: true, value: { durationMs: 3000, chunks: 1, bytes: 1 } })));
    void controller.stop();
    await vi.waitFor(() => expect(releaseStop).toBeTypeOf('function'));
    let done = false;
    const shutdown = controller.shutdown().then(() => (done = true));
    await new Promise((r) => setTimeout(r, 50));
    expect(done).toBe(false);
    releaseStop();
    await shutdown;
    expect(readdirSync(recordings)).toHaveLength(1);
  });
});
