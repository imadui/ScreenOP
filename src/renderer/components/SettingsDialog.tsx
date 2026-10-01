import { useEffect, useState } from 'react';
import type { AppInfo, AppSettings, StorageStatus } from '@app-types';
import { api } from '../services/api';
import { CameraSettings } from './camera/CameraSettings';
import { Modal } from './Modal';
import { useToast } from './Toasts';
import { Toggle } from './Toggle';

export function SettingsDialog({
  settings,
  storage,
  onUpdate,
  onClose
}: {
  settings: AppSettings;
  storage: StorageStatus | null;
  onUpdate: (patch: Partial<AppSettings>) => Promise<void>;
  onClose: () => void;
}) {
  const toast = useToast();
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    void api.app.getInfo().then(setInfo);
  }, []);

  const origin =
    storage?.origin === 'custom'
      ? 'Custom folder'
      : storage?.origin === 'override'
        ? 'Set by ONELOOM_RECORDINGS_DIR'
        : storage?.accountType === 'business'
          ? 'OneDrive for work or school (automatic)'
          : storage?.accountType === 'personal'
            ? 'OneDrive personal (automatic)'
            : 'OneDrive (automatic)';

  return (
    <Modal title="Settings" onClose={onClose} width={680}>
      <div className="settings-section-title">Recordings</div>
      <div className="settings-row">
        <div className="settings-text">
          <div className="settings-title">Recordings folder</div>
          <div className="settings-desc">{origin}</div>
          <div className="path-box mono" style={{ marginTop: 6 }}>
            <span className="ellipsis" title={storage?.recordingsDir ?? ''}>
              {storage?.recordingsDir ?? 'Not available'}
            </span>
          </div>
        </div>
      </div>
      <div className="row" style={{ marginTop: -4 }}>
        <button
          className="btn btn-sm"
          onClick={async () => {
            const s = await api.storage.chooseFolder();
            if (s.ok && s.origin === 'custom') toast.push({ kind: 'success', message: 'Recordings folder changed.', detail: s.recordingsDir ?? '' });
          }}
        >
          Choose folder…
        </button>
        {storage?.origin === 'custom' && (
          <button className="btn btn-sm btn-ghost" onClick={() => void api.storage.useAutomatic()}>
            Use OneDrive automatically
          </button>
        )}
      </div>

      <div className="settings-section-title">Camera</div>
      <CameraSettings settings={settings} onUpdate={onUpdate} />

      <div className="settings-section-title">General</div>
      <div className="settings-row">
        <div className="settings-text">
          <div className="settings-title">Start OneLoom when I sign in to Windows</div>
          <div className="settings-desc">Starts hidden in the tray so the recorder opens instantly (installed app only).</div>
        </div>
        <Toggle checked={settings.launchAtLogin} label="Start at sign-in" onChange={(v) => void onUpdate({ launchAtLogin: v })} />
      </div>
      <div className="settings-row">
        <div className="settings-text">
          <div className="settings-title">Keep running in the tray when closed</div>
          <div className="settings-desc">Closing the window hides OneLoom to the system tray. Quit from the tray menu.</div>
        </div>
        <Toggle checked={settings.closeToTray} label="Close to tray" onChange={(v) => void onUpdate({ closeToTray: v })} />
      </div>
      <div className="settings-row">
        <div className="settings-text">
          <div className="settings-title">Global keyboard shortcuts</div>
          <div className="settings-desc">
            {info?.shortcuts.map((s) => (
              <div key={s.accelerator}>
                <kbd>{s.accelerator.replace('CommandOrControl', 'Ctrl')}</kbd> {s.action}
                {s.scope === 'recording' ? ' (while recording)' : ''}
                {settings.shortcutsEnabled && s.scope === 'always' && !s.registered ? ' — in use by another app' : ''}
              </div>
            ))}
          </div>
        </div>
        <Toggle checked={settings.shortcutsEnabled} label="Global shortcuts" onChange={(v) => void onUpdate({ shortcutsEnabled: v })} />
      </div>
      <div className="settings-row">
        <div className="settings-text">
          <div className="settings-title">3-2-1 countdown</div>
          <div className="settings-desc">Show a short countdown before recording starts.</div>
        </div>
        <Toggle checked={settings.countdown} label="Countdown" onChange={(v) => void onUpdate({ countdown: v })} />
      </div>
      {info && (
        <div className="field-hint" style={{ userSelect: 'text' }}>
          OneLoom {info.version} · Electron {info.electron} · Chromium {info.chrome} · {info.platform}
          <br />
          Log file: <span className="mono">{info.logFile}</span>
        </div>
      )}
    </Modal>
  );
}
