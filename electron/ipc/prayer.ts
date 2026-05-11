/**
 * Prayer Journal — faith-driven, durable, queryable.
 *
 * Two tables:
 *   prayer_requests — what you're praying for (active / answered / archived)
 *   prayer_log      — when you actually prayed (sessions, durations, notes)
 *
 * Designed so Henry's memory layer can pull "your active prayers", "recent
 * answered prayers", and "prayer streak" without an LLM round-trip.
 *
 * Categories follow classic Christian devotional patterns:
 *   intercession  — praying for others
 *   thanksgiving  — gratitude
 *   confession    — acknowledging sin / asking forgiveness
 *   petition      — asking for yourself
 *   lament        — bringing grief / hard things to God
 *   praise        — adoration / worship
 *
 * No AI cost on any read — all stats are computed in SQL.
 */

import { ipcMain } from 'electron';
import type Database from 'better-sqlite3';

let db: Database.Database;

const VALID_CATEGORIES = [
  'intercession',
  'thanksgiving',
  'confession',
  'petition',
  'lament',
  'praise',
] as const;
const VALID_STATUS = ['active', 'answered', 'archived'] as const;
const VALID_URGENCY = ['low', 'normal', 'high'] as const;

type PrayerRequestRow = {
  id: string;
  title: string;
  body: string | null;
  category: string;
  status: string;
  urgency: string;
  for_whom: string | null;
  scripture_ref: string | null;
  answer_note: string | null;
  answered_at: string | null;
  created_at: string;
  updated_at: string;
};

