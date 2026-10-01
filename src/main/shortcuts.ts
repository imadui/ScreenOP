import { globalShortcut } from 'electron';
import type { ShortcutStatus } from '@app-types';
import { log } from './logger';

interface ShortcutDef {
  accelerator: string;
  action: string;
  scope: 'always' | 'recording';
  run: () => void;
}

/**
 * Global shortcuts. Recording-only shortcuts (pause/stop) are registered just for
 * the duration of a recording so Ctrl+Shift+S / Ctrl+Shift+P keep working in other
 * apps the rest of the time. Registration failures (already taken by another app)
 * are reported, never fatal.
 */
export class ShortcutManager {
  private readonly registered = new Map<string, boolean>();
  private enabled = true;
  private recording = false;

  constructor(private readonly defs: ShortcutDef[]) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.sync();
  }

  setRecording(recording: boolean): void {
    if (recording === this.recording) return;
    this.recording = recording;
    this.sync();
  }

  status(): ShortcutStatus[] {
    return this.defs.map((d) => ({
      accelerator: d.accelerator,
      action: d.action,
      scope: d.scope,
      registered: this.registered.get(d.accelerator) ?? false
    }));
  }

  unregisterAll(): void {
    for (const [acc, ok] of this.registered) if (ok) globalShortcut.unregister(acc);
    this.registered.clear();
  }

  private sync(): void {
    for (const def of this.defs) {
      const wanted = this.enabled && (def.scope === 'always' || this.recording);
      const current = this.registered.get(def.accelerator) ?? false;
      if (wanted && !current) {
        let ok = false;
        try {
          ok = globalShortcut.register(def.accelerator, def.run);
        } catch (err) {
          log.warn('shortcut registration threw', def.accelerator, err);
        }
        if (!ok) log.warn(`shortcut ${def.accelerator} (${def.action}) unavailable — probably used by another app`);
        this.registered.set(def.accelerator, ok);
      } else if (!wanted && current) {
        globalShortcut.unregister(def.accelerator);
        this.registered.set(def.accelerator, false);
      } else if (!wanted) {
        this.registered.set(def.accelerator, false);
      }
    }
  }
}
