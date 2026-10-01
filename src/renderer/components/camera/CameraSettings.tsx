import { useState } from 'react';
import type { AppSettings, CameraBackground } from '@app-types';
import { BACKGROUND_PRESETS, backgroundImageUrl } from '@shared/backgrounds';
import { useCameraPreview, useMediaDevices } from '../../hooks/useMedia';
import type { EffectsState } from '../../services/camera/effects';
import { api } from '../../services/api';
import { Icon } from '../Icon';
import { useToast } from '../Toasts';
import { Toggle } from '../Toggle';
import { EffectsCanvas } from './EffectsCanvas';

interface Tile {
  key: string;
  label: string;
  background: CameraBackground;
  image: string | null;
  style: React.CSSProperties;
  icon?: 'x' | 'sparkle';
}

/** Settings → Camera: device, mirror, background blur / built-in / custom image, live preview. */
export function CameraSettings({ settings, onUpdate }: { settings: AppSettings; onUpdate: (patch: Partial<AppSettings>) => Promise<void> }) {
  const toast = useToast();
  const devices = useMediaDevices(true);
  const cam = settings.camera;
  const cameraId =
    devices && devices.cameras.length
      ? (devices.cameras.find((d) => d.deviceId === settings.lastCameraId)?.deviceId ?? devices.cameras[0]!.deviceId)
      : null;
  const { stream, error } = useCameraPreview(cameraId);
  const [effects, setEffects] = useState<EffectsState>('off');

  const custom = backgroundImageUrl(cam.backgroundImage);
  const tiles: Tile[] = [
    { key: 'none', label: 'None', background: 'none', image: null, style: {}, icon: 'x' },
    { key: 'blur-light', label: 'Blur', background: 'blur-light', image: null, style: { backdropFilter: 'blur(2px)' }, icon: 'sparkle' },
    { key: 'blur-strong', label: 'Strong blur', background: 'blur-strong', image: null, style: {}, icon: 'sparkle' },
    ...BACKGROUND_PRESETS.map<Tile>((p) => ({
      key: p.id,
      label: p.label,
      background: 'image',
      image: p.id,
      style: { background: `linear-gradient(135deg, ${p.colors[0]}, ${p.colors[1]} 55%, ${p.colors[2]})` }
    })),
    ...(custom && cam.backgroundImage
      ? [{ key: cam.backgroundImage, label: 'My image', background: 'image' as const, image: cam.backgroundImage, style: { backgroundImage: `url("${custom}")`, backgroundSize: 'cover' } }]
      : [])
  ];
  const selectedKey = cam.background === 'image' ? cam.backgroundImage : cam.background;
  const select = (t: Tile) =>
    void onUpdate({ camera: { ...cam, background: t.background, backgroundImage: t.background === 'image' ? t.image : cam.backgroundImage } });

  const chooseImage = async () => {
    const r = await api.camera.chooseBackgroundImage();
    if (r.ok) await onUpdate({ camera: { ...cam, background: 'image', backgroundImage: r.value } });
    else if (r.error.code !== 'invalid-input' || r.error.message !== 'No image selected.') toast.push({ kind: 'error', message: r.error.message });
  };

  const previewImage = cam.background === 'image' ? (backgroundImageUrl(cam.backgroundImage) ?? cam.backgroundImage) : null;

  return (
    <div className="camera-settings">
      <div className="camera-preview" style={{ borderRadius: settings.cameraLayout.shape === 'circle' ? '50%' : '22%' }}>
        {stream ? (
          <EffectsCanvas
            className="camera-preview-canvas"
            stream={stream}
            background={cam.background}
            image={previewImage}
            mirror={cam.mirror}
            pixelSize={Math.round(200 * (window.devicePixelRatio || 1))}
            onEffectsState={setEffects}
          />
        ) : (
          <div className="camera-preview-msg">{error ? error.message : devices && !cameraId ? 'No camera detected' : <span className="spinner" />}</div>
        )}
        {effects === 'loading' && <span className="camera-preview-badge">Loading effects…</span>}
      </div>
      <div className="camera-settings-controls">
        <div className="field">
          <label className="field-label" htmlFor="camera-device">
            Camera
          </label>
          <select id="camera-device" className="select" value={cameraId ?? ''} onChange={(e) => void onUpdate({ lastCameraId: e.target.value })} disabled={!devices?.cameras.length}>
            {devices?.cameras.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${i + 1}`}
              </option>
            ))}
          </select>
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="settings-title">Mirror my camera</span>
          <Toggle checked={cam.mirror} label="Mirror camera" onChange={(v) => void onUpdate({ camera: { ...cam, mirror: v } })} />
        </div>
        <div className="field">
          <span className="field-label">Background</span>
          <div className="bg-tiles" role="listbox" aria-label="Camera background">
            {tiles.map((t) => (
              <button
                key={t.key}
                type="button"
                role="option"
                aria-selected={selectedKey === t.key}
                className={`bg-tile${selectedKey === t.key ? ' selected' : ''}${t.background.startsWith('blur') ? ` ${t.background}` : ''}`}
                style={t.style}
                title={t.label}
                onClick={() => select(t)}
              >
                {t.icon && <Icon name={t.icon} size={16} />}
                <span>{t.label}</span>
              </button>
            ))}
            <button type="button" className="bg-tile add" title="Use my own image" onClick={() => void chooseImage()}>
              <Icon name="image" size={16} />
              <span>Upload…</span>
            </button>
          </div>
          {effects === 'unavailable' && cam.background !== 'none' && (
            <span className="field-hint">Background effects need WebGL/WebAssembly, which is unavailable here.</span>
          )}
          <span className="field-hint">Effects run entirely on this PC; nothing is uploaded.</span>
        </div>
      </div>
    </div>
  );
}
