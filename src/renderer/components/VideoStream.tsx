import { useEffect, useRef } from 'react';

/** <video> bound to a live MediaStream. */
export function VideoStream({
  stream,
  className,
  onDimensions
}: {
  stream: MediaStream | null;
  className?: string;
  onDimensions?: (width: number, height: number) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const onDimsRef = useRef(onDimensions);
  onDimsRef.current = onDimensions;

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => undefined);
    const report = () => {
      if (video.videoWidth && video.videoHeight) onDimsRef.current?.(video.videoWidth, video.videoHeight);
    };
    video.addEventListener('loadedmetadata', report);
    video.addEventListener('resize', report);
    return () => {
      video.removeEventListener('loadedmetadata', report);
      video.removeEventListener('resize', report);
    };
  }, [stream]);

  return <video ref={ref} className={className} muted playsInline autoPlay />;
}
