import { app } from 'electron';
import { EventEmitter } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AppErrorInfo, Result, StorageStatus } from '@app-types';
import { appError, describeUnknown } from '@shared/errors';
import { log } from '../logger';
import type { SettingsStore } from './SettingsStore';
import { recordingsDirFor, resolveOneDriveRoot, systemOneDriveProbe, type OneDriveProbe } from './onedrive';

/**
 * Owns the "where do finished recordings go" decision.
 * Default: `%OneDrive%\loom\recording`, created on demand.
 */
export class StorageService extends EventEmitter<{ changed: [StorageStatus] }> {
  private status: StorageStatus = {
    ok: false,
    recordingsDir: null,
    oneDriveRoot: null,
    origin: null,
    accountType: null,
    error: null,
    pendingCount: 0
  };

  constructor(
    private readonly settings: SettingsStore,
    private readonly probe: OneDriveProbe = systemOneDriveProbe
  ) {
    super();
  }

  get(): StorageStatus {
    return { ...this.status };
  }

  get recordingsDir(): string | null {
    return this.status.recordingsDir;
  }

  setPendingCount(count: number): void {
    if (count === this.status.pendingCount) return;
    this.status = { ...this.status, pendingCount: count };
    this.emit('changed', this.get());
  }

  async refresh(): Promise<StorageStatus> {
    const next: StorageStatus = {
      ok: false,
      recordingsDir: null,
      oneDriveRoot: null,
      origin: null,
      accountType: null,
      error: null,
      pendingCount: this.status.pendingCount
    };

    // Dev/test hook only; the packaged app always uses OneDrive or the folder picked in Settings.
    const override = app.isPackaged ? undefined : process.env.ONELOOM_RECORDINGS_DIR?.trim();
    const custom = this.settings.get().customRecordingsDir;
    if (override) {
      next.recordingsDir = resolve(override);
      next.origin = 'override';
    } else if (custom) {
      next.recordingsDir = resolve(custom);
      next.origin = 'custom';
    } else {
      const resolution = await resolveOneDriveRoot(this.probe);
      if (resolution) {
        next.oneDriveRoot = resolution.root;
        next.origin = resolution.origin;
        next.accountType = resolution.accountType;
        next.recordingsDir = recordingsDirFor(resolution.root);
      } else {
        next.error = appError('onedrive-not-detected');
      }
    }

    if (next.recordingsDir) {
      const err = await this.createDir(next.recordingsDir);
      next.ok = !err;
      next.error = err;
    }

    const changed = JSON.stringify(next) !== JSON.stringify(this.status);
    this.status = next;
    if (changed) {
      log.info('storage status', { ok: next.ok, dir: next.recordingsDir, origin: next.origin, account: next.accountType, error: next.error?.code });
      this.emit('changed', this.get());
    }
    return this.get();
  }

  /** Make sure the recordings folder exists right now (it may have been deleted or be offline). */
  async ensureReady(): Promise<Result<string>> {
    const status = this.status.ok ? this.status : await this.refresh();
    if (!status.recordingsDir) return { ok: false, error: status.error ?? appError('onedrive-not-detected') };
    const err = await this.createDir(status.recordingsDir);
    if (err) {
      if (this.status.ok) await this.refresh();
      return { ok: false, error: err };
    }
    return { ok: true, value: status.recordingsDir };
  }

  private async createDir(dir: string): Promise<AppErrorInfo | null> {
    try {
      await mkdir(dir, { recursive: true });
      return null;
    } catch (err) {
      return appError('storage-unavailable', `The recordings folder could not be created: ${dir}`, describeUnknown(err));
    }
  }
}
