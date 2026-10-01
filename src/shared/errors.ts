import type { AppErrorInfo, ErrorCode } from '@app-types';

/** Default user-facing wording for each error code. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  'onedrive-not-detected':
    'OneDrive was not detected on this PC. Sign in to OneDrive, or choose another recordings folder in Settings.',
  'storage-unavailable': 'The recordings folder is not available right now.',
  'microphone-unavailable': 'The selected microphone is unavailable.',
  'camera-unavailable': 'The selected camera is unavailable.',
  'permission-denied':
    'Access was denied. Check Windows Settings › Privacy & security › Camera / Microphone and allow desktop apps.',
  'source-unavailable': 'The selected screen or window is no longer available.',
  'source-ended': 'The recorded screen or window disappeared. The recording was saved up to that point.',
  'disk-full': 'The disk is full. The recording was stopped and what was captured has been saved.',
  'write-failed': 'Writing the recording to disk failed.',
  'codec-unsupported': 'No supported video format (WebM VP9/VP8) is available on this system.',
  'system-audio-unavailable': 'System audio unavailable for this source.',
  'already-recording': 'A recording is already in progress.',
  'engine-unavailable': 'The recorder engine is not responding. Try again, or restart OneLoom.',
  'not-found': 'The recording could not be found.',
  'invalid-input': 'Invalid request.',
  unknown: 'Something went wrong.'
};

export function appError(code: ErrorCode, message?: string, detail?: string): AppErrorInfo {
  return { code, message: message ?? ERROR_MESSAGES[code], ...(detail ? { detail } : {}) };
}

export function isAppErrorInfo(value: unknown): value is AppErrorInfo {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AppErrorInfo).code === 'string' &&
    typeof (value as AppErrorInfo).message === 'string'
  );
}

export function describeUnknown(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Map Node.js filesystem error codes onto user-facing app errors. */
export function fileSystemError(err: unknown, context: string): AppErrorInfo {
  const code = (err as { code?: string } | undefined)?.code;
  const detail = `${context}: ${describeUnknown(err)}`;
  switch (code) {
    case 'ENOSPC':
      return appError('disk-full', undefined, detail);
    case 'EACCES':
    case 'EPERM':
    case 'EBUSY':
      return appError('write-failed', 'Windows denied access to the recording file (it may be locked or read-only).', detail);
    case 'ENOENT':
    case 'ENOTDIR':
      return appError('storage-unavailable', undefined, detail);
    default:
      return appError('write-failed', undefined, detail);
  }
}
