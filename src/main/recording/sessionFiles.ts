import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { RecordingOptions, RecordingSourceSummary } from '@app-types';
import { readJson, writeJsonAtomic } from '../storage/jsonFile';

/**
 * Sidecar describing an in-progress (or not yet delivered) recording.
 * It lives next to the raw chunk file in `<userData>/sessions` so a crash or an
 * unavailable OneDrive folder never loses a recording: on the next start the
 * session is finalised and moved into the recordings folder.
 */
export interface SessionRecord {
  version: 1;
  id: string;
  state: 'recording' | 'pending-move';
  createdAt: string;
  baseName: string;
  source: RecordingSourceSummary;
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
  systemAudioEnabled: boolean;
  mimeType?: string;
  width?: number;
  height?: number;
  engineDurationMs?: number | null;
  /** Set once the raw file was rewritten into a seekable WebM. */
  finalizedFile?: string;
  finalDurationMs?: number | null;
}

export interface SessionPaths {
  raw: string;
  finalized: string;
  meta: string;
}

export function sessionPaths(sessionsDir: string, id: string): SessionPaths {
  return {
    raw: join(sessionsDir, `${id}.webm.part`),
    finalized: join(sessionsDir, `${id}.final.webm`),
    meta: join(sessionsDir, `${id}.json`)
  };
}

export function summarizeOptions(options: RecordingOptions): Pick<SessionRecord, 'source' | 'microphoneEnabled' | 'cameraEnabled' | 'systemAudioEnabled'> {
  return {
    source: { kind: options.source.kind, category: options.source.category, name: options.source.displayName || options.source.name },
    microphoneEnabled: options.microphoneDeviceId !== null,
    cameraEnabled: options.cameraDeviceId !== null,
    systemAudioEnabled: options.systemAudio
  };
}

export async function saveSessionRecord(sessionsDir: string, record: SessionRecord): Promise<void> {
  await writeJsonAtomic(sessionPaths(sessionsDir, record.id).meta, record);
}

export async function listSessionRecords(sessionsDir: string): Promise<SessionRecord[]> {
  let names: string[] = [];
  try {
    names = await readdir(sessionsDir);
  } catch {
    return [];
  }
  const records: SessionRecord[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const record = await readJson<SessionRecord | null>(join(sessionsDir, name), null);
    if (record && record.version === 1 && typeof record.id === 'string' && /^[a-f0-9-]{8,64}$/i.test(record.id)) records.push(record);
  }
  return records;
}

export async function removeSessionFiles(sessionsDir: string, id: string): Promise<void> {
  const p = sessionPaths(sessionsDir, id);
  await Promise.all([p.raw, p.finalized, p.meta].map((f) => rm(f, { force: true }).catch(() => undefined)));
}
