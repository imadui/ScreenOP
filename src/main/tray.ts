import { Menu, nativeImage, Tray, type NativeImage } from 'electron';
import { join } from 'node:path';
import type { RecorderState } from '@app-types';
import { elapsedFrom, formatDuration } from '@shared/format';

export interface TrayActions {
  newRecording(): void;
  openApp(): void;
  openRecordings(): void;
  togglePause(): void;
  stop(): void;
  quit(): void;
}

/** System tray icon with a state-aware menu (idle vs. recording). */
export class AppTray {
  private readonly tray: Tray;
  private readonly idleIcon: NativeImage;
  private readonly recordingIcon: NativeImage;
  private state: RecorderState | null = null;
  private tooltipTimer: NodeJS.Timeout | null = null;

  constructor(
    resourcesDir: string,
    private readonly actions: TrayActions
  ) {
    this.idleIcon = nativeImage.createFromPath(join(resourcesDir, 'tray.png'));
    this.recordingIcon = nativeImage.createFromPath(join(resourcesDir, 'tray-recording.png'));
    this.tray = new Tray(this.idleIcon.isEmpty() ? nativeImage.createEmpty() : this.idleIcon);
    this.tray.setToolTip('OneLoom');
    this.tray.on('double-click', () => actions.openApp());
    this.rebuild();
  }

  update(state: RecorderState): void {
    const wasActive = this.isActive(this.state);
    this.state = state;
    const active = this.isActive(state);
    if (active !== wasActive) {
      this.tray.setImage(active && !this.recordingIcon.isEmpty() ? this.recordingIcon : this.idleIcon);
      if (active && !this.tooltipTimer) this.tooltipTimer = setInterval(() => this.updateTooltip(), 1000);
      if (!active && this.tooltipTimer) {
        clearInterval(this.tooltipTimer);
        this.tooltipTimer = null;
      }
    }
    this.updateTooltip();
    this.rebuild();
  }

  displayBalloon(title: string, content: string): void {
    try {
      this.tray.displayBalloon({ title, content, iconType: 'info' });
    } catch {
      // Balloons are best effort (Focus Assist may suppress them).
    }
  }

  destroy(): void {
    if (this.tooltipTimer) clearInterval(this.tooltipTimer);
    this.tray.destroy();
  }

  private isActive(state: RecorderState | null): boolean {
    return !!state && (state.phase === 'recording' || state.phase === 'paused');
  }

  private updateTooltip(): void {
    const s = this.state;
    if (s && this.isActive(s)) {
      const t = formatDuration(elapsedFrom(s.elapsedMs, s.runningSince, Date.now()));
      this.tray.setToolTip(`OneLoom — ${s.phase === 'paused' ? 'paused' : 'recording'} ${t}`);
    } else {
      this.tray.setToolTip('OneLoom');
    }
  }

  private rebuild(): void {
    const s = this.state;
    const active = this.isActive(s);
    const busy = !!s && s.phase !== 'idle';
    const menu = Menu.buildFromTemplate([
      { label: 'New recording', accelerator: 'CmdOrCtrl+Shift+R', enabled: !busy, click: () => this.actions.newRecording() },
      ...(active
        ? [
            { label: s?.phase === 'paused' ? 'Resume recording' : 'Pause recording', click: () => this.actions.togglePause() },
            { label: 'Stop recording', click: () => this.actions.stop() }
          ]
        : []),
      { type: 'separator' as const },
      { label: 'Open OneLoom', click: () => this.actions.openApp() },
      { label: 'Open recordings folder', click: () => this.actions.openRecordings() },
      { type: 'separator' as const },
      { label: 'Quit OneLoom', click: () => this.actions.quit() }
    ]);
    this.tray.setContextMenu(menu);
  }
}
