import type { CameraLayout } from '@app-types';
import { bubbleRect, shapeRadius } from '@shared/camera-layout';

/** True when the Chromium APIs used for compositing are available. */
export function canComposite(): boolean {
  return typeof MediaStreamTrackGenerator === 'function' && typeof OffscreenCanvas === 'function' && typeof VideoFrame === 'function';
}

/** Off-screen <video> playing a track (keeps decoding inside the hidden engine window). */
function playTrack(track: MediaStreamTrack): HTMLVideoElement {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([track]);
  video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.appendChild(video);
  void video.play().catch(() => undefined);
  return video;
}

/**
 * Burns the camera bubble into the screen/window video so the result is ONE file.
 *
 * Inputs are read through off-screen <video> elements (Chromium does not feed
 * desktop-capture tracks to MediaStreamTrackProcessor here), drawn onto an
 * OffscreenCanvas on a steady clock — re-using the last frame when the source is
 * static — and pushed into a MediaStreamTrackGenerator for MediaRecorder.
 */
export class CameraCompositor {
  readonly track: MediaStreamTrack;
  /** Output size: the source's own size once its first frame is known. */
  width: number;
  height: number;

  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private readonly writer: WritableStreamDefaultWriter<VideoFrame>;
  private readonly screenVideo: HTMLVideoElement;
  private readonly cameraVideo: HTMLVideoElement;
  private readonly timer: number;
  private cameraVisible = true;
  private stopped = false;
  private writing = false;
  private lastTimestamp = 0;
  private readonly counters = { ticks: 0, composed: 0, written: 0, writeErrors: 0, skippedNoScreen: 0 };

  constructor(
    screenTrack: MediaStreamTrack,
    cameraTrack: MediaStreamTrack,
    private layout: CameraLayout,
    frameRate: number,
    private readonly mirrorCamera = true,
    /** The captured bubble window already has its own border. */
    private readonly drawBorder = true
  ) {
    const s = screenTrack.getSettings();
    this.width = 0;
    this.height = 0;
    ({ canvas: this.canvas, ctx: this.ctx } = this.createCanvas(s.width ?? 1920, s.height ?? 1080));

    const generator = new MediaStreamTrackGenerator({ kind: 'video' });
    this.track = generator;
    this.writer = generator.writable.getWriter();

    this.screenVideo = playTrack(screenTrack);
    this.cameraVideo = playTrack(cameraTrack);
    // The engine window has background throttling disabled, so this keeps a steady rate.
    this.timer = window.setInterval(() => this.compose(), Math.round(1000 / Math.max(1, frameRate)));
  }

  /**
   * Resolves once the source has produced its first frame (window captures can take
   * ~1 s) and sizes the output to it, so a window recording has no black bars.
   */
  async ready(timeoutMs = 4000): Promise<void> {
    const v = this.screenVideo;
    if (v.videoWidth === 0) {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          v.removeEventListener('loadeddata', done);
          resolve();
        };
        const timer = setTimeout(done, timeoutMs);
        v.addEventListener('loadeddata', done);
      });
    }
    if (v.videoWidth > 0 && (v.videoWidth !== this.width || v.videoHeight !== this.height)) {
      ({ canvas: this.canvas, ctx: this.ctx } = this.createCanvas(v.videoWidth, v.videoHeight));
    }
  }

  private createCanvas(w: number, h: number): { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } {
    this.width = Math.max(2, Math.floor(w / 2) * 2);
    this.height = Math.max(2, Math.floor(h / 2) * 2);
    const canvas = new OffscreenCanvas(this.width, this.height);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas unavailable');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.width, this.height);
    return { canvas, ctx };
  }

  setCameraVisible(visible: boolean): void {
    this.cameraVisible = visible;
  }

  /** Follow the on-screen bubble as the user drags or resizes it. */
  setLayout(layout: CameraLayout): void {
    this.layout = layout;
  }

  /** Frame counters, logged when a recording stops (diagnostics). */
  stats(): Record<string, number> {
    return { ...this.counters, width: this.width, height: this.height };
  }

  /** JPEG of the current composite (used for the library thumbnail). */
  async snapshot(maxWidth = 480): Promise<ArrayBuffer | null> {
    const w = Math.min(maxWidth, this.width);
    const h = Math.round((this.height * w) / this.width);
    const c = new OffscreenCanvas(w, h);
    const cx = c.getContext('2d');
    if (!cx) return null;
    cx.drawImage(this.canvas, 0, 0, w, h);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
    return blob.arrayBuffer();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
    for (const v of [this.screenVideo, this.cameraVideo]) {
      v.pause();
      v.srcObject = null;
      v.remove();
    }
    void this.writer.close().catch(() => undefined);
    this.track.stop();
  }

  private compose(): void {
    this.counters.ticks++;
    if (this.stopped || this.writing) return;
    const sv = this.screenVideo;
    if (!sv.videoWidth || !sv.videoHeight) {
      this.counters.skippedNoScreen++;
      return;
    }
    const ctx = this.ctx;
    // Window captures can change size mid-recording: letterbox into the fixed canvas.
    const scale = Math.min(this.width / sv.videoWidth, this.height / sv.videoHeight);
    const dw = Math.round(sv.videoWidth * scale);
    const dh = Math.round(sv.videoHeight * scale);
    const dx = Math.round((this.width - dw) / 2);
    const dy = Math.round((this.height - dh) / 2);
    if (dw !== this.width || dh !== this.height) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, this.width, this.height);
    }
    ctx.drawImage(sv, dx, dy, dw, dh);
    if (this.cameraVisible && this.cameraVideo.videoWidth) this.drawBubble(this.cameraVideo);

    const timestamp = Math.max(this.lastTimestamp + 1, Math.round(performance.now() * 1000));
    this.lastTimestamp = timestamp;
    const frame = new VideoFrame(this.canvas, { timestamp });
    this.counters.composed++;
    this.writing = true;
    this.writer
      .write(frame)
      .then(() => void this.counters.written++)
      .catch(() => void this.counters.writeErrors++)
      .finally(() => {
        frame.close();
        this.writing = false;
      });
  }

  private drawBubble(cam: HTMLVideoElement): void {
    const ctx = this.ctx;
    const { x, y, diameter: d } = bubbleRect(this.layout, this.width, this.height);
    const cw = cam.videoWidth;
    const ch = cam.videoHeight;
    const side = Math.min(cw, ch);
    const sx = (cw - side) / 2;
    const sy = (ch - side) / 2;
    const radius = shapeRadius(this.layout.shape, d);

    ctx.save();
    // Soft shadow so the bubble reads on light and dark content.
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = Math.round(d * 0.06);
    ctx.beginPath();
    ctx.roundRect(x, y, d, d, radius);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    // Clip 1 px inside so the captured bubble window's anti-aliased edge never shows.
    ctx.roundRect(x + 1, y + 1, d - 2, d - 2, Math.max(0, radius - 1));
    ctx.clip();
    if (this.mirrorCamera) {
      ctx.translate(x + d, y);
      ctx.scale(-1, 1);
      ctx.drawImage(cam, sx, sy, side, side, 0, 0, d, d);
    } else {
      ctx.drawImage(cam, sx, sy, side, side, x, y, d, d);
    }
    ctx.restore();

    if (!this.drawBorder) return;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, d, d, radius);
    ctx.lineWidth = Math.max(2, Math.round(d * 0.014));
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.stroke();
    ctx.restore();
  }
}
