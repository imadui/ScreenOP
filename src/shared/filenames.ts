/** Pure helpers for recording file names (no Node/DOM dependencies, unit-tested). */

export const RECORDING_EXTENSIONS = ['.webm', '.mp4', '.mkv'] as const;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `Recording_2026-09-30_21-15-34` for a local date/time. */
export function recordingBaseName(date: Date): string {
  const d = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  const t = `${pad2(date.getHours())}-${pad2(date.getMinutes())}-${pad2(date.getSeconds())}`;
  return `Recording_${d}_${t}`;
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;
// eslint-disable-next-line no-control-regex
const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;
const MAX_BASENAME_LENGTH = 120;

/**
 * Convert a user-provided title into a safe Windows file base name (without extension).
 * Returns `fallback` when nothing usable remains.
 */
export function sanitizeFileBaseName(title: string, fallback = 'Recording'): string {
  let name = title.normalize('NFC').replace(INVALID_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (name.length > MAX_BASENAME_LENGTH) name = name.slice(0, MAX_BASENAME_LENGTH).trim();
  // Windows silently strips trailing dots and spaces, which would break collision checks;
  // leading dots would make the file look hidden (and the library skips such names).
  name = name.replace(/[. ]+$/g, '').replace(/^[. ]+/, '');
  if (!name) return fallback;
  if (WINDOWS_RESERVED.test(name) || WINDOWS_RESERVED.test(name.split('.')[0] ?? '')) name = `_${name}`;
  return name;
}

export function extensionOf(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx > 0 ? fileName.slice(idx).toLowerCase() : '';
}

export function stripExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx > 0 ? fileName.slice(0, idx) : fileName;
}

export function isRecordingFileName(fileName: string): boolean {
  if (fileName.startsWith('.') || fileName.startsWith('~$')) return false;
  return (RECORDING_EXTENSIONS as readonly string[]).includes(extensionOf(fileName));
}

/** Human title for a file that has no stored metadata. */
export function titleFromFileName(fileName: string): string {
  return stripExtension(fileName).replace(/_/g, ' ').trim() || fileName;
}

/**
 * Pick `base + ext`, or `base (2) + ext`, `base (3) + ext`… — whichever is not taken.
 * `isTaken` must compare case-insensitively (NTFS semantics).
 */
export function findAvailableFileName(base: string, ext: string, isTaken: (fileName: string) => boolean, maxAttempts = 9999): string {
  for (let n = 1; n <= maxAttempts; n++) {
    const candidate = n === 1 ? `${base}${ext}` : `${base} (${n})${ext}`;
    if (!isTaken(candidate)) return candidate;
  }
  throw new Error(`No available file name for ${base}${ext}`);
}
