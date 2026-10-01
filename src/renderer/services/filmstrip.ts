/** Small frames across a video for the trim timeline (generated with a hidden <video>). */
export async function captureFilmstrip(
  url: string,
  durationMs: number,
  count: number,
  onFrame?: (frames: string[]) => void,
  height = 72
): Promise<string[]> {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous'; // the media scheme is CORS-enabled; keeps the canvas exportable
  video.muted = true;
  video.preload = 'auto';
  video.src = url;
  const frames: string[] = [];
  try {
    await new Promise<void>((resolve, reject) => {
      video.addEventListener('loadeddata', () => resolve(), { once: true });
      video.addEventListener('error', () => reject(new Error('video load failed')), { once: true });
      setTimeout(() => reject(new Error('timeout')), 15_000);
    });
    const w = Math.max(2, Math.round((video.videoWidth / Math.max(1, video.videoHeight)) * height));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return frames;
    for (let i = 0; i < count; i++) {
      const t = ((i + 0.5) / count) * (durationMs / 1000);
      video.currentTime = t;
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        video.addEventListener('seeked', done, { once: true });
        setTimeout(done, 4000);
      });
      ctx.drawImage(video, 0, 0, w, height);
      frames.push(canvas.toDataURL('image/jpeg', 0.6));
      onFrame?.([...frames]);
    }
  } catch {
    // A partial filmstrip is fine; the timeline still works without images.
  } finally {
    // Release the file handle (Windows) before the trim replaces the file.
    video.removeAttribute('src');
    video.load();
  }
  return frames;
}
