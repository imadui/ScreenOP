import { useCallback, useEffect, useRef, useState } from 'react';
import type { TrimInfo } from '@app-types';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toasts';
import { useLibrary } from '../hooks/useAppState';
import { navigate } from '../router';
import { api } from '../services/api';
import { captureFilmstrip } from '../services/filmstrip';

const MIN_KEEP_MS = 1000;

function fmt(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/** Latest keyframe at or before `ms` (a lossless cut can only start there); 0 keeps the beginning. */
function snapToKeyframe(ms: number, keyframes: number[]): number {
  let best = 0;
  for (const k of keyframes) {
    if (k <= ms + 1) best = k;
    else break;
  }
  return best;
}

/** Loom-style trim: drag the handles, preview the kept part, save. */
export function TrimPage({ id }: { id: string }) {
  const toast = useToast();
  const { entries } = useLibrary();
  const entry = entries?.find((e) => e.id === id) ?? null;
  const [info, setInfo] = useState<TrimInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [frames, setFrames] = useState<string[]>([]);
  const [saving, setSaving] = useState<number | null>(null);
  const [released, setReleased] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<'start' | 'end' | 'playhead' | null>(null);

  useEffect(() => {
    let alive = true;
    void api.library.trimInfo(id).then((r) => {
      if (!alive) return;
      if (r.ok) setInfo(r.value);
      else setLoadError(r.error.message);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  const duration = info?.durationMs || entry?.durationMs || 0;
  const keyframes = info?.keyframesMs ?? [];
  useEffect(() => {
    if (duration > 0 && !range) setRange({ start: 0, end: duration });
  }, [duration, range]);

  useEffect(() => {
    if (!entry || duration <= 0) return;
    let alive = true;
    void captureFilmstrip(entry.mediaUrl, duration, 12, (f) => alive && setFrames(f));
    return () => {
      alive = false;
    };
  }, [entry?.mediaUrl, duration]);

  useEffect(() => api.library.onTrimProgress((p) => p.id === id && setSaving(p.fraction)), [id]);

  // Keep playback inside the selection.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !range) return;
    let raf = 0;
    const tick = () => {
      const ms = v.currentTime * 1000;
      setCurrent(ms);
      if (!v.paused && ms >= range.end) {
        v.pause();
        v.currentTime = range.start / 1000;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [range]);

  const seek = useCallback((ms: number) => {
    const v = videoRef.current;
    if (v) v.currentTime = Math.max(0, ms) / 1000;
    setCurrent(ms);
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v || !range) return;
    if (v.paused) {
      if (v.currentTime * 1000 < range.start || v.currentTime * 1000 >= range.end - 50) v.currentTime = range.start / 1000;
      void v.play();
    } else v.pause();
  }, [range]);

  const setStartAt = useCallback(
    (ms: number) => setRange((r) => (r ? { ...r, start: Math.min(snapToKeyframe(ms, keyframes), r.end - MIN_KEEP_MS) } : r)),
    [keyframes]
  );
  const setEndAt = useCallback((ms: number) => setRange((r) => (r ? { ...r, end: Math.max(Math.min(ms, duration), r.start + MIN_KEEP_MS) } : r)), [duration]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (saving !== null || (e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'i' || e.key === 'I') setStartAt(current);
      else if (e.key === 'o' || e.key === 'O') setEndAt(current);
      else if (e.key === 'Escape') navigate(`/recording/${id}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, setStartAt, setEndAt, current, saving, id]);

  const msFromPointer = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return Math.min(duration, Math.max(0, ((clientX - rect.left) / rect.width) * duration));
  };

  const onPointerDown = (e: React.PointerEvent, what: 'start' | 'end' | 'playhead') => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = what;
    if (what === 'playhead') seek(msFromPointer(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const what = dragRef.current;
    if (!what || !range) return;
    const ms = msFromPointer(e.clientX);
    if (what === 'start') {
      const start = Math.min(ms, range.end - MIN_KEEP_MS);
      setRange({ ...range, start });
      seek(start);
    } else if (what === 'end') {
      const end = Math.max(ms, range.start + MIN_KEEP_MS);
      setRange({ ...range, end });
      seek(end);
    } else seek(ms);
  };
  const onPointerUp = () => {
    // A lossless cut starts on a keyframe: snap the start handle when released.
    if (dragRef.current === 'start' && range) {
      const snapped = snapToKeyframe(range.start, keyframes);
      setRange({ ...range, start: snapped });
      seek(snapped);
    }
    dragRef.current = null;
  };

  const save = async () => {
    if (!range || !entry) return;
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.removeAttribute('src');
      v.load();
    }
    setReleased(true);
    setSaving(0);
    const r = await api.library.trim(id, range.start, range.end);
    if (r.ok) {
      toast.push({ kind: 'success', message: 'Recording trimmed.', detail: 'The original was moved to the Recycle Bin, in case you need it back.' });
      navigate(`/recording/${id}`);
    } else {
      toast.push({ kind: 'error', message: r.error.message, ...(r.error.detail ? { detail: r.error.detail } : {}) });
      setSaving(null);
      setReleased(false);
    }
  };

  if (entries && !entry) return <div className="page not-found">This recording no longer exists.</div>;
  if (!entry) return <div className="page" />;

  const pct = (ms: number) => `${duration > 0 ? (ms / duration) * 100 : 0}%`;
  const changed = !!range && (range.start > 0 || range.end < duration - 20);

  return (
    <div className="page trim-page">
      <div className="player-top">
        <button className="icon-btn" aria-label="Back" onClick={() => navigate(`/recording/${id}`)} disabled={saving !== null}>
          <Icon name="chevronLeft" size={20} />
        </button>
        <div className="player-title">
          <h1 className="ellipsis">Trim · {entry.title}</h1>
          <span className="muted" style={{ fontSize: 12.5 }}>
            Drag the yellow handles to keep only the part you want. <kbd>Space</kbd> play · <kbd>I</kbd>/<kbd>O</kbd> set start/end at the playhead
          </span>
        </div>
      </div>

      <video
        ref={videoRef}
        className="player-video trim-video"
        src={released ? undefined : entry.mediaUrl}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onClick={togglePlay}
        data-testid="trim-video"
      />

      {loadError && <div className="banner error">{loadError}</div>}
      {info && !info.supported && <div className="banner warning">{info.reason ?? 'This recording cannot be trimmed.'}</div>}

      {range && info?.supported && (
        <>
          <div
            className="trim-timeline"
            ref={trackRef}
            onPointerDown={(e) => onPointerDown(e, 'playhead')}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            data-testid="trim-timeline"
          >
            <div className="trim-strip">
              {frames.length > 0
                ? frames.map((f, i) => <img key={i} src={f} alt="" draggable={false} />)
                : Array.from({ length: 12 }, (_, i) => <div key={i} className="trim-strip-empty" />)}
            </div>
            <div className="trim-dim" style={{ left: 0, width: pct(range.start) }} />
            <div className="trim-dim" style={{ left: pct(range.end), right: 0 }} />
            <div className="trim-selection" style={{ left: pct(range.start), width: `calc(${pct(range.end)} - ${pct(range.start)})` }}>
              <div className="trim-handle start" onPointerDown={(e) => onPointerDown(e, 'start')} onPointerMove={onPointerMove} onPointerUp={onPointerUp} data-testid="trim-start" />
              <div className="trim-handle end" onPointerDown={(e) => onPointerDown(e, 'end')} onPointerMove={onPointerMove} onPointerUp={onPointerUp} data-testid="trim-end" />
            </div>
            <div className="trim-playhead" style={{ left: pct(current) }} />
          </div>

          <div className="trim-bar">
            <button className="btn" onClick={togglePlay} disabled={saving !== null}>
              <Icon name={playing ? 'pause' : 'play'} size={15} /> {playing ? 'Pause' : 'Play selection'}
            </button>
            <button className="btn btn-ghost" onClick={() => setStartAt(current)} disabled={saving !== null}>
              Set start here
            </button>
            <button className="btn btn-ghost" onClick={() => setEndAt(current)} disabled={saving !== null}>
              Set end here
            </button>
            <span className="trim-times tabular" data-testid="trim-times">
              {fmt(range.start)} → {fmt(range.end)} · keeps <strong>{fmt(range.end - range.start)}</strong> of {fmt(duration)}
            </span>
            <span className="spacer" />
            <button className="btn btn-ghost" onClick={() => setRange({ start: 0, end: duration })} disabled={!changed || saving !== null}>
              Reset
            </button>
            <button className="btn" onClick={() => navigate(`/recording/${id}`)} disabled={saving !== null}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={() => void save()} disabled={!changed || saving !== null} data-testid="trim-save">
              {saving !== null ? <span className="spinner" /> : <Icon name="scissors" size={15} />}
              {saving !== null ? `Saving… ${Math.round(saving * 100)}%` : 'Save trim'}
            </button>
          </div>
          <div className="field-hint">
            Trimming is lossless (no re-encoding). The start snaps to the nearest keyframe — at most about a second earlier. The original goes to
            the Recycle Bin.
          </div>
        </>
      )}
    </div>
  );
}
