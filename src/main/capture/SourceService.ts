import { desktopCapturer, screen, type DesktopCapturerSource } from 'electron';
import type { CaptureSource, DisplayInfo, ListSourcesOptions } from '@app-types';
import { classifySource, compareSources, hwndFromSourceId } from '@shared/sources';
import { log } from '../logger';
import { knownWindowHandle, listWindowProcesses, restoreWindow } from './windowProcesses';

/**
 * A provider contributes capture sources to the picker. Today only the desktop
 * capturer exists; a future browser-extension provider could add individual
 * Chrome/Edge tabs (kind `tab`) without touching the picker or the recorder UI.
 */
export interface CaptureSourceProvider {
  readonly id: string;
  list(options: ListSourcesOptions): Promise<CaptureSource[]>;
}

export class DesktopCapturerProvider implements CaptureSourceProvider {
  readonly id = 'desktop-capturer';

  constructor(private readonly ownMediaSourceIds: () => Set<string>) {}

  async list(options: ListSourcesOptions): Promise<CaptureSource[]> {
    const width = Math.min(640, Math.max(64, Math.round(options.thumbnailWidth ?? 320)));
    const [sources, processes] = await Promise.all([
      desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width, height: Math.round((width * 9) / 16) },
        fetchWindowIcons: options.includeIcons ?? true
      }),
      listWindowProcesses()
    ]);

    const own = this.ownMediaSourceIds();
    const displays = screen.getAllDisplays();
    const primaryId = screen.getPrimaryDisplay().id;
    const screens = sources.filter((s) => s.id.startsWith('screen:'));
    const multi = screens.length > 1;

    const result: CaptureSource[] = [];
    screens.forEach((s, index) => {
      const display = displays.find((d) => String(d.id) === s.display_id) ?? displays[index];
      const info: DisplayInfo | undefined = display
        ? {
            id: String(display.id),
            index,
            label: `Screen ${index + 1}`,
            width: Math.round(display.size.width * display.scaleFactor),
            height: Math.round(display.size.height * display.scaleFactor),
            scaleFactor: display.scaleFactor,
            primary: display.id === primaryId
          }
        : undefined;
      const name = multi ? `Screen ${index + 1}${info?.primary ? ' (primary)' : ''}` : 'Entire screen';
      result.push(this.toSource(s, 'screen', name, undefined, info));
    });

    const listed = new Set<string>();
    for (const s of sources) {
      if (!s.id.startsWith('window:') || own.has(s.id) || !s.name.trim()) continue;
      const hwnd = hwndFromSourceId(s.id);
      if (hwnd) listed.add(hwnd);
      const processName = hwnd ? processes.get(hwnd)?.processName : undefined;
      result.push(this.toSource(s, 'window', s.name, processName));
    }

    // Chromium skips minimised windows; list them from the process table so a minimised
    // RDP / Citrix / VM window can still be picked (it is restored when selected).
    for (const [hwnd, p] of processes) {
      const id = `window:${hwnd}:0`;
      if (listed.has(hwnd) || own.has(id) || p.pid === process.pid || !p.title || HIDDEN_TITLES.has(p.title)) continue;
      const c = classifySource({ id, kind: 'window', name: p.title, processName: p.processName });
      result.push({
        id,
        kind: 'window',
        category: c.category,
        name: p.title,
        displayName: c.displayName,
        processName: p.processName,
        ...(c.appName ? { appName: c.appName } : {}),
        ...(c.remoteHost ? { remoteHost: c.remoteHost } : {}),
        previewUnavailable: true,
        minimized: true
      });
    }

    const [screenSources, windowSources] = [result.filter((r) => r.kind === 'screen'), result.filter((r) => r.kind === 'window')];
    windowSources.sort(compareSources);
    log.debug('sources listed', { screens: screenSources.length, windows: windowSources.length, processes: processes.size });
    return [...screenSources, ...windowSources];
  }

  private toSource(s: DesktopCapturerSource, kind: 'screen' | 'window', name: string, processName?: string, display?: DisplayInfo): CaptureSource {
    const c = classifySource({ id: s.id, kind, name, ...(processName ? { processName } : {}) });
    const empty = s.thumbnail.isEmpty();
    const source: CaptureSource = {
      id: s.id,
      kind,
      category: c.category,
      name: kind === 'screen' ? name : s.name,
      displayName: c.displayName,
      ...(c.appName ? { appName: c.appName } : {}),
      ...(processName ? { processName } : {}),
      ...(c.remoteHost ? { remoteHost: c.remoteHost } : {}),
      ...(display ? { display } : {})
    };
    if (!empty) source.thumbnailDataUrl = `data:image/jpeg;base64,${s.thumbnail.toJPEG(72).toString('base64')}`;
    else source.previewUnavailable = true;
    if (s.appIcon && !s.appIcon.isEmpty()) source.appIconDataUrl = s.appIcon.resize({ width: 32 }).toDataURL();
    return source;
  }
}

const HIDDEN_TITLES = new Set(['Program Manager', 'Default IME', 'MSCTFIME UI']);

export class SourceService {
  constructor(private readonly providers: CaptureSourceProvider[]) {}

  /** Restore a minimised window that appeared in the last listing so it can be captured. */
  async restore(sourceId: string): Promise<boolean> {
    const hwnd = hwndFromSourceId(sourceId);
    if (!hwnd || !knownWindowHandle(hwnd)) return false;
    const ok = await restoreWindow(hwnd);
    if (ok) await new Promise((r) => setTimeout(r, 600)); // let DWM present the window
    return ok;
  }

  /** Merges all providers; fails only if every provider failed. */
  async list(options: ListSourcesOptions = {}): Promise<CaptureSource[]> {
    const settled = await Promise.allSettled(this.providers.map((p) => p.list(options)));
    const lists: CaptureSource[][] = [];
    let firstError: unknown = null;
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled') lists.push(s.value);
      else {
        log.warn(`capture provider ${this.providers[i]!.id} failed`, s.reason);
        firstError ??= s.reason;
      }
    });
    if (lists.length === 0 && firstError) throw firstError;
    return lists.flat();
  }
}
