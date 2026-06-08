/**
 * HenryScheduler — Henry's autonomous Routines (design §3).
 *
 * A Routine is a `scheduled_tasks` row: a cron expression + a prompt. On
 * startup the scheduler loads every enabled Routine and registers it with
 * node-cron. When a Routine fires, the scheduler runs its prompt through the
 * full tool suite (the same `runToolConversation` loop the chat path uses),
 * opens a fresh session in the SessionStore for the run, and writes the result
 * back as an assistant message — so the output lands in conversation history
 * with the audit trail of every tool the run called.
 *
 * Renderer signalling:
 *   - `scheduler:task-started`   { id, name }            when a run begins
 *   - `scheduler:task-completed` { id, name, ok, ... }   when a run finishes
 *
 * Safety note: confirm-tier tools (send a message, create an event) still pause
 * for the user via the ToolRunner's confirmation gate. An unattended 7am
 * briefing therefore reads freely but cannot send anything without approval —
 * if no window is present to confirm, the gate fails the action closed.
 */

import cron, { type ScheduledTask as CronJob } from "node-cron";
import type Database from "better-sqlite3";
import type { BrowserWindow } from "electron";
import { randomUUID } from "crypto";

import { registry } from "./toolRegistry";
import { runToolConversation, type RunnerMessage, type ModelCompletion } from "./toolRunner";
import type { ModelTool } from "./types";
import { callAIWithTools } from "../ipc/ai";
import { createSessionRecord, recordSessionMessage } from "../ipc/sessionStore";

type WindowGetter = () => BrowserWindow | null;

/** One Routine, mirroring the `scheduled_tasks` columns exactly. */
export interface ScheduledTask {
  id: string;
  name: string;
  description: string | null;
  cronExpression: string;
  prompt: string;
  enabled: number; // SQLite boolean: 1 | 0
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
}

/** Input shape for `add()` — id/timestamps are filled in by the scheduler. */
export interface NewScheduledTask {
  name: string;
  description?: string;
  cronExpression: string;
  prompt: string;
  enabled?: boolean;
}

/**
 * The four Routines Henry ships with (design §3). All disabled by default —
 * the user opts in from the Routines panel. Seeded only when the table is
 * empty, so user edits/deletes are never clobbered on a later launch.
 */
const DEFAULT_ROUTINES: Array<Omit<NewScheduledTask, "enabled">> = [
  {
    name: "Morning Briefing",
    description: "A 7am rundown of the day ahead.",
    cronExpression: "0 7 * * *",
    prompt:
      "Give me a morning briefing: list today's calendar events, any overdue " +
      "commitments, and open quotes that need follow-up.",
  },
  {
    name: "Evening Wrap",
    description: "End-of-day summary, weekdays at 6pm.",
    cronExpression: "0 18 * * 1-5",
    prompt:
      "End of day summary: what got done today, any commitments due tomorrow, " +
      "anything I should prep tonight.",
  },
  {
    name: "Client Message Watch",
    description: "Checks for new client iMessages every 15 minutes.",
    cronExpression: "*/15 * * * *",
    prompt:
      "Check for any new iMessages from known clients in the last 15 minutes. " +
      "If there are any, summarize them and flag if any need a reply.",
  },
  {
    name: "Pre-appointment Reminder",
    description: "Pulls client context before upcoming appointments (business hours).",
    cronExpression: "*/30 8-17 * * *",
    prompt:
      "Check if any calendar events start in the next 30 minutes. If so, pull " +
      "up the client record and relevant quote/job details.",
  },
];

const SCHEDULED_RUN_SYSTEM_PROMPT =
  "You are Henry, running an autonomous scheduled Routine for your owner — a " +
  "contractor. No one is necessarily watching, so be concise and useful. Use " +
  "your tools to gather what you need (calendar, messages, quotes, memory), " +
  "then write a short, skimmable summary. If nothing is noteworthy, say so " +
  "plainly rather than padding. Outbound actions (sending a message, creating " +
  "an event) will pause for the owner's approval, so it is fine to draft them.";

export class HenryScheduler {
  private jobs = new Map<string, CronJob>();
  private firing = new Set<string>(); // guards against overlapping runs

  constructor(
    private db: Database.Database,
    private getWindow: WindowGetter,
  ) {}

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /** Seed defaults (first run only), then register every enabled Routine. */
  init(): void {
    this.seedDefaults();
    const tasks = this.db
      .prepare("SELECT * FROM scheduled_tasks WHERE enabled = 1")
      .all() as ScheduledTask[];
    for (const task of tasks) this.register(task);
    console.log(`[scheduler] initialized — ${this.jobs.size} active Routine(s)`);
  }

