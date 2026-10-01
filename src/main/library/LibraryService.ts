import { EventEmitter } from 'node:events';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { shell } from 'electron';
import type { RecordingEntry, RecordingMetadata, Result, TrimInfo } from '@app-types';
import { appError, describeUnknown, fileSystemError } from '@shared/errors';
import { extensionOf, findAvailableFileName, isRecordingFileName, sanitizeFileBaseName, stripExtension } from '@shared/filenames';
import { moveExclusive } from '../fsutil';
import { readTrimInfo, trimWebm, type TrimResult } from '../webm/trim';
import { mergeLibrary, type ScannedFile } from '@shared/library-merge';
import { log } from '../logger';
import type { AppPaths } from '../paths';
import type { StorageService } from '../storage/StorageService';
import { readJson, writeJsonAtomic, WriteQueue } from '../storage/jsonFile';
import { readWebmHeaderInfo } from '../webm/remux';
import { MEDIA_SCHEME } from '../protocol';

interface LibraryFile {
  version: 1;
  entries: RecordingMetadata[];
  /** Files whose header was already probed for a duration (avoid re-reading big files). */
  probed?: string[];
}

const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

const isBusyError = (err: unknown) => ['EBUSY', 'EPERM', 'EACCES'].includes((err as { code?: string }).code ?? '');

async function retryWhileBusy<T>(task: () => Promise<T>, shouldRetry: (err: unknown) => boolean = isBusyError, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await task();
    } catch (err) {
      if (i >= attempts || !shouldRetry(err)) throw err;
      await new Promise((r) => setTimeout(r, 150 * i));
    }
  }
}
const samePath = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase();

/**
 * Recording library. The recordings folder is the source of truth; lightweight
 * metadata (title, duration, source, audio/camera flags) is kept in
 * `<userData>/library.json`. Videos are never copied anywhere else.
 */
