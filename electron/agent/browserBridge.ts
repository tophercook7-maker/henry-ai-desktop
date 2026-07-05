/**
 * browser-use bridge (Electron ↔ Python).
 *
 * Henry's `browser_task` tool drives the `browser-use` library, which lives in
 * its own Python 3.11 venv outside this repo (it pulls in Chromium-over-CDP and
 * a stack of ML deps we don't want in the Electron bundle). This module is the
 * single seam between the two worlds: it spawns the venv's Python on
 * `henry_browser_bridge.py`, hands it a web task, and parses the one
 * `HENRY_RESULT_JSON:` line the script prints.
 *
 * Security: model-produced data (the task text, the API key) is passed via
 * environment variables, never argv — the same injection-defense rule
 * `macos.ts` follows. `execFile` is used (no shell), so the bridge path and
 * arguments are never subject to shell interpretation.
 *
 * Locations are overridable for non-default installs:
 *   HENRY_BROWSER_PYTHON   → venv python      (default: ~/HenryAI/repos/henry-browser/.venv/bin/python)
 *   HENRY_BROWSER_BRIDGE   → bridge script    (default: ~/HenryAI/repos/henry-browser/henry_browser_bridge.py)
 */

import { execFile } from "child_process";
import path from "path";
import os from "os";
import fs from "fs";

const HENRY_BROWSER_ROOT = path.join(os.homedir(), "HenryAI", "repos", "henry-browser");

function venvPython(): string {
  const override = process.env.HENRY_BROWSER_PYTHON;
  if (override) return override;
  // Windows venvs put the interpreter under Scripts\; macOS/Linux under bin/.
  return process.platform === "win32"
    ? path.join(HENRY_BROWSER_ROOT, ".venv", "Scripts", "python.exe")
    : path.join(HENRY_BROWSER_ROOT, ".venv", "bin", "python");
}

function bridgeScript(): string {
  return process.env.HENRY_BROWSER_BRIDGE || path.join(HENRY_BROWSER_ROOT, "henry_browser_bridge.py");
}

export type BrowserProvider = "google" | "groq";

export interface BrowserTaskOptions {
  task: string;
  provider: BrowserProvider;
  apiKey: string;
  model?: string;
  maxSteps?: number;
  headless?: boolean;
  /** Hard cap on the whole run. browser-use sessions can be slow. */
  timeoutMs?: number;
}

export interface BrowserTaskResult {
  ok: boolean;
  result?: string;
  provider?: string;
  model?: string;
  steps?: number | null;
  urls?: string[];
  error?: string;
}

/** True when the venv + bridge script are both present — used for a clean
 *  "not installed" error before we try to spawn. */
export function browserBridgeAvailable(): { ok: boolean; reason?: string } {
  const py = venvPython();
  const script = bridgeScript();
  if (!fs.existsSync(py)) {
    return { ok: false, reason: `browser-use Python venv not found at ${py}. Set HENRY_BROWSER_PYTHON or install the henry-browser venv.` };
  }
  if (!fs.existsSync(script)) {
    return { ok: false, reason: `browser-use bridge script not found at ${script}. Set HENRY_BROWSER_BRIDGE.` };
  }
  return { ok: true };
}

/**
 * Run one autonomous browser task. Resolves with the parsed bridge result;
 * never rejects — failures come back as `{ ok: false, error }` so the tool
 * layer can hand the model a clean message.
 */
export function runBrowserTask(opts: BrowserTaskOptions): Promise<BrowserTaskResult> {
  const avail = browserBridgeAvailable();
  if (!avail.ok) return Promise.resolve({ ok: false, error: avail.reason });

  const timeoutMs = opts.timeoutMs ?? 180_000; // 3 min default ceiling

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HENRY_BROWSER_TASK: opts.task,
    HENRY_BROWSER_PROVIDER: opts.provider,
    HENRY_BROWSER_MAX_STEPS: String(opts.maxSteps ?? 12),
    HENRY_BROWSER_HEADLESS: opts.headless === false ? "0" : "1",
  };
  if (opts.model) env.HENRY_BROWSER_MODEL = opts.model;
  if (opts.provider === "google") {
    env.GOOGLE_API_KEY = opts.apiKey;
    env.GEMINI_API_KEY = opts.apiKey;
  } else {
    env.GROQ_API_KEY = opts.apiKey;
  }

  return new Promise((resolve) => {
    execFile(
      venvPython(),
      [bridgeScript()],
      { env, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, killSignal: "SIGKILL" },
      (error, stdout, stderr) => {
        // The bridge always prints exactly one HENRY_RESULT_JSON: line — even
        // on its own internal errors. Find it regardless of surrounding noise.
        const line = (stdout || "")
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.startsWith("HENRY_RESULT_JSON:"))
          .pop();

        if (line) {
          try {
            const parsed = JSON.parse(line.slice("HENRY_RESULT_JSON:".length)) as BrowserTaskResult;
            return resolve(parsed);
          } catch {
            /* fall through to the error path */
          }
        }

        if (error && (error as NodeJS.ErrnoException & { killed?: boolean }).killed) {
          return resolve({ ok: false, error: `Browser task timed out after ${Math.round(timeoutMs / 1000)}s.` });
        }
        const detail = (stderr || stdout || (error && error.message) || "no output").toString().trim().slice(-600);
        resolve({ ok: false, error: `Browser bridge produced no parseable result. ${detail}` });
      },
    );
  });
}
