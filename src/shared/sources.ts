import type { SourceCategory, SourceKind } from '@app-types';

/** Pure classification of desktopCapturer sources into picker categories (unit-tested). */

export interface ClassifyInput {
  id: string;
  kind: SourceKind;
  name: string;
  processName?: string;
}

export interface Classification {
  category: SourceCategory;
  displayName: string;
  appName?: string;
  remoteHost?: string;
}

/** Process names (lower-case, without `.exe`) of remote-session / VM clients. */
const REMOTE_PROCESSES: Record<string, string> = {
  mstsc: 'Remote Desktop',
  msrdc: 'Windows App',
  msrdcw: 'Windows App',
  windows365: 'Windows 365',
  vmconnect: 'Hyper-V',
  vmware: 'VMware Workstation',
  vmplayer: 'VMware Player',
  'vmware-view': 'VMware Horizon',
  vmwareview: 'VMware Horizon',
  virtualboxvm: 'VirtualBox',
  wfica32: 'Citrix Workspace',
  cdviewer: 'Virtual desktop',
  selfservice: 'Citrix Workspace',
  'vmware-remotemks': 'VMware Horizon',
  'omnissa-view': 'Omnissa Horizon',
  horizonclient: 'Omnissa Horizon',
  workspaces: 'Amazon WorkSpaces',
  rdcman: 'Remote Desktop Connection Manager',
  tsclient: 'Parallels RAS',
  'windows app': 'Windows App',
  windowsapp: 'Windows App',
  remotedesktopmanager: 'Remote Desktop Manager',
  remotedesktopmanager64: 'Remote Desktop Manager',
  mremoteng: 'mRemoteNG',
  royalts: 'Royal TS',
  anydesk: 'AnyDesk',
  teamviewer: 'TeamViewer',
  rustdesk: 'RustDesk',
  parsecd: 'Parsec',
  vncviewer: 'VNC Viewer',
  tvnviewer: 'TightVNC Viewer'
};

const BROWSER_PROCESSES: Record<string, string> = {
  chrome: 'Google Chrome',
  msedge: 'Microsoft Edge',
  firefox: 'Firefox',
  brave: 'Brave',
  opera: 'Opera',
  vivaldi: 'Vivaldi',
  arc: 'Arc',
  chromium: 'Chromium'
};

const KNOWN_APP_PROCESSES: Record<string, string> = {
  code: 'Visual Studio Code',
  devenv: 'Visual Studio',
  uipath: 'UiPath Studio',
  'uipath.studio': 'UiPath Studio',
  uipathstudio: 'UiPath Studio',
  powershell: 'Windows PowerShell',
  pwsh: 'PowerShell',
  windowsterminal: 'Windows Terminal',
  explorer: 'File Explorer',
  ms_teams: 'Microsoft Teams',
  teams: 'Microsoft Teams',
  outlook: 'Outlook',
  olk: 'Outlook',
  winword: 'Word',
  excel: 'Excel',
  powerpnt: 'PowerPoint',
  notepad: 'Notepad'
};

/** Localised title suffixes of the classic Remote Desktop Connection client (mstsc.exe). */
const RDP_TITLE_SUFFIXES = [
  'Remote Desktop Connection',
  'Connexion Bureau à distance',
  'Remotedesktopverbindung',
  'Conexión a Escritorio remoto',
  'Connessione Desktop remoto',
  'Conexão de Área de Trabalho Remota',
  'Ligação ao Ambiente de Trabalho Remoto',
  'Verbinding met extern bureaublad',
  'Połączenie pulpitu zdalnego',
  'Anslutning till fjärrskrivbord',
  'Forbindelse til Fjernskrivebord',
  'Tilkobling til eksternt skrivebord',
  'Etätyöpöytäyhteys',
  'Připojení ke vzdálené ploše',
  'Подключение к удаленному рабочему столу',
  'Uzak Masaüstü Bağlantısı',
  'リモート デスクトップ接続',
  '远程桌面连接',
  '원격 데스크톱 연결'
];

