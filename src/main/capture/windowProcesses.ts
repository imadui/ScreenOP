import { execFile } from 'node:child_process';
import { log } from '../logger';

export interface WindowProcess {
  processName: string;
  pid: number;
  /** Main window title as reported by the process (also available when minimised). */
  title: string;
}

// Spawn PowerShell sparingly: only while the source picker is open, at most every 15 s.
const FRESH_MS = 15_000;
let cache: { at: number; value: Map<string, WindowProcess> } | null = null;
let inflight: Promise<Map<string, WindowProcess>> | null = null;

/** Parse `hwnd|processName|pid|title` lines (the title may itself contain `|`). */
export function parseWindowProcesses(stdout: string): Map<string, WindowProcess> {
  const map = new Map<string, WindowProcess>();
  for (const line of stdout.split(/\r?\n/)) {
    const parts = line.trim().split('|');
    const [hwnd, processName, pid] = parts;
    if (!hwnd || !processName || !/^\d+$/.test(hwnd)) continue;
    map.set(hwnd, { processName, pid: Number(pid) || 0, title: parts.slice(3).join('|').trim() });
  }
  return map;
}

function runPowerShell(script: string, timeoutMs: number): Promise<{ ok: boolean; stdout: string; detail: string }> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: timeoutMs, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => resolve({ ok: !err, stdout: String(stdout ?? ''), detail: err ? (err.killed ? 'timed out' : err.message) : '' })
    );
  });
}

async function runEnumeration(timeoutMs: number): Promise<Map<string, WindowProcess>> {
  const script =
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { '{0}|{1}|{2}|{3}' -f [Int64]$_.MainWindowHandle, $_.ProcessName, $_.Id, $_.MainWindowTitle }";
  const started = Date.now();
  const res = await runPowerShell(script, timeoutMs);
  if (!res.ok) {
    log.warn(`window process enumeration unavailable after ${Date.now() - started} ms (${res.detail})`);
    return cache?.value ?? new Map();
  }
  const value = parseWindowProcesses(res.stdout);
  cache = { at: Date.now(), value };
  return value;
}

/**
 * Map top-level window handles to their owning process and title — including
 * minimised windows, which Chromium's capturer does not list. This is how RDP,
 * Citrix and other VDI windows are found and named. Uses one read-only inline
 * `Get-Process` (no script file, no elevation). Never slow: waits at most
 * `maxWaitMs`, otherwise answers from the last result.
 */
export function listWindowProcesses(maxWaitMs = 2500, force = false): Promise<Map<string, WindowProcess>> {
  if (process.platform !== 'win32') return Promise.resolve(new Map());
  if (!force && cache && Date.now() - cache.at < FRESH_MS) return Promise.resolve(cache.value);
  inflight ??= runEnumeration(15_000).finally(() => {
    inflight = null;
  });
  const fallback = new Promise<Map<string, WindowProcess>>((resolve) => setTimeout(() => resolve(cache?.value ?? new Map()), maxWaitMs));
  return Promise.race([inflight, fallback]);
}

/** Handles seen in the last enumeration (restore requests are only honoured for these). */
export function knownWindowHandle(hwnd: string): boolean {
  return !!cache?.value.has(hwnd);
}

/**
 * Restore a minimised window so it can be captured. Uses UI Automation from the
 * .NET assemblies that ship with Windows (no compilation, no keystrokes).
 */
export async function restoreWindow(hwnd: string): Promise<boolean> {
  if (process.platform !== 'win32' || !/^\d{1,20}$/.test(hwnd)) return false;
  const script = [
    'Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes',
    `$el = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr][Int64]${hwnd})`,
    '$p = $null',
    'if ($el -and $el.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$p)) {',
    '  if ($p.Current.WindowVisualState -eq [System.Windows.Automation.WindowVisualState]::Minimized) {',
    '    $p.SetWindowVisualState([System.Windows.Automation.WindowVisualState]::Normal)',
    '  }',
    "  'ok'",
    "} else { 'unsupported' }"
  ].join('\n');
  const res = await runPowerShell(script, 15_000);
  const ok = res.ok && res.stdout.trim().endsWith('ok');
  if (!ok) log.warn('window restore failed', hwnd, res.detail || res.stdout.trim());
  if (ok) cache = null; // force a fresh enumeration next time
  return ok;
}
