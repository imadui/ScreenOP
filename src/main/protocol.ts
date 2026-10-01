import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { protocol } from 'electron';
import { isRecordingFileName } from '@shared/filenames';
import { parseRange } from '@shared/http-range';
import { log } from './logger';

export const MEDIA_SCHEME = 'oneloom-media';

const CONTENT_TYPES: Record<string, string> = {
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.tflite': 'application/octet-stream'
};

/** Files the camera-effects runtime may load (WebAssembly segmentation, all local). */
const ASSET_FILES = new Set(['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'selfie_segmenter.tflite']);

/** Must run before `app.ready`. `stream: true` lets <video> use range requests. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
  ]);
}

export interface MediaLocations {
  recordingsDir(): string | null;
  thumbnailsDir: string;
  /** Bundled segmentation runtime + model. */
  assetsDir: string;
  /** Custom camera backgrounds copied into app data. */
  backgroundsDir: string;
}

/**
 * Serves finished recordings and thumbnails to the renderer via
 * `oneloom-media://recording/<file>` and `oneloom-media://thumbnail/<id>.jpg`.
 * Only bare file names inside those two folders are resolvable (no traversal).
 */
export function handleMediaProtocol(locations: MediaLocations): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const rawPath = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
      // The assets host has exactly one fixed folder segment: assets/mediapipe/<file>.
      const name = url.hostname === 'assets' && rawPath.startsWith('mediapipe/') ? rawPath.slice('mediapipe/'.length) : rawPath;
      if (!name || name !== basename(name) || name.includes('..') || /[\\/:]/.test(name)) return new Response(null, { status: 400 });

      let file: string;
      if (url.hostname === 'recording') {
        const dir = locations.recordingsDir();
        if (!dir || !isRecordingFileName(name)) return new Response(null, { status: 404 });
        file = join(dir, name);
      } else if (url.hostname === 'thumbnail') {
        if (!/^[a-f0-9-]{8,64}\.jpg$/i.test(name)) return new Response(null, { status: 404 });
        file = join(locations.thumbnailsDir, name);
      } else if (url.hostname === 'assets') {
        if (!rawPath.startsWith('mediapipe/') || !ASSET_FILES.has(name)) return new Response(null, { status: 404 });
        file = join(locations.assetsDir, name);
      } else if (url.hostname === 'background') {
        if (!/^[a-f0-9]{16,64}\.(jpg|png|webp)$/i.test(name)) return new Response(null, { status: 404 });
        file = join(locations.backgroundsDir, name);
      } else {
        return new Response(null, { status: 404 });
      }

      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) return new Response(null, { status: 404 });
      const size = info.size;
      const headers = new Headers({
        'Content-Type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
        // OneLoom's own pages (file:// or the dev server) fetch the WebAssembly runtime cross-origin.
        'Access-Control-Allow-Origin': '*'
      });

      const range = parseRange(request.headers.get('range'), size);
      if (range === 'invalid') {
        headers.set('Content-Range', `bytes */${size}`);
        return new Response(null, { status: 416, headers });
      }
      if (size === 0) {
        headers.set('Content-Length', '0');
        return new Response(null, { status: 200, headers });
      }
      const start = range?.start ?? 0;
      const end = range?.end ?? size - 1;
      headers.set('Content-Length', String(end - start + 1));
      if (range) headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
      const body = Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream<Uint8Array>;
      return new Response(body, { status: range ? 206 : 200, headers });
    } catch (err) {
      log.warn('media protocol error', request.url, err);
      return new Response(null, { status: 500 });
    }
  });
}
