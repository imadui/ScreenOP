import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppErrorInfo, AppSettings, RecorderState, RecordingEntry, StorageStatus } from '@app-types';
import { api } from '../services/api';

export function useRecorderState(): RecorderState | null {
  const [state, setState] = useState<RecorderState | null>(null);
  useEffect(() => {
    let alive = true;
    void api.recorder.getState().then((s) => alive && setState(s));
    const off = api.recorder.onState((s) => setState(s));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}

export function useStorageStatus(): [StorageStatus | null, (s: StorageStatus) => void] {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  useEffect(() => {
    let alive = true;
    void api.storage.getStatus().then((s) => alive && setStatus(s));
    const off = api.storage.onChanged((s) => setStatus(s));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return [status, setStatus];
}

export function useSettings(): [AppSettings | null, (patch: Partial<AppSettings>) => Promise<void>] {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    let alive = true;
    void api.settings.get().then((s) => alive && setSettings(s));
    const off = api.settings.onChanged((s) => setSettings(s));
    return () => {
      alive = false;
      off();
    };
  }, []);
  const update = useCallback(async (patch: Partial<AppSettings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    setSettings(await api.settings.update(patch));
  }, []);
  return [settings, update];
}

export interface LibraryState {
  entries: RecordingEntry[] | null;
  error: AppErrorInfo | null;
  refresh: () => Promise<void>;
}

/** Recording library; refreshes on change events and when the window regains focus. */
export function useLibrary(): LibraryState {
  const [entries, setEntries] = useState<RecordingEntry[] | null>(null);
  const [error, setError] = useState<AppErrorInfo | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    const res = await api.library.list();
    if (!alive.current) return;
    if (res.ok) {
      setEntries(res.value);
      setError(null);
    } else {
      setEntries((e) => e ?? []);
      setError(res.error);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const off = api.library.onChanged(() => void refresh());
    const offStorage = api.storage.onChanged(() => void refresh());
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      alive.current = false;
      off();
      offStorage();
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  return { entries, error, refresh };
}

/** Re-render on an interval (for live timers). */
export function useNow(intervalMs: number, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, enabled]);
  return now;
}
