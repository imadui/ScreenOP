import { concatBytes, encodeElement, encodeId, encodeUInt, ID, readId, readSize, readUInt, readFloat } from '../../../src/main/webm/ebml';

const ascii = (s: string) => new TextEncoder().encode(s);
const UNKNOWN_SIZE = new Uint8Array([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

export interface TestBlock {
  track: number;
  rel: number;
  key?: boolean;
  payload: Uint8Array;
}

export interface TestCluster {
  timecode: number;
  blocks: TestBlock[];
}

/** Build a WebM laid out like Chromium's live MediaRecorder output (unknown sizes, no Duration/Cues). */
export function buildLiveWebm(clusters: TestCluster[], opts: { unknownClusterSizes?: boolean } = {}): Uint8Array {
  const unknownClusters = opts.unknownClusterSizes ?? true;
  const ebml = encodeElement(
    ID.EBML,
    concatBytes([
      encodeUInt(0x4286, 1),
      encodeUInt(0x42f7, 1),
      encodeUInt(0x42f2, 4),
      encodeUInt(0x42f3, 8),
      encodeElement(0x4282, ascii('webm')),
      encodeUInt(0x4287, 4),
      encodeUInt(0x4285, 2)
    ])
  );
  const info = encodeElement(
    ID.Info,
    concatBytes([encodeUInt(ID.TimecodeScale, 1_000_000), encodeElement(ID.MuxingApp, ascii('Chrome')), encodeElement(ID.WritingApp, ascii('Chrome'))])
  );
  const video = encodeElement(
    ID.TrackEntry,
    concatBytes([
      encodeUInt(ID.TrackNumber, 1),
      encodeUInt(ID.TrackType, 1),
      encodeElement(ID.CodecID, ascii('V_VP9')),
      encodeElement(ID.Video, concatBytes([encodeUInt(ID.PixelWidth, 1920), encodeUInt(ID.PixelHeight, 1080)]))
    ])
  );
  const audio = encodeElement(
    ID.TrackEntry,
    concatBytes([encodeUInt(ID.TrackNumber, 2), encodeUInt(ID.TrackType, 2), encodeElement(ID.CodecID, ascii('A_OPUS'))])
  );
  const tracks = encodeElement(ID.Tracks, concatBytes([video, audio]));

  const clusterBytes = clusters.map((c) => {
    const children = concatBytes([
      encodeUInt(ID.Timecode, c.timecode),
      ...c.blocks.map((b) => {
        const header = new Uint8Array([0x80 | b.track, (b.rel >> 8) & 0xff, b.rel & 0xff, b.key ? 0x80 : 0x00]);
        return encodeElement(ID.SimpleBlock, concatBytes([header, b.payload]));
      })
    ]);
    return unknownClusters ? concatBytes([encodeId(ID.Cluster), UNKNOWN_SIZE, children]) : encodeElement(ID.Cluster, children);
  });

  return concatBytes([ebml, encodeId(ID.Segment), UNKNOWN_SIZE, info, tracks, ...clusterBytes]);
}

export interface ParsedElement {
  id: number;
  start: number;
  dataStart: number;
  size: number;
  end: number;
}

/** Walk the children of a known-size master element (or the whole buffer). */
export function children(buf: Uint8Array, start: number, end: number): ParsedElement[] {
  const out: ParsedElement[] = [];
  let p = start;
  while (p < end) {
    const id = readId(buf, p);
    if (!id) throw new Error(`bad id at ${p}`);
    const size = readSize(buf, p + id.length);
    if (!size || size.unknown) throw new Error(`unknown/bad size at ${p}`);
    const dataStart = p + id.length + size.length;
    out.push({ id: id.id, start: p, dataStart, size: size.value, end: dataStart + size.value });
    p = dataStart + size.value;
  }
  if (p !== end) throw new Error(`children overran parent (${p} vs ${end})`);
  return out;
}

export function uintOf(buf: Uint8Array, el: ParsedElement): number {
  return readUInt(buf, el.dataStart, el.size);
}

export function floatOf(buf: Uint8Array, el: ParsedElement): number | null {
  return readFloat(buf, el.dataStart, el.size);
}

export function payloadBytes(clusters: TestCluster[]): number {
  return clusters.reduce((n, c) => n + c.blocks.reduce((m, b) => m + b.payload.length, 0), 0);
}

export function randomPayload(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}
