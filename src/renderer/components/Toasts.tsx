import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AppNotice } from '@shared/api';
import { Icon, type IconName } from './Icon';

interface Toast extends AppNotice {
  id: number;
}

interface ToastApi {
  push(notice: AppNotice): void;
}

const ToastContext = createContext<ToastApi>({ push: () => undefined });

const ICONS: Record<AppNotice['kind'], IconName> = {
  success: 'check',
  info: 'info',
  warning: 'alert',
  error: 'alert'
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback(
    (notice: AppNotice) => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-3), { ...notice, id }]);
      const ttl = notice.kind === 'error' || notice.kind === 'warning' ? 9000 : 4500;
      window.setTimeout(() => dismiss(id), ttl);
    },
    [dismiss]
  );

  const api = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <Icon name={ICONS[t.kind]} size={18} />
            <div className="toast-text">
              <div>{t.message}</div>
              {t.detail && <div className="toast-detail">{t.detail}</div>}
            </div>
            <button className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}
