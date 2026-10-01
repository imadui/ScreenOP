import { describe, expect, it } from 'vitest';
import {
  findAvailableFileName,
  isRecordingFileName,
  recordingBaseName,
  sanitizeFileBaseName,
  titleFromFileName
} from '../../src/shared/filenames';

describe('recordingBaseName', () => {
  it('formats local date/time as Recording_YYYY-MM-DD_HH-mm-ss', () => {
    expect(recordingBaseName(new Date(2026, 8, 30, 21, 15, 34))).toBe('Recording_2026-09-30_21-15-34');
    expect(recordingBaseName(new Date(2026, 0, 2, 3, 4, 5))).toBe('Recording_2026-01-02_03-04-05');
  });
});

describe('sanitizeFileBaseName', () => {
  it('replaces characters Windows forbids and collapses whitespace', () => {
    expect(sanitizeFileBaseName('Demo: client/VM <prod> "v2"?')).toBe('Demo client VM prod v2');
    expect(sanitizeFileBaseName('a\\b|c*d')).toBe('a b c d');
  });
  it('strips trailing dots/spaces and handles reserved device names', () => {
    expect(sanitizeFileBaseName('report...  ')).toBe('report');
    expect(sanitizeFileBaseName('..\\..\\Startup\\x')).toBe('Startup x');
    expect(sanitizeFileBaseName('.hidden')).toBe('hidden');
    expect(sanitizeFileBaseName('CON')).toBe('_CON');
    expect(sanitizeFileBaseName('lpt1')).toBe('_lpt1');
    expect(sanitizeFileBaseName('Console demo')).toBe('Console demo');
  });
  it('falls back when nothing usable remains and limits length', () => {
    expect(sanitizeFileBaseName('???')).toBe('Recording');
    expect(sanitizeFileBaseName('x'.repeat(500)).length).toBeLessThanOrEqual(120);
  });
  it('keeps accents and non-Latin scripts', () => {
    expect(sanitizeFileBaseName('Réunion équipe — démo')).toBe('Réunion équipe — démo');
    expect(sanitizeFileBaseName('عرض توضيحي')).toBe('عرض توضيحي');
  });
});

describe('findAvailableFileName', () => {
  it('appends (2), (3)… on collision, case-insensitively', () => {
    const taken = new Set(['recording.webm', 'recording (2).webm']);
    expect(findAvailableFileName('Recording', '.webm', (n) => taken.has(n.toLowerCase()))).toBe('Recording (3).webm');
    expect(findAvailableFileName('Other', '.webm', (n) => taken.has(n.toLowerCase()))).toBe('Other.webm');
  });
});

describe('isRecordingFileName / titleFromFileName', () => {
  it('accepts video files and ignores temp/hidden files', () => {
    expect(isRecordingFileName('Recording_2026-09-30_21-15-34.webm')).toBe(true);
    expect(isRecordingFileName('clip.MP4')).toBe(true);
    expect(isRecordingFileName('notes.txt')).toBe(false);
    expect(isRecordingFileName('.hidden.webm')).toBe(false);
    expect(isRecordingFileName('~$lock.webm')).toBe(false);
  });
  it('derives a readable title', () => {
    expect(titleFromFileName('Recording_2026-09-30_21-15-34.webm')).toBe('Recording 2026-09-30 21-15-34');
  });
});
