import { open, type FileHandle } from 'node:fs/promises';
import {
  concatBytes,
  encodeElement,
  encodeFloat64,
  encodeId,
  encodeSize,
  encodeUInt,
  ID,
  readFloat,
  readId,
  readSize,
  readString,
  readUInt,
  TOP_LEVEL_IDS
} from './ebml';

/**
 * Streaming WebM finaliser.
 *
 * Chromium's MediaRecorder writes "live" WebM: unknown Segment/Cluster sizes, no
 * Duration and no Cues, so players show no length and cannot seek quickly. This
 * module scans the raw file once (reading only element headers) and writes a copy
 * with a known-size Segment, a SeekHead, Info/Duration and a Cues index. Media data
 * is copied in fixed-size chunks, so memory use is constant regardless of length.
 * A truncated tail (crash, disk full) is cut back to the last complete element.
 */

export interface ElementHeader {
  id: number;
  start: number;
  dataStart: number;
  /** null when the size is "unknown". */
  size: number | null;
  end: number | null;
}

export class BufferedReader {
  private buf: Buffer = Buffer.alloc(0);
  private bufStart = 0;

  constructor(
    private readonly fh: FileHandle,
    readonly size: number,
    private readonly windowSize = 4 * 1024 * 1024
  ) {}

  /** View of `[pos, pos+len)` (shorter at EOF). Only valid until the next call. */
  async peek(pos: number, len: number): Promise<Buffer> {
    const relStart = pos - this.bufStart;
    if (relStart >= 0 && relStart + len <= this.buf.length) return this.buf.subarray(relStart, relStart + len);
    if (pos >= this.size) return Buffer.alloc(0);
    const toRead = Math.min(Math.max(len, this.windowSize), this.size - pos);
    const b = Buffer.allocUnsafe(toRead);
    const { bytesRead } = await this.fh.read(b, 0, toRead, pos);
    this.buf = b.subarray(0, bytesRead);
    this.bufStart = pos;
    return this.buf.subarray(0, Math.min(len, bytesRead));
  }

  /** Copy of `[start, end)`. */
  async read(start: number, end: number): Promise<Buffer> {
    const out = Buffer.allocUnsafe(end - start);
    const { bytesRead } = await this.fh.read(out, 0, out.length, start);
    if (bytesRead !== out.length) throw new Error(`Short read at ${start}`);
    return out;
  }
}

export async function readHeader(r: BufferedReader, pos: number): Promise<ElementHeader | null> {
  const b = await r.peek(pos, 12);
  const id = readId(b, 0);
  if (!id) return null;
  const size = readSize(b, id.length);
  if (!size) return null;
  const dataStart = pos + id.length + size.length;
  return {
    id: id.id,
    start: pos,
    dataStart,
    size: size.unknown ? null : size.value,
    end: size.unknown ? null : dataStart + size.value
  };
}

export interface ClusterInfo {
  start: number;
  dataStart: number;
  /** End of the last complete child element. */
  dataEnd: number;
  timecode: number;
  /** Absolute time of the first video keyframe in this cluster, if any. */
  keyframeTime: number | null;
}

export interface TrackInfo {
  number: number;
  type: number;
  codecId: string;
  width?: number;
  height?: number;
}

export interface WebmScan {
  fileSize: number;
  ebmlHeaderEnd: number;
  segmentStart: number;
  segmentDataStart: number;
  info: { start: number; end: number } | null;
  timecodeScale: number;
  existingDurationTicks: number | null;
  tracksRange: { start: number; end: number } | null;
  tracks: TrackInfo[];
  others: Array<{ start: number; end: number }>;
  clusters: ClusterInfo[];
  maxTimestamp: number;
  lastFrameDurationTicks: number;
  blockCount: number;
  /** Absolute times (ticks) of every video keyframe. */
  keyframes: number[];
  /** Blocks stored as BlockGroup (not produced by Chromium). */
  blockGroups: number;
  truncated: boolean;
}

