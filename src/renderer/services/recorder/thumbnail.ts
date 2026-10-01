/** Grab one frame of a live track as a small JPEG (library thumbnail). */
export async function captureTrackThumbnail(track: MediaStreamTrack, maxWidth = 480, timeoutMs = 3000): Promise<ArrayBuffer | null> {
  if (track.readyState !== 'live') return null;
  // ImageCapture works for desktop-capture tracks (MediaStreamTrackProcessor may get no frames).
  if (typeof ImageCapture === 'function') {
    try {
      const bitmap = await Promise.race([
        new ImageCapture(track).grabFrame(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))
      ]);
      const w = Math.min(maxWidth, bitmap.width);
      const h = Math.max(2, Math.round((bitmap.height * w) / bitmap.width));
      const canvas = new OffscreenCanvas(w, h);
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      return await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 })).arrayBuffer();
    } catch {
      // fall through to the frame-processor path
    }
  }
  if (typeof MediaStreamTrackProcessor !== 'function') return null;
  const clone = track.clone();
  const reader = new MediaStreamTrackProcessor({ track: clone, maxBufferSize: 1 }).readable.getReader();
  let frame: VideoFrame | undefined;
  try {
    const result = await Promise.race([
      reader.read(),
      new Promise<ReadableStreamReadResult<VideoFrame>>((resolve) => setTimeout(() => resolve({ done: true, value: undefined }), timeoutMs))
    ]);
    frame = result.value;
    if (!frame) return null;
    const w = Math.min(maxWidth, frame.displayWidth);
    const h = Math.max(2, Math.round((frame.displayHeight * w) / frame.displayWidth));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(frame, 0, 0, w, h);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
    return await blob.arrayBuffer();
  } catch {
    return null;
  } finally {
    frame?.close();
    void reader.cancel().catch(() => undefined);
    clone.stop();
  }
}

/** Thumbnail for an existing video file (used for recordings without one). */
export function captureVideoFileThumbnail(url: string, maxWidth = 480, timeoutMs = 8000): Promise<ArrayBuffer | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous'; // the media scheme is CORS-enabled; keeps the canvas exportable
    video.muted = true;
    video.preload = 'auto';
    let settled = false;
    const finish = (value: ArrayBuffer | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    video.addEventListener('error', () => finish(null));
    video.addEventListener('loadeddata', () => {
      const target = Number.isFinite(video.duration) && video.duration > 2 ? 1 : 0;
      if (target > 0) video.currentTime = target;
      else draw();
    });
    video.addEventListener('seeked', () => draw());
    const draw = () => {
      if (!video.videoWidth) return finish(null);
      const w = Math.min(maxWidth, video.videoWidth);
      const h = Math.max(2, Math.round((video.videoHeight * w) / video.videoWidth));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return finish(null);
      try {
        ctx.drawImage(video, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            if (!blob) return finish(null);
            void blob.arrayBuffer().then(finish, () => finish(null));
          },
          'image/jpeg',
          0.82
        );
      } catch {
        finish(null);
      }
    };
    video.src = url;
  });
}
