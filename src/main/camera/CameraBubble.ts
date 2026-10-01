import { EventEmitter } from 'node:events';
import { BrowserWindow, screen, type Display } from 'electron';
import type { BubbleConfig, BubbleStatus, CameraLayout, CameraShape } from '@app-types';
import {
  clampBubbleDiameter,
  clampToArea,
  cornerPosition,
  layoutFromScreenBubble,
  stepBubbleDiameter,
  type CameraCorner
} from '@shared/camera-layout';
import { IPC } from '@shared/ipc';
import { log } from '../logger';
import type { SettingsStore } from '../storage/SettingsStore';
import { displayFor, hardenWindow, loadRoute, secureWebPreferences } from '../windows/common';

/**
 * The Loom-style floating camera bubble: a round, always-on-top window showing the
 * camera (with background effects) that the user drags, grows and shrinks. It is NOT
 * excluded from capture — in screen recordings it is recorded exactly where it sits;
 * for window recordings the engine composites a capture of this window.
 */
export class CameraBubble extends EventEmitter<{ layout: [CameraLayout]; status: [BubbleStatus]; closedByUser: [] }> {
  private win: BrowserWindow | null = null;
  private deviceId: string | null = null;
  private recording = false;
  private hidden = false;
  private ready = false;
  private dragTimer: NodeJS.Timeout | null = null;
  private layoutTimer: NodeJS.Timeout | null = null;
  private lastStatus: BubbleStatus | null = null;

  constructor(
    private readonly settings: SettingsStore,
    private readonly backgroundUrl: (id: string | null) => string | null
  ) {
    super();
    settings.on('changed', () => this.pushConfig());
  }

  get isOpen(): boolean {
    return !!this.deviceId && !!this.win && !this.win.isDestroyed() && this.win.isVisible();
  }

  get status(): BubbleStatus | null {
    return this.lastStatus;
  }

  isBubble(webContentsId: number): boolean {
    return !!this.win && !this.win.isDestroyed() && this.win.webContents.id === webContentsId;
  }

  /** Create the window hidden ahead of time (renderer start-up is slow on managed PCs). */
  prewarm(): void {
    this.ensureWindow();
  }

  open(deviceId: string): void {
    this.deviceId = deviceId;
    this.hidden = false;
    const win = this.ensureWindow();
    this.applyBounds(this.restoredPosition());
    this.pushConfig();
    win.showInactive();
    win.setAlwaysOnTop(true, 'screen-saver');
  }

  close(): void {
    this.deviceId = null;
    this.recording = false;
    this.stopDrag();
    if (this.win && !this.win.isDestroyed()) this.win.hide();
    this.pushConfig(); // releases the camera
  }

  setRecording(recording: boolean): void {
    this.recording = recording;
    this.pushConfig();
  }

  /** Camera toggle during a recording: hide/show without releasing the device. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (!this.win || this.win.isDestroyed() || !this.deviceId) return;
    if (hidden) this.win.hide();
    else {
      this.win.showInactive();
      this.win.setAlwaysOnTop(true, 'screen-saver');
    }
  }

  get isHidden(): boolean {
    return this.hidden;
  }

  mediaSourceId(): string | null {
    try {
      return this.win && !this.win.isDestroyed() ? this.win.getMediaSourceId() : null;
    } catch {
      return null;
    }
  }

  displayId(): string | null {
    return this.win && !this.win.isDestroyed() ? String(this.currentDisplay().id) : null;
  }

  /** Where the bubble sits relative to its display — mapped onto window recordings. */
  layout(): CameraLayout {
    const bounds = this.win && !this.win.isDestroyed() ? this.win.getBounds() : { x: 0, y: 0, width: 200, height: 200 };
    return layoutFromScreenBubble(bounds, bounds.width, this.currentDisplay().bounds, this.settings.get().cameraLayout.shape);
  }

  place(corner: CameraCorner, displayId?: string | null): void {
    const d = displayId ? displayFor(displayId) : this.currentDisplay();
    const size = this.diameter();
    this.applyBounds(cornerPosition(corner, size, d.workArea));
    this.persistPosition();
    this.emitLayout();
  }

  /** Move to another display, keeping the same relative position (screen recordings). */
  moveToDisplay(displayId: string): void {
    if (!this.win || this.win.isDestroyed()) return;
    const target = displayFor(displayId);
    const current = this.currentDisplay();
    if (target.id === current.id) return;
    const b = this.win.getBounds();
    const rx = (b.x - current.workArea.x) / Math.max(1, current.workArea.width - b.width);
    const ry = (b.y - current.workArea.y) / Math.max(1, current.workArea.height - b.height);
    const x = target.workArea.x + rx * (target.workArea.width - b.width);
    const y = target.workArea.y + ry * (target.workArea.height - b.height);
    this.applyBounds({ x, y });
    this.persistPosition();
  }

  resizeTo(diameter: number): void {
    const next = clampBubbleDiameter(diameter);
    const current = this.win && !this.win.isDestroyed() ? this.win.getBounds() : null;
    if (current) {
      // Grow/shrink around the centre, like Loom (applyBounds keeps it on screen).
      const cx = current.x + current.width / 2;
      const cy = current.y + current.height / 2;
      this.applyBounds({ x: cx - next / 2, y: cy - next / 2 }, next);
    }
    this.persistPosition(next);
    this.emitLayout();
  }

