import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { format } from 'node:util';

type Level = 'debug' | 'info' | 'warn' | 'error';

const MAX_LOG_BYTES = 5 * 1024 * 1024;

/** Small file logger: one rotating file in `<userData>/logs`, mirrored to the console. */
class Logger {
  private stream: WriteStream | null = null;
  private filePath = '';

  init(logDir: string): void {
    mkdirSync(logDir, { recursive: true });
    this.filePath = join(logDir, 'oneloom.log');
    try {
      if (existsSync(this.filePath) && statSync(this.filePath).size > MAX_LOG_BYTES) {
        renameSync(this.filePath, join(logDir, 'oneloom.old.log'));
      }
    } catch {
      // Rotation is best effort.
    }
    this.stream = createWriteStream(this.filePath, { flags: 'a' });
    this.stream.on('error', () => {
      this.stream = null;
    });
  }

  get file(): string {
    return this.filePath;
  }

  debug(...args: unknown[]): void {
    this.write('debug', args);
  }
  info(...args: unknown[]): void {
    this.write('info', args);
  }
  warn(...args: unknown[]): void {
    this.write('warn', args);
  }
  error(...args: unknown[]): void {
    this.write('error', args);
  }

  private write(level: Level, args: unknown[]): void {
    const line = `${new Date().toISOString()} [${level}] ${format(...args)}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
    this.stream?.write(`${line}\n`);
  }
}

export const log = new Logger();
