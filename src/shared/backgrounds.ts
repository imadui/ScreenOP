/** Camera background presets (drawn procedurally — no image files) and URL helpers. */

export interface BackgroundPreset {
  id: string;
  label: string;
  /** Gradient stops, top-left → bottom-right. */
  colors: [string, string, string];
}

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  { id: 'preset:aurora', label: 'Aurora', colors: ['#312e81', '#4f46e5', '#0ea5e9'] },
  { id: 'preset:sunset', label: 'Sunset', colors: ['#7c2d12', '#ea580c', '#db2777'] },
  { id: 'preset:forest', label: 'Forest', colors: ['#052e16', '#15803d', '#84cc16'] },
  { id: 'preset:slate', label: 'Studio', colors: ['#0f172a', '#334155', '#64748b'] }
];

export function presetById(id: string | null | undefined): BackgroundPreset | undefined {
  return BACKGROUND_PRESETS.find((p) => p.id === id);
}

/** URL of a custom background stored by the main process (null for presets/invalid ids). */
export function backgroundImageUrl(id: string | null | undefined): string | null {
  if (!id?.startsWith('custom:')) return null;
  const name = id.slice('custom:'.length);
  return /^[a-f0-9]{16,64}\.(jpg|png|webp)$/.test(name) ? `oneloom-media://background/${name}` : null;
}
