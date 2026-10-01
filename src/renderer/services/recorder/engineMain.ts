import { RecorderEngine } from './RecorderEngine';

/** Entry point of the hidden engine window (route `#/engine`). */
export function startEngine(): void {
  const api = window.oneloom;
  const engine = new RecorderEngine(api.engine);
  api.engine.onCommand((request) => void engine.handle(request));
  window.addEventListener('unhandledrejection', (e) => {
    api.engine.emit({ type: 'log', level: 'error', message: `unhandled rejection: ${String(e.reason)}` });
  });
  window.addEventListener('error', (e) => {
    api.engine.emit({ type: 'log', level: 'error', message: `engine error: ${e.message}` });
  });
  api.engine.ready();
}
