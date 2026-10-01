import { useEffect, useRef, useState } from 'react';
import type { RecordingEntry } from '@app-types';
import { formatBytes, formatDuration } from '@shared/format';
import { Icon } from '../components/Icon';
import { MenuButton } from '../components/MenuButton';
import { categoryIcon } from '../components/recorder/SourcePicker';
import { DeleteDialog, RenameDialog } from '../components/library/RecordingDialogs';
import { useLibrary } from '../hooks/useAppState';
import { useRecordingActions } from '../hooks/useRecordingActions';
import { navigate } from '../router';
import { formatLongDate } from '../services/dates';

export function PlayerPage({ id }: { id: string }) {
  const { entries } = useLibrary();
  const actions = useRecordingActions();
  const entry = entries?.find((e) => e.id === id) ?? null;
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [released, setReleased] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [probedDuration, setProbedDuration] = useState<number | null>(null);

  // Windows may refuse to rename/delete a file that is open: release the player first.
  const releaseVideo = () => {
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.removeAttribute('src');
      v.load();
    }
    setReleased(true);
  };

  useEffect(() => {
    setReleased(false);
    setProbedDuration(null);
  }, [entry?.mediaUrl]);

  if (entries && !entry) {
    return (
      <div className="page player-page">
        <button className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => navigate('/')}>
          <Icon name="chevronLeft" size={17} /> Library
        </button>
        <div className="not-found">This recording no longer exists. It may have been moved or deleted.</div>
      </div>
    );
  }
  if (!entry) return <div className="page" />;

  const duration = entry.durationMs ?? probedDuration;
  const flags: Array<{ on: boolean | null; label: string }> = [
    { on: entry.microphoneEnabled, label: 'Microphone' },
    { on: entry.systemAudioEnabled, label: 'System audio' },
    { on: entry.cameraEnabled, label: 'Camera' }
  ];

  return (
    <div className="page player-page">
      <div className="player-top">
        <button className="icon-btn" aria-label="Back to library" onClick={() => navigate('/')}>
          <Icon name="chevronLeft" size={20} />
        </button>
        <div className="player-title">
          <h1 className="ellipsis" title={entry.title} data-testid="player-title">
            {entry.title}
          </h1>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {formatLongDate(entry.createdAt)}
          </span>
        </div>
        {entry.fileName.toLowerCase().endsWith('.webm') && (
          <button className="btn" onClick={() => navigate(`/recording/${entry.id}/trim`)} data-testid="open-trim">
            <Icon name="scissors" size={16} /> Trim
          </button>
        )}
        <button className="btn" onClick={() => setRenaming(true)}>
          <Icon name="edit" size={16} /> Rename
        </button>
        <MenuButton
          label="Share"
          className="btn"
          items={actions.providers.map((p) => ({
            label: p.label,
            icon: p.id === 'copy-path' ? 'copy' : p.id === 'show-in-onedrive' ? 'cloud' : 'share',
            onSelect: () => void actions.share(entry, p.id)
          }))}
        >
          <Icon name="share" size={16} /> Share
        </MenuButton>
      </div>

      <video
        ref={videoRef}
        key={entry.mediaUrl}
        className="player-video"
        src={released ? undefined : entry.mediaUrl}
        controls
        autoPlay
        preload="metadata"
        data-testid="player-video"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d)) setProbedDuration(Math.round(d * 1000));
        }}
      />

      <div className="player-meta">
        <span className="chip">
          <Icon name="clock" size={13} /> {formatDuration(duration)}
        </span>
        <span className="chip">{formatBytes(entry.sizeBytes)}</span>
        {entry.width && entry.height && (
          <span className="chip">
            {entry.width}×{entry.height}
          </span>
        )}
        {entry.source.name && (
          <span className="chip">
            <Icon name={categoryIcon(entry.source.category)} size={13} /> {entry.source.name}
          </span>
        )}
        {flags
          .filter((f) => f.on !== null)
          .map((f) => (
            <span key={f.label} className={`chip ${f.on ? 'chip-primary' : ''}`}>
              {f.label} {f.on ? 'on' : 'off'}
            </span>
          ))}
        {entry.recovered && <span className="chip chip-warning">Recovered after interruption</span>}
        {entry.trimmedAt && <span className="chip">Trimmed</span>}
      </div>

      <div className="path-box mono">
        <Icon name="folder" size={15} />
        <span className="ellipsis" title={entry.absolutePath}>
          {entry.absolutePath}
        </span>
      </div>

      <div className="player-actions">
        <button className="btn" onClick={() => void actions.open(entry)}>
          <Icon name="external" size={16} /> Open in default player
        </button>
        <button className="btn" onClick={() => void actions.showInFolder(entry)}>
          <Icon name="folderOpen" size={16} /> Show in Explorer
        </button>
        <button className="btn" onClick={() => void actions.copyPath(entry)}>
          <Icon name="copy" size={16} /> Copy path
        </button>
        <span className="spacer" />
        <button className="btn btn-danger" onClick={() => setDeleting(true)}>
          <Icon name="trash" size={16} /> Delete
        </button>
      </div>

      {renaming && (
        <RenameDialog
          entry={entry}
          onCancel={() => setRenaming(false)}
          onSubmit={async (title) => {
            releaseVideo();
            const updated: RecordingEntry | null = await actions.rename(entry, title);
            setReleased(false);
            if (updated) setRenaming(false);
          }}
        />
      )}
      {deleting && (
        <DeleteDialog
          entry={entry}
          onCancel={() => setDeleting(false)}
          onConfirm={async () => {
            releaseVideo();
            if (await actions.remove(entry)) navigate('/');
            else setReleased(false);
          }}
        />
      )}
    </div>
  );
}
