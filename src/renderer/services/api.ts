import type { OneLoomApi } from '@shared/api';

/** Typed access to the preload bridge. */
export const api: OneLoomApi = window.oneloom;

export function logToMain(level: 'info' | 'warn' | 'error', message: string): void {
  try {
    api.app.log(level, message);
  } catch {
    // Bridge unavailable (should not happen outside tests).
  }
}
