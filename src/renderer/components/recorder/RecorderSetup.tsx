import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppSettings, BubbleStatus, CameraBackground, CaptureSource, RecordingOptions } from '@app-types';
import { BUBBLE_PRESET, nearestPreset } from '@shared/camera-layout';
import { useRecorderState, useSettings, useStorageStatus } from '../../hooks/useAppState';
import { useCaptureSources, useMediaDevices, useMicLevel, useSourcePreview } from '../../hooks/useMedia';
import { navigate } from '../../router';
import { api } from '../../services/api';
import { Icon } from '../Icon';
import { useEscape } from '../Modal';
import { useToast } from '../Toasts';
import { Segmented, Toggle } from '../Toggle';
import { categoryIcon, SourcePicker } from './SourcePicker';
import { SourcePreview } from './SourcePreview';

const CATEGORY_LABEL = { screen: 'Entire screen', window: 'Application window', browser: 'Browser window', remote: 'Remote session / VM' } as const;

function resolveDevice(pref: string | null, list: MediaDeviceInfo[]): string | null {
  if (pref === 'none') return null;
  if (pref && list.some((d) => d.deviceId === pref)) return pref;
  return list.find((d) => d.deviceId === 'default')?.deviceId ?? list[0]?.deviceId ?? null;
}

function deviceLabel(d: MediaDeviceInfo, index: number, kind: string): string {
  return d.label || `${kind} ${index + 1}`;
}

