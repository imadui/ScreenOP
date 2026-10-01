import { useEffect, useRef, useState } from 'react';
import type { RecordingEntry } from '@app-types';
import { Modal } from '../Modal';

export function RenameDialog({
  entry,
  onCancel,
  onSubmit
}: {
  entry: RecordingEntry;
  onCancel: () => void;
  onSubmit: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(entry.title);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = async () => {
    const t = title.trim();
    if (!t || busy) return;
    if (t === entry.title) return onCancel();
    setBusy(true);
    await onSubmit(t);
    setBusy(false);
  };

  return (
    <Modal
      title="Rename recording"
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!title.trim() || busy} onClick={() => void submit()}>
            {busy && <span className="spinner" />}
            Rename
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field-label" htmlFor="rename-input">
          Title
        </label>
        <input
          id="rename-input"
          ref={inputRef}
          className="input"
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
        <span className="field-hint">The video file in your OneDrive folder is renamed too (characters Windows forbids are replaced).</span>
      </div>
    </Modal>
  );
}

export function DeleteDialog({
  entry,
  onCancel,
  onConfirm
}: {
  entry: RecordingEntry;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Delete recording?"
      onClose={onCancel}
      width={460}
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn btn-record"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onConfirm();
              setBusy(false);
            }}
          >
            {busy && <span className="spinner" />}
            Delete
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>
        <strong>{entry.title}</strong> will be moved to the Recycle Bin. You can restore it from there (and from the OneDrive recycle bin).
      </p>
    </Modal>
  );
}