  /** Stop every cron job. Called on app quit. */
  shutdown(): void {
    for (const [, job] of this.jobs) {
      try {
        void job.stop();
      } catch {
        /* best effort */
      }
    }
    this.jobs.clear();
  }

  private seedDefaults(): void {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM scheduled_tasks")
      .get() as { n: number };
    if (row.n > 0) return;

    const insert = this.db.prepare(
      `INSERT INTO scheduled_tasks (id, name, description, cronExpression, prompt, enabled, createdAt)
       VALUES (?, ?, ?, ?, ?, 0, datetime('now'))`,
    );
    const seed = this.db.transaction(() => {
      for (const r of DEFAULT_ROUTINES) {
        insert.run(randomUUID(), r.name, r.description ?? null, r.cronExpression, r.prompt);
      }
    });
    seed();
    console.log(`[scheduler] seeded ${DEFAULT_ROUTINES.length} default Routines (disabled)`);
  }

  // ── node-cron registration ─────────────────────────────────────────────

  /** Register (or re-register) a task's cron job and stamp its next run. */
  private register(task: ScheduledTask): void {
    this.unregister(task.id);

    if (!cron.validate(task.cronExpression)) {
      console.error(
        `[scheduler] invalid cron "${task.cronExpression}" for Routine ${task.id} (${task.name}) — skipping`,
      );
      return;
    }

    const job = cron.schedule(
      task.cronExpression,
      () => {
        void this.fire(task.id);
      },
      { name: `henry-routine-${task.id}` },
    );
    this.jobs.set(task.id, job);

    // Persist the computed next-run time for the panel to display.
    const next = this.nextRunOf(job);
    this.db
      .prepare("UPDATE scheduled_tasks SET nextRunAt = ? WHERE id = ?")
      .run(next, task.id);
  }

  private unregister(id: string): void {
    const job = this.jobs.get(id);
    if (job) {
      try {
        void job.stop();
      } catch {
        /* best effort */
      }
      this.jobs.delete(id);
    }
    // Clear the stale next-run stamp when a Routine is no longer scheduled.
    this.db.prepare("UPDATE scheduled_tasks SET nextRunAt = NULL WHERE id = ?").run(id);
  }

  private nextRunOf(job: CronJob): string | null {
    try {
      const next = job.getNextRun();
      return next ? next.toISOString() : null;
    } catch {
      return null;
    }
  }

  // ── Public API (backs the IPC handlers) ─────────────────────────────────

  listTasks(): ScheduledTask[] {
    return this.db
      .prepare("SELECT * FROM scheduled_tasks ORDER BY createdAt ASC")
      .all() as ScheduledTask[];
  }

