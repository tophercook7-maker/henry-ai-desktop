/**
 * Project Vault IPC — the renderer's boundary to the projects table
 * (build plan, Phase 1.1). Mirrors the agent's project tools so the UI and
 * Henry-in-chat read/write the same records.
 *
 * Channels (match preload.ts):
 *   - `projects:list`   → all projects (optionally filtered by status)
 *   - `projects:get`    → one project by id
 *   - `projects:update` → patch a project's editable fields by id
 *
 * Every handler returns `{ ok, result }` | `{ ok, error }` so a bad payload can
 * never crash the main process or white-screen the renderer.
 */

import { ipcMain } from "electron";
import type Database from "better-sqlite3";

type Row = Record<string, unknown>;

const SELECT_FIELDS = `id, name, type, status, description, summary, next_action,
  money_angle, domain, repo_url, notes, last_worked_at, last_active_at, updated_at`;

/** Fields the renderer is allowed to patch (whitelist — no arbitrary columns). */
const EDITABLE = new Set([
  "name",
  "status",
  "type",
  "description",
  "next_action",
  "money_angle",
  "domain",
  "repo_url",
  "notes",
]);

const VALID_STATUS = new Set(["active", "paused", "completed", "archived"]);

function safe<T>(fn: () => T) {
  try {
    return { ok: true as const, result: fn() };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

export function registerProjectHandlers(db: Database.Database): void {
  ipcMain.handle("projects:list", (_e, payload?: { status?: string; limit?: number }) =>
    safe(() => {
      const limit = Math.min(Number(payload?.limit) || 100, 500);
      const status = payload?.status;
      const sql = status
        ? `SELECT ${SELECT_FIELDS} FROM projects WHERE status = ? ORDER BY strategic_importance_score DESC, last_active_at DESC LIMIT ?`
        : `SELECT ${SELECT_FIELDS} FROM projects ORDER BY strategic_importance_score DESC, last_active_at DESC LIMIT ?`;
      const rows = status
        ? (db.prepare(sql).all(status, limit) as Row[])
        : (db.prepare(sql).all(limit) as Row[]);
      return rows;
    }),
  );

  ipcMain.handle("projects:get", (_e, payload: { id: string }) =>
    safe(() => {
      const row = db
        .prepare(`SELECT ${SELECT_FIELDS} FROM projects WHERE id = ?`)
        .get(payload?.id) as Row | undefined;
      return row ?? null;
    }),
  );

  ipcMain.handle(
    "projects:update",
    (_e, payload: { id: string; patch: Record<string, unknown> }) =>
      safe(() => {
        const id = String(payload?.id ?? "").trim();
        if (!id) throw new Error("id is required");
        const patch = payload?.patch ?? {};

        const sets: string[] = [];
        const args: unknown[] = [];
        for (const [key, value] of Object.entries(patch)) {
          if (!EDITABLE.has(key)) continue; // ignore anything not whitelisted
          if (key === "status" && !VALID_STATUS.has(String(value))) {
            throw new Error(`Invalid status: ${String(value)}`);
          }
          sets.push(`${key} = ?`);
          args.push(value === null || value === undefined ? null : String(value));
        }
        if (sets.length === 0) throw new Error("No editable fields in patch");

        sets.push("last_worked_at = ?");
        args.push(new Date().toISOString());
        sets.push("updated_at = datetime('now')");
        sets.push("last_active_at = datetime('now')");

        const info = db
          .prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`)
          .run(...args, id);
        if (info.changes === 0) throw new Error(`No project found for id ${id}`);

        return db
          .prepare(`SELECT ${SELECT_FIELDS} FROM projects WHERE id = ?`)
          .get(id) as Row;
      }),
  );
}
