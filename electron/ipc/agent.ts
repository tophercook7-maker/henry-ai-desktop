/**
 * Agent IPC — the renderer's boundary to the agent layer (design §6).
 *
 * Registers the shipped tool set against the registry and exposes:
 *   - `agent:list-tools`       → name/description/safety-tier of every tool
 *   - `agent:confirm-response` → renderer's yes/no (+ edited args) for a
 *                                confirm-tier tool the runner is waiting on
 *
 * The tool-call loop itself lives in `electron/agent/toolRunner.ts` and is
 * driven from `ai.ts` when a request carries tools.
 */

import { ipcMain, type BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';
import { registry } from '../agent/toolRegistry';
import { registerAllTools } from '../agent/registerTools';
import { resolveConfirmation } from '../agent/toolRunner';

type WindowGetter = () => BrowserWindow | null;

export function registerAgentHandlers(db: Database.Database, getWindow: WindowGetter): void {
  // Populate the registry with the Sprint 1 tool kits.
  registerAllTools({ db, getWindow });

  // Tool catalogue for the renderer (name, description, safety tier, category).
  ipcMain.handle('agent:list-tools', () => registry.describe());

  // Renderer's decision on a confirm-tier tool. `editedArgs` lets the user
  // tweak the params (e.g. message body) before the action runs.
  ipcMain.handle(
    'agent:confirm-response',
    (_e, payload: { id: string; approved: boolean; editedArgs?: Record<string, unknown> }) => {
      const matched = resolveConfirmation(payload.id, payload.approved, payload.editedArgs);
      return { ok: matched };
    },
  );
}