/** "New recording" panel: source, camera bubble, microphone, system audio, then 3-2-1. */
export function RecorderSetup({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [settings, updateSettings] = useSettings();
  const [storage] = useStorageStatus();
  const recorder = useRecorderState();
  const [starting, setStarting] = useState(false);
  const started = useRef(false);
  const live = !starting;

  const { sources, error: sourcesError, loading, refresh } = useCaptureSources(live);
  const devices = useMediaDevices(true);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const source: CaptureSource | null = sources?.find((s) => s.id === sourceId) ?? null;

  useEffect(() => {
    if (!sources?.length) return;
    if (!sourceId || !sources.some((s) => s.id === sourceId)) {
      const fallback = sources.find((s) => s.display?.primary) ?? sources[0]!;
      if (sourceId) toast.push({ kind: 'warning', message: 'The selected window is no longer available.' });
      setSourceId(fallback.id);
    }
  }, [sources, sourceId, toast]);

  // Until devices are enumerated, assume the remembered (or default) microphone.
  const micId = !settings
    ? null
    : devices
      ? resolveDevice(settings.lastMicrophoneId, devices.microphones)
      : settings.lastMicrophoneId === 'none'
        ? null
        : (settings.lastMicrophoneId ?? 'default');
  const cameraOn = !!settings?.cameraEnabled && !!devices && devices.cameras.length > 0;
  const cameraId = cameraOn && settings && devices ? resolveDevice(settings.lastCameraId === 'none' ? null : settings.lastCameraId, devices.cameras) : null;

  // The Loom-style bubble lives on screen while the recorder is open with the camera on.
  const [bubbleStatus, setBubbleStatus] = useState<BubbleStatus | null>(null);
  useEffect(() => api.camera.onBubbleStatus(setBubbleStatus), []);
  useEffect(() => {
    if (cameraId && !starting) void api.camera.openBubble(cameraId);
    else if (!cameraId && !starting) void api.camera.closeBubble();
  }, [cameraId, starting]);
  useEffect(
    () => () => {
      if (!started.current) void api.camera.closeBubble();
    },
    []
  );

  const [restoringId, setRestoringId] = useState<string | null>(null);
  const selectSource = async (s: CaptureSource) => {
    setSourceId(s.id);
    if (!s.minimized) return;
    // Minimised windows can't be captured: restore it (RDP/Citrix sessions are often minimised).
    setRestoringId(s.id);
    const r = await api.sources.restore(s.id);
    if (!r.ok) toast.push({ kind: 'warning', message: r.error.message });
    await refresh();
    setRestoringId(null);
  };

  const preview = useSourcePreview(live && source && !source.minimized ? source.id : null);
  const mic = useMicLevel(live && micId ? micId : null);

  const busy = !!recorder && recorder.phase !== 'idle';
  const canStart = !!source && !source.minimized && !restoringId && !!settings && !starting && !busy && !!storage?.ok;

  const close = useCallback(() => {
    if (!starting) onClose();
  }, [starting, onClose]);
  useEscape(close);

  const start = async () => {
    if (!source || !settings) return;
    setStarting(true);
    const options: RecordingOptions = {
      source: {
        id: source.id,
        kind: source.kind,
        category: source.category,
        name: source.name,
        displayName: source.displayName,
        ...(source.display ? { displayId: source.display.id, width: source.display.width, height: source.display.height } : {})
      },
      microphoneDeviceId: micId,
      ...(micId ? { microphoneLabel: devices?.microphones.find((d) => d.deviceId === micId)?.label ?? '' } : {}),
      cameraDeviceId: cameraId,
      ...(cameraId ? { cameraLabel: devices?.cameras.find((d) => d.deviceId === cameraId)?.label ?? '' } : {}),
      cameraLayout: settings.cameraLayout,
      systemAudio: settings.systemAudio,
      quality: settings.quality,
      countdown: settings.countdown
    };
    started.current = true;
    const res = await api.recorder.start(options);
    if (!res.ok) {
      started.current = false;
      toast.push({ kind: 'error', message: res.error.message, ...(res.error.detail ? { detail: res.error.detail } : {}) });
      setStarting(false);
      return;
    }
    onClose();
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="setup" role="dialog" aria-modal="true" aria-label="New recording">
        <div className="setup-header">
          <h2>New recording</h2>
          <button className="icon-btn" aria-label="Close" onClick={close} disabled={starting}>
            <Icon name="x" />
          </button>
        </div>

        <div className="setup-main">
          <SourcePreview source={source} stream={preview.stream} loading={preview.loading || starting} error={preview.error?.message ?? null} />
          <SourcePicker
            sources={sources}
            selectedId={sourceId}
            onSelect={(s) => void selectSource(s)}
            restoringId={restoringId}
            loading={loading}
            onRefresh={() => void refresh()}
            error={sourcesError?.message ?? null}
          />
        </div>

        <aside className="setup-side">
          <section className="side-section">
            <div className="field-label">Recording</div>
            <div className="selected-source">
              <div className="ss-icon">
                <Icon name={categoryIcon(source?.category ?? 'screen')} size={17} />
              </div>
              <div className="ss-text">
                <span className="ss-name ellipsis">{source?.displayName ?? 'Choose a source'}</span>
                <span className="ss-kind ellipsis">
                  {!source
                    ? 'Screen or window'
                    : source.display
                      ? `${source.display.width}×${source.display.height}${source.display.primary ? ' · primary display' : ''}`
                      : (source.appName ?? CATEGORY_LABEL[source.category])}
                </span>
              </div>
            </div>
          </section>

          {settings && (
            <>
              <section className="side-section">
                <div className="side-title">
                  <Icon name="camera" size={17} />
                  Camera
                  <Toggle
                    checked={cameraOn}
                    label="Camera"
                    disabled={!devices || devices.cameras.length === 0}
                    onChange={(v) => void updateSettings({ cameraEnabled: v })}
                  />
                </div>
                {!devices && (
                  <div className="field-hint row">
                    <span className="spinner" style={{ width: 12, height: 12 }} /> Detecting cameras and microphones…
                  </div>
                )}
                {devices && devices.cameras.length === 0 && <div className="field-hint">No camera detected.</div>}
                {cameraOn && devices && (
                  <CameraOptions settings={settings} cameras={devices.cameras} cameraId={cameraId} status={bubbleStatus} onChange={updateSettings} />
                )}
              </section>

              <section className="side-section">
                <div className="side-title">
                  <Icon name={micId ? 'mic' : 'micOff'} size={17} />
                  Microphone
                </div>
                <select
                  className="select"
                  aria-label="Microphone"
                  value={micId ?? 'none'}
                  onChange={(e) => void updateSettings({ lastMicrophoneId: e.target.value })}
                >
                  <option value="none">No microphone</option>
                  {!devices && micId && <option value={micId}>{micId === 'default' ? 'Default microphone' : 'Last used microphone'}</option>}
                  {devices?.microphones.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {deviceLabel(d, i, 'Microphone')}
                    </option>
                  ))}
                </select>
                {micId && (
                  <div className="level-meter" aria-label="Microphone level">
                    <div style={{ width: `${Math.round(mic.level * 100)}%` }} />
                  </div>
                )}
                {mic.error && <div className="warning-item error-item">{mic.error.message}</div>}
              </section>

              <section className="side-section">
                <div className="side-title">
                  <Icon name={settings.systemAudio ? 'volume' : 'volumeOff'} size={17} />
                  System audio
                  <Toggle checked={settings.systemAudio} label="System audio" onChange={(v) => void updateSettings({ systemAudio: v })} />
                </div>
                <div className="field-hint">Everything played on this PC — including audio redirected from Remote Desktop.</div>
              </section>

              <section className="side-section">
                <div className="option-row">
                  <span className="field-label">Quality</span>
                  <Segmented
                    label="Quality"
                    value={settings.quality}
                    options={[
                      { value: 'standard', label: '1080p' },
                      { value: 'high', label: 'Up to 4K' }
                    ]}
                    onChange={(v) => void updateSettings({ quality: v })}
                  />
                </div>
                <div className="option-row">
                  <span className="field-label">Countdown</span>
                  <Toggle checked={settings.countdown} label="3-2-1 countdown" onChange={(v) => void updateSettings({ countdown: v })} />
                </div>
              </section>
            </>
          )}

          <div className="start-area">
            {storage && !storage.ok && (
              <div className="warning-item error-item">
                <Icon name="alert" size={14} />
                <span>{storage.error?.message ?? 'The recordings folder is unavailable.'}</span>
              </div>
            )}
            {source?.kind === 'window' && (source.minimized || source.previewUnavailable) && (
              <div className="warning-item">
                <Icon name="alert" size={14} />
                <span>
                  {restoringId
                    ? 'Restoring the window…'
                    : source.minimized
                      ? 'This window is minimised. Click it again to restore it, or restore it from the taskbar.'
                      : 'This window shows no preview. Keep it open (not minimised) while recording.'}
                </span>
              </div>
            )}
            <button className="btn btn-record btn-lg btn-block" disabled={!canStart} onClick={() => void start()} data-testid="start-recording">
              {starting ? <span className="spinner" /> : <span className="record-dot" />}
              {starting ? 'Starting…' : 'Start recording'}
            </button>
            <div className="start-hint">
              <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> pause · <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> stop
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

const QUICK_BACKGROUNDS: Array<{ value: CameraBackground; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'blur-light', label: 'Blur' },
  { value: 'blur-strong', label: 'Strong blur' },
  { value: 'image', label: 'Image' }
];

