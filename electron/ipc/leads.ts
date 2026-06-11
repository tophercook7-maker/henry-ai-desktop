/**
 * Money Engine IPC (build plan, Phase 3) — the renderer's boundary to the
 * MixedMakerShop lead pipeline. Mirrors the lead agent tools so the panel and
 * Henry-in-chat read/write the same records.
 *
 * Channels (match preload.ts):
 *   - `leads:list`   → all leads (optionally filtered by status)
 *   - `leads:create` → add a lead
 *   - `leads:update` → patch a lead's editable fields by id
 *   - `leads:delete` → remove a lead by id
 *
 * Every handler returns `{ ok, result }` | `{ ok, error }`.
 */

import { ipcMain } from 'electron';
import type Database from 'better-sqlite3';

type Row = Record<string, unknown>;

const FIELDS = `id, business, contact_name, phone, email, website, source, status,
  audit_notes, notes, proposal_amount, next_follow_up, created_at, updated_at, last_touch_at`;

const EDITABLE = new Set([
  'business', 'contact_name', 'phone', 'email', 'website', 'source', 'status',
  'audit_notes', 'notes', 'proposal_amount', 'next_follow_up',
]);

export const LEAD_STATUSES = ['new', 'audited', 'contacted', 'follow_up', 'proposal', 'won', 'lost'] as const;
const VALID_STATUS = new Set<string>(LEAD_STATUSES);

function safe<T>(fn: () => T) {
  try {
    return { ok: true as const, result: fn() };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

function genId(): string {
  return `lead_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function registerLeadHandlers(db: Database.Database): void {
  ipcMain.handle('leads:list', (_e, payload?: { status?: string; limit?: number }) =>
    safe(() => {
      const limit = Math.min(Number(payload?.limit) || 500, 1000);
      const status = payload?.status;
      const sql = status
        ? `SELECT ${FIELDS} FROM leads WHERE status = ? ORDER BY updated_at DESC LIMIT ?`
        : `SELECT ${FIELDS} FROM leads ORDER BY updated_at DESC LIMIT ?`;
      return (status ? db.prepare(sql).all(status, limit) : db.prepare(sql).all(limit)) as Row[];
    }),
  );

  ipcMain.handle('leads:create', (_e, payload: { business: string; [k: string]: unknown }) =>
    safe(() => {
      const business = String(payload?.business ?? '').trim();
      if (!business) throw new Error('A business name is required.');
      const status = payload?.status && VALID_STATUS.has(String(payload.status)) ? String(payload.status) : 'new';
      const id = genId();
      db.prepare(
        `INSERT INTO leads (id, business, contact_name, phone, email, website, source, status, notes, proposal_amount, last_touch_at)
         VALUES (@id, @business, @contact_name, @phone, @email, @website, @source, @status, @notes, @proposal_amount, datetime('now'))`,
      ).run({
        id,
        business,
        contact_name: payload.contact_name != null ? String(payload.contact_name) : null,
        phone: payload.phone != null ? String(payload.phone) : null,
        email: payload.email != null ? String(payload.email) : null,
        website: payload.website != null ? String(payload.website) : null,
        source: payload.source != null ? String(payload.source) : null,
        status,
        notes: payload.notes != null ? String(payload.notes) : null,
        proposal_amount: payload.proposal_amount != null ? Number(payload.proposal_amount) : null,
      });
      return db.prepare(`SELECT ${FIELDS} FROM leads WHERE id = ?`).get(id) as Row;
    }),
  );

  ipcMain.handle('leads:update', (_e, payload: { id: string; patch: Record<string, unknown> }) =>
    safe(() => {
      const id = String(payload?.id ?? '').trim();
      if (!id) throw new Error('id is required');
      const patch = payload?.patch ?? {};
      const sets: string[] = [];
      const args: unknown[] = [];
      for (const [key, value] of Object.entries(patch)) {
        if (!EDITABLE.has(key)) continue;
        if (key === 'status' && !VALID_STATUS.has(String(value))) throw new Error(`Invalid status: ${String(value)}`);
        sets.push(`${key} = ?`);
        if (key === 'proposal_amount') args.push(value == null ? null : Number(value));
        else args.push(value == null ? null : String(value));
      }
      if (sets.length === 0) throw new Error('No editable fields in patch');
      sets.push("last_touch_at = datetime('now')", "updated_at = datetime('now')");
      const info = db.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
      if (info.changes === 0) throw new Error(`No lead found for id ${id}`);
      return db.prepare(`SELECT ${FIELDS} FROM leads WHERE id = ?`).get(id) as Row;
    }),
  );

  ipcMain.handle('leads:delete', (_e, payload: { id: string }) =>
    safe(() => {
      const info = db.prepare('DELETE FROM leads WHERE id = ?').run(String(payload?.id ?? ''));
      return { deleted: info.changes > 0 };
    }),
  );
}
