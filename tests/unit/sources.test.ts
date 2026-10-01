import { describe, expect, it } from 'vitest';
import { classifySource, compareSources, hwndFromSourceId, normalizeTitle, parseRdpTitle } from '../../src/shared/sources';
import { parseWindowProcesses } from '../../src/main/capture/windowProcesses';

describe('Remote Desktop detection', () => {
  it('recognises mstsc windows by title in several languages', () => {
    expect(parseRdpTitle('VM-DEMO01 - Remote Desktop Connection')).toEqual({ host: 'VM-DEMO01' });
    expect(parseRdpTitle('VM-DEMO01 - Connexion Bureau à distance')).toEqual({ host: 'VM-DEMO01' });
    expect(parseRdpTitle('10.0.0.5 - Remotedesktopverbindung')).toEqual({ host: '10.0.0.5' });
    expect(parseRdpTitle('Remote Desktop Connection')).toEqual({ host: null });
    expect(parseRdpTitle('Notes about Remote Desktop Connection setup - Notepad')).toBeNull();
  });

  it('labels a connected RDP session "Remote Desktop — HOST"', () => {
    const c = classifySource({ id: 'window:123:0', kind: 'window', name: 'VM-DEMO01 - Remote Desktop Connection', processName: 'mstsc' });
    expect(c).toMatchObject({ category: 'remote', displayName: 'Remote Desktop — VM-DEMO01', remoteHost: 'VM-DEMO01' });
  });

  it('uses the process name even when the title is unusual', () => {
    const c = classifySource({ id: 'window:1:0', kind: 'window', name: 'vm-build-01 – something', processName: 'MSTSC.EXE' });
    expect(c.category).toBe('remote');
    expect(c.displayName).toBe('Remote Desktop — vm-build-01');
  });

  it('works from the title alone when process info is unavailable', () => {
    const c = classifySource({ id: 'window:1:0', kind: 'window', name: 'VM-DEMO01 - Connexion Bureau à distance' });
    expect(c).toMatchObject({ category: 'remote', displayName: 'Remote Desktop — VM-DEMO01' });
  });

  it('detects "Desktop Viewer" virtual desktops and keeps their taskbar title', () => {
    expect(classifySource({ id: 'window:1:0', kind: 'window', name: 'My VM - Desktop Viewer' })).toMatchObject({
      category: 'remote',
      appName: 'Virtual desktop',
      displayName: 'My VM - Desktop Viewer',
      remoteHost: 'My VM'
    });
    expect(classifySource({ id: 'window:1:0', kind: 'window', name: 'My VM - Desktop Viewer', processName: 'CDViewer' }).displayName).toBe('My VM - Desktop Viewer');
    expect(classifySource({ id: 'window:1:0', kind: 'window', name: 'Bureau Finance - Visionneuse de bureau' }).category).toBe('remote');
    expect(classifySource({ id: 'window:1:0', kind: 'window', name: 'Something', processName: 'CDViewer' })).toMatchObject({
      category: 'remote',
      displayName: 'Something'
    });
  });

  it('detects other remote / VM clients', () => {
    expect(classifySource({ id: 'window:1:0', kind: 'window', name: 'Cloud PC', processName: 'msrdc' })).toMatchObject({
      category: 'remote',
      displayName: 'Cloud PC'
    });
    expect(classifySource({ id: 'window:1:0', kind: 'window', name: 'DevBox on HOST1 - Virtual Machine Connection' })).toMatchObject({
      category: 'remote',
      appName: 'Hyper-V'
    });
    expect(classifySource({ id: 'window:1:0', kind: 'window', name: 'Desktop', processName: 'vmware-view' }).category).toBe('remote');
  });
});

describe('browser and app classification', () => {
  it('handles Edge titles that contain a zero-width space', () => {
    const title = 'ChatGPT and 5 more pages - Work - Microsoft​ Edge';
    expect(normalizeTitle(title)).toBe('ChatGPT and 5 more pages - Work - Microsoft Edge');
    expect(classifySource({ id: 'window:1:0', kind: 'window', name: title })).toMatchObject({ category: 'browser', appName: 'Microsoft Edge' });
  });
  it('classifies Chrome / Firefox windows', () => {
    expect(classifySource({ id: 'window:1:0', kind: 'window', name: 'Inbox - Google Chrome' }).category).toBe('browser');
    expect(classifySource({ id: 'window:1:0', kind: 'window', name: 'Docs — Mozilla Firefox' }).category).toBe('browser');
    expect(classifySource({ id: 'window:1:0', kind: 'window', name: 'anything', processName: 'chrome' }).category).toBe('browser');
  });
  it('treats other apps as windows with a friendly app name', () => {
    expect(classifySource({ id: 'window:1:0', kind: 'window', name: 'index.ts - OneLoom - Visual Studio Code' })).toMatchObject({
      category: 'window',
      appName: 'Visual Studio Code'
    });
    expect(classifySource({ id: 'window:1:0', kind: 'window', name: 'Main.xaml - UiPath Studio', processName: 'UiPath.Studio' }).appName).toBe('UiPath Studio');
    expect(classifySource({ id: 'window:1:0', kind: 'window', name: 'Administrator: Windows PowerShell', processName: 'powershell' }).appName).toBe(
      'Windows PowerShell'
    );
  });
  it('keeps screens as screens', () => {
    expect(classifySource({ id: 'screen:0:0', kind: 'screen', name: 'Screen 1 (primary)' })).toEqual({ category: 'screen', displayName: 'Screen 1 (primary)' });
  });
});

describe('helpers', () => {
  it('extracts the HWND from a desktopCapturer id', () => {
    expect(hwndFromSourceId('window:6360062:0')).toBe('6360062');
    expect(hwndFromSourceId('screen:0:0')).toBeNull();
  });
  it('orders remote sessions before browsers and other windows', () => {
    const list = [
      { category: 'window' as const, displayName: 'A' },
      { category: 'browser' as const, displayName: 'B' },
      { category: 'remote' as const, displayName: 'C' }
    ].sort(compareSources);
    expect(list.map((s) => s.category)).toEqual(['remote', 'browser', 'window']);
  });
  it('parses the PowerShell hwnd|process|pid|title output (titles may contain |)', () => {
    const map = parseWindowProcesses('6360062|msedge|1234|Inbox | Work - Microsoft Edge\r\n1509480|CDViewer|55|My VM - Desktop Viewer\r\n\r\ngarbage\r\n');
    expect(map.get('6360062')).toEqual({ processName: 'msedge', pid: 1234, title: 'Inbox | Work - Microsoft Edge' });
    expect(map.get('1509480')?.title).toBe('My VM - Desktop Viewer');
    expect(map.size).toBe(2);
  });
});
