import { useEffect, useRef, useState } from 'react';
import type { BubbleConfig } from '@app-types';
import { BUBBLE_DIAMETER_MAX, BUBBLE_DIAMETER_MIN } from '@shared/camera-layout';
import { EffectsCanvas } from '../components/camera/EffectsCanvas';
import { Icon } from '../components/Icon';
import { useCameraPreview } from '../hooks/useMedia';
import type { EffectsState } from '../services/camera/effects';
import { api } from '../services/api';

/**
 * The floating camera bubble (its own always-on-top window). Drag it anywhere; hover
 * for controls; mouse-wheel to resize. What you see here is what gets recorded.
 */
export function BubblePage() {
  const [config, setConfig] = useState<BubbleConfig | null>(null);
  const [effects, setEffects] = useState<EffectsState>('off');
  const lastWheel = useRef(0);
  const dragging = useRef(false);

  useEffect(() => {
    const off = api.bubble.onConfig(setConfig);
    api.bubble.ready();
    return off;
  }, []);

  const { stream, error } = useCameraPreview(config?.deviceId || null);

  useEffect(() => {
    if (!config) return;
    api.bubble.status({
      camera: error ? 'error' : stream ? 'live' : 'starting',
      effects,
      ...(error ? { message: error.message } : {})
    });
  }, [config, stream, error, effects]);

  if (!config) return null;
  const pixelSize = Math.min(900, Math.round(config.diameter * (window.devicePixelRatio || 1)));
  const radius = config.shape === 'circle' ? '50%' : '22%';

  const endDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    api.bubble.drag('end');
  };

  return (
    <div
      className={`bubble-shell${config.diameter < 170 ? ' compact' : ''}${config.recording ? ' recording' : ''}`}
      style={{ borderRadius: radius }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button') || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
        api.bubble.drag('start');
      }}
      onPointerUp={endDrag}
      onLostPointerCapture={endDrag}
      onWheel={(e) => {
        const now = Date.now();
        if (now - lastWheel.current < 180) return;
        lastWheel.current = now;
        api.bubble.step(e.deltaY < 0 ? 1 : -1);
      }}
      data-testid="camera-bubble"
      data-effects={effects}
      data-camera={stream ? 'live' : error ? 'error' : 'starting'}
    >
      <EffectsCanvas
        className="bubble-canvas"
        stream={stream}
        background={config.background}
        image={config.backgroundImage}
        mirror={config.mirror}
        pixelSize={pixelSize}
        onEffectsState={setEffects}
      />
      {!stream && <div className="bubble-message">{error ? error.message : <span className="spinner" />}</div>}
      {effects === 'loading' && <div className="bubble-badge">Loading effects…</div>}
      {/* While recording the bubble is captured with the screen, so its buttons are hidden
          (resize from the control pill or with the mouse wheel; drag still works). */}
      <div className="bubble-controls" hidden={config.recording}>
        <button aria-label="Smaller" title="Smaller (or scroll)" disabled={config.diameter <= BUBBLE_DIAMETER_MIN} onClick={() => api.bubble.step(-1)}>
          <Icon name="minus" size={15} strokeWidth={2.4} />
        </button>
        <button aria-label="Bigger" title="Bigger (or scroll)" disabled={config.diameter >= BUBBLE_DIAMETER_MAX} onClick={() => api.bubble.step(1)}>
          <Icon name="plus" size={15} strokeWidth={2.4} />
        </button>
        <button
          aria-label="Change shape"
          title={config.shape === 'circle' ? 'Rounded square' : 'Circle'}
          onClick={() => api.bubble.setShape(config.shape === 'circle' ? 'rounded' : 'circle')}
        >
          <Icon name={config.shape === 'circle' ? 'square' : 'circle'} size={14} strokeWidth={2.2} />
        </button>
        <button aria-label="Hide camera" title={config.recording ? 'Hide camera' : 'Turn camera off'} onClick={() => api.bubble.close()}>
          <Icon name="x" size={15} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}