export async function scanWebm(r: BufferedReader): Promise<WebmScan> {
  const fileSize = r.size;
  const ebml = await readHeader(r, 0);
  if (!ebml || ebml.id !== ID.EBML || ebml.end === null) throw new Error('Not an EBML file');
  const segment = await readHeader(r, ebml.end);
  if (!segment || segment.id !== ID.Segment) throw new Error('Missing WebM Segment');
  const segmentEnd = segment.end === null ? fileSize : Math.min(segment.end, fileSize);

  const scan: WebmScan = {
    fileSize,
    ebmlHeaderEnd: ebml.end,
    segmentStart: segment.start,
    segmentDataStart: segment.dataStart,
    info: null,
    timecodeScale: 1_000_000,
    existingDurationTicks: null,
    tracksRange: null,
    tracks: [],
    others: [],
    clusters: [],
    maxTimestamp: 0,
    lastFrameDurationTicks: 0,
    blockCount: 0,
    keyframes: [],
    blockGroups: 0,
    truncated: false
  };

  let videoTrack: number | null = null;
  let lastVideoTs: number | null = null;
  let prevVideoTs: number | null = null;

  let pos = segment.dataStart;
  while (pos < segmentEnd) {
    const h = await readHeader(r, pos);
    if (!h) {
      scan.truncated = true;
      break;
    }

    if (h.id === ID.Cluster) {
      const limit = h.end === null ? segmentEnd : Math.min(h.end, segmentEnd);
      let p = h.dataStart;
      let lastComplete = h.dataStart;
      let timecode: number | null = null;
      let keyframeTime: number | null = null;
      let clusterTruncated = false;

      while (p < limit) {
        const c = await readHeader(r, p);
        if (!c) {
          clusterTruncated = true;
          break;
        }
        if (h.end === null && TOP_LEVEL_IDS.has(c.id)) break;
        if (c.end === null || c.end > fileSize || (h.end !== null && c.end > h.end)) {
          clusterTruncated = true;
          break;
        }
        const size = c.size ?? 0;
        if (c.id === ID.Timecode && size <= 8) {
          const b = await r.peek(c.dataStart, size);
          timecode = readUInt(b, 0, size);
        } else if ((c.id === ID.SimpleBlock || c.id === ID.BlockGroup) && timecode !== null) {
          const block = c.id === ID.SimpleBlock ? await readBlockHeader(r, c.dataStart, size) : await readBlockGroup(r, c.dataStart, c.end);
          if (block) {
            const ts = timecode + block.relativeTimecode;
            scan.blockCount++;
            if (ts > scan.maxTimestamp) scan.maxTimestamp = ts;
            if (videoTrack === null) videoTrack = firstVideoTrack(scan.tracks);
            if (c.id === ID.BlockGroup) scan.blockGroups++;
            if (block.track === videoTrack) {
              if (block.keyframe) scan.keyframes.push(ts);
              if (block.keyframe && keyframeTime === null) keyframeTime = ts;
              if (lastVideoTs === null || ts > lastVideoTs) {
                prevVideoTs = lastVideoTs;
                lastVideoTs = ts;
              }
            }
          }
        }
        p = c.end;
        lastComplete = p;
      }

      if (timecode !== null && lastComplete > h.dataStart) {
        scan.clusters.push({ start: h.start, dataStart: h.dataStart, dataEnd: lastComplete, timecode, keyframeTime });
      }
      if (clusterTruncated) {
        scan.truncated = true;
        break;
      }
      pos = h.end === null ? p : h.end;
      if (h.end !== null && h.end > fileSize) {
        scan.truncated = true;
        break;
      }
      continue;
    }

    if (h.end === null || h.end > fileSize) {
      scan.truncated = true;
      break;
    }

    if ((h.id === ID.Info || h.id === ID.Tracks) && h.end - h.start > MAX_HEADER_ELEMENT_BYTES) {
      throw new Error('WebM header element is implausibly large');
    }
    switch (h.id) {
      case ID.Info: {
        scan.info = { start: h.start, end: h.end };
        await forEachChild(r, h.dataStart, h.end, async (c, data) => {
          if (c.id === ID.TimecodeScale) scan.timecodeScale = readUInt(data, 0, data.length) || 1_000_000;
          if (c.id === ID.Duration) scan.existingDurationTicks = readFloat(data, 0, data.length);
        });
        break;
      }
      case ID.Tracks:
        scan.tracksRange = { start: h.start, end: h.end };
        scan.tracks = await parseTracks(r, h.dataStart, h.end);
        videoTrack = firstVideoTrack(scan.tracks);
        break;
      case ID.SeekHead:
      case ID.Cues:
      case ID.Void:
      case ID.CRC32:
        // Regenerated (or meaningless after rewriting).
        break;
      default:
        // Tags/Chapters are kept; anything huge (e.g. Attachments) is dropped rather than buffered.
        if (h.end - h.start <= MAX_HEADER_ELEMENT_BYTES) scan.others.push({ start: h.start, end: h.end });
    }
    pos = h.end;
  }

  if (lastVideoTs !== null && prevVideoTs !== null) {
    const diff = lastVideoTs - prevVideoTs;
    const maxTicks = (200 * 1_000_000) / scan.timecodeScale;
    scan.lastFrameDurationTicks = diff > 0 && diff <= maxTicks ? diff : 0;
  }
  return scan;
}

