/**
 * Local scripture store — SQLite + IPC (lean lookup, no remote API).
 */

import { dialog, ipcMain, type BrowserWindow } from 'electron';
import fs from 'fs';
import type Database from 'better-sqlite3';
import { parseScriptureReference } from '../../src/henry/scriptureReference';
import type { ScriptureEntry } from '../../src/henry/scriptureStore';

const NOT_FOUND_GUIDANCE =
  'This passage is not in Henry’s local scripture store yet. Do not invent verse text. Offer to discuss the topic from general knowledge only if clearly labeled as commentary or interpretation, or suggest the user import a JSON bundle for this translation.';

const PARSE_FAIL_GUIDANCE =
  'The user’s message did not match a parsable reference. Do not guess a passage; ask for a clear reference (e.g. John 3:16) if needed.';

function rowToEntry(row: Record<string, unknown>): ScriptureEntry {
  return {
    id: String(row.id),
    reference: String(row.reference),
    normalizedReference: String(row.normalized_reference),
    book: String(row.book),
    bookSlug: String(row.book_slug),
    chapter: Number(row.chapter),
    verseStart: Number(row.verse_start),
    verseEnd: Number(row.verse_end),
    text: String(row.text),
    sourceProfileId: row.source_profile_id != null ? String(row.source_profile_id) : null,
    sourceLabel: row.source_label != null ? String(row.source_label) : null,
    notes: row.notes != null ? String(row.notes) : null,
    createdAt: String(row.created_at),
  };
}

type WindowGetter = () => BrowserWindow | null;

export function registerScriptureHandlers(db: Database.Database, getWindow?: WindowGetter) {
  ipcMain.handle('scripture:lookup', async (_event, reference: string) => {
    const trimmed = typeof reference === 'string' ? reference.trim() : '';
    if (!trimmed) {
      return {
        found: false,
        parsed: null,
        parseError: 'Empty reference.',
        guidance: PARSE_FAIL_GUIDANCE,
      };
    }

    const pr = parseScriptureReference(trimmed);
    if (!pr.ok) {
      return {
        found: false,
        parsed: null,
        parseError: pr.error,
        guidance: PARSE_FAIL_GUIDANCE,
      };
    }

    const row = db
      .prepare(
        `SELECT * FROM scripture_entries WHERE normalized_reference = ? LIMIT 1`
      )
      .get(pr.value.normalizedReference) as Record<string, unknown> | undefined;

    if (!row) {
      return {
        found: false,
        parsed: pr.value,
        normalizedReference: pr.value.normalizedReference,
        guidance: NOT_FOUND_GUIDANCE,
      };
    }

    const entry = rowToEntry(row);
    return {
      found: true,
      parsed: pr.value,
      normalizedReference: entry.normalizedReference,
      text: entry.text,
      sourceProfileId: entry.sourceProfileId,
      sourceLabel: entry.sourceLabel,
      notes: entry.notes,
      entry,
    };
  });

  ipcMain.handle(
    'scripture:import',
    async (
      _event,
      payload: {
        entries: Array<{
          reference: string;
          text: string;
          sourceProfileId?: string;
          sourceLabel?: string;
          notes?: string;
        }>;
      }
    ) => {
      const list = Array.isArray(payload?.entries) ? payload.entries : [];
      const errors: string[] = [];
      let imported = 0;

      const insert = db.prepare(`
        INSERT INTO scripture_entries (
          id, normalized_reference, reference, book, book_slug, chapter, verse_start, verse_end,
          text, source_profile_id, source_label, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(normalized_reference) DO UPDATE SET
          reference = excluded.reference,
          book = excluded.book,
          book_slug = excluded.book_slug,
          chapter = excluded.chapter,
          verse_start = excluded.verse_start,
          verse_end = excluded.verse_end,
          text = excluded.text,
          source_profile_id = excluded.source_profile_id,
          source_label = excluded.source_label,
          notes = excluded.notes,
          created_at = excluded.created_at
      `);

      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (!e || typeof e.reference !== 'string' || typeof e.text !== 'string') {
          errors.push(`Row ${i}: missing reference or text.`);
          continue;
        }
        const pr = parseScriptureReference(e.reference.trim());
        if (!pr.ok) {
          errors.push(`Row ${i} (${e.reference}): ${pr.error}`);
          continue;
        }
        const v = pr.value;
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        try {
          insert.run(
            id,
            v.normalizedReference,
            v.rawInput,
            v.book,
            v.bookSlug,
            v.chapter,
            v.verseStart,
            v.verseEnd,
            e.text.trim(),
            e.sourceProfileId?.trim() || null,
            e.sourceLabel?.trim() || null,
            e.notes?.trim() || null,
            now
          );
          imported++;
        } catch (err: unknown) {
          errors.push(`Row ${i}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      return { imported, skipped: list.length - imported, errors };
    }
  );

  ipcMain.handle('scripture:count', async () => {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM scripture_entries`).get() as { c: number };
    return row.c;
  });

  ipcMain.handle('scripture:pickImportJson', async () => {
    const win = getWindow?.();
    const parent = win && !win.isDestroyed() ? win : undefined;
    const openOpts = {
      properties: ['openFile' as const],
      title: 'Import scripture JSON',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    };
    const { canceled, filePaths } = parent
      ? await dialog.showOpenDialog(parent, openOpts)
      : await dialog.showOpenDialog(openOpts);
    if (canceled || !filePaths?.[0]) {
      return { canceled: true as const, content: null as string | null };
    }
    try {
      const content = fs.readFileSync(filePaths[0], 'utf-8');
      return { canceled: false as const, content };
    } catch (e: unknown) {
      return {
        canceled: false as const,
        content: null as string | null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  });
}