function CameraOptions({
  settings,
  cameras,
  cameraId,
  status,
  onChange
}: {
  settings: AppSettings;
  cameras: MediaDeviceInfo[];
  cameraId: string | null;
  status: BubbleStatus | null;
  onChange: (patch: Partial<AppSettings>) => Promise<void>;
}) {
  const cam = settings.camera;
  const setBackground = (background: CameraBackground) =>
    void onChange({
      camera: { ...cam, background, backgroundImage: background === 'image' ? (cam.backgroundImage ?? 'preset:aurora') : cam.backgroundImage }
    });
  return (
    <>
      <select className="select" aria-label="Camera" value={cameraId ?? ''} onChange={(e) => void onChange({ lastCameraId: e.target.value })}>
        {cameras.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {deviceLabel(d, i, 'Camera')}
          </option>
        ))}
      </select>
      <div className="option-row">
        <span className="field-label">Position</span>
        <div className="segmented" role="group" aria-label="Camera position">
          <button type="button" onClick={() => void api.camera.placeBubble('bottom-left')}>
            ↙ Left
          </button>
          <button type="button" onClick={() => void api.camera.placeBubble('bottom-right')}>
            Right ↘
          </button>
        </div>
      </div>
      <div className="option-row">
        <span className="field-label">Size</span>
        <Segmented
          label="Camera size"
          value={nearestPreset(cam.bubbleDiameter)}
          options={[
            { value: 'small', label: 'S' },
            { value: 'medium', label: 'M' },
            { value: 'large', label: 'L' }
          ]}
          onChange={(size) => void api.camera.setBubbleSize(BUBBLE_PRESET[size])}
        />
        <Segmented
          label="Camera shape"
          value={settings.cameraLayout.shape}
          options={[
            { value: 'circle', label: 'Circle' },
            { value: 'rounded', label: 'Rounded' }
          ]}
          onChange={(shape) => void onChange({ cameraLayout: { ...settings.cameraLayout, shape } })}
        />
      </div>
      <div className="option-row">
        <span className="field-label">Background</span>
        <select className="select" style={{ flex: 1, width: 'auto' }} aria-label="Camera background" value={cam.background} onChange={(e) => setBackground(e.target.value as CameraBackground)}>
          {QUICK_BACKGROUNDS.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
      </div>
      {status?.camera === 'error' && <div className="warning-item error-item">{status.message ?? 'The camera could not start.'}</div>}
      {status?.effects === 'unavailable' && cam.background !== 'none' && (
        <div className="warning-item">Background effects are unavailable on this PC (no WebGL/WebAssembly); the camera is shown without them.</div>
      )}
      <div className="field-hint">
        Your camera bubble is on screen: drag it anywhere, hover it to resize. <button className="link-btn" onClick={() => navigate('/settings')}>Camera settings…</button>
      </div>
    </>
  );
}