function firstVideoTrack(tracks: TrackInfo[]): number | null {
  return tracks.find((t) => t.type === 1)?.number ?? null;
}

export async function readBlockHeader(
  r: BufferedReader,
  dataStart: number,
  size: number
): Promise<{ track: number; relativeTimecode: number; keyframe: boolean } | null> {
  const b = await r.peek(dataStart, Math.min(size, 12));
  const track = readSize(b, 0);
  if (!track || b.length < track.length + 3) return null;
  const rel = (b[track.length]! << 8) | b[track.length + 1]!;
  const relativeTimecode = rel & 0x8000 ? rel - 0x10000 : rel;
  const flags = b[track.length + 2]!;
  return { track: track.value, relativeTimecode, keyframe: (flags & 0x80) !== 0 };
}

async function readBlockGroup(
  r: BufferedReader,
  start: number,
  end: number
): Promise<{ track: number; relativeTimecode: number; keyframe: boolean } | null> {
  let block: { track: number; relativeTimecode: number } | null = null;
  let hasReference = false;
  let p = start;
  while (p < end) {
    const c = await readHeader(r, p);
    if (!c || c.end === null || c.end > end) break;
    if (c.id === ID.Block) block = await readBlockHeader(r, c.dataStart, c.size ?? 0);
    if (c.id === ID.ReferenceBlock) hasReference = true;
    p = c.end;
  }
  return block ? { ...block, keyframe: !hasReference } : null;
}

async function forEachChild(
  r: BufferedReader,
  start: number,
  end: number,
  fn: (header: ElementHeader, data: Buffer) => Promise<void> | void
): Promise<void> {
  let p = start;
  while (p < end) {
    const c = await readHeader(r, p);
    if (!c || c.end === null || c.end > end) break;
    // Header metadata children are tiny; never buffer an oversized (corrupt/crafted) one.
    if ((c.size ?? 0) <= MAX_METADATA_CHILD_BYTES) {
      const data = Buffer.from(await r.peek(c.dataStart, c.size ?? 0));
      await fn(c, data);
    }
    p = c.end;
  }
}

const MAX_METADATA_CHILD_BYTES = 1024 * 1024;
/** Info/Tracks/Tags are copied through memory; real ones are a few KB. */
const MAX_HEADER_ELEMENT_BYTES = 16 * 1024 * 1024;

async function parseTracks(r: BufferedReader, start: number, end: number): Promise<TrackInfo[]> {
  const entries: Array<{ start: number; end: number }> = [];
  await forEachChild(r, start, end, (c) => {
    if (c.id === ID.TrackEntry && c.end !== null) entries.push({ start: c.dataStart, end: c.end });
  });
  const tracks: TrackInfo[] = [];
  for (const entry of entries) {
    const t: TrackInfo = { number: 0, type: 0, codecId: '' };
    await forEachChild(r, entry.start, entry.end, async (c, data) => {
      if (c.id === ID.TrackNumber) t.number = readUInt(data, 0, data.length);
      else if (c.id === ID.TrackType) t.type = readUInt(data, 0, data.length);
      else if (c.id === ID.CodecID) t.codecId = readString(data, 0, data.length);
      else if (c.id === ID.Video && c.end !== null) {
        await forEachChild(r, c.dataStart, c.end, (v, vd) => {
          if (v.id === ID.PixelWidth) t.width = readUInt(vd, 0, vd.length);
          if (v.id === ID.PixelHeight) t.height = readUInt(vd, 0, vd.length);
        });
      }
    });
    if (t.number > 0) tracks.push(t);
  }
  return tracks;
}

export interface RemuxResult {
  durationMs: number;
  width?: number;
  height?: number;
  clusters: number;
  cuePoints: number;
  truncated: boolean;
  bytesWritten: number;
}

const CLUSTER_HEADER_BYTES = 4 + 8;

function buildSeekHead(entries: Array<{ id: number; position: number }>): Uint8Array {
  const seeks = entries.map((e) =>
    encodeElement(ID.Seek, concatBytes([encodeElement(ID.SeekID, encodeId(e.id)), encodeUInt(ID.SeekPosition, e.position, 8)]))
  );
  return encodeElement(ID.SeekHead, concatBytes(seeks));
}

