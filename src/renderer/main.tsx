import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { currentRoute } from './router';
import { logToMain } from './services/api';
import { startEngine } from './services/recorder/engineMain';
import './styles/global.css';
import './styles/controls.css';
import './styles/layout.css';
import './styles/recorder.css';
import './styles/overlays.css';
import './styles/player.css';

const route = currentRoute();

if (route.startsWith('/engine')) {
  // Hidden recorder engine window: no UI, just the capture pipeline.
  document.title = 'OneLoom engine';
  startEngine();
} else {
  if (route.startsWith('/controller') || route.startsWith('/countdown') || route.startsWith('/bubble')) {
    document.documentElement.dataset.window = 'overlay';
  }
  window.addEventListener('error', (e) => logToMain('error', `${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => logToMain('error', `unhandled rejection: ${String(e.reason)}`));
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
