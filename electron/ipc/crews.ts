/**
 * Crews IPC (build plan, Phase 2) — the renderer's boundary to Agent Crews.
 *
 * Channels (match preload.ts):
 *   - `crews:list` → lightweight summaries of every crew (no system prompts)
 *   - `crews:run`  → run a crew by id on an input; returns the full transcript
 *
 * Crews run on the Worker engine (same as Routines) so they don't depend on the
 * chat UI's current model selection. Every handler returns `{ ok, result }` |
 * `{ ok, error }` so a bad payload can't crash the main process.
 */

import { ipcMain, type BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { DEFAULT_CREWS, getCrew } from '../agent/crews/defaults';
import { runCrew } from '../agent/crews/runner';
import type { CrewSummary } from '../agent/crews/types';

type WindowGetter = () => BrowserWindow | null;

/** Resolve the Worker engine (provider/model/key). Mirrors HenryScheduler. */
function resolveWorkerEngine(db: Database.Database): { provider: string; model: string; apiKey: string } {
  const get = (key: string): string =>
    (
      (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value?: string } | undefined)
        ?.value ?? ''
    ).trim();

  const providerId = get('worker_provider');
  const model = get('worker_model');
  if (!providerId || !model) {
    throw new Error('Worker engine is not configured. Open Settings → Engines and pick a Worker provider/model so crews can run.');
  }

  const provider = db.prepare('SELECT * FROM providers WHERE id = ?').get(providerId) as
    | { id: string; name: string; api_key?: string }
    | undefined;
  if (!provider) throw new Error('Worker provider not found. Reconfigure the Worker engine in Settings.');

  const isOllama = (provider.id || '').toLowerCase() === 'ollama' || (provider.name || '').toLowerCase() === 'ollama';
  if (!isOllama && !provider.api_key) {
    throw new Error(`Worker provider "${provider.name}" is missing an API key.`);
  }
  return { provider: providerId, model, apiKey: provider.api_key ?? '' };
}

function summarize(): CrewSummary[] {
  return DEFAULT_CREWS.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    goal: c.goal,
    agents: c.agents.map((a) => ({ id: a.id, name: a.name, role: a.role, goal: a.goal })),
  }));
}

export function registerCrewHandlers(db: Database.Database, getWindow: WindowGetter): void {
  ipcMain.handle('crews:list', () => {
    try {
      return { ok: true, result: summarize() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('crews:run', async (_e, payload: { crewId: string; input: string }) => {
    try {
      const crew = getCrew(payload?.crewId);
      if (!crew) return { ok: false, error: `Unknown crew: ${payload?.crewId}` };
      const input = String(payload?.input ?? '').trim();
      if (!input) return { ok: false, error: 'Give the crew something to work on.' };

      const engine = resolveWorkerEngine(db);
      const win = getWindow();
      const result = await runCrew(crew, input, {
        db,
        getWindow,
        engine,
        onStep: (step) => {
          if (win && !win.isDestroyed()) win.webContents.send('crews:step', { crewId: crew.id, step });
        },
      });
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
