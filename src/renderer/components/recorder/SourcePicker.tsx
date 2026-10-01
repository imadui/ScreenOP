import { useEffect, useMemo, useState } from 'react';
import type { CaptureSource, SourceCategory } from '@app-types';
import { Icon, type IconName } from '../Icon';

const TABS: Array<{ id: SourceCategory; label: string; icon: IconName }> = [
  { id: 'screen', label: 'Screens', icon: 'monitor' },
  { id: 'window', label: 'Windows', icon: 'window' },
  { id: 'browser', label: 'Browsers', icon: 'globe' },
  { id: 'remote', label: 'Remote & VMs', icon: 'remote' }
];

const NOTES: Partial<Record<SourceCategory, string>> = {
  browser:
    'Windows lets OneLoom capture whole browser windows, not individual tabs. Pick the Chrome/Edge window and keep the tab you want in front — or drag that tab into its own window first.',
  remote:
    'Remote Desktop, Citrix and VM windows are recorded from this PC — nothing is installed in the VM. Minimised sessions are restored when you pick them; keep the window open (not minimised) while recording. Redirected VM audio is captured with “System audio”.'
};

export function categoryIcon(category: SourceCategory | 'unknown'): IconName {
  return category === 'screen' ? 'monitor' : category === 'remote' ? 'remote' : category === 'browser' ? 'globe' : 'window';
}

export function SourcePicker({
  sources,
  selectedId,
  onSelect,
  loading,
  onRefresh,
  error,
  restoringId = null
}: {
  sources: CaptureSource[] | null;
  selectedId: string | null;
  onSelect: (source: CaptureSource) => void;
  loading: boolean;
  onRefresh: () => void;
  error: string | null;
  restoringId?: string | null;
}) {
  const counts = useMemo(() => {
    const c: Record<SourceCategory, number> = { screen: 0, window: 0, browser: 0, remote: 0 };
    for (const s of sources ?? []) c[s.category]++;
    return c;
  }, [sources]);

  const selected = sources?.find((s) => s.id === selectedId);
  const [tab, setTab] = useState<SourceCategory>(selected?.category ?? 'screen');
  useEffect(() => {
    if (selected) setTab(selected.category);
    // Only follow the selection when it changes, not on every refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Restored/visible windows first, minimised ones after.
  const visible = (sources ?? []).filter((s) => s.category === tab).sort((a, b) => Number(!!a.minimized) - Number(!!b.minimized));
  const note = NOTES[tab];

  return (
    <div className="picker">
      <div className="picker-tabs" role="tablist" aria-label="Capture source type">
        {TABS.map((t) => (
          <button key={t.id} role="tab" className="picker-tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={15} />
            {t.label}
            <span className="count">{counts[t.id]}</span>
          </button>
        ))}
        <span className="spacer" />
        <button className="icon-btn" onClick={onRefresh} aria-label="Refresh sources" title="Refresh">
          {loading ? <span className="spinner" /> : <Icon name="refresh" size={17} />}
        </button>
      </div>
      {note && (
        <div className="picker-note">
          <Icon name="info" size={15} />
          <span>{note}</span>
        </div>
      )}
      <div className="picker-grid" role="listbox" aria-label="Capture sources">
        {error && <div className="picker-empty">{error}</div>}
        {!error && sources === null && <div className="picker-empty"><span className="spinner" /></div>}
        {!error && sources !== null && visible.length === 0 && (
          <div className="picker-empty">
            {tab === 'remote'
              ? 'No Remote Desktop, Citrix or VM window found. Open your session (mstsc, Citrix Desktop Viewer, Windows App…) and press refresh.'
              : tab === 'browser'
                ? 'No browser window is open.'
                : 'Nothing to show here.'}
          </div>
        )}
        {visible.map((s) => (
          <button
            key={s.id}
            role="option"
            aria-selected={s.id === selectedId}
            aria-pressed={s.id === selectedId}
            className="source-tile"
            onClick={() => onSelect(s)}
            title={s.name}
          >
            <div className="source-thumb">
              {s.thumbnailDataUrl ? (
                <img src={s.thumbnailDataUrl} alt="" draggable={false} />
              ) : s.minimized ? (
                <span className="minimized-hint">
                  <Icon name={categoryIcon(s.category)} size={22} />
                  {restoringId === s.id ? 'Restoring…' : 'Minimized — click to restore'}
                </span>
              ) : (
                <span>{s.previewUnavailable ? 'Preview unavailable' : ''}</span>
              )}
            </div>
            <div className="source-caption">
              {s.appIconDataUrl ? <img src={s.appIconDataUrl} alt="" /> : <Icon name={categoryIcon(s.category)} size={16} />}
              <span className="ellipsis">{s.displayName}</span>
            </div>
            {(s.display || s.appName) && (
              <div className="source-sub ellipsis">
                {s.display ? `${s.display.width}×${s.display.height}${s.display.scaleFactor !== 1 ? ` · ${Math.round(s.display.scaleFactor * 100)}%` : ''}` : s.appName}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
