const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const longFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });

/** "Today, 21:15" / "Yesterday, 09:02" / "30 Sept 2026". */
export function formatRecordingDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = d.getTime();
  if (t >= startOfToday) return `Today, ${timeFmt.format(d)}`;
  if (t >= startOfToday - 86_400_000) return `Yesterday, ${timeFmt.format(d)}`;
  return dateFmt.format(d);
}

export function formatLongDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : longFmt.format(d);
}
