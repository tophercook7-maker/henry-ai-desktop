/**
 * Scheduler IPC — the renderer's boundary to Henry's Routines (design §6).
 *
 * Channels (match preload.ts):
 *   - `scheduler:list`     → every Routine with its status/next-run
 *   - `scheduler:add`      → create a new Routine
 *   - `scheduler:toggle`   → enable/disable a Routine by id
 *   - `scheduler:run-now`  → fire a Routine immediately
 *   - `scheduler:delete`   → remove a Routine
 *
 * The `HenryScheduler` instance is owned by main.ts and handed in here so the
 * cron jobs and the IPC surface share one source of truth.
 */

import { ipcMain } from "electron";
import type { HenryScheduler, NewScheduledTask } from "../agent/scheduler";

/** Wrap a handler so the renderer always gets `{ ok, result }` | `{ ok, error }`. */
function safe<T>(fn: () => T | Promise<T>) {
  return async () => {
    try {
      return { ok: true, result: await fn() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };
}

export function registerSchedulerHandlers(scheduler: HenryScheduler): void {
  ipcMain.handle("scheduler:list", () => {
    try {
      return { ok: true, result: scheduler.listTasks() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle("scheduler:add", (_e, task: NewScheduledTask) =>
    safe(() => scheduler.add(task))(),
  );

  ipcMain.handle(
    "scheduler:toggle",
    (_e, payload: { id: string; enabled: boolean }) =>
      safe(() =>
        payload.enabled ? scheduler.enable(payload.id) : scheduler.disable(payload.id),
      )(),
  );

  ipcMain.handle("scheduler:run-now", (_e, payload: { id: string }) =>
    safe(() => scheduler.runNow(payload.id))(),
  );

  ipcMain.handle("scheduler:delete", (_e, payload: { id: string }) =>
    safe(() => scheduler.remove(payload.id))(),
  );
}
