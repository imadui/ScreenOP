import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ID, readSize } from '../../src/main/webm/ebml';
import { readWebmHeaderInfo } from '../../src/main/webm/remux';
import { planTrim, readTrimInfo, trimWebm } from '../../src/main/webm/trim';
import { buildLiveWebm, children, randomPayload, uintOf, type TestCluster } from './helpers/webm';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'oneloom-trim-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** 6 s: clusters every 2 s, keyframes every 1 s, video @30 fps + audio @20 ms. */
function clips(): TestCluster[] {
  const clusters: TestCluster[] = [];
  let seed = 7;
  for (let c = 0; c < 3; c++) {
    const blocks = [];
    for (let i = 0; i < 60; i++) {
      const rel = Math.round(i * 33.333);
      blocks.push({ track: 1, rel, key: i === 0 || i === 30, payload: randomPayload(120, seed++) });
      if (i % 2 === 0) blocks.push({ track: 2, rel: rel + 5, payload: randomPayload(40, seed++) });
    }
    clusters.push({ timecode: c * 2000, blocks });
  }
  return clusters;
}

function blocksOf(buf: Uint8Array): Array<{ track: number; ts: number; key: boolean }> {
  const top = children(buf, 0, buf.length);
  const segment = top[1]!;
  const out: Array<{ track: number; ts: number; key: boolean }> = [];
  for (const el of children(buf, segment.dataStart, segment.end)) {
    if (el.id !== ID.Cluster) continue;
    const kids = children(buf, el.dataStart, el.end);
    const tc = uintOf(buf, kids.find((k) => k.id === ID.Timecode)!);
    for (const k of kids) {
      if (k.id !== ID.SimpleBlock) continue;
      const track = readSize(buf, k.dataStart)!;
      const view = new DataView(buf.buffer, buf.byteOffset + k.dataStart + track.length, 3);
      out.push({ track: track.value, ts: tc + view.getInt16(0), key: (view.getUint8(2) & 0x80) !== 0 });
    }
  }
  return out;
}

describe('planTrim', () => {
  it('snaps the start back to the nearest keyframe and keeps the end exact', () => {
    expect(planTrim([0, 1000, 2000, 3000], 2500, 4200, 1_000_000)).toEqual({ startTicks: 2000, endTicks: 4200 });
    expect(planTrim([0, 1000, 2000], 2000, 2600, 1_000_000).startTicks).toBe(2000);
    expect(planTrim([0, 1000], 0, 500, 1_000_000).startTicks).toBe(0);
    // Video starting late (first keyframe at 729 ms): a cut at 0 keeps the beginning.
    expect(planTrim([729, 1729], 0, 2500, 1_000_000).startTicks).toBe(0);
    expect(planTrim([729, 1729], 2000, 2500, 1_000_000).startTicks).toBe(1729);
    expect(() => planTrim([0, 3000], 3500, 3000, 1_000_000)).toThrow();
  });
});

describe('trimWebm', () => {
  it('reports keyframes and duration', async () => {
    const input = join(dir, 'in.webm');
    writeFileSync(input, buildLiveWebm(clips()));
    const info = await readTrimInfo(input);
    expect(info.supported).toBe(true);
    expect(info.keyframesMs).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
    expect(info.durationMs).toBeGreaterThan(5900);
  });

  it('cuts losslessly: starts on a keyframe at t=0, ends at the requested time, stays seekable', async () => {
    const input = join(dir, 'in.webm');
    const output = join(dir, 'out.webm');
    writeFileSync(input, buildLiveWebm(clips()));
    const progress: number[] = [];
    const result = await trimWebm(input, output, 2400, 4500, (p) => progress.push(p));

    expect(result.startMs).toBe(2000); // snapped to the keyframe at 2 s
    expect(result.durationMs).toBeGreaterThan(2400);
    expect(result.durationMs).toBeLessThan(2600);
    expect(progress.at(-1)).toBe(1);

    const buf = new Uint8Array(readFileSync(output));
    const blocks = blocksOf(buf);
    const video = blocks.filter((b) => b.track === 1);
    expect(video[0]).toMatchObject({ ts: 0, key: true });
    expect(Math.max(...blocks.map((b) => b.ts))).toBeLessThan(2500);
    // 2.0–4.5 s at 30 fps ≈ 75 frames; every source frame in range is kept, untouched.
    expect(video.length).toBeGreaterThanOrEqual(74);
    expect(video.length).toBeLessThanOrEqual(76);
    expect(blocks.some((b) => b.track === 2)).toBe(true);

    const header = await readWebmHeaderInfo(output);
    expect(header?.durationMs).toBeCloseTo(result.durationMs, -1);
    const segment = children(buf, 0, buf.length)[1]!;
    expect(children(buf, segment.dataStart, segment.end).some((e) => e.id === ID.Cues)).toBe(true);
  });

  it('keeps the full selected length when the source is static (sparse frames)', async () => {
    // A static window yields a frame only now and then: here at 0 s and 3 s.
    const sparse: TestCluster[] = [
      { timecode: 0, blocks: [{ track: 1, rel: 0, key: true, payload: randomPayload(500, 1) }] },
      { timecode: 3000, blocks: [{ track: 1, rel: 0, key: true, payload: randomPayload(500, 2) }] }
    ];
    const input = join(dir, 'static.webm');
    writeFileSync(input, buildLiveWebm(sparse));
    const result = await trimWebm(input, join(dir, 'out.webm'), 0, 2500);
    expect(result.durationMs).toBe(2500); // not just up to the last frame (≈0 s)
    expect((await readWebmHeaderInfo(join(dir, 'out.webm')))?.durationMs).toBeCloseTo(2500, -1);
  });

  it('refuses an empty selection and leaves no temp files', async () => {
    const input = join(dir, 'in.webm');
    writeFileSync(input, buildLiveWebm(clips()));
    await expect(trimWebm(input, join(dir, 'out.webm'), 5000, 4000)).rejects.toThrow();
    expect(() => readFileSync(join(dir, 'out.webm.live'))).toThrow();
  });
});

describe('trimWebm on an already-finalised static recording', () => {
  it('uses the stored Duration (not the last frame) as the end of the media', async () => {
    const { remuxWebm } = await import('../../src/main/webm/remux');
    const sparse: TestCluster[] = [{ timecode: 0, blocks: [{ track: 1, rel: 0, key: true, payload: randomPayload(500, 3) }] }];
    const raw = join(dir, 'raw.webm');
    writeFileSync(raw, buildLiveWebm(sparse));
    const finalised = join(dir, 'final.webm');
    await remuxWebm(raw, finalised, { minDurationMs: 4000 }); // recorded 4 s of a static window
    expect((await readTrimInfo(finalised)).durationMs).toBe(4000);
    const result = await trimWebm(finalised, join(dir, 'trimmed.webm'), 0, 2600);
    expect(result.durationMs).toBe(2600);
  });
});
