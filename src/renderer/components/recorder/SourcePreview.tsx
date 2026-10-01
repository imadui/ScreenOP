import { useEffect, useRef, useState } from 'react';
import type { CaptureSource } from '@app-types';
import { Icon } from '../Icon';
import { VideoStream } from '../VideoStream';
import { categoryIcon } from './SourcePicker';

/**
 * Live preview of the selected source. For screen recordings the on-screen camera
 * bubble shows up here exactly as it will in the video.
 */
export function SourcePreview({
  source,
  stream,
  loading,
  error
}: {
  source: CaptureSource | null;
  stream: MediaStream | null;
  loading: boolean;
  error: string | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const width = Math.min(el.clientWidth, el.clientHeight * aspect);
      setBox({ width: Math.round(width), height: Math.round(width / aspect) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect]);

  useEffect(() => {
    if (source?.display) setAspect(source.display.width / source.display.height);
  }, [source?.id, source?.display]);

  return (
    <div className="preview-wrap" ref={wrapRef}>
      {!source ? (
        <div className="preview-empty">
          <Icon name="monitor" size={30} />
          Choose a screen or window below
        </div>
      ) : source.minimized ? (
        <div className="preview-empty">
          <Icon name={categoryIcon(source.category)} size={30} />
          {source.displayName} is minimised — click it below to restore it.
        </div>
      ) : error ? (
        <div className="preview-empty">
          <Icon name="alert" size={26} />
          {error}
        </div>
      ) : (
        <div className="preview" style={{ width: box.width, height: box.height }}>
          <VideoStream stream={stream} className="source" onDimensions={(w, h) => setAspect(w / h)} />
          {loading && !stream && (
            <div className="preview-empty" style={{ position: 'absolute', inset: 0, justifyContent: 'center' }}>
              <span className="spinner" />
            </div>
          )}
          <span className="preview-label ellipsis">
            <Icon name={categoryIcon(source.category)} size={13} />
            <span className="ellipsis">{source.displayName}</span>
          </span>
        </div>
      )}
    </div>
  );
}
