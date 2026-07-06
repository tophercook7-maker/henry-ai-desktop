/**
 * Voice STT — whisper.cpp speech-to-text. FREE, fully local, works offline.
 *
 * Channels (uniform `{ ok, result | error }` envelope, matching machines/ipc.ts):
 *   voice:sttStatus  — whisper binary + model presence (binary detection cached)
 *   voice:sttSetup   — one-time setup: brew-install whisper-cpp if the binary is
 *                      missing (only when brew exists), then download the
 *                      ggml-base.en model (~148 MB). Progress streams to the
 *                      renderer on 'voice:stt:setup-progress'.
 *   voice:transcribe — audio bytes (webm/opus from MediaRecorder) → temp file →
 *                      ffmpeg 16 kHz mono wav → whisper-cli → { text, ms }.
 *                      Rejects while a previous transcription is still running.
 *
 * The model lives under <userData>/voice-models/ggml-base.en.bin so it survives
 * app updates and never touches the repo.
 */

import { app, ipcMain, type BrowserWindow } from 'electron';
import { execFile, execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';

type Envelope<T = unknown> = { ok: true; result: T } | { ok: false; error: string };

async function envelope<T>(fn: () => T | Promise<T>): Promise<Envelope<T>> {
  try {
    return { ok: true, result: await fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const HOME = os.homedir();
const ENV = {
  ...process.env,
  HOME,
  PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`,
};

export const STT_MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin';
const STT_MODEL_FILE = 'ggml-base.en.bin';
/** ggml-base.en.bin is ~148 MB — anything smaller is a truncated download. */
const STT_MODEL_MIN_BYTES = 140 * 1024 * 1024;

export interface SttStatus {
  binaryPresent: boolean;
  binaryPath: string | null;
  modelPresent: boolean;
  modelPath: string;
  /** True when both binary + model are in place — transcription will work. */
  ready: boolean;
}

export interface SttSetupProgress {
  phase: 'binary' | 'model';
  message: string;
  downloaded?: number;
  total?: number;
  pct?: number;
}

// ── Binary detection (cached) ───────────────────────────────────────────────

/** Homebrew's whisper-cpp formula installs `whisper-cli`; older builds shipped `whisper-cpp`. */
const BINARY_NAMES = ['whisper-cli', 'whisper-cpp'];
const BINARY_DIRS = ['/opt/homebrew/bin', '/usr/local/bin'];

let cachedBinary: string | null | undefined; // undefined = not probed yet

export function detectWhisperBinary(refresh = false): string | null {
  if (!refresh && cachedBinary !== undefined) return cachedBinary;
  cachedBinary = null;
  for (const name of BINARY_NAMES) {
    // Absolute locations first (packaged apps have a minimal PATH).
    for (const dir of BINARY_DIRS) {
      const p = path.join(dir, name);
      try {
        fs.accessSync(p, fs.constants.X_OK);
        cachedBinary = p;
        return cachedBinary;
      } catch { /* keep looking */ }
    }
    try {
      const found = execSync(`which ${name}`, { encoding: 'utf8', env: ENV, timeout: 3000 }).trim();
      if (found) {
        cachedBinary = found;
        return cachedBinary;
      }
    } catch { /* not on PATH */ }
  }
  return cachedBinary;
}

// ── Model management ────────────────────────────────────────────────────────

export function sttModelDir(): string {
  return path.join(app.getPath('userData'), 'voice-models');
}

export function sttModelPath(): string {
  return path.join(sttModelDir(), STT_MODEL_FILE);
}

export function sttModelPresent(): boolean {
  try {
    const stat = fs.statSync(sttModelPath());
    return stat.isFile() && stat.size >= STT_MODEL_MIN_BYTES;
  } catch {
    return false;
  }
}

export function getSttStatus(refresh = false): SttStatus {
  const binaryPath = detectWhisperBinary(refresh);
  const modelPresent = sttModelPresent();
  return {
    binaryPresent: Boolean(binaryPath),
    binaryPath,
    modelPresent,
    modelPath: sttModelPath(),
    ready: Boolean(binaryPath) && modelPresent,
  };
}

/** Follow-redirects GET (HuggingFace 302s to its CDN). */
function httpsGetFollow(
  url: string,
  onResponse: (res: import('http').IncomingMessage) => void,
  onError: (err: Error) => void,
  redirectsLeft = 5,
): void {
  const req = https.get(url, (res) => {
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
      res.resume();
      httpsGetFollow(new URL(res.headers.location, url).toString(), onResponse, onError, redirectsLeft - 1);
      return;
    }
    if (status !== 200) {
      res.resume();
      onError(new Error(`Model download failed: HTTP ${status}`));
      return;
    }
    onResponse(res);
  });
  req.on('error', onError);
}

let downloadInFlight: Promise<void> | null = null;

/**
 * Download ggml-base.en.bin into the voice-models dir. Streams to a .part file,
 * verifies the size, then renames into place. Concurrent calls share one download.
 */
export function downloadSttModel(
  onProgress?: (p: SttSetupProgress) => void,
): Promise<void> {
  if (sttModelPresent()) return Promise.resolve();
  if (downloadInFlight) return downloadInFlight;

  downloadInFlight = new Promise<void>((resolve, reject) => {
    const dir = sttModelDir();
    fs.mkdirSync(dir, { recursive: true });
    const finalPath = sttModelPath();
    const partPath = finalPath + '.part';

    const fail = (err: Error) => {
      try { fs.unlinkSync(partPath); } catch { /* already gone */ }
      reject(err);
    };

    httpsGetFollow(
      STT_MODEL_URL,
      (res) => {
        const total = Number(res.headers['content-length'] || 0);
        let downloaded = 0;
        const out = fs.createWriteStream(partPath);

        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          onProgress?.({
            phase: 'model',
            message: 'Downloading speech model…',
            downloaded,
            total,
            pct: total > 0 ? Math.round((downloaded / total) * 100) : 0,
          });
        });
        res.pipe(out);

        out.on('finish', () => {
          out.close(() => {
            try {
              const size = fs.statSync(partPath).size;
              if (size < STT_MODEL_MIN_BYTES || (total > 0 && size !== total)) {
                fail(new Error(`Model download incomplete (${size} bytes) — try again.`));
                return;
              }
              fs.renameSync(partPath, finalPath);
              onProgress?.({ phase: 'model', message: 'Speech model ready.', downloaded: size, total: size, pct: 100 });
              resolve();
            } catch (e) {
              fail(e instanceof Error ? e : new Error(String(e)));
            }
          });
        });
        out.on('error', fail);
        res.on('error', fail);
      },
      fail,
    );
  }).finally(() => {
    downloadInFlight = null;
  });

  return downloadInFlight;
}

/** brew install whisper-cpp — only attempted when brew itself is present. */
async function installWhisperBinary(onProgress?: (p: SttSetupProgress) => void): Promise<void> {
  const BREW = '/opt/homebrew/bin/brew';
  let brewPath = BREW;
  try {
    fs.accessSync(BREW, fs.constants.X_OK);
  } catch {
    try {
      brewPath = execSync('which brew', { encoding: 'utf8', env: ENV, timeout: 3000 }).trim();
    } catch {
      throw new Error('Homebrew not found — install whisper-cpp manually: brew install whisper-cpp');
    }
  }
  onProgress?.({ phase: 'binary', message: 'Installing whisper-cpp via Homebrew…' });
  await new Promise<void>((resolve, reject) => {
    execFile(brewPath, ['install', 'whisper-cpp'], { env: ENV, timeout: 300_000 }, (err) => {
      if (err) reject(new Error(`brew install whisper-cpp failed: ${err.message.slice(0, 200)}`));
      else resolve();
    });
  });
  detectWhisperBinary(true);
}

// ── Transcription ───────────────────────────────────────────────────────────

let transcribeBusy = false;

function run(cmd: string, args: string[], timeout: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { env: ENV, timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${path.basename(cmd)} failed: ${(stderr || err.message).slice(0, 300)}`));
      else resolve({ stdout, stderr });
    });
  });
}

