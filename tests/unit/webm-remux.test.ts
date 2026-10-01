import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeSize, ID, readId, readSize } from '../../src/main/webm/ebml';
import { readWebmHeaderInfo, remuxWebm } from '../../src/main/webm/remux';
import { buildLiveWebm, children, floatOf, payloadBytes, randomPayload, uintOf, type TestCluster } from './helpers/webm';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'oneloom-remux-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** 3 clusters × (video @30fps + audio @20ms), keyframe at the start of each cluster. */
function sampleClusters(): TestCluster[] {
  const clusters: TestCluster[] = [];
  let seed = 1;
  for (let c = 0; c < 3; c++) {
    const blocks = [];
    for (let i = 0; i < 60; i++) {
      blocks.push({ track: 1, rel: Math.round(i * 33.333), key: i === 0, payload: randomPayload(200 + (i % 7) * 13, seed++) });
      if (i % 2 === 0) blocks.push({ track: 2, rel: Math.round(i * 33.333) + 3, payload: randomPayload(80, seed++) });
    }
    clusters.push({ timecode: c * 2000, blocks });
  }
  return clusters;
}

function parseOutput(buf: Uint8Array) {
  const top = children(buf, 0, buf.length);
  expect(top.map((e) => e.id)).toEqual([ID.EBML, ID.Segment]);
  const segment = top[1]!;
  expect(segment.end).toBe(buf.length);
  const segChildren = children(buf, segment.dataStart, segment.end);
  return { segment, segChildren };
}

