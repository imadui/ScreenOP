import { constants } from 'node:fs';
import { access, copyFile, rename, rm } from 'node:fs/promises';

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Move without ever overwriting: rename on the same volume; across volumes copy to a
 * `.partial` name (not a video extension, so the library ignores it) and rename into
 * place, so an interrupted copy never looks like a finished recording.
 */
export async function moveExclusive(src: string, dest: string): Promise<void> {
  if (await exists(dest)) throw Object.assign(new Error(`Destination exists: ${dest}`), { code: 'EEXIST' });
  try {
    await rename(src, dest);
  } catch (err) {
    if ((err as { code?: string }).code !== 'EXDEV') throw err;
    const partial = `${dest}.partial`;
    await rm(partial, { force: true });
    await copyFile(src, partial, constants.COPYFILE_EXCL);
    if (await exists(dest)) {
      await rm(partial, { force: true });
      throw Object.assign(new Error(`Destination exists: ${dest}`), { code: 'EEXIST' });
    }
    await rename(partial, dest);
    await rm(src, { force: true });
  }
}
