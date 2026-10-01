import { open, rm, type FileHandle } from 'node:fs/promises';
import type { TrimInfo } from '@app-types';
import { concatBytes, encodeElement, encodeId, encodeUInt, ID, readSize } from './ebml';
import { BufferedReader, readHeader, remuxWebm, scanWebm, type WebmScan } from './remux';

/**
 * Lossless WebM trim (no re-encoding, no FFmpeg).
 *
 * A video stream can only start cleanly on a keyframe, so the cut start snaps back to
 * the closest keyframe at or before the requested start (recordings carry one every
 * second). The end is frame-accurate. Timestamps are rebased to start at 0 and the
 * result goes through the regular finaliser, so it gets a Duration and Cues index.
 */

const UNKNOWN_SIZE = new Uint8Array([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
const MAX_CLUSTER_SPAN_TICKS = 30_000; // SimpleBlock timecodes are int16 relative to the cluster

export interface TrimPlan {
  startTicks: number;
  endTicks: number;
}

/** Choose the actual cut points (in timecode ticks) for a requested range. */
export function planTrim(keyframes: number[], startMs: number, endMs: number, timecodeScale: number): TrimPlan {
  const ticksPerMs = 1_000_000 / timecodeScale;
  const target = Math.max(0, startMs) * ticksPerMs;
  const sorted = [...keyframes].sort((a, b) => a - b);
  // Before the first keyframe means "keep the beginning": the first video frame is a
  // keyframe, and audio may legitimately start earlier (e.g. a window's first frame
  // arrives a moment after recording began).
  let start = 0;
  for (const k of sorted) {
    if (k <= target + 0.5) start = k;
    else break;
  }
  const endTicks = Math.round(endMs * ticksPerMs);
  if (!(endTicks > start)) throw new Error('The selection is empty after aligning to the nearest keyframe.');
  return { startTicks: start, endTicks };
}

async function openScan(path: string): Promise<{ fh: FileHandle; reader: BufferedReader; scan: WebmScan }> {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    const reader = new BufferedReader(fh, size);
    return { fh, reader, scan: await scanWebm(reader) };
  } catch (err) {
    await fh.close().catch(() => undefined);
    throw err;
  }
}

/** End of the media: the stored Duration when longer than the last frame (static content). */
function mediaEndTicks(scan: WebmScan): number {
  return Math.max(scan.maxTimestamp + scan.lastFrameDurationTicks, scan.existingDurationTicks ?? 0);
}

function unsupportedReason(scan: WebmScan): string | null {
  if (!scan.tracksRange || scan.clusters.length === 0) return 'This file contains no media.';
  if (!scan.tracks.some((t) => t.type === 1)) return 'Only videos can be trimmed.';
  if (scan.blockGroups > 0) return 'This WebM layout is not supported for lossless trimming.';
  return null;
}

export async function readTrimInfo(path: string): Promise<TrimInfo> {
  const { fh, scan } = await openScan(path);
  await fh.close().catch(() => undefined);
  const toMs = (t: number) => (t * scan.timecodeScale) / 1_000_000;
  const reason = unsupportedReason(scan);
  return {
    supported: !reason,
    ...(reason ? { reason } : {}),
    durationMs: Math.round(toMs(mediaEndTicks(scan))),
    keyframesMs: scan.keyframes.map((k) => Math.round(toMs(k)))
  };
}

export interface TrimResult {
  startMs: number;
  endMs: number;
  durationMs: number;
}

/** Write `input` trimmed to [startMs, endMs) into `output` (must not exist). */
export async function trimWebm(
  input: string,
  output: string,
  startMs: number,
  endMs: number,
  onProgress?: (fraction: number) => void
): Promise<TrimResult> {
  const live = `${output}.live`;
  const { fh, reader, scan } = await openScan(input);
  let out: FileHandle | null = null;
  try {
    const reason = unsupportedReason(scan);
    if (reason) throw new Error(reason);
    const plan = planTrim(scan.keyframes, startMs, endMs, scan.timecodeScale);
    const video = scan.tracks.find((t) => t.type === 1)!.number;

    await rm(live, { force: true });
    out = await open(live, 'wx');
    const write = async (bytes: Uint8Array) => {
      let off = 0;
      while (off < bytes.length) off += (await out!.write(bytes, off, bytes.length - off)).bytesWritten;
    };
    await write(await reader.read(0, scan.ebmlHeaderEnd));
    await write(concatBytes([encodeId(ID.Segment), UNKNOWN_SIZE]));
    if (scan.info) await write(await reader.read(scan.info.start, scan.info.end));
    await write(await reader.read(scan.tracksRange!.start, scan.tracksRange!.end));

    let cluster: { tc: number; parts: Uint8Array[] } | null = null;
    let kept = 0;
    const flush = async () => {
      if (cluster && cluster.parts.length > 0) {
        await write(encodeElement(ID.Cluster, concatBytes([encodeUInt(ID.Timecode, cluster.tc), ...cluster.parts])));
      }
      cluster = null;
    };

    for (let i = 0; i < scan.clusters.length; i++) {
      const c = scan.clusters[i]!;
      let p = c.dataStart;
      while (p < c.dataEnd) {
        const h = await readHeader(reader, p);
        if (!h || h.end === null) break;
        if (h.id === ID.SimpleBlock) {
          const data = Buffer.from(await reader.read(h.dataStart, h.end));
          const track = readSize(data, 0);
          if (track && data.length >= track.length + 3) {
            const rel = data.readInt16BE(track.length);
            const ts = c.timecode + rel;
            if (ts >= plan.startTicks && ts < plan.endTicks) {
              const t = ts - plan.startTicks;
              const isVideoKey = track.value === video && (data[track.length + 2]! & 0x80) !== 0;
              const current = cluster as { tc: number; parts: Uint8Array[] } | null;
              if (!current || (isVideoKey && current.parts.length > 0) || Math.abs(t - current.tc) > MAX_CLUSTER_SPAN_TICKS) {
                await flush();
                cluster = { tc: t, parts: [] };
              }
              data.writeInt16BE(t - cluster!.tc, track.length);
              cluster!.parts.push(encodeElement(ID.SimpleBlock, data));
              kept++;
            }
          }
        }
        p = h.end;
      }
      onProgress?.(((i + 1) / scan.clusters.length) * 0.6);
    }
    await flush();
    await out.close();
    out = null;
    if (kept === 0) throw new Error('Nothing is left inside the selected range.');

    // Keep the full selected length even if the source had no frame near the end (static screen).
    const sourceEndTicks = mediaEndTicks(scan);
    const selectionMs = ((Math.min(plan.endTicks, sourceEndTicks) - plan.startTicks) * scan.timecodeScale) / 1_000_000;
    const result = await remuxWebm(live, output, { minDurationMs: selectionMs });
    onProgress?.(1);
    const toMs = (t: number) => (t * scan.timecodeScale) / 1_000_000;
    return { startMs: Math.round(toMs(plan.startTicks)), endMs: Math.round(Math.min(toMs(plan.endTicks), endMs)), durationMs: Math.round(result.durationMs) };
  } finally {
    await out?.close().catch(() => undefined);
    await fh.close().catch(() => undefined);
    await rm(live, { force: true }).catch(() => undefined);
  }
}
