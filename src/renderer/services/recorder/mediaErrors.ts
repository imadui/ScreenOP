import type { AppErrorInfo } from '@app-types';
import { appError, describeUnknown, isAppErrorInfo } from '@shared/errors';

export type MediaDeviceRole = 'microphone' | 'camera' | 'screen';

const PRIVACY_HINT: Record<MediaDeviceRole, string> = {
  microphone: 'Allow desktop apps to use the microphone in Windows Settings › Privacy & security › Microphone.',
  camera: 'Allow desktop apps to use the camera in Windows Settings › Privacy & security › Camera.',
  screen: 'Screen capture was blocked by Windows or by a policy.'
};

/** Translate getUserMedia / MediaRecorder DOMExceptions into user-facing errors. */
export function mediaError(err: unknown, role: MediaDeviceRole): AppErrorInfo {
  if (isAppErrorInfo(err)) return err;
  const name = (err as { name?: string } | null)?.name ?? '';
  const detail = describeUnknown(err);
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return appError('permission-denied', `${capitalize(role)} access was denied. ${PRIVACY_HINT[role]}`, detail);
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      if (role === 'screen') return appError('source-unavailable', undefined, detail);
      return appError(role === 'camera' ? 'camera-unavailable' : 'microphone-unavailable', `The selected ${role} was not found — is it unplugged?`, detail);
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      if (role === 'screen') return appError('source-unavailable', 'Windows could not capture this screen or window. It may have been closed or minimised.', detail);
      return appError(
        role === 'camera' ? 'camera-unavailable' : 'microphone-unavailable',
        `The ${role} is busy (used by another app such as Teams or Zoom) or failed to start.`,
        detail
      );
    default:
      if (role === 'screen') return appError('source-unavailable', undefined, detail);
      return appError(role === 'camera' ? 'camera-unavailable' : 'microphone-unavailable', undefined, detail);
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