describe('remuxWebm', () => {
  it('adds Duration, a known Segment size, SeekHead and Cues while preserving every block', async () => {
    const clusters = sampleClusters();
    const input = join(dir, 'in.webm');
    const output = join(dir, 'out.webm');
    writeFileSync(input, buildLiveWebm(clusters));

    const result = await remuxWebm(input, output);
    expect(result.truncated).toBe(false);
    expect(result.clusters).toBe(3);
    expect(result.cuePoints).toBe(3);
    // Last video frame at 4000 + 59*33.333 ≈ 5967ms, plus one frame duration.
    expect(result.durationMs).toBeGreaterThan(5990);
    expect(result.durationMs).toBeLessThan(6010);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);

    const buf = new Uint8Array(readFileSync(output));
    const { segment, segChildren } = parseOutput(buf);
    const ids = segChildren.map((e) => e.id);
    expect(ids[0]).toBe(ID.SeekHead);
    expect(ids).toContain(ID.Info);
    expect(ids).toContain(ID.Tracks);
    expect(ids.filter((i) => i === ID.Cluster)).toHaveLength(3);
    expect(ids[ids.length - 1]).toBe(ID.Cues);

    const info = segChildren.find((e) => e.id === ID.Info)!;
    const duration = children(buf, info.dataStart, info.end).find((e) => e.id === ID.Duration)!;
    expect(floatOf(buf, duration)).toBeCloseTo(result.durationMs, 3);

    // SeekHead entries point at the right elements.
    const seekHead = segChildren[0]!;
    for (const seek of children(buf, seekHead.dataStart, seekHead.end)) {
      const [seekId, seekPos] = children(buf, seek.dataStart, seek.end);
      const target = readId(buf, segment.dataStart + uintOf(buf, seekPos!));
      expect(target?.id).toBe(readId(buf, seekId!.dataStart)!.id);
    }

    // Every cue points to a Cluster whose first keyframe matches the cue time.
    const cues = segChildren.find((e) => e.id === ID.Cues)!;
    const points = children(buf, cues.dataStart, cues.end);
    expect(points.map((p) => uintOf(buf, children(buf, p.dataStart, p.end)[0]!))).toEqual([0, 2000, 4000]);
    for (const point of points) {
      const positions = children(buf, point.dataStart, point.end)[1]!;
      const clusterPos = children(buf, positions.dataStart, positions.end).find((e) => e.id === ID.CueClusterPosition)!;
      expect(readId(buf, segment.dataStart + uintOf(buf, clusterPos))?.id).toBe(ID.Cluster);
    }

    // Media payload is byte-identical.
    let blockBytes = 0;
    for (const cluster of segChildren.filter((e) => e.id === ID.Cluster)) {
      for (const el of children(buf, cluster.dataStart, cluster.end)) if (el.id === ID.SimpleBlock) blockBytes += el.size - 4;
    }
    expect(blockBytes).toBe(payloadBytes(clusters));

    const header = await readWebmHeaderInfo(output);
    expect(header?.durationMs).toBeCloseTo(result.durationMs, 3);
    expect(header?.width).toBe(1920);
  });

  it('pads the SeekHead with a Void (and keeps offsets valid) when there are no keyframes to index', async () => {
    const clusters = sampleClusters().map((c) => ({ ...c, blocks: c.blocks.map((b) => ({ ...b, key: false })) }));
    const input = join(dir, 'in.webm');
    const output = join(dir, 'out.webm');
    writeFileSync(input, buildLiveWebm(clusters));
    const result = await remuxWebm(input, output);
    expect(result.cuePoints).toBe(0);
    const buf = new Uint8Array(readFileSync(output));
    const { segment, segChildren } = parseOutput(buf);
    expect(segChildren[1]!.id).toBe(ID.Void);
    expect(segChildren.some((e) => e.id === ID.Cues)).toBe(false);
    const seekHead = segChildren[0]!;
    for (const seek of children(buf, seekHead.dataStart, seekHead.end)) {
      const [seekId, seekPos] = children(buf, seek.dataStart, seek.end);
      expect(readId(buf, segment.dataStart + uintOf(buf, seekPos!))?.id).toBe(readId(buf, seekId!.dataStart)!.id);
    }
  });

  it('handles known-size clusters too', async () => {
    const input = join(dir, 'in.webm');
    writeFileSync(input, buildLiveWebm(sampleClusters(), { unknownClusterSizes: false }));
    const result = await remuxWebm(input, join(dir, 'out.webm'));
    expect(result.clusters).toBe(3);
    parseOutput(new Uint8Array(readFileSync(join(dir, 'out.webm'))));
  });

  it('recovers a file truncated mid-block (crash / disk full) up to the last complete block', async () => {
    const clusters = sampleClusters();
    const full = buildLiveWebm(clusters);
    const input = join(dir, 'in.webm');
    writeFileSync(input, full.subarray(0, full.length - 150));
    const result = await remuxWebm(input, join(dir, 'out.webm'));
    expect(result.truncated).toBe(true);
    expect(result.clusters).toBe(3);
    expect(result.durationMs).toBeGreaterThan(5000);
    const buf = new Uint8Array(readFileSync(join(dir, 'out.webm')));
    const { segChildren } = parseOutput(buf);
    let blocks = 0;
    for (const cluster of segChildren.filter((e) => e.id === ID.Cluster)) {
      blocks += children(buf, cluster.dataStart, cluster.end).filter((e) => e.id === ID.SimpleBlock).length;
    }
    const total = clusters.reduce((n, c) => n + c.blocks.length, 0);
    expect(blocks).toBeLessThan(total);
    expect(blocks).toBeGreaterThan(total - 3);
  });

  it('rejects non-WebM input and never overwrites the destination', async () => {
    const input = join(dir, 'bad.webm');
    writeFileSync(input, Buffer.from('definitely not a webm file'));
    await expect(remuxWebm(input, join(dir, 'x.webm'))).rejects.toThrow();

    const good = join(dir, 'good.webm');
    writeFileSync(good, buildLiveWebm(sampleClusters()));
    const existing = join(dir, 'existing.webm');
    writeFileSync(existing, 'keep me');
    await expect(remuxWebm(good, existing)).rejects.toThrow();
    expect(readFileSync(existing, 'utf8')).toBe('keep me');
  });
});

describe('EBML vints', () => {
  it('round-trips sizes and flags all-ones as unknown', () => {
    for (const v of [0, 1, 126, 127, 128, 16382, 16383, 2 ** 21, 2 ** 35, 2 ** 49]) {
      const enc = encodeSize(v);
      const dec = readSize(enc, 0)!;
      expect(dec.value).toBe(v);
      expect(dec.unknown).toBe(false);
      expect(dec.length).toBe(enc.length);
    }
    expect(readSize(new Uint8Array([0xff]), 0)!.unknown).toBe(true);
    expect(readSize(new Uint8Array([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), 0)!.unknown).toBe(true);
    expect(encodeSize(5, 8)).toHaveLength(8);
    expect(readSize(encodeSize(5, 8), 0)!.value).toBe(5);
  });
});