type PrayerLogRow = {
  id: string;
  request_id: string | null;
  duration_minutes: number;
  notes: string | null;
  scripture_ref: string | null;
  prayed_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function safe<T>(fn: () => T): { ok: true; data: T } | { ok: false; error: string } {
  try {
    return { ok: true, data: fn() };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

export function registerPrayerHandlers(database: Database.Database) {
  db = database;

  // ── Schema ──────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS prayer_requests (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT,
      category TEXT NOT NULL DEFAULT 'petition',
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active','answered','archived')),
      urgency TEXT NOT NULL DEFAULT 'normal'
        CHECK(urgency IN ('low','normal','high')),
      for_whom TEXT,
      scripture_ref TEXT,
      answer_note TEXT,
      answered_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_prayer_requests_status
      ON prayer_requests(status, urgency, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_prayer_requests_category
      ON prayer_requests(category, status);

    CREATE TABLE IF NOT EXISTS prayer_log (
      id TEXT PRIMARY KEY,
      request_id TEXT,
      duration_minutes REAL DEFAULT 0,
      notes TEXT,
      scripture_ref TEXT,
      prayed_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(request_id) REFERENCES prayer_requests(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_prayer_log_request
      ON prayer_log(request_id, prayed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_prayer_log_date
      ON prayer_log(prayed_at DESC);
  `);

  // ── prayer_requests CRUD ────────────────────────────────────────────────

  ipcMain.handle('prayer:requests:list', (_e, filter?: {
    status?: 'active' | 'answered' | 'archived' | 'all';
    category?: string;
    limit?: number;
  }) => safe(() => {
    const status = filter?.status ?? 'active';
    const limit = Math.min(Math.max(1, filter?.limit ?? 200), 500);

    let where = '1=1';
    const params: (string | number)[] = [];
    if (status !== 'all') {
      where += ' AND status = ?';
      params.push(status);
    }
    if (filter?.category && (VALID_CATEGORIES as readonly string[]).includes(filter.category)) {
      where += ' AND category = ?';
      params.push(filter.category);
    }

    const rows = db
      .prepare(
        `SELECT * FROM prayer_requests
         WHERE ${where}
         ORDER BY
           CASE urgency WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
           datetime(created_at) DESC
         LIMIT ?`,
      )
      .all(...params, limit) as PrayerRequestRow[];

    // Attach prayer_count per request (no separate round-trip)
    const counts = db
      .prepare(
        `SELECT request_id, COUNT(*) AS n, MAX(prayed_at) AS last
         FROM prayer_log
         WHERE request_id IS NOT NULL
         GROUP BY request_id`,
      )
      .all() as { request_id: string; n: number; last: string }[];
    const byId = new Map(counts.map((c) => [c.request_id, c]));

    return rows.map((r) => ({
      ...r,
      prayer_count: byId.get(r.id)?.n ?? 0,
      last_prayed_at: byId.get(r.id)?.last ?? null,
    }));
  }));

  ipcMain.handle('prayer:requests:get', (_e, id: string) => safe(() => {
    return db.prepare(`SELECT * FROM prayer_requests WHERE id = ?`).get(id) as
      | PrayerRequestRow
      | undefined;
  }));

  ipcMain.handle('prayer:requests:create', (_e, payload: Partial<PrayerRequestRow>) =>
    safe(() => {
      const title = (payload.title ?? '').toString().trim();
      if (!title) throw new Error('Title required');

      const category = (VALID_CATEGORIES as readonly string[]).includes(
        payload.category ?? '',
      )
        ? (payload.category as string)
        : 'petition';
      const urgency = (VALID_URGENCY as readonly string[]).includes(payload.urgency ?? '')
        ? (payload.urgency as string)
        : 'normal';

      const id = newId('pr');
      const now = nowIso();
      db.prepare(
        `INSERT INTO prayer_requests
         (id, title, body, category, status, urgency, for_whom, scripture_ref, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      ).run(
        id,
        title,
        payload.body ?? null,
        category,
        urgency,
        payload.for_whom ?? null,
        payload.scripture_ref ?? null,
        now,
        now,
      );
      return db.prepare(`SELECT * FROM prayer_requests WHERE id = ?`).get(id);
    }),
  );

  ipcMain.handle('prayer:requests:update', (_e, payload: { id: string } & Partial<PrayerRequestRow>) =>
    safe(() => {
      if (!payload.id) throw new Error('id required');
      const existing = db
        .prepare(`SELECT * FROM prayer_requests WHERE id = ?`)
        .get(payload.id) as PrayerRequestRow | undefined;
      if (!existing) throw new Error('Prayer request not found');

      const fields: string[] = [];
      const values: unknown[] = [];

      const writable: (keyof PrayerRequestRow)[] = [
        'title',
        'body',
        'category',
        'urgency',
        'for_whom',
        'scripture_ref',
      ];
      for (const k of writable) {
        if (payload[k] !== undefined) {
          if (k === 'category' && !(VALID_CATEGORIES as readonly string[]).includes(payload[k] as string)) continue;
          if (k === 'urgency' && !(VALID_URGENCY as readonly string[]).includes(payload[k] as string)) continue;
          fields.push(`${k} = ?`);
          values.push(payload[k] ?? null);
        }
      }
      fields.push(`updated_at = ?`);
      values.push(nowIso());
      values.push(payload.id);
      db.prepare(`UPDATE prayer_requests SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      return db.prepare(`SELECT * FROM prayer_requests WHERE id = ?`).get(payload.id);
    }),
  );

  ipcMain.handle('prayer:requests:setStatus', (_e, payload: {
    id: string;
    status: 'active' | 'answered' | 'archived';
    answer_note?: string;
  }) => safe(() => {
    if (!payload.id) throw new Error('id required');
    if (!(VALID_STATUS as readonly string[]).includes(payload.status))
      throw new Error('Invalid status');

    const answeredAt = payload.status === 'answered' ? nowIso() : null;
    db.prepare(
      `UPDATE prayer_requests
       SET status = ?, answer_note = ?, answered_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      payload.status,
      payload.answer_note ?? null,
      answeredAt,
      nowIso(),
      payload.id,
    );
    return db.prepare(`SELECT * FROM prayer_requests WHERE id = ?`).get(payload.id);
  }));

  ipcMain.handle('prayer:requests:delete', (_e, id: string) => safe(() => {
    db.prepare(`DELETE FROM prayer_requests WHERE id = ?`).run(id);
    return { id };
  }));

  // ── prayer_log ──────────────────────────────────────────────────────────

  ipcMain.handle('prayer:log:add', (_e, payload: {
    request_id?: string | null;
    duration_minutes?: number;
    notes?: string;
    scripture_ref?: string;
    prayed_at?: string;
  }) => safe(() => {
    const id = newId('pl');
    db.prepare(
      `INSERT INTO prayer_log (id, request_id, duration_minutes, notes, scripture_ref, prayed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      payload.request_id ?? null,
      Math.max(0, Number(payload.duration_minutes ?? 0)),
      payload.notes ?? null,
      payload.scripture_ref ?? null,
      payload.prayed_at ?? nowIso(),
    );
    return db.prepare(`SELECT * FROM prayer_log WHERE id = ?`).get(id);
  }));

  ipcMain.handle('prayer:log:list', (_e, filter?: {
    request_id?: string;
    sinceDays?: number;
    limit?: number;
  }) => safe(() => {
    const limit = Math.min(Math.max(1, filter?.limit ?? 200), 500);
    let where = '1=1';
    const params: (string | number)[] = [];
    if (filter?.request_id) {
      where += ' AND request_id = ?';
      params.push(filter.request_id);
    }
    if (filter?.sinceDays && filter.sinceDays > 0) {
      where += ` AND datetime(prayed_at) >= datetime('now', ?)`;
      params.push(`-${Math.floor(filter.sinceDays)} days`);
    }
    const rows = db
      .prepare(
        `SELECT * FROM prayer_log
         WHERE ${where}
         ORDER BY datetime(prayed_at) DESC
         LIMIT ?`,
      )
      .all(...params, limit) as PrayerLogRow[];
    return rows;
  }));

  ipcMain.handle('prayer:log:delete', (_e, id: string) => safe(() => {
    db.prepare(`DELETE FROM prayer_log WHERE id = ?`).run(id);
    return { id };
  }));

  // ── Stats / dashboard (zero AI cost) ────────────────────────────────────

  ipcMain.handle('prayer:stats:summary', () => safe(() => {
    const totals = db
      .prepare(
        `SELECT
           SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active_count,
           SUM(CASE WHEN status='answered' THEN 1 ELSE 0 END) AS answered_count,
           SUM(CASE WHEN status='archived' THEN 1 ELSE 0 END) AS archived_count,
           COUNT(*) AS total
         FROM prayer_requests`,
      )
      .get() as Record<string, number | null>;

    const totalLog = db
      .prepare(
        `SELECT
           COUNT(*) AS sessions,
           COALESCE(SUM(duration_minutes),0) AS total_minutes
         FROM prayer_log`,
      )
      .get() as { sessions: number; total_minutes: number };

    const last7 = db
      .prepare(
        `SELECT COUNT(*) AS sessions, COALESCE(SUM(duration_minutes),0) AS total_minutes
         FROM prayer_log
         WHERE datetime(prayed_at) >= datetime('now','-7 days')`,
      )
      .get() as { sessions: number; total_minutes: number };

    const last30 = db
      .prepare(
        `SELECT COUNT(*) AS sessions, COALESCE(SUM(duration_minutes),0) AS total_minutes
         FROM prayer_log
         WHERE datetime(prayed_at) >= datetime('now','-30 days')`,
      )
      .get() as { sessions: number; total_minutes: number };

    // Streak: count consecutive days back from today with at least one entry.
    // Pull last 60 distinct days then walk.
    const days = db
      .prepare(
        `SELECT DISTINCT date(prayed_at) AS d
         FROM prayer_log
         WHERE datetime(prayed_at) >= datetime('now','-90 days')
         ORDER BY d DESC
         LIMIT 90`,
      )
      .all() as { d: string }[];

    const daySet = new Set(days.map((x) => x.d));
    const today = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    let streak = 0;
    const cursor = new Date(today);
    // If they haven't prayed today yet, start streak from yesterday so they don't lose it mid-day
    if (!daySet.has(fmt(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (daySet.has(fmt(cursor))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    return {
      active_count: totals.active_count ?? 0,
      answered_count: totals.answered_count ?? 0,
      archived_count: totals.archived_count ?? 0,
      total_requests: totals.total ?? 0,
      total_sessions: totalLog.sessions ?? 0,
      total_minutes: totalLog.total_minutes ?? 0,
      last7_sessions: last7.sessions ?? 0,
      last7_minutes: last7.total_minutes ?? 0,
      last30_sessions: last30.sessions ?? 0,
      last30_minutes: last30.total_minutes ?? 0,
      streak_days: streak,
    };
  }));

  ipcMain.handle('prayer:stats:answered', (_e, opts?: { limit?: number }) => safe(() => {
    const limit = Math.min(Math.max(1, opts?.limit ?? 25), 200);
    return db
      .prepare(
        `SELECT * FROM prayer_requests
         WHERE status = 'answered'
         ORDER BY datetime(answered_at) DESC
         LIMIT ?`,
      )
      .all(limit) as PrayerRequestRow[];
  }));

  // ── Memory bridge: Henry's chat layer can call this for context ─────────
  ipcMain.handle('prayer:context:forChat', () => safe(() => {
    // Compact context block for LLM injection.
    const active = db
      .prepare(
        `SELECT id, title, category, urgency, for_whom
         FROM prayer_requests
         WHERE status = 'active'
         ORDER BY
           CASE urgency WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
           datetime(created_at) DESC
         LIMIT 12`,
      )
      .all() as Pick<PrayerRequestRow, 'id' | 'title' | 'category' | 'urgency' | 'for_whom'>[];

    const recentAnswered = db
      .prepare(
        `SELECT title, answer_note, answered_at
         FROM prayer_requests
         WHERE status = 'answered'
         ORDER BY datetime(answered_at) DESC
         LIMIT 5`,
      )
      .all() as { title: string; answer_note: string | null; answered_at: string }[];

    return { active, recentAnswered };
  }));
}
