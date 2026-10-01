import type { RecordingMetadata } from '@app-types';
import { titleFromFileName } from './filenames';

/** A video file found while scanning the recordings folder. */
export interface ScannedFile {
  fileName: string;
  absolutePath: string;
  sizeBytes: number;
  birthtimeMs: number;
  mtimeMs: number;
}

export interface MergeResult {
  entries: RecordingMetadata[];
  changed: boolean;
}

const RENAME_BIRTHTIME_TOLERANCE_MS = 2000;

/**
 * Reconcile stored metadata with the files actually present on disk.
 * The folder is the source of truth: missing files are dropped, unknown files get
 * basic metadata, and files renamed in Explorer keep their metadata (matched by
 * size + creation time, which NTFS preserves across renames).
 */
export function mergeLibrary(files: ScannedFile[], stored: RecordingMetadata[], makeId: () => string): MergeResult {
  let changed = false;
  const byName = new Map(stored.map((e) => [e.fileName.toLowerCase(), e] as const));
  const result: RecordingMetadata[] = [];
  const unmatchedFiles: ScannedFile[] = [];
  const used = new Set<RecordingMetadata>();

  for (const file of files) {
    const entry = byName.get(file.fileName.toLowerCase());
    if (!entry) {
      unmatchedFiles.push(file);
      continue;
    }
    used.add(entry);
    const updated = refresh(entry, file);
    if (updated !== entry) changed = true;
    result.push(updated);
  }

  const orphans = stored.filter((e) => !used.has(e));
  for (const file of unmatchedFiles) {
    const idx = orphans.findIndex(
      (e) =>
        e.sizeBytes === file.sizeBytes &&
        e.fileBirthtimeMs != null &&
        file.birthtimeMs > 0 &&
        Math.abs(e.fileBirthtimeMs - file.birthtimeMs) <= RENAME_BIRTHTIME_TOLERANCE_MS
    );
    if (idx >= 0) {
      const [entry] = orphans.splice(idx, 1);
      result.push({
        ...entry!,
        fileName: file.fileName,
        absolutePath: file.absolutePath,
        title: titleFromFileName(file.fileName)
      });
    } else {
      const created = file.birthtimeMs > 0 ? file.birthtimeMs : file.mtimeMs;
      result.push({
        id: makeId(),
        fileName: file.fileName,
        absolutePath: file.absolutePath,
        title: titleFromFileName(file.fileName),
        createdAt: new Date(created).toISOString(),
        durationMs: null,
        sizeBytes: file.sizeBytes,
        source: { kind: 'unknown', category: 'unknown', name: '' },
        microphoneEnabled: null,
        cameraEnabled: null,
        systemAudioEnabled: null,
        fileBirthtimeMs: file.birthtimeMs
      });
    }
    changed = true;
  }
  if (orphans.length > 0) changed = true;

  result.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return { entries: result, changed };
}

function refresh(entry: RecordingMetadata, file: ScannedFile): RecordingMetadata {
  if (
    entry.sizeBytes === file.sizeBytes &&
    entry.absolutePath === file.absolutePath &&
    entry.fileName === file.fileName &&
    entry.fileBirthtimeMs != null
  ) {
    return entry;
  }
  return {
    ...entry,
    fileName: file.fileName,
    absolutePath: file.absolutePath,
    sizeBytes: file.sizeBytes,
    fileBirthtimeMs: entry.fileBirthtimeMs ?? file.birthtimeMs
  };
}
