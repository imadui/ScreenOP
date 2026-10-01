import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChunkFileWriter } from '../../src/main/recording/ChunkFileWriter';
import { finalizeSession } from '../../src/main/recording/finalize';
import { listSessionRecords, saveSessionRecord, sessionPaths, type SessionRecord } from '../../src/main/recording/sessionFiles';
import { buildLiveWebm, randomPayload } from './helpers/webm';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'oneloom-files-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('ChunkFileWriter', () => {
  it('writes chunks in sequence order even when they arrive out of order', async () => {
    const path = join(dir, 'out.part');
    const w = await ChunkFileWriter.create(path);
    const enc = (s: string) => new TextEncoder().encode(s);
    const p2 = w.write(2, enc('C'));
    const p0 = w.write(0, enc('A'));
    const p1 = w.write(1, enc('B'));
    await Promise.all([p0, p1, p2]);
    await w.close();
    expect(readFileSync(path, 'utf8')).toBe('ABC');
    expect(w.bytesWritten).toBe(3);
  });

  it('refuses duplicate sequence numbers and never clobbers an existing file', async () => {
    const path = join(dir, 'dup.part');
    const w = await ChunkFileWriter.create(path);
    await w.write(0, new Uint8Array([1]));
    await expect(w.write(0, new Uint8Array([2]))).rejects.toMatchObject({ code: 'write-failed' });
    await w.close();
    await expect(ChunkFileWriter.create(path)).rejects.toThrow();
  });
});

function record(id: string, baseName = 'Recording_2026-09-30_21-15-34'): SessionRecord {
  return {
    version: 1,
    id,
    state: 'recording',
    createdAt: new Date(2026, 8, 30, 21, 15, 34).toISOString(),
    baseName,
    source: { kind: 'window', category: 'remote', name: 'Remote Desktop — VM-DEMO01' },
    microphoneEnabled: true,
    cameraEnabled: false,
    systemAudioEnabled: true,
    mimeType: 'video/webm;codecs=vp9,opus'
  };
}

function writeRawSession(sessions: string, id: string): void {
  mkdirSync(sessions, { recursive: true });
  const clusters = [0, 2000].map((timecode) => ({
    timecode,
    blocks: Array.from({ length: 30 }, (_, i) => ({ track: 1, rel: i * 33, key: i === 0, payload: randomPayload(100, i + timecode) }))
  }));
  writeFileSync(sessionPaths(sessions, id).raw, buildLiveWebm(clusters));
}

describe('finalizeSession', () => {
  it('moves a seekable WebM into the recordings folder with a collision-safe name', async () => {
    const sessions = join(dir, 'sessions');
    const recordings = join(dir, 'OneDrive', 'loom', 'recording');
    mkdirSync(recordings, { recursive: true });
    writeFileSync(join(recordings, 'Recording_2026-09-30_21-15-34.webm'), 'existing');
    const id = '11111111-2222-3333-4444-555555555555';
    writeRawSession(sessions, id);
    const rec = record(id);
    await saveSessionRecord(sessions, rec);

    const res = await finalizeSession(rec, { sessionsDir: sessions, ensureRecordingsDir: async () => ({ ok: true, value: recordings }) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.metadata.fileName).toBe('Recording_2026-09-30_21-15-34 (2).webm');
    expect(res.value.metadata.absolutePath).toBe(join(recordings, 'Recording_2026-09-30_21-15-34 (2).webm'));
    expect(res.value.metadata.durationMs).toBeGreaterThan(2900);
    expect(res.value.remuxed).toBe(true);
    expect(readFileSync(join(recordings, 'Recording_2026-09-30_21-15-34.webm'), 'utf8')).toBe('existing');
    // Temp files are cleaned up; nothing is duplicated in app data.
    expect(readdirSync(sessions)).toEqual([]);
  });

  it('keeps the recording safe (pending) when OneDrive is unavailable and delivers it later', async () => {
    const sessions = join(dir, 'sessions');
    const recordings = join(dir, 'later');
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    writeRawSession(sessions, id);
    await saveSessionRecord(sessions, record(id));

    const [first] = await listSessionRecords(sessions);
    const unavailable = await finalizeSession(first!, {
      sessionsDir: sessions,
      ensureRecordingsDir: async () => ({ ok: false, error: { code: 'storage-unavailable', message: 'offline' } })
    });
    expect(unavailable.ok).toBe(false);
    const [pending] = await listSessionRecords(sessions);
    expect(pending?.state).toBe('pending-move');
    expect(existsSync(sessionPaths(sessions, id).finalized)).toBe(true);
    expect(existsSync(sessionPaths(sessions, id).raw)).toBe(false);

    mkdirSync(recordings, { recursive: true });
    const delivered = await finalizeSession(pending!, { sessionsDir: sessions, ensureRecordingsDir: async () => ({ ok: true, value: recordings }) });
    expect(delivered.ok).toBe(true);
    expect(readdirSync(recordings)).toEqual(['Recording_2026-09-30_21-15-34.webm']);
    expect(readdirSync(sessions)).toEqual([]);
  });

  it('reports an empty recording instead of producing a broken file', async () => {
    const sessions = join(dir, 'sessions');
    mkdirSync(sessions, { recursive: true });
    const id = 'ffffffff-0000-1111-2222-333333333333';
    writeFileSync(sessionPaths(sessions, id).raw, '');
    const res = await finalizeSession(record(id), { sessionsDir: sessions, ensureRecordingsDir: async () => ({ ok: true, value: dir }) });
    expect(res.ok).toBe(false);
  });
});