  step(direction: 1 | -1): void {
    this.resizeTo(stepBubbleDiameter(this.diameter(), direction));
  }

  setShape(shape: CameraShape): void {
    void this.settings.update({ cameraLayout: { ...this.settings.get().cameraLayout, shape } });
    this.emitLayout();
  }

  handleReady(): void {
    this.ready = true;
    this.pushConfig();
  }

  handleStatus(status: BubbleStatus): void {
    this.lastStatus = status;
    this.emit('status', status);
  }

  handleUserClose(): void {
    this.close();
    this.emit('closedByUser');
  }

  /** Follow the cursor while the user drags the bubble (keeps hover events working). */
  drag(phase: 'start' | 'end'): void {
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    if (phase === 'end') {
      this.stopDrag();
      this.applyBounds(win.getBounds());
      this.persistPosition();
      this.emitLayout();
      return;
    }
    this.stopDrag();
    const start = screen.getCursorScreenPoint();
    const origin = win.getBounds();
    const offset = { x: start.x - origin.x, y: start.y - origin.y };
    const startedAt = Date.now();
    this.dragTimer = setInterval(() => {
      if (!this.win || this.win.isDestroyed() || Date.now() - startedAt > 60_000) return this.stopDrag();
      const p = screen.getCursorScreenPoint();
      this.win.setPosition(Math.round(p.x - offset.x), Math.round(p.y - offset.y));
      this.emitLayoutThrottled();
    }, 16);
  }

  destroy(): void {
    this.stopDrag();
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }

  private diameter(): number {
    return clampBubbleDiameter(this.settings.get().camera.bubbleDiameter);
  }

  private stopDrag(): void {
    if (this.dragTimer) clearInterval(this.dragTimer);
    this.dragTimer = null;
  }

  private currentDisplay(): Display {
    if (!this.win || this.win.isDestroyed()) return displayFor(null);
    return screen.getDisplayMatching(this.win.getBounds());
  }

  /** Saved position if it is still on a connected display, else bottom-left of the cursor's display. */
  private restoredPosition(): { x: number; y: number } {
    const size = this.diameter();
    const saved = this.settings.get().camera.bubblePosition;
    if (saved) {
      const d = screen.getDisplayMatching({ x: saved.x, y: saved.y, width: size, height: size });
      const area = d.workArea;
      const inside = saved.x + size > area.x && saved.x < area.x + area.width && saved.y + size > area.y && saved.y < area.y + area.height;
      if (inside) return clampToArea(saved, size, area);
    }
    return cornerPosition('bottom-left', size, displayFor(null).workArea);
  }

  /** Position (and size) the window, always fully inside the work area of its display. */
  private applyBounds(pos: { x: number; y: number }, size = this.diameter()): void {
    const win = this.ensureWindow();
    const area = screen.getDisplayMatching({ x: Math.round(pos.x), y: Math.round(pos.y), width: size, height: size }).workArea;
    const p = clampToArea(pos, Math.min(size, area.width, area.height), area);
    win.setBounds({ x: p.x, y: p.y, width: size, height: size });
  }

  /**
   * Persist the position, and the *requested* diameter — not the window width, which
   * Windows rounds at fractional display scaling (it would drift by a pixel each time).
   */
  private persistPosition(diameter = this.diameter()): void {
    if (!this.win || this.win.isDestroyed()) return;
    const b = this.win.getBounds();
    void this.settings.update({ camera: { ...this.settings.get().camera, bubblePosition: { x: b.x, y: b.y }, bubbleDiameter: diameter } });
  }

  private emitLayout(): void {
    if (this.win && !this.win.isDestroyed()) this.emit('layout', this.layout());
  }

  private emitLayoutThrottled(): void {
    if (this.layoutTimer) return;
    this.layoutTimer = setTimeout(() => {
      this.layoutTimer = null;
      this.emitLayout();
    }, 100);
  }

  private config(): BubbleConfig | null {
    if (!this.deviceId) return null;
    const s = this.settings.get();
    return {
      deviceId: this.deviceId,
      diameter: this.diameter(),
      shape: s.cameraLayout.shape,
      mirror: s.camera.mirror,
      background: s.camera.background,
      backgroundImage: s.camera.background === 'image' ? (this.backgroundUrl(s.camera.backgroundImage) ?? s.camera.backgroundImage) : null,
      recording: this.recording
    };
  }

  private pushConfig(): void {
    if (!this.win || this.win.isDestroyed() || !this.ready) return;
    const config = this.config();
    this.win.webContents.send(IPC.bubbleConfig, config);
    // Tolerate the ±1 px rounding Windows applies at fractional scaling.
    if (config && Math.abs(this.win.getBounds().width - config.diameter) > 2) {
      const b = this.win.getBounds();
      this.applyBounds({ x: b.x + (b.width - config.diameter) / 2, y: b.y + (b.height - config.diameter) / 2 }, config.diameter);
    }
  }

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const size = this.diameter();
    const win = new BrowserWindow({
      width: size,
      height: size,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      title: 'OneLoom camera',
      backgroundColor: '#00000000',
      webPreferences: secureWebPreferences({ backgroundThrottling: false })
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    hardenWindow(win);
    win.on('closed', () => {
      this.win = null;
      this.ready = false;
    });
    win.webContents.on('render-process-gone', (_e, d) => log.warn('camera bubble renderer gone', d.reason));
    loadRoute(win, '/bubble');
    this.ready = false;
    this.win = win;
    return win;
  }
}
