import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Write via a temp file + rename so a crash never leaves a half-written JSON file. */
export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmp, file);
}

/** Serialises async writes so concurrent saves cannot interleave. */
export class WriteQueue {
  private chain: Promise<void> = Promise.resolve();

  run(task: () => Promise<void>): Promise<void> {
    const next = this.chain.then(task, task);
    this.chain = next.catch(() => undefined);
    return next;
  }
}
