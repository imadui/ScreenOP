import { useRecorderState } from '../hooks/useAppState';

export function CountdownPage() {
  const state = useRecorderState();
  const value = state?.phase === 'countdown' ? state.countdownValue : null;
  if (!value) return null;
  return (
    <div className="countdown-root">
      <div className="countdown-circle">
        <span key={value} className="countdown-number">
          {value}
        </span>
        <span className="countdown-caption">Recording starts…</span>
      </div>
    </div>
  );
}
