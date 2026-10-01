import { useEffect, useRef } from 'react';
import type { RecordingEntry } from '@app-types';
import { api, logToMain } from '../services/api';
import { captureVideoFileThumbnail } from '../services/recorder/thumbnail';

/**
 * Generates thumbnails (one at a time, in the background) for recordings that
 * have none — e.g. videos copied into the folder by hand.
 */
export function useThumbnailBackfill(entries: RecordingEntry[] | null): void {
  const attempted = useRef(new Set<string>());
  const running = useRef(false);

  useEffect(() => {
    if (!entries || running.current) return;
    const queue = entries.filter((e) => !e.thumbnailUrl && !attempted.current.has(e.id) && e.sizeBytes > 0).slice(0, 12);
    if (queue.length === 0) return;
    running.current = true;
    let cancelled = false;
    void (async () => {
      for (const entry of queue) {
        if (cancelled) break;
        attempted.current.add(entry.id);
        const jpeg = await captureVideoFileThumbnail(entry.mediaUrl);
        if (jpeg && !cancelled) {
          const res = await api.library.saveThumbnail(entry.id, jpeg);
          if (!res.ok) logToMain('warn', `thumbnail save failed for ${entry.fileName}: ${res.error.message}`);
        }
      }
      running.current = false;
    })();
    return () => {
      cancelled = true;
      running.current = false;
    };
  }, [entries]);
}
