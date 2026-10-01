/**
 * Parse a single HTTP `Range: bytes=start-end` header against a resource size.
 * Returns null when no range was requested and 'invalid' when unsatisfiable.
 */
export function parseRange(header: string | null | undefined, size: number): { start: number; end: number } | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return 'invalid';
  let start: number;
  let end: number;
  if (!m[1]) {
    const suffix = Number(m[2]);
    if (suffix === 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}