export class LibraryService extends EventEmitter<{ changed: [] }> {
  private entries: RecordingMetadata[] = [];
  private probed = new Set<string>();
  private readonly queue = new WriteQueue();
  private listing: Promise<Result<RecordingEntry[]>> | null = null;
  private lock: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly storage: StorageService,
    private readonly paths: AppPaths
  ) {
    super();
  }

  async load(): Promise<void> {
    const data = await readJson<LibraryFile>(this.paths.libraryFile, { version: 1, entries: [] });
    // library.json is outside our control (any same-user process can edit it): keep only
    // well-formed entries whose path really is a video file with the stored name.
    this.entries = Array.isArray(data.entries)
      ? data.entries.filter(
          (e) =>
            e &&
            typeof e.id === 'string' &&
            typeof e.fileName === 'string' &&
            typeof e.absolutePath === 'string' &&
            isRecordingFileName(e.fileName) &&
            basename(e.absolutePath) === e.fileName
        )
      : [];
    this.probed = new Set(Array.isArray(data.probed) ? data.probed.filter((p): p is string => typeof p === 'string') : []);
    await mkdir(this.paths.thumbnails, { recursive: true }).catch(() => undefined);
  }

  /**
   * Entry by id — only if its file lives directly in the current recordings folder.
   * Every shell action (open, show, trash, rename) goes through this check, so a
   * tampered metadata file can never point OneLoom at an arbitrary path.
   */
  get(id: string): RecordingMetadata | undefined {
    const dir = this.storage.recordingsDir;
    const entry = this.entries.find((e) => e.id === id);
    if (!entry || !dir) return undefined;
    if (!samePath(dirname(entry.absolutePath), dir) || !isRecordingFileName(basename(entry.absolutePath))) return undefined;
    return entry;
  }

  list(): Promise<Result<RecordingEntry[]>> {
    // Coalesce concurrent refreshes, and run them exclusively with add/rename/remove so a
    // slow scan can never overwrite metadata written while it was running.
    this.listing ??= this.exclusive(() => this.scan()).finally(() => {
      this.listing = null;
    });
    return this.listing;
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.lock.then(task, task);
    this.lock = run.catch(() => undefined);
    return run;
  }

  private async scan(): Promise<Result<RecordingEntry[]>> {
    const dir = this.storage.recordingsDir;
    if (!dir) return { ok: false, error: this.storage.get().error ?? appError('onedrive-not-detected') };

    let files: ScannedFile[];
    try {
      const dirents = await readdir(dir, { withFileTypes: true });
      files = [];
      for (const d of dirents) {
        if (!d.isFile() || !isRecordingFileName(d.name)) continue;
        const absolutePath = join(dir, d.name);
        try {
          const s = await stat(absolutePath);
          files.push({ fileName: d.name, absolutePath, sizeBytes: s.size, birthtimeMs: s.birthtimeMs, mtimeMs: s.mtimeMs });
        } catch {
          // File vanished between readdir and stat.
        }
      }
    } catch (err) {
      return { ok: false, error: appError('storage-unavailable', `Cannot read the recordings folder: ${dir}`, describeUnknown(err)) };
    }

    const inDir = this.entries.filter((e) => samePath(dirname(e.absolutePath), dir));
    const elsewhere = this.entries.filter((e) => !inDir.includes(e));
    const merged = mergeLibrary(files, inDir, () => randomUUID());
    let changed = merged.changed;

    // Fill in durations for files OneLoom did not record (header read, once per file).
    for (const entry of merged.entries) {
      if (entry.durationMs !== null || this.probed.has(entry.absolutePath.toLowerCase())) continue;
      if (extensionOf(entry.fileName) !== '.webm') continue;
      this.probed.add(entry.absolutePath.toLowerCase());
      changed = true;
      const info = await readWebmHeaderInfo(entry.absolutePath);
      if (info?.durationMs != null) entry.durationMs = Math.round(info.durationMs);
      if (info?.width) entry.width = info.width;
      if (info?.height) entry.height = info.height;
    }

    this.entries = [...merged.entries, ...elsewhere];
    if (changed) await this.persist();

    const thumbs = await this.thumbnailIndex();
    return { ok: true, value: merged.entries.map((e) => this.toEntry(e, thumbs)) };
  }

  add(meta: RecordingMetadata): Promise<void> {
    return this.exclusive(async () => {
      this.entries = [meta, ...this.entries.filter((e) => e.id !== meta.id && !samePath(e.absolutePath, meta.absolutePath))];
      await this.persist();
      this.emit('changed');
    });
  }

  rename(id: string, rawTitle: string): Promise<Result<RecordingEntry>> {
    return this.exclusive(() => this.renameLocked(id, rawTitle));
  }

  private async renameLocked(id: string, rawTitle: string): Promise<Result<RecordingEntry>> {
    const entry = this.get(id);
    if (!entry) return { ok: false, error: appError('not-found') };
    const title = rawTitle.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!title) return { ok: false, error: appError('invalid-input', 'The title cannot be empty.') };

    const dir = dirname(entry.absolutePath);
    const ext = extensionOf(entry.fileName) || '.webm';
    const base = sanitizeFileBaseName(title);
    let fileName = entry.fileName;

    if (`${base}${ext}`.toLowerCase() === entry.fileName.toLowerCase()) {
      fileName = `${base}${ext}`; // same name, maybe different case
    } else {
      let taken: Set<string>;
      try {
        taken = new Set((await readdir(dir)).map((n) => n.toLowerCase()));
      } catch (err) {
        return { ok: false, error: fileSystemError(err, 'Reading recordings folder') };
      }
      taken.delete(entry.fileName.toLowerCase());
      fileName = findAvailableFileName(base, ext, (n) => taken.has(n.toLowerCase()));
    }

    const absolutePath = join(dir, fileName);
    if (fileName !== entry.fileName) {
      try {
        await retryWhileBusy(() => rename(entry.absolutePath, absolutePath));
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'EBUSY' || code === 'EPERM') {
          return { ok: false, error: appError('write-failed', 'The file is in use by another program. Close it and try again.', describeUnknown(err)) };
        }
        return { ok: false, error: fileSystemError(err, 'Renaming recording') };
      }
    }
    const updated: RecordingMetadata = { ...entry, title, fileName, absolutePath };
    this.entries = this.entries.map((e) => (e.id === id ? updated : e));
    await this.persist();
    this.emit('changed');
    log.info('renamed recording', { id, fileName });
    return { ok: true, value: this.toEntry(updated, await this.thumbnailIndex()) };
  }

  /** Moves the video to the Recycle Bin (recoverable) rather than deleting it permanently. */
  remove(id: string): Promise<Result<true>> {
    return this.exclusive(() => this.removeLocked(id));
  }

  private async removeLocked(id: string): Promise<Result<true>> {
    const entry = this.get(id);
    if (!entry) return { ok: false, error: appError('not-found') };
    try {
      // The player may have just released the file; Windows can hold it for a moment.
      await retryWhileBusy(() => shell.trashItem(entry.absolutePath), () => true);
    } catch (err) {
      try {
        await stat(entry.absolutePath);
      } catch {
        // Already gone — treat as success.
        await this.forget(id);
        return { ok: true, value: true };
      }
      return { ok: false, error: appError('write-failed', 'The recording could not be moved to the Recycle Bin.', describeUnknown(err)) };
    }
    await this.forget(id);
    log.info('deleted recording', { id, file: entry.fileName });
    return { ok: true, value: true };
  }

  private async forget(id: string): Promise<void> {
    this.entries = this.entries.filter((e) => e.id !== id);
    await rm(this.thumbnailPath(id), { force: true }).catch(() => undefined);
    await this.persist();
    this.emit('changed');
  }

  async trimInfo(id: string): Promise<Result<TrimInfo>> {
    const entry = this.get(id);
    if (!entry) return { ok: false, error: appError('not-found') };
    if (extensionOf(entry.fileName) !== '.webm') {
      return { ok: true, value: { supported: false, reason: 'Only WebM recordings can be trimmed.', durationMs: entry.durationMs ?? 0, keyframesMs: [] } };
    }
    try {
      return { ok: true, value: await readTrimInfo(entry.absolutePath) };
    } catch (err) {
      return { ok: false, error: appError('unknown', 'This recording could not be read for trimming.', describeUnknown(err)) };
    }
  }

  /**
   * Losslessly trim a recording in place. The trimmed copy is written to app data first;
   * only when it is complete does the original go to the Recycle Bin (restorable) and
   * the trimmed file take its name.
   */
  trim(id: string, startMs: number, endMs: number, onProgress?: (fraction: number) => void): Promise<Result<RecordingEntry>> {
    return this.exclusive(async () => {
      const entry = this.get(id);
      if (!entry) return { ok: false, error: appError('not-found') };
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs - startMs < 500) {
        return { ok: false, error: appError('invalid-input', 'Keep at least half a second of video.') };
      }
      await mkdir(this.paths.sessions, { recursive: true });
      const work = join(this.paths.sessions, `trim-${id}-${Date.now()}.webm`);
      let result: TrimResult;
      try {
        result = await trimWebm(entry.absolutePath, work, startMs, endMs, onProgress);
      } catch (err) {
        await rm(work, { force: true }).catch(() => undefined);
        return { ok: false, error: appError('write-failed', err instanceof Error ? err.message : 'Trimming failed.', describeUnknown(err)) };
      }

      try {
        await retryWhileBusy(() => shell.trashItem(entry.absolutePath), () => true);
      } catch (err) {
        await rm(work, { force: true }).catch(() => undefined);
        return { ok: false, error: appError('write-failed', 'The original could not be moved to the Recycle Bin, so nothing was changed. Close any player using it and try again.', describeUnknown(err)) };
      }

      let target = entry.absolutePath;
      try {
        await moveExclusive(work, target);
      } catch {
        // Name taken again in the meantime: keep both rather than lose anything.
        const dir = dirname(entry.absolutePath);
        const taken = new Set((await readdir(dir)).map((n) => n.toLowerCase()));
        const name = findAvailableFileName(`${stripExtension(entry.fileName)} (trimmed)`, '.webm', (n) => taken.has(n.toLowerCase()));
        target = join(dir, name);
        try {
          await moveExclusive(work, target);
        } catch (err) {
          return { ok: false, error: fileSystemError(err, 'Saving the trimmed recording (the original is in the Recycle Bin)') };
        }
      }

      const info = await stat(target);
      const updated: RecordingMetadata = {
        ...entry,
        fileName: basename(target),
        absolutePath: target,
        durationMs: result.durationMs,
        sizeBytes: info.size,
        fileBirthtimeMs: info.birthtimeMs,
        trimmedAt: new Date().toISOString()
      };
      this.entries = this.entries.map((e) => (e.id === id ? updated : e));
      // The old thumbnail may show trimmed-away content; the library regenerates it.
      await rm(this.thumbnailPath(id), { force: true }).catch(() => undefined);
      await this.persist();
      this.emit('changed');
      log.info('trimmed recording', { id, startMs: result.startMs, endMs: result.endMs, durationMs: result.durationMs });
      return { ok: true, value: this.toEntry(updated, await this.thumbnailIndex()) };
    });
  }

  thumbnailPath(id: string): string {
    return join(this.paths.thumbnails, `${id}.jpg`);
  }

  async saveThumbnail(id: string, data: Uint8Array): Promise<Result<true>> {
    if (!/^[a-f0-9-]{8,64}$/i.test(id)) return { ok: false, error: appError('invalid-input') };
    if (data.length === 0 || data.length > MAX_THUMBNAIL_BYTES || data[0] !== 0xff || data[1] !== 0xd8) {
      return { ok: false, error: appError('invalid-input', 'Thumbnail must be a JPEG under 2 MB.') };
    }
    try {
      await mkdir(this.paths.thumbnails, { recursive: true });
      await writeFile(this.thumbnailPath(id), data);
      return { ok: true, value: true };
    } catch (err) {
      return { ok: false, error: fileSystemError(err, 'Saving thumbnail') };
    }
  }

  private async thumbnailIndex(): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    try {
      for (const name of await readdir(this.paths.thumbnails)) {
        if (!name.endsWith('.jpg')) continue;
        try {
          map.set(name.slice(0, -4), (await stat(join(this.paths.thumbnails, name))).mtimeMs);
        } catch {
          // ignore
        }
      }
    } catch {
      // No thumbnails yet.
    }
    return map;
  }

  private toEntry(meta: RecordingMetadata, thumbs: Map<string, number>): RecordingEntry {
    const thumbVersion = thumbs.get(meta.id);
    return {
      ...meta,
      mediaUrl: `${MEDIA_SCHEME}://recording/${encodeURIComponent(meta.fileName)}?v=${meta.sizeBytes}`,
      thumbnailUrl: thumbVersion != null ? `${MEDIA_SCHEME}://thumbnail/${meta.id}.jpg?v=${Math.round(thumbVersion)}` : null
    };
  }

  private persist(): Promise<void> {
    const data: LibraryFile = { version: 1, entries: this.entries, probed: [...this.probed].slice(-2000) };
    return this.queue.run(() => writeJsonAtomic(this.paths.libraryFile, data)).catch((err) => log.warn('library save failed', err));
  }
}
