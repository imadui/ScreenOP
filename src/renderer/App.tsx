import { useEffect } from 'react';
import { elapsedFrom, formatDuration } from '@shared/format';
import { BrandMark, Icon } from './components/Icon';
import { ToastProvider, useToast } from './components/Toasts';
import { useNow, useRecorderState } from './hooks/useAppState';
import { loadMediaDevices } from './hooks/useMedia';
import { BubblePage } from './pages/BubblePage';
import { ControllerPage } from './pages/ControllerPage';
import { CountdownPage } from './pages/CountdownPage';
import { HomePage } from './pages/HomePage';
import { PlayerPage } from './pages/PlayerPage';
import { TrimPage } from './pages/TrimPage';
import { navigate, useHashRoute } from './router';
import { api } from './services/api';

export function App() {
  const route = useHashRoute();
  if (route.startsWith('/controller')) return <ControllerPage />;
  if (route.startsWith('/countdown')) return <CountdownPage />;
  if (route.startsWith('/bubble')) return <BubblePage />;
  return (
    <ToastProvider>
      <MainWindow route={route} />
    </ToastProvider>
  );
}

function MainWindow({ route }: { route: string }) {
  const toast = useToast();

  useEffect(() => {
    // Warm up device enumeration (slow on first call on some PCs) before the recorder opens.
    void loadMediaDevices().catch(() => undefined);
  }, []);

  useEffect(() => {
    const offNav = api.app.onNavigate((r) => navigate(r));
    const offNotice = api.app.onNotice((n) => toast.push(n));
    return () => {
      offNav();
      offNotice();
    };
  }, [toast]);

  const trimMatch = /^\/recording\/([a-f0-9-]+)\/trim$/i.exec(route);
  const playerMatch = /^\/recording\/([a-f0-9-]+)$/i.exec(route);

  return (
    <div className="app">
      <TitleBar />
      <main className="content">
        {trimMatch ? <TrimPage id={trimMatch[1]!} /> : playerMatch ? <PlayerPage id={playerMatch[1]!} /> : <HomePage route={route} />}
      </main>
    </div>
  );
}

function TitleBar() {
  const state = useRecorderState();
  const active = state?.phase === 'recording' || state?.phase === 'paused';
  const now = useNow(500, active);
  return (
    <header className="titlebar">
      <button className="brand btn-ghost" style={{ border: 'none', background: 'none', padding: 0 }} onClick={() => navigate('/')} aria-label="OneLoom home">
        <BrandMark />
        OneLoom
      </button>
      {active && state && (
        <span className="rec-indicator">
          <span className="record-dot" />
          {state.phase === 'paused' ? 'Paused' : 'Recording'} {formatDuration(elapsedFrom(state.elapsedMs, state.runningSince, now))}
        </span>
      )}
      <span className="spacer" />
      <button className="icon-btn" aria-label="Settings" title="Settings" onClick={() => navigate('/settings')}>
        <Icon name="settings" size={18} />
      </button>
    </header>
  );
}
