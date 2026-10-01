/**
 * Minimal EBML (Matroska/WebM) primitives: just enough to parse the layout
 * Chromium's MediaRecorder produces and to write a seekable copy.
 */

export const ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Seek: 0x4dbb,
  SeekID: 0x53ab,
  SeekPosition: 0x53ac,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Duration: 0x4489,
  MuxingApp: 0x4d80,
  WritingApp: 0x5741,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  CodecID: 0x86,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  ReferenceBlock: 0xfb,
  Cues: 0x1c53bb6b,
  CuePoint: 0xbb,
  CueTime: 0xb3,
  CueTrackPositions: 0xb7,
  CueTrack: 0xf7,
  CueClusterPosition: 0xf1,
  Void: 0xec,
  CRC32: 0xbf,
  Tags: 0x1254c367,
  Chapters: 0x1043a770,
  Attachments: 0x1941a469
} as const;

/** Level-1 elements: seeing one of these ends an unknown-sized Cluster. */
export const TOP_LEVEL_IDS: ReadonlySet<number> = new Set([
  ID.EBML,
  ID.Segment,
  ID.SeekHead,
  ID.Info,
  ID.Tracks,
  ID.Cluster,
  ID.Cues,
  ID.Tags,
  ID.Chapters,
  ID.Attachments
]);

export interface VintSize {
  value: number;
  length: number;
  unknown: boolean;
}

/** Read an element ID (1–4 bytes, marker bits kept). */
export function readId(buf: Uint8Array, offset: number): { id: number; length: number } | null {
  const first = buf[offset];
  if (first === undefined) return null;
  let length: number;
  if (first & 0x80) length = 1;
  else if (first & 0x40) length = 2;
  else if (first & 0x20) length = 3;
  else if (first & 0x10) length = 4;
  else return null;
  if (offset + length > buf.length) return null;
  let id = 0;
  for (let i = 0; i < length; i++) id = id * 256 + buf[offset + i]!;
  return { id, length };
}

/** Read a size vint (1–8 bytes). All-ones data bits mean "unknown size". */
export function readSize(buf: Uint8Array, offset: number): VintSize | null {
  const first = buf[offset];
  if (first === undefined || first === 0) return null;
  let length = 1;
  let mask = 0x80;
  while (!(first & mask)) {
    length++;
    mask >>= 1;
  }
  if (offset + length > buf.length) return null;
  let value = first & (mask - 1);
  let allOnes = value === mask - 1;
  for (let i = 1; i < length; i++) {
    const b = buf[offset + i]!;
    value = value * 256 + b;
    if (b !== 0xff) allOnes = false;
  }
  return { value, length, unknown: allOnes };
}

export function encodeSize(value: number, fixedLength?: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`Invalid EBML size ${value}`);
  let length = fixedLength ?? 1;
  if (fixedLength === undefined) {
    while (length < 8 && value >= 2 ** (7 * length) - 1) length++;
  }
  if (length < 1 || length > 8 || value >= 2 ** (7 * length) - 1) {
    throw new RangeError(`EBML size ${value} does not fit in ${length} bytes`);
  }
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0] = (out[0] ?? 0) | (0x80 >> (length - 1));
  return out;
}

export function encodeId(id: number): Uint8Array {
  const length = id > 0xffffff ? 4 : id > 0xffff ? 3 : id > 0xff ? 2 : 1;
  const out = new Uint8Array(length);
  let v = id;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  return out;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function encodeElement(id: number, data: Uint8Array, fixedSizeLength?: number): Uint8Array {
  return concatBytes([encodeId(id), encodeSize(data.length, fixedSizeLength), data]);
}

export function encodeUIntData(value: number, fixedBytes?: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`Invalid unsigned integer ${value}`);
  let length = fixedBytes ?? 1;
  if (fixedBytes === undefined) {
    while (length < 8 && value >= 2 ** (8 * length)) length++;
  }
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  return out;
}

export function encodeUInt(id: number, value: number, fixedBytes?: number): Uint8Array {
  return encodeElement(id, encodeUIntData(value, fixedBytes));
}

export function encodeFloat64(id: number, value: number): Uint8Array {
  const data = new Uint8Array(8);
  new DataView(data.buffer).setFloat64(0, value, false);
  return encodeElement(id, data);
}

export function readUInt(buf: Uint8Array, offset: number, length: number): number {
  let v = 0;
  for (let i = 0; i < length; i++) v = v * 256 + buf[offset + i]!;
  return v;
}

export function readFloat(buf: Uint8Array, offset: number, length: number): number | null {
  const view = new DataView(buf.buffer, buf.byteOffset + offset, length);
  if (length === 4) return view.getFloat32(0, false);
  if (length === 8) return view.getFloat64(0, false);
  return null;
}

export function readString(buf: Uint8Array, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) {
    const c = buf[offset + i]!;
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}
