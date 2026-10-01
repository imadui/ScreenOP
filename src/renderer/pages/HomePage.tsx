import { useMemo, useState } from 'react';
import type { RecordingEntry } from '@app-types';
import { Icon } from '../components/Icon';
import { RecordingCard } from '../components/library/RecordingCard';
import { DeleteDialog, RenameDialog } from '../components/library/RecordingDialogs';
import { RecorderSetup } from '../components/recorder/RecorderSetup';
import { SettingsDialog } from '../components/SettingsDialog';
import { useToast } from '../components/Toasts';
import { useLibrary, useRecorderState, useSettings, useStorageStatus } from '../hooks/useAppState';
import { useRecordingActions } from '../hooks/useRecordingActions';
import { useThumbnailBackfill } from '../hooks/useThumbnailBackfill';
import { navigate } from '../router';
import { api } from '../services/api';

type SortKey = 'newest' | 'oldest' | 'longest' | 'title';

export function HomePage({ route }: { route: string }) {
  const toast = useToast();
  const { entries, error, refresh } = useLibrary();
  const [storage] = useStorageStatus();
  const [settings, updateSettings] = useSettings();
  const recorder = useRecorderState();
  const actions = useRecordingActions();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [renaming, setRenaming] = useState<RecordingEntry | null>(null);
  const [deleting, setDeleting] = useState<RecordingEntry | null>(null);
  useThumbnailBackfill(entries);

  const showSetup = route === '/new';
  const showSettings = route === '/settings';
  const busy = !!recorder && recorder.phase !== 'idle';

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (entries ?? []).filter(
      (e) => !q || e.title.toLowerCase().includes(q) || e.fileName.toLowerCase().includes(q) || e.source.name.toLowerCase().includes(q)
    );
    const sorted = [...list];
    if (sort === 'oldest') sorted.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    else if (sort === 'longest') sorted.sort((a, b) => (b.durationMs ?? -1) - (a.durationMs ?? -1));
    else if (sort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title));
    else sorted.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return sorted;
  }, [entries, query, sort]);

  const openFolder = async () => {
    const r = await api.storage.openFolder();
    if (!r.ok) toast.push({ kind: 'error', message: r.error.message, ...(r.error.detail ? { detail: r.error.detail } : {}) });
  };

  return (
    <div className="page">
      <div className="home-hero">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>Your recordings</h1>
          <div className="subtitle">
            {storage?.ok ? (
              <button className="storage-link" onClick={() => void openFolder()} title="Open recordings folder">
                <Icon name="cloud" size={15} />
                <span className="ellipsis mono" data-testid="recordings-dir">
                  {storage.recordingsDir}
                </span>
              </button>
            ) : (
              <span>{storage ? 'Recordings folder unavailable' : 'Locating OneDrive…'}</span>
            )}
          </div>
        </div>
        <button className="btn" onClick={() => void openFolder()}>
          <Icon name="folderOpen" size={17} />
          Open folder
        </button>
        <button className="btn btn-primary btn-lg" onClick={() => navigate('/new')} disabled={busy} data-testid="new-recording">
          <span className="record-dot" />
          New recording
        </button>
      </div>

      {storage && !storage.ok && (
        <div className="banner error">
          <Icon name="alert" />
          <div className="banner-text">
            <strong>{storage.error?.message ?? 'The recordings folder is unavailable.'}</strong>
            {storage.error?.detail && <div className="faint">{storage.error.detail}</div>}
          </div>
          <button className="btn btn-sm" onClick={() => void api.storage.chooseFolder()}>
            Choose a folder…
          </button>
        </div>
      )}
      {storage && storage.pendingCount > 0 && (
        <div className="banner warning">
          <Icon name="alert" />
          <div className="banner-text">
            <strong>
              {storage.pendingCount} recording{storage.pendingCount > 1 ? 's are' : ' is'} waiting to be saved to the recordings folder.
            </strong>
            <div className="faint">They are safe on this PC and will be moved automatically when the folder is available.</div>
          </div>
          <button className="btn btn-sm" onClick={() => void api.storage.retryPending()}>
            Retry now
          </button>
        </div>
      )}

      <div className="toolbar">
        <div className="search">
          <Icon name="search" size={16} />
          <input className="input" placeholder="Search recordings" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search recordings" />
        </div>
        <span className="spacer" />
        <span className="faint" style={{ fontSize: 12.5 }}>
          {entries ? `${visible.length} of ${entries.length}` : ''}
        </span>
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="longest">Longest first</option>
          <option value="title">Title A–Z</option>
        </select>
        <button className="icon-btn" aria-label="Refresh" title="Refresh" onClick={() => void refresh()}>
          <Icon name="refresh" size={17} />
        </button>
      </div>

      {error && storage?.ok && (
        <div className="banner error">
          <Icon name="alert" />
          <div className="banner-text">{error.message}</div>
        </div>
      )}

      {entries === null ? (
        <div className="grid">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="empty">
          <div className="empty-art">
            <Icon name="film" size={38} strokeWidth={1.6} />
          </div>
          <h2>No recordings yet</h2>
          <p>Record your screen, an app window or a Remote Desktop session. Videos are saved straight into your OneDrive folder.</p>
          <button className="btn btn-primary btn-lg" onClick={() => navigate('/new')} disabled={busy}>
            <span className="record-dot" />
            Record your first video
          </button>
          <span className="faint" style={{ fontSize: 12 }}>
            Tip: press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> anywhere to open the recorder.
          </span>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <h2>No matches</h2>
          <p>Nothing matches “{query}”.</p>
        </div>
      ) : (
        <div className="grid" data-testid="recording-grid">
          {visible.map((entry, i) => (
            <RecordingCard key={entry.id} entry={entry} index={i} actions={actions} onRename={setRenaming} onDelete={setDeleting} />
          ))}
        </div>
      )}

      {renaming && (
        <RenameDialog
          entry={renaming}
          onCancel={() => setRenaming(null)}
          onSubmit={async (title) => {
            if (await actions.rename(renaming, title)) setRenaming(null);
          }}
        />
      )}
      {deleting && (
        <DeleteDialog
          entry={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            if (await actions.remove(deleting)) setDeleting(null);
          }}
        />
      )}
      {showSetup && <RecorderSetup onClose={() => navigate('/')} />}
      {showSettings && settings && <SettingsDialog settings={settings} storage={storage} onUpdate={updateSettings} onClose={() => navigate('/')} />}
    </div>
  );
}
