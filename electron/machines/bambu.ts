/**
 * Bambu Lab LAN-mode driver — MQTT over TLS.
 *
 * Bambu printers in LAN mode run an MQTT broker on :8883 (TLS, self-signed
 * cert). Auth is username `bblp` + the LAN access code from the printer's
 * screen. The printer publishes status reports on `device/{serial}/report`;
 * we request a full state dump by publishing a `pushall` command to
 * `device/{serial}/request`. Reports are often *partial* (diffs), so the
 * driver merges every report into a running status.
 *
 * Control (pause/resume/stop) also goes over MQTT. Job upload is FTPS on
 * port 990 (implicit TLS) which raw Node does not do cleanly — sendJob is
 * intentionally a clearly-surfaced "not yet supported" rather than a
 * half-working upload.
 */

import mqtt, { type MqttClient } from 'mqtt';
import type {
  MachineActionResult,
  MachineCapabilities,
  MachineConnectionConfig,
  MachineDriver,
  MachineState,
  MachineStatus,
} from './types';

// ── Pure mapper (unit-tested) ───────────────────────────────────────────────

/** Bambu `print` report payload → the fields we care about. */
export interface BambuPrintReport {
  gcode_state?: string;        // IDLE | RUNNING | PAUSE | FINISH | FAILED | PREPARE | SLICING
  mc_percent?: number;         // 0–100
  mc_remaining_time?: number;  // minutes
  nozzle_temper?: number;
  nozzle_target_temper?: number;
  bed_temper?: number;
  bed_target_temper?: number;
  subtask_name?: string;
  [key: string]: unknown;
}

export function mapBambuGcodeState(gcodeState: string | undefined): MachineState | undefined {
  if (!gcodeState) return undefined;
  switch (gcodeState.toUpperCase()) {
    case 'RUNNING':
    case 'PREPARE':
    case 'SLICING':
      return 'printing';
    case 'PAUSE':
      return 'paused';
    case 'FAILED':
      return 'error';
    case 'IDLE':
    case 'FINISH':
      return 'idle';
    default:
      return undefined;
  }
}

/**
 * Merge one (possibly partial) Bambu report into the previous status.
 * Fields absent from the report keep their previous value.
 */
export function mapBambuReport(report: BambuPrintReport, prev?: MachineStatus): MachineStatus {
  const state = mapBambuGcodeState(report.gcode_state) ?? prev?.state ?? 'idle';
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  return {
    state,
    progressPct: num(report.mc_percent) ?? prev?.progressPct,
    timeRemainingSec:
      num(report.mc_remaining_time) !== undefined
        ? Math.round(report.mc_remaining_time! * 60)
        : prev?.timeRemainingSec,
    tempNozzle: num(report.nozzle_temper) ?? prev?.tempNozzle,
    tempNozzleTarget: num(report.nozzle_target_temper) ?? prev?.tempNozzleTarget,
    tempBed: num(report.bed_temper) ?? prev?.tempBed,
    tempBedTarget: num(report.bed_target_temper) ?? prev?.tempBedTarget,
    jobName: typeof report.subtask_name === 'string' && report.subtask_name
      ? report.subtask_name
      : prev?.jobName,
    raw: report,
  };
}

// ── Driver ──────────────────────────────────────────────────────────────────

const CAPABILITIES: MachineCapabilities = { sendJob: false, pauseResume: true, stop: true };

export class BambuDriver implements MachineDriver {
  readonly protocol = 'bambu' as const;
  readonly capabilities = CAPABILITIES;

  private client: MqttClient | null = null;
  private status: MachineStatus = { state: 'offline' };
  private connected = false;
  private seq = 1;

  constructor(private config: MachineConnectionConfig) {}

  private get serial(): string {
    return String(this.config.serialNumber ?? '').trim();
  }

  async connect(): Promise<void> {
    const host = String(this.config.host ?? '').trim();
    const accessCode = String(this.config.accessCode ?? '').trim();
    if (!host) throw new Error('Bambu connection needs the printer IP (LAN mode).');
    if (!this.serial) throw new Error('Bambu connection needs the printer serial number.');
    if (!accessCode) throw new Error('Bambu connection needs the LAN access code (printer screen → Settings → WLAN).');

    const port = this.config.port ?? 8883;
    const url = `mqtts://${host}:${port}`;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const client = mqtt.connect(url, {
        username: 'bblp',
        password: accessCode,
        rejectUnauthorized: false, // Bambu uses a self-signed cert
        connectTimeout: 8000,
        reconnectPeriod: 5000,
        keepalive: 30,
      });
      this.client = client;

      client.on('connect', () => {
        this.connected = true;
        client.subscribe(`device/${this.serial}/report`, (err) => {
          if (err) console.warn('[machines:bambu] subscribe failed:', err.message);
        });
        this.requestPushAll();
        if (!settled) { settled = true; resolve(); }
      });

      client.on('message', (_topic, payload) => this.onMessage(payload));

      client.on('error', (err) => {
        if (!settled) {
          settled = true;
          client.end(true);
          this.client = null;
          reject(new Error(`Bambu MQTT connect failed: ${err.message}. Check the IP and LAN access code.`));
        }
      });

      client.on('close', () => {
        this.connected = false;
        if (this.status.state !== 'offline') this.status = { ...this.status, state: 'offline' };
      });
    });
  }

  private onMessage(payload: Buffer): void {
    try {
      const msg = JSON.parse(payload.toString('utf8')) as { print?: BambuPrintReport };
      if (msg.print && typeof msg.print === 'object') {
        this.status = mapBambuReport(msg.print, this.status.state === 'offline' ? undefined : this.status);
      }
    } catch {
      /* non-JSON report — ignore */
    }
  }

  private publishRequest(body: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.client || !this.connected) {
        reject(new Error('Not connected to the printer.'));
        return;
      }
      this.client.publish(
        `device/${this.serial}/request`,
        JSON.stringify(body),
        { qos: 0 },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }

  private requestPushAll(): void {
    void this.publishRequest({
      pushing: { sequence_id: String(this.seq++), command: 'pushall' },
    }).catch(() => { /* best effort */ });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    const client = this.client;
    this.client = null;
    this.status = { state: 'offline' };
    if (client) {
      await new Promise<void>((resolve) => client.end(true, {}, () => resolve()));
    }
  }

  async getStatus(): Promise<MachineStatus> {
    if (!this.client || !this.connected) return { state: 'offline' };
    // P1-series printers only push on request; X1 pushes periodically. A
    // pushall per poll keeps both fresh and is cheap on the LAN.
    this.requestPushAll();
    return this.status;
  }

  async sendJob(_filePath: string): Promise<MachineActionResult> {
    return {
      ok: false,
      error:
        'Sending files to Bambu printers is not yet supported (upload uses FTPS on port 990). ' +
        'Start the print from Bambu Studio / your slicer or the printer SD card — Henry will ' +
        'monitor and control it from there.',
    };
  }

  private async printCommand(command: 'pause' | 'resume' | 'stop'): Promise<MachineActionResult> {
    try {
      await this.publishRequest({
        print: { sequence_id: String(this.seq++), command, param: '' },
      });
      return { ok: true, message: `Sent ${command} to the printer.` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  pause(): Promise<MachineActionResult> { return this.printCommand('pause'); }
  resume(): Promise<MachineActionResult> { return this.printCommand('resume'); }
  stop(): Promise<MachineActionResult> { return this.printCommand('stop'); }
}