  add(task: NewScheduledTask): ScheduledTask {
    if (!task.name?.trim()) throw new Error("Routine name is required.");
    if (!task.cronExpression?.trim()) throw new Error("Cron expression is required.");
    if (!task.prompt?.trim()) throw new Error("Prompt is required.");
    if (!cron.validate(task.cronExpression.trim())) {
      throw new Error(`Invalid cron expression: "${task.cronExpression}"`);
    }

    const id = randomUUID();
    const enabled = task.enabled ? 1 : 0;
    this.db
      .prepare(
        `INSERT INTO scheduled_tasks (id, name, description, cronExpression, prompt, enabled, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        id,
        task.name.trim(),
        task.description?.trim() || null,
        task.cronExpression.trim(),
        task.prompt.trim(),
        enabled,
      );

    const row = this.getRow(id)!;
    if (enabled) this.register(row);
    return this.getRow(id)!;
  }

  remove(id: string): boolean {
    this.unregister(id);
    const info = this.db.prepare("DELETE FROM scheduled_tasks WHERE id = ?").run(id);
    return info.changes > 0;
  }

  enable(id: string): ScheduledTask | null {
    const row = this.getRow(id);
    if (!row) return null;
    this.db.prepare("UPDATE scheduled_tasks SET enabled = 1 WHERE id = ?").run(id);
    this.register(this.getRow(id)!);
    return this.getRow(id);
  }

  disable(id: string): ScheduledTask | null {
    const row = this.getRow(id);
    if (!row) return null;
    this.db.prepare("UPDATE scheduled_tasks SET enabled = 0 WHERE id = ?").run(id);
    this.unregister(id);
    return this.getRow(id);
  }

  /** Fire a Routine immediately, regardless of its schedule or enabled state. */
  async runNow(id: string): Promise<{ ok: boolean; content?: string; error?: string }> {
    const row = this.getRow(id);
    if (!row) return { ok: false, error: `No Routine found for id "${id}"` };
    return this.fire(id);
  }

  private getRow(id: string): ScheduledTask | null {
    return (
      (this.db
        .prepare("SELECT * FROM scheduled_tasks WHERE id = ?")
        .get(id) as ScheduledTask | undefined) ?? null
    );
  }

  // ── Firing a Routine ─────────────────────────────────────────────────────

  private async fire(
    id: string,
  ): Promise<{ ok: boolean; content?: string; error?: string }> {
    const task = this.getRow(id);
    if (!task) return { ok: false, error: "Routine not found" };

    // Skip if a previous run of this Routine is still in flight (e.g. a long
    // model turn overrunning a */15 cadence).
    if (this.firing.has(id)) {
      console.warn(`[scheduler] Routine ${task.name} still running — skipping this tick`);
      return { ok: false, error: "Previous run still in progress" };
    }
    this.firing.add(id);

    this.send("scheduler:task-started", { id: task.id, name: task.name });
    const startedAt = new Date().toISOString();

    let sessionId: string | null = null;
    try {
      // Open a session so the run's output + tool-call audit trail are recorded.
      sessionId =
        (await createSessionRecord({
          title: `Routine: ${task.name}`,
          origin: "schedule",
          system_prompt: SCHEDULED_RUN_SYSTEM_PROMPT,
        }).catch(() => null)) ?? randomUUID();

      await recordSessionMessage({
        session_id: sessionId,
        role: "user",
        kind: "chat",
        content: task.prompt,
      }).catch(() => {});

      const content = await this.runPrompt(task.prompt, sessionId);

      await recordSessionMessage({
        session_id: sessionId,
        role: "assistant",
        kind: "chat",
        content,
      }).catch(() => {});

      // Stamp last/next run.
      const job = this.jobs.get(id);
      const next = job ? this.nextRunOf(job) : null;
      this.db
        .prepare("UPDATE scheduled_tasks SET lastRunAt = ?, nextRunAt = ? WHERE id = ?")
        .run(startedAt, next, id);

      this.send("scheduler:task-completed", {
        id: task.id,
        name: task.name,
        ok: true,
        sessionId,
        content,
      });
      return { ok: true, content };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.error(`[scheduler] Routine ${task.name} failed:`, error);
      this.db
        .prepare("UPDATE scheduled_tasks SET lastRunAt = ? WHERE id = ?")
        .run(startedAt, id);
      this.send("scheduler:task-completed", {
        id: task.id,
        name: task.name,
        ok: false,
        sessionId,
        error,
      });
      return { ok: false, error };
    } finally {
      this.firing.delete(id);
    }
  }

  /**
   * Run a single prompt through the full tool suite. Resolves the worker engine
   * config (provider/model/key) the same way the task broker does, builds the
   * `complete` callback over `callAIWithTools`, and drives the tool-call loop.
   */
  private async runPrompt(prompt: string, sessionId: string): Promise<string> {
    const { provider, model, apiKey } = this.resolveEngine();

    const messages: RunnerMessage[] = [
      { role: "system", content: SCHEDULED_RUN_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ];

    const complete = (msgs: RunnerMessage[], modelTools: ModelTool[]): Promise<ModelCompletion> =>
      callAIWithTools({ provider, model, apiKey, messages: msgs, modelTools });

    const context = {
      db: this.db,
      getWindow: this.getWindow,
      sessionId,
    };

    const result = await runToolConversation({ registry, context, messages, complete });
    return result.content;
  }

  /**
   * Resolve the engine a Routine runs on. Routines use the Worker engine
   * (same as background tasks) so they don't depend on the chat UI's current
   * model selection. Mirrors `getWorkerEngineConfig` in taskBroker.ts.
   */
  private resolveEngine(): { provider: string; model: string; apiKey: string } {
    const get = (key: string): string =>
      (
        (this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
          | { value?: string }
          | undefined)?.value ?? ""
      ).trim();

    const providerId = get("worker_provider");
    const model = get("worker_model");
    if (!providerId || !model) {
      throw new Error(
        "Worker engine is not configured. Open Settings and choose a Worker provider/model so Routines can run.",
      );
    }

    const provider = this.db
      .prepare("SELECT * FROM providers WHERE id = ?")
      .get(providerId) as { id: string; name: string; api_key?: string } | undefined;
    if (!provider) {
      throw new Error("Worker provider not found. Reconfigure the Worker engine in Settings.");
    }

    const isOllama =
      (provider.id || "").toLowerCase() === "ollama" ||
      (provider.name || "").toLowerCase() === "ollama";
    if (!isOllama && !provider.api_key) {
      throw new Error(`Worker provider "${provider.name}" is missing an API key.`);
    }

    return { provider: providerId, model, apiKey: provider.api_key ?? "" };
  }

  // ── Renderer signalling ─────────────────────────────────────────────────

  private send(channel: string, data: unknown): void {
    const win = this.getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, data);
  }
}
