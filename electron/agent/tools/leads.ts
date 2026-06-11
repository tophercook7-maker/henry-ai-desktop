/**
 * Lead tools — the Money Engine's write/read surface for the agent layer
 * (build plan, Phase 3). These let Henry-in-chat and the Money Crew populate
 * and move the MixedMakerShop lead pipeline.
 *
 * Reads are `silent`; writes (add / update) are `notify` — they touch Henry's
 * own data, not the outside world, so they run immediately with a toast. No
 * lead tool ever contacts anyone; outreach stays a draft until Topher sends it.
 */

import type { ToolDefinition, ToolResult } from '../types';

type Row = Record<string, unknown>;

const STATUSES = ['new', 'audited', 'contacted', 'follow_up', 'proposal', 'won', 'lost'];
const VALID = new Set(STATUSES);

const FIELDS = `id, business, contact_name, phone, email, website, source, status,
  audit_notes, notes, proposal_amount, next_follow_up, updated_at`;

function ok(data: unknown): ToolResult { return { ok: true, data }; }
function fail(error: string): ToolResult { return { ok: false, error }; }
function like(s: string): string { return `%${s.trim()}%`; }

export function leadTools(): ToolDefinition[] {
  return [
    {
      name: 'lead_add',
      description:
        'Add a prospect to the MixedMakerShop lead pipeline. Use when you find a ' +
        'business that might need a website. Captures the business name and any ' +
        'detail you have (contact, phone, website, where you found them).',
      category: 'finance',
      safetyLevel: 'notify',
      confirmPrompt: (p) => `Add lead "${String(p.business)}" to the pipeline`,
      inputSchema: {
        type: 'object',
        properties: {
          business: { type: 'string', description: 'Business name (required).' },
          contact_name: { type: 'string', description: 'Contact person.' },
          phone: { type: 'string' },
          email: { type: 'string' },
          website: { type: 'string', description: "Their current site, if any." },
          source: { type: 'string', description: 'Where you found them (Facebook, referral, walk-by).' },
          notes: { type: 'string' },
        },
        required: ['business'],
        additionalProperties: false,
      },
      async execute(params, { db }) {
        try {
          const business = String(params.business ?? '').trim();
          if (!business) return fail('business is required');
          const id = `lead_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
          db.prepare(
            `INSERT INTO leads (id, business, contact_name, phone, email, website, source, notes, status, last_touch_at)
             VALUES (@id, @business, @contact_name, @phone, @email, @website, @source, @notes, 'new', datetime('now'))`,
          ).run({
            id,
            business,
            contact_name: params.contact_name != null ? String(params.contact_name) : null,
            phone: params.phone != null ? String(params.phone) : null,
            email: params.email != null ? String(params.email) : null,
            website: params.website != null ? String(params.website) : null,
            source: params.source != null ? String(params.source) : null,
            notes: params.notes != null ? String(params.notes) : null,
          });
          const lead = db.prepare(`SELECT ${FIELDS} FROM leads WHERE id = ?`).get(id) as Row;
          return ok({ added: true, lead });
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    },
    {
      name: 'lead_list',
      description:
        'List leads in the MixedMakerShop pipeline, optionally filtered by stage ' +
        '(new, audited, contacted, follow_up, proposal, won, lost).',
      category: 'finance',
      safetyLevel: 'silent',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: STATUSES, description: 'Filter by pipeline stage.' },
          limit: { type: 'number', description: 'Max results (default 50).' },
        },
        additionalProperties: false,
      },
      async execute(params, { db }) {
        try {
          const limit = Math.min(Number(params.limit) || 50, 200);
          const status = params.status ? String(params.status) : '';
          const rows = status
            ? (db.prepare(`SELECT ${FIELDS} FROM leads WHERE status = ? ORDER BY updated_at DESC LIMIT ?`).all(status, limit) as Row[])
            : (db.prepare(`SELECT ${FIELDS} FROM leads ORDER BY updated_at DESC LIMIT ?`).all(limit) as Row[]);
          return ok({ status: status || 'all', leads: rows, count: rows.length });
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    },
    {
      name: 'lead_update',
      description:
        'Update a lead by business name (fuzzy match). Move it through the ' +
        'pipeline (status), record audit notes, set a proposal amount or a ' +
        'follow-up date, or append a note. Only fields you pass change.',
      category: 'finance',
      safetyLevel: 'notify',
      confirmPrompt: (p) => `Update lead "${String(p.business)}"`,
      inputSchema: {
        type: 'object',
        properties: {
          business: { type: 'string', description: 'Business name to match (fuzzy).' },
          status: { type: 'string', enum: STATUSES, description: 'Move to this pipeline stage.' },
          audit_notes: { type: 'string', description: 'What the site audit found.' },
          proposal_amount: { type: 'number', description: 'Quoted amount.' },
          next_follow_up: { type: 'string', description: 'Next follow-up date (ISO or plain).' },
          note: { type: 'string', description: 'A note to append.' },
        },
        required: ['business'],
        additionalProperties: false,
      },
      async execute(params, { db }) {
        try {
          const business = String(params.business ?? '').trim();
          if (!business) return fail('business is required');
          const lead = db
            .prepare(`SELECT id, notes FROM leads WHERE business = ? COLLATE NOCASE OR business LIKE ? ORDER BY (business = ? COLLATE NOCASE) DESC LIMIT 1`)
            .get(business, like(business), business) as { id: string; notes: string | null } | undefined;
          if (!lead) return fail(`No lead found matching "${business}".`);

          const sets: string[] = [];
          const args: unknown[] = [];
          if (typeof params.status === 'string') {
            if (!VALID.has(params.status)) return fail(`Invalid status: ${params.status}`);
            sets.push('status = ?'); args.push(params.status);
          }
          if (typeof params.audit_notes === 'string') { sets.push('audit_notes = ?'); args.push(params.audit_notes); }
          if (params.proposal_amount != null) { sets.push('proposal_amount = ?'); args.push(Number(params.proposal_amount)); }
          if (typeof params.next_follow_up === 'string') { sets.push('next_follow_up = ?'); args.push(params.next_follow_up); }
          if (typeof params.note === 'string' && params.note.trim()) {
            const stamp = new Date().toISOString().slice(0, 10);
            sets.push('notes = ?');
            args.push(`${lead.notes ? lead.notes + '\n' : ''}[${stamp}] ${params.note.trim()}`);
          }
          if (sets.length === 0) return fail('Nothing to update — pass at least one field.');
          sets.push("last_touch_at = datetime('now')", "updated_at = datetime('now')");
          db.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).run(...args, lead.id);
          const updated = db.prepare(`SELECT ${FIELDS} FROM leads WHERE id = ?`).get(lead.id) as Row;
          return ok({ updated: true, lead: updated });
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    },
  ];
}
