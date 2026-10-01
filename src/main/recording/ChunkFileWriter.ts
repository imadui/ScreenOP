import { open, type FileHandle } from 'node:fs/promises';
import type { AppErrorInfo } from '@app-types';
import { fileSystemError } from '@shared/errors';

/**
 * Appends MediaRecorder chunks to a file strictly in sequence order.
 * Chunks may arrive out of order over IPC; they are buffered until their turn.
 * After the first write error every further write fails fast with the same error.
 */
export class ChunkFileWriter {
  private nextSeq = 0;
  private readonly waiting = new Map<number, { data: Uint8Array; resolve: () => void; reject: (e: AppErrorInfo) => void }>();
  private chain: Promise<void> = Promise.resolve();
  private failure: AppErrorInfo | null = null;
  private closed = false;
  bytesWritten = 0;
  chunksWritten = 0;

  private constructor(
    private readonly fh: FileHandle,
    readonly path: string
  ) {}

  static async create(path: string): Promise<ChunkFileWriter> {
    // 'wx' = fail if the file exists, never clobber another session.
    return new ChunkFileWriter(await open(path, 'wx'), path);
  }

  get error(): AppErrorInfo | null {
    return this.failure;
  }

  write(seq: number, data: Uint8Array): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed) return Promise.reject(fileSystemError(new Error('writer closed'), 'write'));
    if (!Number.isInteger(seq) || seq < this.nextSeq || this.waiting.has(seq)) {
      return Promise.reject(fileSystemError(new Error(`unexpected chunk sequence ${seq}`), 'write'));
    }
    return new Promise<void>((resolve, reject) => {
      this.waiting.set(seq, { data, resolve, reject });
      this.drain();
    });
  }

  private drain(): void {
    let item = this.waiting.get(this.nextSeq);
    while (item) {
      const current = item;
      this.waiting.delete(this.nextSeq);
      this.nextSeq++;
      this.chain = this.chain.then(async () => {
        if (this.failure) {
          current.reject(this.failure);
          return;
        }
        try {
          let off = 0;
          while (off < current.data.length) {
            const { bytesWritten } = await this.fh.write(current.data, off, current.data.length - off);
            off += bytesWritten;
          }
          this.bytesWritten += current.data.length;
          this.chunksWritten++;
          current.resolve();
        } catch (err) {
          this.failure = fileSystemError(err, 'Writing recording chunk');
          current.reject(this.failure);
        }
      });
      item = this.waiting.get(this.nextSeq);
    }
  }

  /** Flush pending writes and close. Chunks still missing earlier sequence numbers are dropped. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.chain;
    for (const [, w] of this.waiting) w.reject(fileSystemError(new Error('writer closed before chunk sequence completed'), 'write'));
    this.waiting.clear();
    try {
      await this.fh.sync();
    } catch {
      // Best effort.
    }
    await this.fh.close().catch(() => undefined);
  }
}
