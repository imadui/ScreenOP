#!/usr/bin/env node
// Copies the MediaPipe WebAssembly runtime (camera background effects) from node_modules
// into resources/mediapipe so it ships with the app and loads without any network access.
// The selfie segmentation model (resources/mediapipe/selfie_segmenter.tflite) is committed.
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const to = join(root, 'resources', 'mediapipe');
mkdirSync(to, { recursive: true });

for (const file of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
  const src = join(from, file);
  const dest = join(to, file);
  if (!existsSync(src)) {
    console.error(`missing ${src} — run npm install`);
    process.exit(1);
  }
  if (!existsSync(dest) || statSync(dest).size !== statSync(src).size) copyFileSync(src, dest);
}
if (!existsSync(join(to, 'selfie_segmenter.tflite'))) {
  console.error('missing resources/mediapipe/selfie_segmenter.tflite (see docs/INSTALL.md)');
  process.exit(1);
}
console.log('mediapipe runtime ready in resources/mediapipe');
