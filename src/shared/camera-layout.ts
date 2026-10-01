import type { CameraLayout, CameraShape, CameraSize } from '@app-types';

/** Bubble diameter as a fraction of the shorter side of the video frame. */
export const CAMERA_SIZE_FRACTION: Record<CameraSize, number> = {
  small: 0.18,
  medium: 0.25,
  large: 0.34
};

/** Margin between bubble and frame edge, as a fraction of the shorter side. */
export const CAMERA_MARGIN_FRACTION = 0.035;

/** On-screen bubble sizes (DIP) used by the grow / shrink buttons. */
export const BUBBLE_STEPS = [120, 160, 200, 250, 320, 400, 500] as const;
export const BUBBLE_DIAMETER_DEFAULT = 200;
export const BUBBLE_DIAMETER_MIN = BUBBLE_STEPS[0];
export const BUBBLE_DIAMETER_MAX = BUBBLE_STEPS[BUBBLE_STEPS.length - 1];

export function clampBubbleDiameter(d: number): number {
  return Math.round(Math.min(BUBBLE_DIAMETER_MAX, Math.max(BUBBLE_DIAMETER_MIN, d)));
}

/** Next size up/down from the current diameter (snaps to the step list). */
export function stepBubbleDiameter(current: number, direction: 1 | -1): number {
  if (direction > 0) return BUBBLE_STEPS.find((s) => s > current + 1) ?? BUBBLE_DIAMETER_MAX;
  return [...BUBBLE_STEPS].reverse().find((s) => s < current - 1) ?? BUBBLE_DIAMETER_MIN;
}

/** Map the S/M/L presets of the setup panel onto bubble diameters. */
export const BUBBLE_PRESET: Record<CameraSize, number> = { small: 160, medium: 200, large: 320 };

export function nearestPreset(diameter: number): CameraSize {
  const entries = Object.entries(BUBBLE_PRESET) as Array<[CameraSize, number]>;
  return entries.reduce((best, cur) => (Math.abs(cur[1] - diameter) < Math.abs(best[1] - diameter) ? cur : best))[0];
}

export type CameraCorner = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';

export interface BubbleRect {
  /** Top-left corner in frame pixels. */
  x: number;
  y: number;
  diameter: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function bubbleDiameter(frameWidth: number, frameHeight: number, size: CameraSize, fraction?: number): number {
  const f = fraction != null && Number.isFinite(fraction) ? Math.min(0.8, Math.max(0.05, fraction)) : CAMERA_SIZE_FRACTION[size];
  return Math.round(Math.min(frameWidth, frameHeight) * f);
}

/** Clamp a normalised centre so the bubble stays inside the frame (with an optional margin). */
export function clampCenter(layout: CameraLayout, frameWidth: number, frameHeight: number, withMargin = true): { x: number; y: number } {
  const d = bubbleDiameter(frameWidth, frameHeight, layout.size, layout.diameter);
  const margin = withMargin ? Math.min(frameWidth, frameHeight) * CAMERA_MARGIN_FRACTION : 0;
  const minX = (d / 2 + margin) / frameWidth;
  const minY = (d / 2 + margin) / frameHeight;
  const clamp = (v: number, lo: number, hi: number) => (lo > hi ? 0.5 : Math.min(hi, Math.max(lo, v)));
  return { x: clamp(layout.x, minX, 1 - minX), y: clamp(layout.y, minY, 1 - minY) };
}

export function bubbleRect(layout: CameraLayout, frameWidth: number, frameHeight: number): BubbleRect {
  const diameter = bubbleDiameter(frameWidth, frameHeight, layout.size, layout.diameter);
  // Layouts derived from the on-screen bubble already sit where the user put it: no extra margin.
  const c = clampCenter(layout, frameWidth, frameHeight, layout.diameter == null);
  return {
    x: Math.round(c.x * frameWidth - diameter / 2),
    y: Math.round(c.y * frameHeight - diameter / 2),
    diameter
  };
}

/**
 * Translate the on-screen bubble (window bounds in DIP) into a layout for a recorded
 * frame: same relative centre and same size relative to the display it is on. Moving
 * the bubble left/right on screen moves it left/right in a window recording.
 */
export function layoutFromScreenBubble(bubble: Rect, bubbleDiameterDip: number, display: Rect, shape: CameraShape): CameraLayout {
  const cx = bubble.x + bubble.width / 2;
  const cy = bubble.y + bubble.height / 2;
  const unitClamp = (v: number) => Math.min(1, Math.max(0, v));
  return {
    x: unitClamp((cx - display.x) / display.width),
    y: unitClamp((cy - display.y) / display.height),
    size: 'medium',
    shape,
    diameter: Math.min(0.8, Math.max(0.05, bubbleDiameterDip / Math.min(display.width, display.height)))
  };
}

/** Top-left of a bubble placed in a corner of a work area. */
export function cornerPosition(corner: CameraCorner, windowSize: number, workArea: Rect, margin = 28): { x: number; y: number } {
  const x = corner.endsWith('left') ? workArea.x + margin : workArea.x + workArea.width - windowSize - margin;
  const y = corner.startsWith('top') ? workArea.y + margin : workArea.y + workArea.height - windowSize - margin;
  return { x: Math.round(x), y: Math.round(y) };
}

/** Keep a window of `size` fully inside the work area. */
export function clampToArea(pos: { x: number; y: number }, size: number, area: Rect): { x: number; y: number } {
  return {
    x: Math.round(Math.min(area.x + area.width - size, Math.max(area.x, pos.x))),
    y: Math.round(Math.min(area.y + area.height - size, Math.max(area.y, pos.y)))
  };
}

/** Layout for a corner preset, computed for the given frame aspect ratio. */
export function cornerLayout(
  corner: CameraCorner,
  size: CameraSize,
  shape: CameraShape,
  frameWidth = 1920,
  frameHeight = 1080
): CameraLayout {
  const x = corner.endsWith('left') ? 0 : 1;
  const y = corner.startsWith('top') ? 0 : 1;
  const c = clampCenter({ x, y, size, shape }, frameWidth, frameHeight);
  return { x: c.x, y: c.y, size, shape };
}

/** Which corner a layout is closest to (used to keep a preset when the size changes). */
export function nearestCorner(layout: CameraLayout): CameraCorner {
  const v = layout.y >= 0.5 ? 'bottom' : 'top';
  const h = layout.x >= 0.5 ? 'right' : 'left';
  return `${v}-${h}` as CameraCorner;
}

export const DEFAULT_CAMERA_LAYOUT: CameraLayout = cornerLayout('bottom-left', 'medium', 'circle');

/** Corner radius used for the "rounded" shape, relative to the diameter. */
export function shapeRadius(shape: CameraShape, diameter: number): number {
  return shape === 'circle' ? diameter / 2 : diameter * 0.22;
}
