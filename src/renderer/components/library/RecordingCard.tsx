import { memo } from 'react';
import type { RecordingEntry } from '@app-types';
import { formatBytes, formatDuration } from '@shared/format';
import { Icon } from '../Icon';
import { MenuButton, type MenuItem } from '../MenuButton';
import { categoryIcon } from '../recorder/SourcePicker';
import type { RecordingActions } from '../../hooks/useRecordingActions';
import { formatRecordingDate } from '../../services/dates';
import { navigate } from '../../router';

export const RecordingCard = memo(function RecordingCard({
  entry,
  actions,
  onRename,
  onDelete,
  index
}: {
  entry: RecordingEntry;
  actions: RecordingActions;
  onRename: (entry: RecordingEntry) => void;
  onDelete: (entry: RecordingEntry) => void;
  index: number;
}) {
  const items: MenuItem[] = [
    { label: 'Play', icon: 'play', onSelect: () => actions.play(entry) },
    { label: 'Rename', icon: 'edit', onSelect: () => onRename(entry) },
    ...(entry.fileName.toLowerCase().endsWith('.webm')
      ? [{ label: 'Trim', icon: 'scissors' as const, onSelect: () => navigate(`/recording/${entry.id}/trim`) }]
      : []),
    { label: 'Open in default player', icon: 'external', onSelect: () => void actions.open(entry) },
    { label: 'Show in Explorer', icon: 'folderOpen', onSelect: () => void actions.showInFolder(entry) },
    ...actions.providers.map<MenuItem>((p, i) => ({
      label: p.label,
      icon: p.id === 'copy-path' ? 'copy' : p.id === 'show-in-onedrive' ? 'cloud' : 'share',
      onSelect: () => void actions.share(entry, p.id),
      separatorBefore: i === 0
    })),
    { label: 'Delete', icon: 'trash', danger: true, separatorBefore: true, onSelect: () => onDelete(entry) }
  ];

  return (
    <article
      className="card"
      tabIndex={0}
      style={{ animationDelay: `${Math.min(index, 12) * 25}ms` }}
      onDoubleClick={() => actions.play(entry)}
      onClick={() => actions.play(entry)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') actions.play(entry);
        if (e.key === 'F2') onRename(entry);
        if (e.key === 'Delete') onDelete(entry);
      }}
      aria-label={entry.title}
      data-testid="recording-card"
      data-recording-id={entry.id}
    >
      <div className="thumb">
        {entry.thumbnailUrl ? (
          <img src={entry.thumbnailUrl} alt="" loading="lazy" draggable={false} />
        ) : (
          <div className="thumb-placeholder">
            <Icon name="film" size={30} />
          </div>
        )}
        <div className="play-overlay">
          <span>
            <Icon name="play" size={20} />
          </span>
        </div>
        {entry.durationMs != null && <span className="duration-badge">{formatDuration(entry.durationMs)}</span>}
      </div>
      <div className="card-body">
        <div className="card-text">
          <span className="card-title ellipsis" title={entry.title}>
            {entry.title}
          </span>
          <span className="card-meta">
            {formatRecordingDate(entry.createdAt)} · {formatBytes(entry.sizeBytes)}
          </span>
          {entry.source.name && (
            <span className="card-meta">
              <Icon name={categoryIcon(entry.source.category)} size={13} />
              <span className="ellipsis">{entry.source.name}</span>
              {entry.cameraEnabled && <Icon name="camera" size={13} />}
              {entry.microphoneEnabled && <Icon name="mic" size={13} />}
            </span>
          )}
        </div>
        <MenuButton items={items} label={`Actions for ${entry.title}`} />
      </div>
    </article>
  );
});
