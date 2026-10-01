import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { Result } from '@app-types';
import { backgroundImageUrl } from '@shared/backgrounds';
import { appError, describeUnknown } from '@shared/errors';

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = { '.jpg': 'jpg', '.jpeg': 'jpg', '.png': 'png', '.webp': 'webp' };

/** Magic bytes, so a renamed non-image is rejected. */
function looksLikeImage(buf: Buffer, ext: string): boolean {
  if (ext === 'jpg') return buf[0] === 0xff && buf[1] === 0xd8;
  if (ext === 'png') return buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (ext === 'webp') return buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

/** Copy a user-picked image into app data and return its background id (`custom:<hash>.<ext>`). */
export async function importBackgroundImage(sourcePath: string, backgroundsDir: string): Promise<Result<string>> {
  const ext = EXTENSIONS[extname(sourcePath).toLowerCase()];
  if (!ext) return { ok: false, error: appError('invalid-input', 'Choose a JPG, PNG or WebP image.') };
  try {
    const info = await stat(sourcePath);
    if (!info.isFile() || info.size > MAX_IMAGE_BYTES) return { ok: false, error: appError('invalid-input', 'Choose an image smaller than 15 MB.') };
    const data = await readFile(sourcePath);
    if (!looksLikeImage(data, ext)) return { ok: false, error: appError('invalid-input', 'This file is not a valid image.') };
    const name = `${createHash('sha256').update(data).digest('hex').slice(0, 32)}.${ext}`;
    await mkdir(backgroundsDir, { recursive: true });
    await writeFile(join(backgroundsDir, name), data);
    return { ok: true, value: `custom:${name}` };
  } catch (err) {
    return { ok: false, error: appError('write-failed', 'The image could not be imported.', describeUnknown(err)) };
  }
}

/** URL the renderer loads for a custom background (presets are drawn procedurally). */
export const backgroundUrl = backgroundImageUrl;
