import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppErrorInfo, CaptureSource } from '@app-types';
import { appError, describeUnknown, isAppErrorInfo } from '@shared/errors';
import { api } from '../services/api';
import { acquireCamera, acquireMicrophone, acquirePreview, stopStream } from '../services/recorder/capture';

export interface DeviceLists {
  microphones: MediaDeviceInfo[];
  cameras: MediaDeviceInfo[];
}

let cachedDevices: DeviceLists | null = null;
let enumeration: Promise<DeviceLists> | null = null;

function toLists(list: MediaDeviceInfo[]): DeviceLists {
  return {
    // Chromium lists a "communications" alias on Windows; "default" is enough.
    microphones: list.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications'),
    cameras: list.filter((d) => d.kind === 'videoinput')
  };
}

/**
 * Enumerate capture devices once and share the result. The very first
 * enumeration can take 10+ seconds on some Windows machines (cold Media
 * Foundation / audio endpoint scan), so the main window starts it at load time.
 */
export function loadMediaDevices(force = false): Promise<DeviceLists> {
  if (enumeration && !force) return enumeration;
  const run = (async () => {
    let list = await navigator.mediaDevices.enumerateDevices();
    if (list.some((d) => (d.kind === 'audioinput' || d.kind === 'videoinput') && !d.label)) {
      try {
        stopStream(await navigator.mediaDevices.getUserMedia({ audio: true }));
        list = await navigator.mediaDevices.enumerateDevices();
      } catch {
        // Labels stay generic; devices remain selectable.
      }
    }
    cachedDevices = toLists(list);
    return cachedDevices;
  })();
  enumeration = run;
  run.catch(() => {
    if (enumeration === run) enumeration = null;
  });
  return run;
}

/** Microphones and cameras, kept up to date when devices are plugged/unplugged. */
export function useMediaDevices(enabled: boolean): DeviceLists | null {
  const [devices, setDevices] = useState<DeviceLists | null>(cachedDevices);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async (force = false) => {
      try {
        const lists = await loadMediaDevices(force);
        if (alive) setDevices(lists);
      } catch {
        if (alive) setDevices({ microphones: [], cameras: [] });
      }
    };
    void load();
    const onChange = () => void load(true);
    navigator.mediaDevices.addEventListener('devicechange', onChange);
    return () => {
      alive = false;
      navigator.mediaDevices.removeEventListener('devicechange', onChange);
    };
  }, [enabled]);
  return devices;
}

export interface SourcesState {
  sources: CaptureSource[] | null;
  error: AppErrorInfo | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useCaptureSources(enabled: boolean, autoRefreshMs = 8000): SourcesState {
  const [sources, setSources] = useState<CaptureSource[] | null>(null);
  const [error, setError] = useState<AppErrorInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    try {
      const res = await api.sources.list({ thumbnailWidth: 360, includeIcons: true });
      if (res.ok) {
        setSources(res.value);
        setError(null);
      } else {
        setError(res.error);
        setSources((s) => s ?? []);
      }
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    // Process names (RDP/Citrix detection, minimised windows) arrive a moment after the first scan.
    const early = window.setTimeout(() => void refresh(), 3000);
    const t = window.setInterval(() => {
      if (document.hasFocus()) void refresh();
    }, autoRefreshMs);
    return () => {
      clearTimeout(early);
      clearInterval(t);
    };
  }, [enabled, refresh, autoRefreshMs]);

  return { sources, error, loading, refresh };
}

interface StreamState {
  stream: MediaStream | null;
  error: AppErrorInfo | null;
  loading: boolean;
}

/** Acquire a MediaStream for `key`; releases it on change/unmount and ignores stale results. */
function useMediaStream(key: string | null, acquire: (key: string) => Promise<MediaStream>, role: string): StreamState {
  const [state, setState] = useState<StreamState>({ stream: null, error: null, loading: false });
  const acquireRef = useRef(acquire);
  acquireRef.current = acquire;

  useEffect(() => {
    if (!key) {
      setState({ stream: null, error: null, loading: false });
      return;
    }
    let alive = true;
    let acquired: MediaStream | null = null;
    setState({ stream: null, error: null, loading: true });
    acquireRef
      .current(key)
      .then((stream) => {
        if (!alive) {
          stopStream(stream);
          return;
        }
        acquired = stream;
        setState({ stream, error: null, loading: false });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        const error = isAppErrorInfo(err) ? err : appError('unknown', `Could not start ${role} preview.`, describeUnknown(err));
        setState({ stream: null, error, loading: false });
      });
    return () => {
      alive = false;
      stopStream(acquired);
    };
  }, [key, role]);

  return state;
}

export function useSourcePreview(sourceId: string | null): StreamState {
  return useMediaStream(sourceId, acquirePreview, 'screen');
}

export function useCameraPreview(deviceId: string | null): StreamState {
  return useMediaStream(deviceId, acquireCamera, 'camera');
}

/** Live microphone input level (0..1) for the setup panel meter. */
export function useMicLevel(deviceId: string | null): { level: number; error: AppErrorInfo | null } {
  const { stream, error } = useMediaStream(deviceId, acquireMicrophone, 'microphone');
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!stream) {
      setLevel(0);
      return;
    }
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let raf = 0;
    let smoothed = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      const rms = Math.sqrt(sum / data.length);
      smoothed = Math.max(rms, smoothed * 0.85);
      setLevel(Math.min(1, smoothed * 4));
      raf = requestAnimationFrame(tick);
    };
    void ctx.resume();
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      void ctx.close().catch(() => undefined);
    };
  }, [stream]);
  return { level, error };
}
