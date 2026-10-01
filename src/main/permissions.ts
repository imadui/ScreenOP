import { session, systemPreferences } from 'electron';
import { log } from './logger';
import { isAppUrl } from './windows/common';

const ALLOWED_PERMISSIONS = new Set(['media', 'display-capture', 'clipboard-sanitized-write', 'fullscreen']);

/**
 * Grant camera/microphone/screen permissions to OneLoom's own pages only.
 * Windows can still block devices via Settings › Privacy; that surfaces as a
 * getUserMedia error which the UI explains.
 */
export function configurePermissions(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const allowed = ALLOWED_PERMISSIONS.has(permission) && isAppUrl(details.requestingUrl) && isAppUrl(wc.getURL());
    if (!allowed) log.warn('permission denied', permission, details.requestingUrl);
    callback(allowed);
  });
  // File pages report the opaque origin "file:///", so also require the frame to be our page.
  ses.setPermissionCheckHandler((wc, permission) => ALLOWED_PERMISSIONS.has(permission) && !!wc && isAppUrl(wc.getURL()));
}

export function logMediaAccessStatus(): void {
  if (process.platform !== 'win32') return;
  try {
    log.info('windows media access', {
      microphone: systemPreferences.getMediaAccessStatus('microphone'),
      camera: systemPreferences.getMediaAccessStatus('camera'),
      screen: systemPreferences.getMediaAccessStatus('screen')
    });
  } catch (err) {
    log.warn('media access status unavailable', err);
  }
}
