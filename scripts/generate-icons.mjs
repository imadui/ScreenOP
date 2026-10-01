#!/usr/bin/env node
// Renders the OneLoom icon set with no image dependencies: shapes are rasterised
// analytically (4×4 supersampling) and encoded as PNG / multi-size ICO.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function roundedRectInside(x, y, s, r) {
  const cx = Math.min(Math.max(x, r), s - r);
  const cy = Math.min(Math.max(y, r), s - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= 0 && y >= 0 && x <= s && y <= s;
}

/** Colour of one sub-sample for the given variant (coordinates in 0..1). */
function sample(variant, u, v) {
  const d = Math.hypot(u - 0.5, v - 0.5);
  if (variant === 'app') {
    if (!roundedRectInside(u, v, 1, 0.26)) return null;
    let c = mix(hex('#7468ff'), hex('#4a3fd8'), (u + v) / 2);
    if (d >= 0.215 && d <= 0.295) c = hex('#ffffff');
    if (d <= 0.115) c = hex('#ff6168');
    return c;
  }
  // Tray: filled disc, white ring, coloured centre — legible at 16 px on light or dark taskbars.
  const base = variant === 'tray-recording' ? hex('#e5484d') : hex('#5b4ff0');
  if (d > 0.48) return null;
  let c = base;
  if (d >= 0.24 && d <= 0.34) c = hex('#ffffff');
  if (d <= 0.14) c = variant === 'tray-recording' ? hex('#ffffff') : hex('#ff6b70');
  return c;
}

function render(variant, size) {
  const ss = 4;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = sample(variant, (x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a++;
        }
      }
      const i = (y * size + x) * 4;
      if (a > 0) {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
      }
      out[i + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return encodePng(size, out);
}

function encodeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

function write(rel, data) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  console.log(`wrote ${rel} (${data.length} bytes)`);
}

const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
write('build/icon.ico', encodeIco(icoSizes.map((size) => ({ size, data: render('app', size) }))));
write('build/icon.png', render('app', 512));
write('resources/icon.png', render('app', 256));
write('resources/tray.png', render('tray', 16));
write('resources/tray@2x.png', render('tray', 32));
write('resources/tray-recording.png', render('tray-recording', 16));
write('resources/tray-recording@2x.png', render('tray-recording', 32));
