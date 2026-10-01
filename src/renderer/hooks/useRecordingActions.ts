import { useCallback, useEffect, useState } from 'react';
import type { RecordingEntry, ShareProviderInfo } from '@app-types';
import { useToast } from '../components/Toasts';
import { navigate } from '../router';
import { api } from '../services/api';

export interface RecordingActions {
  providers: ShareProviderInfo[];
  play(entry: RecordingEntry): void;
  open(entry: RecordingEntry): Promise<void>;
  showInFolder(entry: RecordingEntry): Promise<void>;
  copyPath(entry: RecordingEntry): Promise<void>;
  share(entry: RecordingEntry, providerId: string): Promise<void>;
  rename(entry: RecordingEntry, title: string): Promise<RecordingEntry | null>;
  remove(entry: RecordingEntry): Promise<boolean>;
}

/** Library actions with user feedback (toasts) — shared by the grid and the player. */
export function useRecordingActions(): RecordingActions {
  const toast = useToast();
  const [providers, setProviders] = useState<ShareProviderInfo[]>([]);

  useEffect(() => {
    void api.share.providers().then(setProviders);
  }, []);

  const fail = useCallback(
    (message: string, detail?: string) => toast.push({ kind: 'error', message, ...(detail ? { detail } : {}) }),
    [toast]
  );

  return {
    providers,
    play: (entry) => navigate(`/recording/${entry.id}`),
    open: async (entry) => {
      const r = await api.library.open(entry.id);
      if (!r.ok) fail(r.error.message, r.error.detail);
    },
    showInFolder: async (entry) => {
      const r = await api.library.showInFolder(entry.id);
      if (!r.ok) fail(r.error.message, r.error.detail);
    },
    copyPath: async (entry) => {
      const r = await api.library.copyPath(entry.id);
      if (r.ok) toast.push({ kind: 'success', message: 'Path copied to the clipboard.', detail: r.value });
      else fail(r.error.message, r.error.detail);
    },
    share: async (entry, providerId) => {
      const r = await api.share.run(providerId, entry.id);
      toast.push({ kind: r.ok ? 'success' : 'error', message: r.message });
    },
    rename: async (entry, title) => {
      const r = await api.library.rename(entry.id, title);
      if (r.ok) {
        toast.push({ kind: 'success', message: 'Recording renamed.', detail: r.value.fileName });
        return r.value;
      }
      fail(r.error.message, r.error.detail);
      return null;
    },
    remove: async (entry) => {
      const r = await api.library.remove(entry.id);
      if (r.ok) {
        toast.push({ kind: 'success', message: 'Moved to the Recycle Bin.' });
        return true;
      }
      fail(r.error.message, r.error.detail);
      return false;
    }
  };
}
