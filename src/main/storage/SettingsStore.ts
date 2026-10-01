import { EventEmitter } from 'node:events';
import type { AppSettings } from '@app-types';
import { DEFAULT_SETTINGS, sanitizeSettings } from '@shared/settings';
import { readJson, writeJsonAtomic, WriteQueue } from './jsonFile';
import { log } from '../logger';

export class SettingsStore extends EventEmitter<{ changed: [AppSettings] }> {
  private settings: AppSettings = { ...DEFAULT_SETTINGS };
  private readonly queue = new WriteQueue();

  constructor(private readonly file: string) {
    super();
  }

  async load(): Promise<AppSettings> {
    this.settings = sanitizeSettings(await readJson<unknown>(this.file, {}));
    return this.settings;
  }

  get(): AppSettings {
    return { ...this.settings };
  }

  async update(patch: unknown): Promise<AppSettings> {
    const merged = sanitizeSettings({ ...this.settings, ...(typeof patch === 'object' && patch ? patch : {}) }, this.settings);
    this.settings = merged;
    await this.queue.run(() => writeJsonAtomic(this.file, merged)).catch((err) => log.warn('settings save failed', err));
    this.emit('changed', this.get());
    return this.get();
  }
}