const VM_TITLE_PATTERNS: Array<{ re: RegExp; app: string }> = [
  // Virtual desktops opened in a "Desktop Viewer" (e.g. "My VM - Desktop Viewer").
  { re: /\s[-–—]\s(Desktop Viewer|Visionneuse de bureau|Desktop-Viewer|Visor de escritorio)$/i, app: 'Virtual desktop' },
  { re: /\s[-–—]\s(Citrix Workspace|Citrix Viewer|Citrix Receiver)$/i, app: 'Citrix' },
  { re: /\s[-–—]\s(VMware Horizon|Omnissa Horizon)( Client)?$/i, app: 'Horizon' },
  { re: /\s[-–—]\s(Azure Virtual Desktop|Windows 365|Windows App)$/i, app: 'Windows App' },
  { re: /\s[-–—]\s(Amazon WorkSpaces)$/i, app: 'Amazon WorkSpaces' },
  { re: /\s[-–—]\s(Virtual Machine Connection|Connexion à un ordinateur virtuel|Verbindung mit virtuellem Computer)$/i, app: 'Hyper-V' },
  { re: /\s[-–—]\s(VMware Workstation|VMware Player|VMware Horizon Client)$/i, app: 'VMware' },
  { re: /\[(Running|En cours d'exécution|Wird ausgeführt)\]\s[-–—]\sOracle VirtualBox$/i, app: 'VirtualBox' }
];

const BROWSER_TITLE_SUFFIXES: Array<{ re: RegExp; app: string }> = [
  { re: /\s[-–—]\s(Google Chrome)$/i, app: 'Google Chrome' },
  { re: /\s[-–—]\s(Microsoft Edge)$/i, app: 'Microsoft Edge' },
  { re: /\s[-–—]\s(Mozilla Firefox|Firefox)$/i, app: 'Firefox' },
  { re: /\s[-–—]\s(Brave)$/i, app: 'Brave' },
  { re: /\s[-–—]\s(Opera)$/i, app: 'Opera' },
  { re: /\s[-–—]\s(Vivaldi)$/i, app: 'Vivaldi' }
];

const APP_TITLE_SUFFIXES: Array<{ re: RegExp; app: string }> = [
  { re: /\s[-–—]\s(Visual Studio Code)$/i, app: 'Visual Studio Code' },
  { re: /\s[-–—]\s(UiPath Studio.*)$/i, app: 'UiPath Studio' },
  { re: /\s[-–—]\s(File Explorer|Explorateur de fichiers)$/i, app: 'File Explorer' }
];

/** Remove zero-width characters (Edge puts U+200B inside "Microsoft​ Edge") and trim. */
export function normalizeTitle(title: string): string {
  return title.replace(/[​-‍⁠﻿]/g, '').replace(/\s+/g, ' ').trim();
}

export function normalizeProcessName(processName: string | undefined): string | undefined {
  if (!processName) return undefined;
  return processName.trim().toLowerCase().replace(/\.exe$/, '');
}

/** Extract the host from `HOST - Remote Desktop Connection` (any supported language). */
export function parseRdpTitle(title: string): { host: string | null } | null {
  const t = normalizeTitle(title);
  for (const suffix of RDP_TITLE_SUFFIXES) {
    if (t.toLowerCase() === suffix.toLowerCase()) return { host: null };
    const re = new RegExp(`^(.*?)\\s[-–—]\\s${escapeRegExp(suffix)}$`, 'i');
    const m = re.exec(t);
    if (m) return { host: m[1]!.trim() || null };
  }
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function hwndFromSourceId(id: string): string | null {
  const m = /^window:(\d+):/.exec(id);
  return m ? m[1]! : null;
}

export function classifySource(input: ClassifyInput): Classification {
  const title = normalizeTitle(input.name);
  if (input.kind === 'screen') {
    return { category: 'screen', displayName: title || 'Entire screen' };
  }

  const proc = normalizeProcessName(input.processName);

  // 1. Remote sessions / VMs — the most important category to identify reliably.
  const rdp = parseRdpTitle(title);
  if (proc === 'mstsc' || rdp) {
    const host = rdp?.host ?? (proc === 'mstsc' ? stripSuffix(title) : null);
    return {
      category: 'remote',
      appName: 'Remote Desktop',
      ...(host ? { remoteHost: host } : {}),
      displayName: host ? `Remote Desktop — ${host}` : 'Remote Desktop Connection'
    };
  }
  // VM / virtual-desktop windows keep the exact title people see on their taskbar
  // ("My VM - Desktop Viewer"); the client app is shown as the subtitle.
  for (const { re, app } of VM_TITLE_PATTERNS) {
    if (re.test(title)) {
      const vmName = title.replace(re, '').trim();
      return { category: 'remote', appName: app, ...(vmName ? { remoteHost: vmName } : {}), displayName: title };
    }
  }
  const remoteApp = lookup(REMOTE_PROCESSES, proc);
  if (remoteApp) {
    return { category: 'remote', appName: remoteApp, displayName: title || remoteApp };
  }

  // 2. Browsers — only whole windows can be captured from outside the browser.
  const browserApp = lookup(BROWSER_PROCESSES, proc);
  if (browserApp) {
    return { category: 'browser', appName: browserApp, displayName: title || browserApp };
  }
  for (const { re, app } of BROWSER_TITLE_SUFFIXES) {
    if (re.test(title)) return { category: 'browser', appName: app, displayName: title };
  }

  // 3. Everything else is a regular application window.
  const knownApp = lookup(KNOWN_APP_PROCESSES, proc);
  if (knownApp) {
    return { category: 'window', appName: knownApp, displayName: title || knownApp };
  }
  for (const { re, app } of APP_TITLE_SUFFIXES) {
    if (re.test(title)) return { category: 'window', appName: app, displayName: title };
  }
  return { category: 'window', displayName: title || 'Untitled window' };
}

/** Own-property lookup (a process named "constructor" must not hit Object.prototype). */
function lookup(table: Record<string, string>, key: string | undefined): string | undefined {
  return key && Object.hasOwn(table, key) ? table[key] : undefined;
}

function stripSuffix(title: string): string | null {
  const idx = title.search(/\s[-–—]\s[^-–—]+$/);
  const host = idx > 0 ? title.slice(0, idx).trim() : '';
  return host || null;
}

/** Stable ordering: remote sessions first (most important), then browsers, then other windows. */
export function compareSources(a: { category: SourceCategory; displayName: string }, b: { category: SourceCategory; displayName: string }): number {
  const rank: Record<SourceCategory, number> = { screen: 0, remote: 1, browser: 2, window: 3 };
  return rank[a.category] - rank[b.category] || a.displayName.localeCompare(b.displayName);
}
