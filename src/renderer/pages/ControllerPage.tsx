import { useEffect, useState } from 'react';
import { elapsedFrom, formatDuration } from '@shared/format';
import { Icon } from '../components/Icon';
import { useNow, useRecorderState } from '../hooks/useAppState';
import { api } from '../services/api';

/** Floating pill shown while recording (its window is excluded from capture). */
export function ControllerPage() {
  const state = useRecorderState();
  const active = state?.phase === 'recording' || state?.phase === 'paused';
  const now = useNow(250, active);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // The controller window is reused between recordings: reset transient UI state.
  useEffect(() => {
    if (!active) setConfirmDiscard(false);
  }, [active]);

  useEffect(() => {
    if (!confirmDiscard) return;
    const t = window.setTimeout(() => setConfirmDiscard(false), 3500);
    return () => clearTimeout(t);
  }, [confirmDiscard]);

  if (!state) return null;
  const elapsed = elapsedFrom(state.elapsedMs, state.runningSince, now);
  const paused = state.phase === 'paused';
  const saving = state.phase === 'stopping' || state.phase === 'finalizing';
  const pending = state.phase === 'preparing' || state.phase === 'countdown';

  return (
    <div className="controller-root">
      <div className="pill" role="toolbar" aria-label="Recording controls">
        <span className="grip">
          <Icon name="grip" size={14} />
        </span>
        <div className="status">
          {saving || pending ? <span className="spinner" style={{ width: 14, height: 14 }} /> : <span className={`live-dot${paused ? ' paused' : ''}`} />}
          {saving ? (
            <span className="label">Saving…</span>
          ) : pending ? (
            <span className="label">{state.countdownValue ? `Starting in ${state.countdownValue}…` : 'Starting…'}</span>
          ) : (
            <>
              <span className="time" data-testid="controller-time">
                {formatDuration(elapsed)}
              </span>
              {paused && <span className="label">Paused</span>}
            </>
          )}
        </div>
        <span className="spacer" />
        {active && (
          <>
            <button
              className="pill-btn"
              title={paused ? 'Resume (Ctrl+Shift+P)' : 'Pause (Ctrl+Shift+P)'}
              aria-label={paused ? 'Resume' : 'Pause'}
              onClick={() => void (paused ? api.recorder.resume() : api.recorder.pause())}
            >
              <Icon name={paused ? 'play' : 'pause'} size={18} />
            </button>
            <button
              className={`pill-btn${state.micAvailable && state.micMuted ? ' off' : ''}`}
              disabled={!state.micAvailable}
              title={!state.micAvailable ? 'No microphone' : state.micMuted ? 'Unmute microphone' : 'Mute microphone'}
              aria-label="Toggle microphone"
              onClick={() => void api.recorder.setMicMuted(!state.micMuted)}
            >
              <Icon name={state.micMuted || !state.micAvailable ? 'micOff' : 'mic'} size={18} />
            </button>
            <button
              className={`pill-btn${state.cameraAvailable && !state.cameraVisible ? ' off' : ''}`}
              disabled={!state.cameraAvailable}
              title={!state.cameraAvailable ? 'No camera' : state.cameraVisible ? 'Hide camera' : 'Show camera'}
              aria-label="Toggle camera"
              onClick={() => void api.recorder.setCameraVisible(!state.cameraVisible)}
            >
              <Icon name={state.cameraVisible ? 'camera' : 'cameraOff'} size={18} />
            </button>
            {state.cameraAvailable && state.cameraVisible && (
              <>
                <button className="pill-btn small" title="Smaller camera" aria-label="Smaller camera" onClick={() => void api.camera.stepBubble(-1)}>
                  <Icon name="minus" size={15} strokeWidth={2.4} />
                </button>
                <button className="pill-btn small" title="Bigger camera" aria-label="Bigger camera" onClick={() => void api.camera.stepBubble(1)}>
                  <Icon name="plus" size={15} strokeWidth={2.4} />
                </button>
              </>
            )}
            <span className="sep" />
            {confirmDiscard ? (
              <button className="pill-btn confirm" onClick={() => void api.recorder.discard()}>
                Discard?
              </button>
            ) : (
              <button className="pill-btn" title="Discard recording" aria-label="Discard recording" onClick={() => setConfirmDiscard(true)}>
                <Icon name="trash" size={17} />
              </button>
            )}
          </>
        )}
        <button
          className="pill-btn stop"
          title={pending ? 'Cancel' : 'Stop and save (Ctrl+Shift+S)'}
          aria-label={pending ? 'Cancel' : 'Stop recording'}
          disabled={saving}
          onClick={() => void api.recorder.stop()}
          data-testid="controller-stop"
        >
          <Icon name={pending ? 'x' : 'stop'} size={pending ? 18 : 16} />
        </button>
      </div>
    </div>
  );
}
