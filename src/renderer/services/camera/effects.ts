import type { ImageSegmenter } from '@mediapipe/tasks-vision';
import type { CameraBackground } from '@app-types';
import { presetById } from '@shared/backgrounds';

/**
 * Camera background effects: person segmentation (MediaPipe selfie segmenter, run
 * locally in WebAssembly/WebGL — nothing leaves the PC), then blur or replace the
 * background. Also handles the square crop and mirroring of the camera bubble.
 */

const ASSET_BASE = 'oneloom-media://assets/mediapipe/';
const SEG_SIZE = 256;

export type EffectsState = 'off' | 'loading' | 'ready' | 'unavailable';

let segmenterPromise: Promise<ImageSegmenter> | null = null;

function loadSegmenter(): Promise<ImageSegmenter> {
  segmenterPromise ??= (async () => {
    const vision = await import('@mediapipe/tasks-vision');
    const fileset = {
      wasmLoaderPath: `${ASSET_BASE}vision_wasm_internal.js`,
      wasmBinaryPath: `${ASSET_BASE}vision_wasm_internal.wasm`
    };
    const create = (delegate: 'GPU' | 'CPU') =>
      vision.ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${ASSET_BASE}selfie_segmenter.tflite`, delegate },
        runningMode: 'VIDEO',
        outputCategoryMask: false,
        outputConfidenceMasks: true
      });
    try {
      return await create('GPU');
    } catch (err) {
      console.warn('GPU segmentation unavailable, using CPU', err);
      return create('CPU');
    }
  })();
  segmenterPromise.catch(() => {
    segmenterPromise = null;
  });
  return segmenterPromise;
}

export interface EffectOptions {
  background: CameraBackground;
  /** Preset id (`preset:…`) or image URL for `image` backgrounds. */
  image: string | null;
  mirror: boolean;
}

function canvas(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

export class CameraEffectsRenderer {
  private options: EffectOptions = { background: 'none', image: null, mirror: true };
  private segmenter: ImageSegmenter | null = null;
  private state: EffectsState = 'off';
  private readonly input = canvas(SEG_SIZE);
  private readonly mask = canvas(SEG_SIZE);
  private readonly maskImage = new ImageData(SEG_SIZE, SEG_SIZE);
  private person = canvas(2);
  private image: HTMLImageElement | null = null;
  private imageKey: string | null = null;
  private lastTimestamp = 0;

  constructor(private readonly onState?: (state: EffectsState) => void) {}

  setOptions(options: EffectOptions): void {
    this.options = options;
    if (options.background !== 'none' && !this.segmenter && this.state !== 'loading') {
      this.setState('loading');
      loadSegmenter().then(
        (s) => {
          this.segmenter = s;
          this.setState('ready');
        },
        (err) => {
          console.warn('background effects unavailable', err);
          this.setState('unavailable');
        }
      );
    } else if (options.background === 'none') {
      this.setState(this.segmenter ? 'ready' : 'off');
    }
    const key = options.background === 'image' ? options.image : null;
    if (key !== this.imageKey) {
      this.imageKey = key;
      this.image = null;
      if (key && !key.startsWith('preset:')) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          if (this.imageKey === key) this.image = img;
        };
        img.src = key;
      }
    }
  }

  get effectsState(): EffectsState {
    return this.state;
  }

  /** Render one frame of `video` into the square `out` canvas. */
  draw(video: HTMLVideoElement, out: HTMLCanvasElement): void {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const ctx = out.getContext('2d');
    if (!vw || !vh || !ctx) return;
    const side = Math.min(vw, vh);
    const sx = (vw - side) / 2;
    const sy = (vh - side) / 2;
    const D = out.width;
    const { background, mirror } = this.options;

    const drawCamera = (target: CanvasRenderingContext2D, inflate = 0) => {
      target.save();
      if (mirror) {
        target.translate(D, 0);
        target.scale(-1, 1);
      }
      target.drawImage(video, sx, sy, side, side, -inflate, -inflate, D + inflate * 2, D + inflate * 2);
      target.restore();
    };

    if (background === 'none' || !this.segmenter) {
      drawCamera(ctx);
      return;
    }

    // 1. Person mask from a small square crop.
    const inCtx = this.input.getContext('2d', { willReadFrequently: false })!;
    inCtx.drawImage(video, sx, sy, side, side, 0, 0, SEG_SIZE, SEG_SIZE);
    const timestamp = Math.max(this.lastTimestamp + 1, Math.round(performance.now()));
    this.lastTimestamp = timestamp;
    let gotMask = false;
    try {
      this.segmenter.segmentForVideo(this.input, timestamp, (result) => {
        const confidence = result.confidenceMasks?.[0];
        if (!confidence) return;
        const values = confidence.getAsFloat32Array();
        const px = this.maskImage.data;
        for (let i = 0; i < values.length; i++) px[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, values[i]!)) * 255);
        gotMask = true;
      });
    } catch (err) {
      console.warn('segmentation failed', err);
      this.segmenter = null;
      this.setState('unavailable');
    }
    if (!gotMask) {
      drawCamera(ctx);
      return;
    }
    this.mask.getContext('2d')!.putImageData(this.maskImage, 0, 0);

    // 2. Background.
    ctx.save();
    ctx.clearRect(0, 0, D, D);
    if (background === 'blur-light' || background === 'blur-strong') {
      const radius = Math.round((background === 'blur-light' ? 0.03 : 0.07) * D);
      ctx.filter = `blur(${radius}px)`;
      drawCamera(ctx, radius * 2);
      ctx.filter = 'none';
    } else {
      this.drawBackgroundImage(ctx, D);
    }
    ctx.restore();

    // 3. Person layer (built unmirrored, like the mask), softened edges, then mirrored once.
    if (this.person.width !== D) this.person = canvas(D);
    const pctx = this.person.getContext('2d')!;
    pctx.globalCompositeOperation = 'source-over';
    pctx.clearRect(0, 0, D, D);
    pctx.filter = `blur(${Math.max(1, Math.round(D / 220))}px)`;
    pctx.drawImage(this.mask, 0, 0, D, D);
    pctx.filter = 'none';
    pctx.globalCompositeOperation = 'source-in';
    pctx.drawImage(video, sx, sy, side, side, 0, 0, D, D);
    pctx.globalCompositeOperation = 'source-over';
    ctx.save();
    if (mirror) {
      ctx.translate(D, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(this.person, 0, 0);
    ctx.restore();
  }

  private drawBackgroundImage(ctx: CanvasRenderingContext2D, D: number): void {
    const preset = presetById(this.imageKey);
    if (this.image && this.image.naturalWidth > 0) {
      const iw = this.image.naturalWidth;
      const ih = this.image.naturalHeight;
      const s = Math.max(D / iw, D / ih);
      ctx.drawImage(this.image, (D - iw * s) / 2, (D - ih * s) / 2, iw * s, ih * s);
      return;
    }
    const colors = preset?.colors ?? ['#1f2937', '#374151', '#4b5563'];
    const g = ctx.createLinearGradient(0, 0, D, D);
    g.addColorStop(0, colors[0]);
    g.addColorStop(0.55, colors[1]);
    g.addColorStop(1, colors[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, D, D);
    // Soft light so the gradient reads like a lit backdrop.
    const r = ctx.createRadialGradient(D * 0.3, D * 0.25, D * 0.05, D * 0.3, D * 0.25, D * 0.8);
    r.addColorStop(0, 'rgba(255,255,255,0.22)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, D, D);
  }

  private setState(state: EffectsState): void {
    if (state === this.state) return;
    this.state = state;
    this.onState?.(state);
  }
}