export async function transcribeAudio(audio: Uint8Array): Promise<{ text: string; ms: number }> {
  if (transcribeBusy) throw new Error('A transcription is already running — try again in a moment.');
  const status = getSttStatus();
  if (!status.binaryPresent) throw new Error('whisper-cli not installed — run voice setup first.');
  if (!status.modelPresent) throw new Error('Speech model not downloaded — run voice setup first.');
  if (!audio || audio.byteLength < 100) throw new Error('No audio captured.');

  transcribeBusy = true;
  const t0 = Date.now();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'henry-voice-'));
  const inPath = path.join(tmpDir, 'in.webm');
  const wavPath = path.join(tmpDir, 'in.wav');
  const outBase = path.join(tmpDir, 'out');

  try {
    fs.writeFileSync(inPath, Buffer.from(audio));

    // whisper.cpp wants 16 kHz mono PCM wav — ffmpeg is a managed dependency.
    await run('ffmpeg', ['-y', '-i', inPath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath], 30_000);

    // -otxt/-of writes plain text to out.txt — robust across whisper-cli versions
    // (stdout mixes logs with text on some builds). -np keeps logs quiet.
    await run(
      status.binaryPath as string,
      ['-m', status.modelPath, '-f', wavPath, '-l', 'en', '-np', '-otxt', '-of', outBase],
      120_000,
    );

    const text = fs.readFileSync(outBase + '.txt', 'utf8').replace(/\s+/g, ' ').trim();
    return { text, ms: Date.now() - t0 };
  } finally {
    transcribeBusy = false;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

// ── IPC registration ────────────────────────────────────────────────────────

export function registerVoiceSttHandlers(getWindow: () => BrowserWindow | null): void {
  const sendProgress = (p: SttSetupProgress) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('voice:stt:setup-progress', p);
  };

  ipcMain.handle('voice:sttStatus', (_e, opts?: { refresh?: boolean }) =>
    envelope(() => getSttStatus(Boolean(opts?.refresh))),
  );

  let setupInFlight: Promise<SttStatus> | null = null;
  ipcMain.handle('voice:sttSetup', () =>
    envelope(() => {
      if (!setupInFlight) {
        setupInFlight = (async () => {
          if (!detectWhisperBinary(true)) await installWhisperBinary(sendProgress);
          if (!sttModelPresent()) await downloadSttModel(sendProgress);
          return getSttStatus(true);
        })().finally(() => {
          setupInFlight = null;
        });
      }
      return setupInFlight;
    }),
  );

  ipcMain.handle('voice:transcribe', (_e, audio: Uint8Array) =>
    envelope(() => transcribeAudio(audio)),
  );
}
