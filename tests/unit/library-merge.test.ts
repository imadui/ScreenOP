import { describe, expect, it } from 'vitest';
import type { RecordingMetadata } from '../../src/types';
import { mergeLibrary, type ScannedFile } from '../../src/shared/library-merge';

const DIR = 'C:\\OneDrive\\loom\\recording';
const file = (fileName: string, sizeBytes: number, birthtimeMs: number): ScannedFile => ({
  fileName,
  absolutePath: `${DIR}\\${fileName}`,
  sizeBytes,
  birthtimeMs,
  mtimeMs: birthtimeMs + 1000
});
const meta = (id: string, fileName: string, sizeBytes: number, birthtimeMs: number, extra: Partial<RecordingMetadata> = {}): RecordingMetadata => ({
  id,
  fileName,
  absolutePath: `${DIR}\\${fileName}`,
  title: fileName,
  createdAt: new Date(birthtimeMs).toISOString(),
  durationMs: 5000,
  sizeBytes,
  source: { kind: 'window', category: 'remote', name: 'Remote Desktop — VM1' },
  microphoneEnabled: true,
  cameraEnabled: false,
  systemAudioEnabled: true,
  fileBirthtimeMs: birthtimeMs,
  ...extra
});

let n = 0;
const makeId = () => `id-${++n}`;

describe('mergeLibrary', () => {
  it('keeps metadata for files still present (matched case-insensitively)', () => {
    const stored = [meta('a', 'Demo.webm', 100, 1_000)];
    const r = mergeLibrary([file('demo.WEBM', 100, 1_000)], stored, makeId);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]!.id).toBe('a');
    expect(r.entries[0]!.source.category).toBe('remote');
  });

  it('adds basic entries for unknown files and drops entries whose file is gone', () => {
    const stored = [meta('gone', 'Old.webm', 5, 1_000)];
    const r = mergeLibrary([file('Recording_2026-09-30_21-15-34.webm', 42, 2_000)], stored, makeId);
    expect(r.changed).toBe(true);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ title: 'Recording 2026-09-30 21-15-34', durationMs: null, sizeBytes: 42 });
    expect(r.entries[0]!.id).not.toBe('gone');
  });

  it('follows a rename done in Explorer (same size + creation time)', () => {
    const stored = [meta('a', 'Recording_1.webm', 12345, 50_000, { title: 'Recording 1' })];
    const r = mergeLibrary([file('Client demo.webm', 12345, 50_400)], stored, makeId);
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0]).toMatchObject({ id: 'a', fileName: 'Client demo.webm', title: 'Client demo', durationMs: 5000 });
  });

  it('reports no change when nothing changed and sorts newest first', () => {
    const stored = [meta('old', 'a.webm', 1, 1_000), meta('new', 'b.webm', 2, 9_000)];
    const r = mergeLibrary([file('a.webm', 1, 1_000), file('b.webm', 2, 9_000)], stored, makeId);
    expect(r.changed).toBe(false);
    expect(r.entries.map((e) => e.id)).toEqual(['new', 'old']);
  });

  it('updates the size when a file changed on disk', () => {
    const r = mergeLibrary([file('a.webm', 999, 1_000)], [meta('a', 'a.webm', 1, 1_000)], makeId);
    expect(r.changed).toBe(true);
    expect(r.entries[0]!.sizeBytes).toBe(999);
  });
});
