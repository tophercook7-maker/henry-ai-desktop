/**
 * Network 3D-printer connect + live monitor/control (build plan, 3D area).
 *
 * Talks to a discovered printer over its open HTTP API and returns a normalized
 * status (state, nozzle/bed temps, progress, job) plus basic control
 * (pause / resume / cancel / send G-code). Two adapters ship now:
 *   - OctoPrint    (needs the printer's API key)
 *   - Klipper/Moonraker (open by default, no key)
 * Bambu (MQTT + access code) is a later adapter — its protocol is proprietary.
 *
 * Channels: `printerNet:status`, `printerNet:command`. All LAN, no cloud.
 */

import { ipcMain } from 'electron';

export interface NetPrinterConn {
  ip: string;
  port?: number;
  kind: string;     // 'OctoPrint' | 'Klipper/Moonraker' | ...
  apiKey?: string;
}

export interface NetPrinterStatus {
  state?: string;
  nozzle?: { actual: number; target: number };
  bed?: { actual: number; target: number };
  progress?: number; // 0–100
  job?: string;
}

async function httpJson(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {},
): Promise<{ status: number; json: unknown; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 4000);
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: opts.headers,
      body: opts.body,
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    let json: unknown = undefined;
    try { json = text ? JSON.parse(text) : undefined; } catch { /* non-JSON */ }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

function base(conn: NetPrinterConn, defaultPort: number): string {
  return `http://${conn.ip}:${conn.port ?? defaultPort}`;
}

const isMoonraker = (k: string) => /moonraker|klipper/i.test(k);
const isOctoPrint = (k: string) => /octoprint/i.test(k);

// ── Status ──────────────────────────────────────────────────────────────────

async function octoStatus(conn: NetPrinterConn): Promise<NetPrinterStatus> {
  if (!conn.apiKey) throw new Error('OctoPrint needs an API key (Settings → API in OctoPrint).');
  const headers = { 'X-Api-Key': conn.apiKey };
  const b = base(conn, 80);
  const [p, j] = await Promise.all([
    httpJson(`${b}/api/printer`, { headers }),
    httpJson(`${b}/api/job`, { headers }),
  ]);
  if (p.status === 403 || p.status === 401) throw new Error('OctoPrint rejected the API key.');
  const pr = (p.json ?? {}) as {
    temperature?: { tool0?: { actual?: number; target?: number }; bed?: { actual?: number; target?: number } };
    state?: { text?: string };
  };
  const job = (j.json ?? {}) as { progress?: { completion?: number }; job?: { file?: { name?: string } } };
  return {
    state: pr.state?.text,
    nozzle: pr.temperature?.tool0 ? { actual: pr.temperature.tool0.actual ?? 0, target: pr.temperature.tool0.target ?? 0 } : undefined,
    bed: pr.temperature?.bed ? { actual: pr.temperature.bed.actual ?? 0, target: pr.temperature.bed.target ?? 0 } : undefined,
    progress: typeof job.progress?.completion === 'number' ? Math.round(job.progress.completion) : undefined,
    job: job.job?.file?.name ?? undefined,
  };
}

async function moonrakerStatus(conn: NetPrinterConn): Promise<NetPrinterStatus> {
  const b = base(conn, 7125);
  const q = 'extruder&heater_bed&print_stats&display_status';
  const r = await httpJson(`${b}/printer/objects/query?${q}`);
  const s = ((r.json ?? {}) as { result?: { status?: Record<string, any> } }).result?.status ?? {};
  const ext = s.extruder ?? {};
  const bed = s.heater_bed ?? {};
  const ps = s.print_stats ?? {};
  const ds = s.display_status ?? {};
  return {
    state: ps.state,
    nozzle: { actual: Math.round(ext.temperature ?? 0), target: Math.round(ext.target ?? 0) },
    bed: { actual: Math.round(bed.temperature ?? 0), target: Math.round(bed.target ?? 0) },
    progress: typeof ds.progress === 'number' ? Math.round(ds.progress * 100) : undefined,
    job: ps.filename || undefined,
  };
}

// ── Control ─────────────────────────────────────────────────────────────────

type Action = 'pause' | 'resume' | 'cancel' | 'gcode';

async function octoCommand(conn: NetPrinterConn, action: Action, gcode?: string): Promise<void> {
  if (!conn.apiKey) throw new Error('OctoPrint needs an API key.');
  const headers = { 'X-Api-Key': conn.apiKey, 'Content-Type': 'application/json' };
  const b = base(conn, 80);
  if (action === 'gcode') {
    if (!gcode?.trim()) throw new Error('No G-code to send.');
    const r = await httpJson(`${b}/api/printer/command`, { method: 'POST', headers, body: JSON.stringify({ commands: gcode.split('\n').map((s) => s.trim()).filter(Boolean) }) });
    if (r.status >= 300) throw new Error(`OctoPrint command failed (${r.status}).`);
    return;
  }
  const body = action === 'cancel' ? { command: 'cancel' } : { command: 'pause', action };
  const r = await httpJson(`${b}/api/job`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (r.status >= 300) throw new Error(`OctoPrint ${action} failed (${r.status}).`);
}

async function moonrakerCommand(conn: NetPrinterConn, action: Action, gcode?: string): Promise<void> {
  const b = base(conn, 7125);
  if (action === 'gcode') {
    if (!gcode?.trim()) throw new Error('No G-code to send.');
    const r = await httpJson(`${b}/printer/gcode/script?script=${encodeURIComponent(gcode)}`, { method: 'POST' });
    if (r.status >= 300) throw new Error(`Moonraker command failed (${r.status}).`);
    return;
  }
  const path = action === 'pause' ? 'pause' : action === 'resume' ? 'resume' : 'cancel';
  const r = await httpJson(`${b}/printer/print/${path}`, { method: 'POST' });
  if (r.status >= 300) throw new Error(`Moonraker ${action} failed (${r.status}).`);
}

// ── IPC ─────────────────────────────────────────────────────────────────────

export function registerPrinterNetworkHandlers(): void {
  ipcMain.handle('printerNet:status', async (_e, conn: NetPrinterConn) => {
    try {
      if (!conn?.ip) throw new Error('No printer address.');
      const status = isMoonraker(conn.kind)
        ? await moonrakerStatus(conn)
        : isOctoPrint(conn.kind)
          ? await octoStatus(conn)
          : (() => { throw new Error(`Live monitor isn't supported for "${conn.kind}" yet.`); })();
      return { ok: true, result: await status };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('printerNet:command', async (_e, payload: { conn: NetPrinterConn; action: Action; gcode?: string }) => {
    try {
      const { conn, action, gcode } = payload ?? ({} as { conn: NetPrinterConn; action: Action; gcode?: string });
      if (!conn?.ip) throw new Error('No printer address.');
      if (isMoonraker(conn.kind)) await moonrakerCommand(conn, action, gcode);
      else if (isOctoPrint(conn.kind)) await octoCommand(conn, action, gcode);
      else throw new Error(`Control isn't supported for "${conn.kind}" yet.`);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
