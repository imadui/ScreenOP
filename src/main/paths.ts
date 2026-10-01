import { app } from 'electron';
import { join } from 'node:path';

/** Application-private locations (never used for finished videos). */
export interface AppPaths {
  userData: string;
  /** In-progress recordings and recordings waiting to be moved to OneDrive. */
  sessions: string;
  thumbnails: string;
  /** Custom camera background images chosen by the user. */
  backgrounds: string;
  logs: string;
  libraryFile: string;
  settingsFile: string;
  resources: string;
}

export function resolveAppPaths(): AppPaths {
  const userData = app.getPath('userData');
  return {
    userData,
    sessions: join(userData, 'sessions'),
    thumbnails: join(userData, 'thumbnails'),
    backgrounds: join(userData, 'backgrounds'),
    logs: join(userData, 'logs'),
    libraryFile: join(userData, 'library.json'),
    settingsFile: join(userData, 'settings.json'),
    resources: app.isPackaged ? join(process.resourcesPath, 'resources') : join(app.getAppPath(), 'resources')
  };
}
