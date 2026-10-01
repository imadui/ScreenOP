import { clipboard, shell } from 'electron';
import type { RecordingMetadata, ShareProviderInfo, ShareResult } from '@app-types';

/**
 * Sharing extension point. Providers are listed in the UI's "Share" menu.
 *
 * A future `OneDriveLinkProvider` can implement this interface using Microsoft
 * Graph (`POST /me/drive/items/{item-id}/createLink`) after an MSAL OAuth sign-in;
 * the recording's `absolutePath` maps to a drive item because it lives under the
 * OneDrive root. Nothing here requires authentication today.
 */
export interface SharingProvider {
  readonly info: ShareProviderInfo;
  isAvailable(recording: RecordingMetadata): boolean;
  share(recording: RecordingMetadata): Promise<ShareResult>;
}

export const copyPathProvider: SharingProvider = {
  info: { id: 'copy-path', label: 'Copy file path', description: 'Copy the full path of the video to the clipboard.' },
  isAvailable: () => true,
  async share(recording) {
    clipboard.writeText(recording.absolutePath);
    return { ok: true, message: 'File path copied to the clipboard.' };
  }
};

export const showInOneDriveProvider: SharingProvider = {
  info: {
    id: 'show-in-onedrive',
    label: 'Show in OneDrive folder',
    description: 'Open the folder in Explorer — right-click the file › Share to create a OneDrive link.'
  },
  isAvailable: () => true,
  async share(recording) {
    shell.showItemInFolder(recording.absolutePath);
    return { ok: true, message: 'Opened in Explorer. Right-click the file and choose “Share” to send a OneDrive link.' };
  }
};

export class SharingService {
  constructor(private readonly providers: SharingProvider[]) {}

  list(): ShareProviderInfo[] {
    return this.providers.map((p) => p.info);
  }

  async run(providerId: string, recording: RecordingMetadata): Promise<ShareResult> {
    const provider = this.providers.find((p) => p.info.id === providerId);
    if (!provider || !provider.isAvailable(recording)) return { ok: false, message: 'This sharing option is not available.' };
    try {
      return await provider.share(recording);
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'Sharing failed.' };
    }
  }
}
