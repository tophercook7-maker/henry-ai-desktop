/**
 * Henry AI — Ollama Lifecycle Manager (Electron main process only)
 *
 * Handles everything: detect existing install, download the binary,
 * launch as a managed child process, and tear down on quit.
 *
 * The binary is stored in the app's userData/bin directory — no admin
 * rights needed because we never touch system directories.
 */

import { app } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import https from 'https';

const BIN_NAME = process.platform === 'win32' ? 'ollama.exe' : 'ollama';
export const OLLAMA_HOST = '127.0.0.1:11434';
export const OLLAMA_URL = `http://${OLLAMA_HOST}`;

// ── Paths ────────────────────────────────────────────────────────────────────

export function getHenryBinDir(): string {
  return path.join(app.getPath('userData'), 'bin');
}

export function getHenryOllamaPath(): string {
  return path.join(getHenryBinDir(), BIN_NAME);
}

// ── Binary detection ─────────────────────────────────────────────────────────

const SYSTEM_PATHS: Record<string, string[]> = {
  darwin: [
    '/usr/local/bin/ollama',
    '/opt/homebrew/bin/ollama',
    '/usr/bin/ollama',
  ],
  win32: [
    `${process.env.LOCALAPPDATA || ''}\\Ollama\\ollama.exe`,
    'C:\\Program Files\\Ollama\\ollama.exe',
  ],
  linux: ['/usr/local/bin/ollama', '/usr/bin/ollama'],
};

/** Returns the path to an Ollama binary, or null if none found. */
export function findOllamaBinary(): string | null {
  // Henry's own managed copy first
  const henryBin = getHenryOllamaPath();
  if (fs.existsSync(henryBin)) return henryBin;

  // System locations
  const platform = process.platform as string;
  const systemLocs = SYSTEM_PATHS[platform] ?? [];
  for (const p of systemLocs) {
    if (fs.existsSync(p)) return p;
  }

  // PATH
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    const full = path.join(dir, BIN_NAME);
    if (fs.existsSync(full)) return full;
  }

  return null;
}

// ── Download ─────────────────────────────────────────────────────────────────

export type DownloadProgress = {
  phase: 'downloading' | 'extracting' | 'done' | 'error';
  downloaded: number;
  total: number;
  message: string;
};

function getDownloadUrl(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  if (process.platform === 'darwin') {
    return `https://github.com/ollama/ollama/releases/latest/download/ollama-darwin`;
  }
  if (process.platform === 'win32') {
    return `https://github.com/ollama/ollama/releases/latest/download/ollama-windows-${arch}.zip`;
  }
  // Linux
  return `https://github.com/ollama/ollama/releases/latest/download/ollama-linux-${arch}`;
}

function httpsGet(url: string): Promise<import('http').IncomingMessage> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        httpsGet(res.headers.location!).then(resolve).catch(reject);
      } else {
        resolve(res);
      }
    }).on('error', reject);
  });
}

/**
 * Download Ollama binary into Henry's userData/bin.
 * Calls onProgress repeatedly during the download.
 * Returns the final binary path.
 */
export async function downloadOllama(
  onProgress: (p: DownloadProgress) => void,
): Promise<string> {
  const binDir = getHenryBinDir();
  if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });

  const url = getDownloadUrl();
  const tmpPath = path.join(binDir, 'ollama.tmp');
  const ollamaPath = getHenryOllamaPath();

  onProgress({ phase: 'downloading', downloaded: 0, total: 0, message: 'Connecting to GitHub…' });

  const res = await httpsGet(url);

  if (res.statusCode !== 200) {
    throw new Error(`Download failed: HTTP ${res.statusCode}`);
  }

  const total = parseInt(res.headers['content-length'] ?? '0', 10);
  let downloaded = 0;

  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(tmpPath);
    res.on('data', (chunk: Buffer) => {
      downloaded += chunk.length;
      onProgress({
        phase: 'downloading',
        downloaded,
        total,
        message: `Downloading Ollama… ${total ? Math.round((downloaded / total) * 100) : '?'}%`,
      });
    });
    res.pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
    res.on('error', reject);
  });

  onProgress({ phase: 'extracting', downloaded, total, message: 'Installing…' });

  if (process.platform === 'darwin' || process.platform === 'linux') {
    // Direct binary (no archive on Mac/Linux since we use the flat binary)
    fs.renameSync(tmpPath, ollamaPath);
    fs.chmodSync(ollamaPath, 0o755);
  } else {
    // Windows zip
    const { execSync } = await import('child_process');
    execSync(
      `powershell -Command "Expand-Archive -Path '${tmpPath}' -DestinationPath '${binDir}' -Force"`,
      { stdio: 'ignore' },
    );
    fs.unlinkSync(tmpPath);
  }

  onProgress({ phase: 'done', downloaded, total, message: 'Ollama installed.' });
  return ollamaPath;
}

// ── Launch / lifecycle ────────────────────────────────────────────────────────

let ollamaProcess: ChildProcess | null = null;

/** Start Ollama if not already running. Waits until it's accepting requests. */
export async function launchOllama(binaryPath: string): Promise<void> {
  // Already responding? Great.
  if (await isOllamaResponding()) return;

  // Don't double-spawn
  if (ollamaProcess && !ollamaProcess.killed) return;

  ollamaProcess = spawn(binaryPath, ['serve'], {
    env: {
      ...process.env,
      OLLAMA_HOST,
      OLLAMA_ORIGINS: '*',
    },
    detached: false,
    stdio: 'ignore',
  });

  ollamaProcess.on('exit', () => { ollamaProcess = null; });
  ollamaProcess.on('error', () => { ollamaProcess = null; });

  // Poll until ready (max 12 seconds)
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    await sleep(600);
    if (await isOllamaResponding()) return;
  }
  // If still not ready, we tried — caller can surface an error
}

/** True if Ollama is responding at localhost */
export async function isOllamaResponding(): Promise<boolean> {
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${OLLAMA_URL}/api/version`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  }
}

/** Kill Henry's managed Ollama process (not system-installed ones). */
export function stopManagedOllama(): void {
  if (ollamaProcess && !ollamaProcess.killed) {
    ollamaProcess.kill('SIGTERM');
    ollamaProcess = null;
  }
}

/** Register cleanup on app quit — call once from main.ts */
export function registerOllamaCleanup(): void {
  app.on('before-quit', stopManagedOllama);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}
