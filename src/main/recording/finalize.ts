import { readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { RecordingMetadata, Result } from '@app-types';
import { appError, describeUnknown, fileSystemError } from '@shared/errors';
import { findAvailableFileName, sanitizeFileBaseName } from '@shared/filenames';
import { exists, moveExclusive } from '../fsutil';
import { log } from '../logger';
import { remuxWebm } from '../webm/remux';
import { removeSessionFiles, saveSessionRecord, sessionPaths, type SessionRecord } from './sessionFiles';

export interface FinalizeDeps {
  sessionsDir: string;
  /** Resolve (and create) the destination folder; fails when OneDrive is unavailable. */
  ensureRecordingsDir(): Promise<Result<string>>;
}

export interface FinalizeOutcome {
  metadata: RecordingMetadata;
  remuxed: boolean;
  truncated: boolean;
}

/**
 * Turn a session's raw chunk file into a finished recording inside the recordings folder.
 * Idempotent and resumable: if OneDrive is unavailable the rewritten file stays in the
 * sessions folder (state `pending-move`) and a later call completes the move.
 */
export async function finalizeSession(record: SessionRecord, deps: FinalizeDeps): Promise<Result<FinalizeOutcome>> {
  const paths = sessionPaths(deps.sessionsDir, record.id);
  let remuxed = !!record.finalizedFile;
  let truncated = false;
  let finalDurationMs = record.finalDurationMs ?? null;
  let width = record.width;
  let height = record.height;

  // 1. Rewrite into a seekable WebM (once).
  if (!record.finalizedFile) {
    const raw = await stat(paths.raw).catch(() => null);
    if (!raw || raw.size === 0) {
      await removeSessionFiles(deps.sessionsDir, record.id);
      return { ok: false, error: appError('write-failed', 'Nothing was recorded (the recording file is empty).') };
    }
    await rm(paths.finalized, { force: true }).catch(() => undefined);
    try {
      const result = await remuxWebm(paths.raw, paths.finalized, record.engineDurationMs ? { minDurationMs: record.engineDurationMs } : {});
      remuxed = true;
      truncated = result.truncated;
      finalDurationMs = Math.round(result.durationMs);
      width = result.width ?? width;
      height = result.height ?? height;
      await rm(paths.raw, { force: true }).catch(() => undefined);
      record.finalizedFile = paths.finalized;
      log.info('recording finalised', { id: record.id, durationMs: finalDurationMs, clusters: result.clusters, cues: result.cuePoints, truncated });
    } catch (err) {
      // Fall back to the raw MediaRecorder output: still a valid, playable WebM.
      log.warn('WebM rewrite failed, keeping raw recording', describeUnknown(err));
      await rm(paths.finalized, { force: true }).catch(() => undefined);
      try {
        await rename(paths.raw, paths.finalized);
      } catch (renameErr) {
        return { ok: false, error: fileSystemError(renameErr, 'Preparing recording') };
      }
      record.finalizedFile = paths.finalized;
      finalDurationMs = record.engineDurationMs ?? null;
    }
    record.state = 'pending-move';
    record.finalDurationMs = finalDurationMs;
    if (width) record.width = width;
    if (height) record.height = height;
    await saveSessionRecord(deps.sessionsDir, record).catch((err) => log.warn('could not save session record', err));
  }

  if (!(await exists(paths.finalized))) {
    // Already delivered before a crash, or removed by the user: nothing left to do.
    await removeSessionFiles(deps.sessionsDir, record.id);
    return { ok: false, error: appError('not-found', 'The recording file for this session no longer exists.') };
  }

  // 2. Deliver into the recordings folder (OneDrive).
  const dirResult = await deps.ensureRecordingsDir();
  if (!dirResult.ok) return { ok: false, error: dirResult.error };
  const dir = dirResult.value;

  // The sidecar is a file on disk: never trust its name for the destination path.
  const base = sanitizeFileBaseName(record.baseName, 'Recording');
  const pick = async (): Promise<{ fileName: string; destination: string }> => {
    const taken = new Set((await readdir(dir)).map((n) => n.toLowerCase()));
    const name = findAvailableFileName(base, '.webm', (n) => taken.has(n.toLowerCase()));
    const dest = resolve(dir, name);
    if (dirname(dest).toLowerCase() !== resolve(dir).toLowerCase()) throw new Error(`Refusing to write outside the recordings folder: ${dest}`);
    return { fileName: name, destination: dest };
  };

  let fileName: string;
  let destination: string;
  try {
    ({ fileName, destination } = await pick());
    await moveExclusive(paths.finalized, destination);
  } catch (err) {
    if ((err as { code?: string }).code === 'EEXIST') {
      // Lost a race for the name; try once more with a fresh listing.
      try {
        ({ fileName, destination } = await pick());
        await moveExclusive(paths.finalized, destination);
      } catch (retryErr) {
        return { ok: false, error: fileSystemError(retryErr, 'Moving recording into the recordings folder') };
      }
    } else {
      return { ok: false, error: fileSystemError(err, 'Moving recording into the recordings folder') };
    }
  }

  const info = await stat(destination);
  await removeSessionFiles(deps.sessionsDir, record.id);

  const metadata: RecordingMetadata = {
    id: record.id,
    fileName,
    absolutePath: destination,
    title: fileName.replace(/\.webm$/i, '').replace(/_/g, ' '),
    createdAt: record.createdAt,
    durationMs: finalDurationMs,
    sizeBytes: info.size,
    source: record.source,
    microphoneEnabled: record.microphoneEnabled,
    cameraEnabled: record.cameraEnabled,
    systemAudioEnabled: record.systemAudioEnabled,
    fileBirthtimeMs: info.birthtimeMs,
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    ...(record.mimeType ? { mimeType: record.mimeType } : {})
  };
  return { ok: true, value: { metadata, remuxed, truncated } };
}