function buildCues(scan: WebmScan, clusterPositions: number[]): { bytes: Uint8Array; count: number } {
  const video = firstVideoTrack(scan.tracks);
  const cueTrack = video ?? scan.tracks[0]?.number ?? 1;
  const points: Uint8Array[] = [];
  let lastTime = -1;
  scan.clusters.forEach((cluster, i) => {
    const time = video !== null ? cluster.keyframeTime : cluster.timecode;
    if (time === null || time <= lastTime) return;
    lastTime = time;
    points.push(
      encodeElement(
        ID.CuePoint,
        concatBytes([
          encodeUInt(ID.CueTime, Math.max(0, time)),
          encodeElement(ID.CueTrackPositions, concatBytes([encodeUInt(ID.CueTrack, cueTrack), encodeUInt(ID.CueClusterPosition, clusterPositions[i]!)]))
        ])
      )
    );
  });
  return { bytes: points.length ? encodeElement(ID.Cues, concatBytes(points)) : new Uint8Array(0), count: points.length };
}

/** Rewrite `inputPath` into a seekable WebM at `outputPath` (which must not exist). */
export interface RemuxOptions {
  /**
   * Never report less than this. Static content is recorded variable-frame-rate (frames
   * only when something changes), so the last frame can be long before the real end.
   */
  minDurationMs?: number;
}

export async function remuxWebm(inputPath: string, outputPath: string, options: RemuxOptions = {}): Promise<RemuxResult> {
  const input = await open(inputPath, 'r');
  let output: FileHandle | null = null;
  try {
    const { size } = await input.stat();
    const reader = new BufferedReader(input, size);
    const scan = await scanWebm(reader);
    if (!scan.tracksRange || scan.clusters.length === 0) throw new Error('WebM contains no media');

    const minTicks = options.minDurationMs ? (options.minDurationMs * 1_000_000) / scan.timecodeScale : 0;
    const durationTicks = Math.max(scan.maxTimestamp + scan.lastFrameDurationTicks, minTicks);

    // Info: keep original children except Duration/Void/CRC, then add the real Duration.
    const infoChildren: Uint8Array[] = [];
    if (scan.info) {
      const infoHeader = await readHeader(reader, scan.info.start);
      let p = infoHeader!.dataStart;
      while (p < scan.info.end) {
        const c = await readHeader(reader, p);
        if (!c || c.end === null || c.end > scan.info.end) break;
        if (c.id !== ID.Duration && c.id !== ID.Void && c.id !== ID.CRC32) infoChildren.push(await reader.read(c.start, c.end));
        p = c.end;
      }
    } else {
      infoChildren.push(encodeUInt(ID.TimecodeScale, scan.timecodeScale));
    }
    infoChildren.push(encodeFloat64(ID.Duration, durationTicks));
    const info = encodeElement(ID.Info, concatBytes(infoChildren));
    const tracks = await reader.read(scan.tracksRange.start, scan.tracksRange.end);
    const others: Buffer[] = [];
    for (const o of scan.others) others.push(await reader.read(o.start, o.end));

    // Layout (positions are relative to the Segment data start).
    const placeholderSeek = buildSeekHead([
      { id: ID.Info, position: 0 },
      { id: ID.Tracks, position: 0 },
      { id: ID.Cues, position: 0 }
    ]);
    let offset = placeholderSeek.length;
    const infoPos = offset;
    offset += info.length;
    const tracksPos = offset;
    offset += tracks.length;
    for (const o of others) offset += o.length;
    const clusterPositions: number[] = [];
    for (const c of scan.clusters) {
      clusterPositions.push(offset);
      offset += CLUSTER_HEADER_BYTES + (c.dataEnd - c.dataStart);
    }
    const cuesPos = offset;
    const cues = buildCues(scan, clusterPositions);
    offset += cues.bytes.length;
    const segmentSize = offset;

    const seekEntries = [
      { id: ID.Info, position: infoPos },
      { id: ID.Tracks, position: tracksPos },
      ...(cues.count > 0 ? [{ id: ID.Cues, position: cuesPos }] : [])
    ];
    let seekHead = buildSeekHead(seekEntries);
    if (seekHead.length !== placeholderSeek.length) {
      // No Cues entry: pad with a Void element so every precomputed offset stays valid.
      const pad = placeholderSeek.length - seekHead.length;
      seekHead = concatBytes([seekHead, voidElement(pad)]);
    }

    output = await open(outputPath, 'wx');
    let written = 0;
    const write = async (bytes: Uint8Array) => {
      let off = 0;
      while (off < bytes.length) {
        const { bytesWritten } = await output!.write(bytes, off, bytes.length - off);
        off += bytesWritten;
      }
      written += bytes.length;
    };

    await write(await reader.read(0, scan.ebmlHeaderEnd));
    await write(concatBytes([encodeId(ID.Segment), encodeSize(segmentSize, 8)]));
    await write(seekHead);
    await write(info);
    await write(tracks);
    for (const o of others) await write(o);

    const copyBuf = Buffer.allocUnsafe(1024 * 1024);
    for (const c of scan.clusters) {
      const len = c.dataEnd - c.dataStart;
      await write(concatBytes([encodeId(ID.Cluster), encodeSize(len, 8)]));
      let p = c.dataStart;
      while (p < c.dataEnd) {
        const n = Math.min(copyBuf.length, c.dataEnd - p);
        const { bytesRead } = await input.read(copyBuf, 0, n, p);
        if (bytesRead <= 0) throw new Error(`Unexpected end of file at ${p}`);
        await write(copyBuf.subarray(0, bytesRead));
        p += bytesRead;
      }
    }
    if (cues.count > 0) await write(cues.bytes);
    await output.sync();

    const video = scan.tracks.find((t) => t.type === 1);
    return {
      durationMs: (durationTicks * scan.timecodeScale) / 1_000_000,
      ...(video?.width ? { width: video.width } : {}),
      ...(video?.height ? { height: video.height } : {}),
      clusters: scan.clusters.length,
      cuePoints: cues.count,
      truncated: scan.truncated,
      bytesWritten: written
    };
  } finally {
    await input.close().catch(() => undefined);
    await output?.close().catch(() => undefined);
  }
}

