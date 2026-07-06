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

  // ── Voice (free local speech) ─────────────────────────────────────────────
  {
    id: 'whisper_cpp',
    name: 'Whisper (local speech-to-text)',
    category: 'recommended',
    description: 'whisper.cpp — free, offline voice input for Henry',
    check: async () => {
      try {
        const { detectWhisperBinary } = require('../voice/stt') as typeof import('../voice/stt');
        const bin = detectWhisperBinary(true);
        return bin
          ? { ok: true, detail: bin }
          : { ok: false, detail: 'whisper-cli not installed — voice input runs one-time setup on first use' };
      } catch (e) {
        return { ok: false, detail: String(e) };
      }
    },
    fix: async () => {
      if (!toolVersion(BREW)) {
        return { success: false, message: 'Homebrew not found — cannot auto-install whisper-cpp' };
      }
      return brewInstall('whisper-cpp');
    },
  },

  {
    id: 'whisper_model',
    name: 'Whisper model (base.en)',
    category: 'optional',
    description: 'The ~148MB speech model whisper.cpp uses to transcribe your voice',
    check: async () => {
      try {
        const { detectWhisperBinary, sttModelPresent, sttModelPath } =
          require('../voice/stt') as typeof import('../voice/stt');
        if (sttModelPresent()) return { ok: true, detail: sttModelPath() };
        if (!detectWhisperBinary()) {
          // No binary yet — the model alone is useless; report once via whisper_cpp.
          return { ok: true, detail: 'Waiting on whisper-cli install — model downloads during voice setup' };
        }
        return { ok: false, detail: 'Speech model not downloaded (~148MB, one-time)' };
      } catch (e) {
        return { ok: false, detail: String(e) };
      }
    },
    fix: async () => {
      try {
        const { downloadSttModel } = require('../voice/stt') as typeof import('../voice/stt');
        await downloadSttModel();
        return { success: true, message: 'Downloaded ggml-base.en speech model' };
      } catch (e) {
        return { success: false, message: `Model download failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  },

  {
    id: 'microphone',
    name: 'Microphone Permission',
    category: 'recommended',
    description: 'Required so Henry can hear you — voice input in chat',
    check: async () => {
      try {
        const { systemPreferences } = require('electron');
        const status = systemPreferences.getMediaAccessStatus('microphone');
        // 'not-determined' is fine — macOS prompts automatically on first use.
        if (status === 'granted' || status === 'not-determined') return { ok: true, detail: status };
        return {
          ok: false,
          detail: 'Microphone not granted — System Settings → Privacy → Microphone → Henry AI',
        };
      } catch {
        return { ok: true };
      }
    },
    fix: async () => {
      // Report-only (like Screen Recording): open the right pane, user flips the toggle.
      exec('open "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"');
      return { success: false, message: 'Opening Microphone settings — enable Henry AI, then try the mic again' };
    },
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

  // ── Coder engine ──────────────────────────────────────────────────────────
  {
    id: 'claude_cli',
    name: 'Claude Code CLI',
    category: 'recommended',
    description: "Henry's default coder engine — codes on your Claude subscription (big context, no per-token cost)",
    check: async () => {
      const candidates = [
        'claude',
        `${HOME}/.claude/local/claude`,
        '/opt/homebrew/bin/claude',
        '/usr/local/bin/claude',
        `${HOME}/.local/bin/claude`,
      ];
      for (const c of candidates) {
        const v = toolVersion(`"${c}"`);
        if (v) return { ok: true, version: v, detail: c === 'claude' ? undefined : c };
      }
      return {
        ok: false,
        detail:
          'Claude Code CLI not found — install with: npm install -g @anthropic-ai/claude-code (docs: docs.anthropic.com/en/docs/claude-code). Henry falls back to the free local coder.',
      };
    },
    // No auto-fix: a global npm install shouldn't run silently on every launch.
  },

  {
    id: 'qwen_coder',
    name: 'Local coder model (qwen2.5-coder)',
    category: 'optional',
    description: 'Free offline coder fallback via Ollama — used when the Claude Code CLI is unavailable',
    check: async () => {
      if (!toolExists('ollama')) {
        return { ok: true, detail: 'Ollama not installed — local coder fallback skipped (optional)' };
      }
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2500);
        const res = await fetch('http://localhost:11434/api/tags', { signal: controller.signal });
        clearTimeout(timer);
        const data = (await res.json()) as { models?: Array<{ name?: string }> };
        const names = (data.models ?? []).map((m) => m.name ?? '');
        const hit =
          names.find((n) => n.startsWith('qwen2.5-coder')) ??
          names.find((n) => /^qwen[\w.]*-coder/i.test(n));
        return hit
          ? { ok: true, detail: hit }
          : { ok: false, detail: 'Coder model not pulled — run: ollama pull qwen2.5-coder:7b' };
      } catch {
        // Ollama installed but not running — can't verify; don't nag or auto-pull.
        return { ok: true, detail: "Ollama isn't running — start it to verify the local coder model" };
      }
    },
    fix: async () => {
      return new Promise((resolve) => {
        exec('ollama pull qwen2.5-coder:7b', { env: ENV, timeout: 600_000 }, (err) => {
          if (err) resolve({ success: false, message: 'Auto-pull failed — run: ollama pull qwen2.5-coder:7b' });
          else resolve({ success: true, message: 'Pulled qwen2.5-coder:7b for the free local coder' });
        });
      });
    },
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
    id: 'accessibility',
    name: 'Accessibility Permission',
    category: 'recommended',
    description: 'Required for iPad remote control — lets Henry move the mouse and type',
    check: async () => {
      try {
        const { systemPreferences } = require('electron');
        const ok = systemPreferences.isTrustedAccessibilityClient(false);
        return ok
          ? { ok: true }
          : { ok: false, detail: 'Accessibility not granted — System Settings → Privacy → Accessibility' };
      } catch {
        return { ok: true };
      }
    },
    fix: async (): Promise<FixResult> => {
      try {
        const { systemPreferences, shell } = require('electron');
        systemPreferences.isTrustedAccessibilityClient(true);
        await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
        return { success: false, message: 'Opening Accessibility settings — enable Henry AI, then restart' };
      } catch (e) {
        return { success: false, message: 'Could not open Accessibility settings: ' + String(e) };
      }
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
      version: (result as CheckResult).version,
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
