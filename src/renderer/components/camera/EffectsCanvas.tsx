import { useEffect, useRef } from 'react';
import type { CameraBackground } from '@app-types';
import { CameraEffectsRenderer, type EffectsState } from '../../services/camera/effects';

/** Live camera rendered through the background-effects pipeline into a square canvas. */
export function EffectsCanvas({
  stream,
  background,
  image,
  mirror,
  pixelSize,
  className,
  onEffectsState
}: {
  stream: MediaStream | null;
  background: CameraBackground;
  image: string | null;
  mirror: boolean;
  /** Canvas resolution in device pixels (square). */
  pixelSize: number;
  className?: string;
  onEffectsState?: (state: EffectsState) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onStateRef = useRef(onEffectsState);
  onStateRef.current = onEffectsState;
  const rendererRef = useRef<CameraEffectsRenderer | null>(null);
  rendererRef.current ??= new CameraEffectsRenderer((s) => onStateRef.current?.(s));

  useEffect(() => {
    rendererRef.current!.setOptions({ background, image, mirror });
  }, [background, image, mirror]);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    video.srcObject = stream;
    if (!stream) return;
    void video.play().catch(() => undefined);
    let handle = 0;
    let stopped = false;
    const frame = () => {
      if (stopped) return;
      rendererRef.current!.draw(video, canvas);
      handle = video.requestVideoFrameCallback(frame);
    };
    handle = video.requestVideoFrameCallback(frame);
    return () => {
      stopped = true;
      video.cancelVideoFrameCallback(handle);
    };
  }, [stream]);

  return (
    <>
      <video ref={videoRef} muted playsInline style={{ display: 'none' }} />
      <canvas ref={canvasRef} className={className} width={pixelSize} height={pixelSize} />
    </>
  );
}