/** A Void element occupying exactly `totalBytes` (≥ 2). */
function voidElement(totalBytes: number): Uint8Array {
  if (totalBytes < 2) throw new RangeError('Void element needs at least 2 bytes');
  // 1 byte ID + size vint; choose the vint length so the total adds up.
  for (let sizeLen = 1; sizeLen <= 8; sizeLen++) {
    const dataLen = totalBytes - 1 - sizeLen;
    if (dataLen >= 0 && dataLen < 2 ** (7 * sizeLen) - 1) {
      return concatBytes([encodeId(ID.Void), encodeSize(dataLen, sizeLen), new Uint8Array(dataLen)]);
    }
  }
  throw new RangeError(`Cannot build Void of ${totalBytes} bytes`);
}

export interface WebmHeaderInfo {
  durationMs: number | null;
  width?: number;
  height?: number;
}

/** Cheap header read (Info/Tracks only) — used to show durations of files without metadata. */
export async function readWebmHeaderInfo(path: string): Promise<WebmHeaderInfo | null> {
  let fh: FileHandle | null = null;
  try {
    fh = await open(path, 'r');
    const { size } = await fh.stat();
    const reader = new BufferedReader(fh, size, 256 * 1024);
    const ebml = await readHeader(reader, 0);
    if (!ebml || ebml.id !== ID.EBML || ebml.end === null) return null;
    const segment = await readHeader(reader, ebml.end);
    if (!segment || segment.id !== ID.Segment) return null;
    let timecodeScale = 1_000_000;
    let duration: number | null = null;
    let width: number | undefined;
    let height: number | undefined;
    let pos = segment.dataStart;
    for (let guard = 0; guard < 16 && pos < size; guard++) {
      const h = await readHeader(reader, pos);
      if (!h || h.end === null || h.id === ID.Cluster) break;
      if (h.id === ID.Info) {
        await forEachChild(reader, h.dataStart, h.end, (c, data) => {
          if (c.id === ID.TimecodeScale) timecodeScale = readUInt(data, 0, data.length) || 1_000_000;
          if (c.id === ID.Duration) duration = readFloat(data, 0, data.length);
        });
      } else if (h.id === ID.Tracks) {
        const video = (await parseTracks(reader, h.dataStart, h.end)).find((t) => t.type === 1);
        width = video?.width;
        height = video?.height;
      }
      pos = h.end;
    }
    const durationTicks = duration as number | null;
    return {
      durationMs: durationTicks !== null && Number.isFinite(durationTicks) ? (durationTicks * timecodeScale) / 1_000_000 : null,
      ...(width ? { width } : {}),
      ...(height ? { height } : {})
    };
  } catch {
    return null;
  } finally {
    await fh?.close().catch(() => undefined);
  }
}
