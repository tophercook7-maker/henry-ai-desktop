/**
 * Henry Self-Repair Engine
 *
 * Henry audits his own health on every launch and can fix problems himself.
 * Every check has an auto-fix. Every fix is logged. User sees the result.
 *
 * Philosophy: Henry should never ask the user to run a command.
 * If something is broken, Henry fixes it. If he can't, he says exactly why
 * and what to do — one sentence, no jargon.
 */

import { execSync, exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const BREW = '/opt/homebrew/bin/brew';
const HOME = os.homedir();
const ENV = { ...process.env, HOME, PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}` };

export interface HealthCheck {
  id: string;
  name: string;
  category: 'required' | 'recommended' | 'optional';
  description: string;
  check: () => Promise<CheckResult>;
  fix?: () => Promise<FixResult>;
}

export interface CheckResult {
  ok: boolean;
  detail?: string;
  version?: string;
}

export interface FixResult {
  success: boolean;
  message: string;
}

export interface DiagnosticReport {
  timestamp: string;
  checks: Array<{
    id: string;
    name: string;
    category: string;
    status: 'ok' | 'warning' | 'error' | 'fixed' | 'fix_failed';
    detail?: string;
    version?: string;
    fixMessage?: string;
  }>;
  summary: { ok: number; fixed: number; failed: number; warnings: number };
}

// ── Tool checker helper ────────────────────────────────────────────────────
function toolVersion(cmd: string, versionFlag = '--version'): string | null {
  try {
    return execSync(`${cmd} ${versionFlag} 2>/dev/null`, { encoding: 'utf8', env: ENV, timeout: 5000 }).trim().split('\n')[0] || null;
  } catch { return null; }
}

function toolExists(cmd: string): boolean {
  try { execSync(`which ${cmd}`, { encoding: 'utf8', env: ENV, timeout: 3000 }); return true; } catch { return false; }
}

async function brewInstall(pkg: string): Promise<FixResult> {
  return new Promise(resolve => {
    exec(`${BREW} install ${pkg}`, { env: ENV, timeout: 120_000 }, (err) => {
      if (err) resolve({ success: false, message: `brew install ${pkg} failed: ${err.message.slice(0, 100)}` });
      else resolve({ success: true, message: `Installed ${pkg} via brew` });
    });
  });
}

// ── All health checks ──────────────────────────────────────────────────────
export const HEALTH_CHECKS: HealthCheck[] = [

  // ── Core runtime ──────────────────────────────────────────────────────────
  {
    id: 'brew',
    name: 'Homebrew',
    category: 'required',
    description: 'Package manager — used to install everything else',
    check: async () => {
      const v = toolVersion(BREW);
      return v ? { ok: true, version: v } : { ok: false, detail: 'Homebrew not found' };
    },
    // brew can't auto-install itself — give user a one-liner
  },

  {
    id: 'node',
    name: 'Node.js',
    category: 'required',
    description: 'JavaScript runtime for Henry\'s backend',
    check: async () => {
      const v = toolVersion('node');
      return v ? { ok: true, version: v } : { ok: false, detail: 'Node.js not installed' };
    },
    fix: async () => brewInstall('node'),
  },

  {
    id: 'cloudflared',
    name: 'Cloudflare Tunnel',
    category: 'required',
    description: 'Secure tunnel so mobile works from anywhere',
    check: async () => {
      const v = toolVersion('cloudflared');
      return v ? { ok: true, version: v } : { ok: false, detail: 'cloudflared not installed — mobile only works on home WiFi' };
    },
    fix: async () => brewInstall('cloudflared'),
  },

  {
    id: 'git',
    name: 'Git',
    category: 'required',
    description: 'Version control — used for Henry updates',
    check: async () => {
      const v = toolVersion('git');
      return v ? { ok: true, version: v } : { ok: false, detail: 'Git not installed' };
    },
    fix: async () => brewInstall('git'),
  },

  // ── Media tools ───────────────────────────────────────────────────────────
  {
    id: 'ffmpeg',
    name: 'FFmpeg',
    category: 'recommended',
    description: 'Audio/video processing — required for voice features and media generation',
    check: async () => {
      const v = toolVersion('ffmpeg', '-version');
      return v ? { ok: true, version: v.split('\n')[0] } : { ok: false, detail: 'ffmpeg not installed — voice processing unavailable' };
    },
    fix: async () => brewInstall('ffmpeg'),
  },

  {
    id: 'yt_dlp',
    name: 'yt-dlp',
    category: 'optional',
    description: 'Video downloader — for media capture features',
    check: async () => {
      const v = toolVersion('yt-dlp');
      return v ? { ok: true, version: v } : { ok: false, detail: 'yt-dlp not installed' };
    },
    fix: async () => brewInstall('yt-dlp'),
  },

  // ── Python ────────────────────────────────────────────────────────────────
  {
    id: 'python3',
    name: 'Python 3',
    category: 'recommended',
    description: 'Used for AI scripts, data processing, and Henry utilities',
    check: async () => {
      const v = toolVersion('python3');
      return v ? { ok: true, version: v } : { ok: false, detail: 'Python 3 not installed' };
    },
    fix: async () => brewInstall('python3'),
  },

  // ── Database ──────────────────────────────────────────────────────────────
  {
    id: 'sqlite3',
    name: 'SQLite',
    category: 'required',
    description: 'Henry\'s local database — stores all conversations, memory, tasks',
    check: async () => {
      const v = toolVersion('sqlite3');
      // Also check DB file health
      const dbPath = path.join(os.homedir(), 'Library/Application Support/henry-ai-desktop/henry-workspace/henry.db');
      const dbExists = fs.existsSync(dbPath);
      return v && dbExists
        ? { ok: true, version: v, detail: `DB: ${(fs.statSync(dbPath).size / 1024).toFixed(0)}KB` }
        : { ok: false, detail: !dbExists ? 'Database file missing — will recreate on restart' : 'sqlite3 not installed' };
    },
    fix: async () => brewInstall('sqlite3'),
  },

  // ── Henry settings check ──────────────────────────────────────────────────
  {
    id: 'groq_key',
    name: 'Groq API Key',
    category: 'required',
    description: 'Free AI model access — Henry\'s brain',
    check: async () => {
      try {
        const dbPath = path.join(HOME, 'Library/Application Support/henry-ai-desktop/henry-workspace/henry.db');
        const { execSync: es } = await import('child_process');
        const result = es(`sqlite3 "${dbPath}" "SELECT api_key FROM providers WHERE id='groq' AND enabled=1;"`, { encoding: 'utf8', env: ENV, timeout: 3000 }).trim();
        if (result && result.length > 10) return { ok: true, detail: `Key set (${result.length} chars)` };
        return { ok: false, detail: 'No Groq API key — add one in Settings → AI Providers' };
      } catch { return { ok: false, detail: 'Could not check API key' }; }
    },
    // No auto-fix for API keys — user must provide
  },

  {
    id: 'tunnel_config',
    name: 'Auto-Tunnel Setting',
    category: 'recommended',
    description: 'Cloudflare tunnel starts automatically so mobile works anywhere',
    check: async () => {
      try {
        const dbPath = path.join(HOME, 'Library/Application Support/henry-ai-desktop/henry-workspace/henry.db');
        const result = execSync(`sqlite3 "${dbPath}" "SELECT value FROM settings WHERE key='auto_tunnel_enabled';"`, { encoding: 'utf8', env: ENV, timeout: 3000 }).trim();
        return result === 'true'
          ? { ok: true, detail: 'Auto-tunnel enabled' }
          : { ok: false, detail: 'Auto-tunnel disabled — mobile only works on home WiFi' };
      } catch { return { ok: false, detail: 'Could not check tunnel setting' }; }
    },
    fix: async () => {
      try {
        const dbPath = path.join(HOME, 'Library/Application Support/henry-ai-desktop/henry-workspace/henry.db');
        execSync(`sqlite3 "${dbPath}" "INSERT OR REPLACE INTO settings(key,value) VALUES('auto_tunnel_enabled','true');"`, { env: ENV, timeout: 3000 });
        return { success: true, message: 'Auto-tunnel enabled' };
      } catch (e) { return { success: false, message: String(e) }; }
    },
  },

  {
    id: 'screen_recording',
    name: 'Screen Recording Permission',
    category: 'recommended',
    description: 'Required for live screen view on mobile',
    check: async () => {
      try {
        execSync('screencapture -x /tmp/henry_health_check.png', { env: ENV, timeout: 5000 });
        const exists = fs.existsSync('/tmp/henry_health_check.png');
        try { fs.unlinkSync('/tmp/henry_health_check.png'); } catch { }
        return exists ? { ok: true } : { ok: false, detail: 'Screen Recording not granted — go to System Settings → Privacy → Screen Recording → Henry AI' };
      } catch { return { ok: false, detail: 'Screen Recording not granted — System Settings → Privacy → Screen Recording' }; }
    },
    fix: async () => {
      exec('open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"');
      return { success: false, message: 'Opening Screen Recording settings — enable Henry AI, then restart Henry' };
    },
  },

  {
    id: 'disk_space',
    name: 'Disk Space',
    category: 'recommended',
    description: 'Henry needs space for conversations, media, and AI models',
    check: async () => {
      try {
        const out = execSync('df -h / | tail -1', { encoding: 'utf8', env: ENV, timeout: 3000 });
        const parts = out.trim().split(/\s+/);
        const available = parts[3] || '?';
        const usedPct = parseInt(parts[4] || '0');
        const ok = usedPct < 90;
        return { ok, detail: `${available} free (${parts[4]} used)`, version: available };
      } catch { return { ok: true, detail: 'Could not check disk' }; }
    },
  },
];

// ── Run full diagnostic ────────────────────────────────────────────────────
export async function runDiagnostic(autoFix = true): Promise<DiagnosticReport> {
  const report: DiagnosticReport = {
    timestamp: new Date().toISOString(),
    checks: [],
    summary: { ok: 0, fixed: 0, failed: 0, warnings: 0 },
  };

  for (const check of HEALTH_CHECKS) {
    const result = await check.check().catch(e => ({ ok: false, detail: String(e) }));
    const entry: DiagnosticReport['checks'][0] = {
      id: check.id,
      name: check.name,
      category: check.category,
      status: result.ok ? 'ok' : (check.category === 'required' ? 'error' : 'warning'),
      detail: result.detail,
      version: result.version,
    };

    if (!result.ok && autoFix && check.fix) {
      try {
        const fixResult = await check.fix();
        if (fixResult.success) {
          entry.status = 'fixed';
          entry.fixMessage = fixResult.message;
          report.summary.fixed++;
        } else {
          entry.status = check.category === 'required' ? 'fix_failed' : 'warning';
          entry.fixMessage = fixResult.message;
          if (check.category === 'required') report.summary.failed++;
          else report.summary.warnings++;
        }
      } catch (e) {
        entry.fixMessage = String(e);
        entry.status = 'fix_failed';
        if (check.category === 'required') report.summary.failed++;
        else report.summary.warnings++;
      }
    } else if (result.ok) {
      report.summary.ok++;
    } else if (check.category === 'required') {
      report.summary.failed++;
    } else {
      report.summary.warnings++;
    }

    report.checks.push(entry);
  }

  return report;
}

// ── Save report to DB ──────────────────────────────────────────────────────
export function saveReport(db: import('better-sqlite3').Database, report: DiagnosticReport): void {
  try {
    db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('last_diagnostic',?)").run(JSON.stringify(report));
  } catch { /* ignore */ }
}

export function loadLastReport(db: import('better-sqlite3').Database): DiagnosticReport | null {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key='last_diagnostic'").get() as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  } catch { return null; }
}
