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

  // ── Auto-download KJV from CDN ─────────────────────────────────────────────
  ipcMain.handle('scripture:downloadKJV', async (_event, books?: string[]) => {
    const { default: https } = await import('https');
    const CDN = 'https://cdn.jsdelivr.net/gh/aruljohn/Bible-kjv/';

    const ALL_BOOKS = [
      'Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth',
      '1Samuel','2Samuel','1Kings','2Kings','1Chronicles','2Chronicles','Ezra','Nehemiah',
      'Esther','Job','Psalms','Proverbs','Ecclesiastes','SongofSolomon','Isaiah','Jeremiah',
      'Lamentations','Ezekiel','Daniel','Hosea','Joel','Amos','Obadiah','Jonah','Micah',
      'Nahum','Habakkuk','Zephaniah','Haggai','Zechariah','Malachi',
      'Matthew','Mark','Luke','John','Acts','Romans',
      '1Corinthians','2Corinthians','Galatians','Ephesians','Philippians','Colossians',
      '1Thessalonians','2Thessalonians','1Timothy','2Timothy','Titus','Philemon',
      'Hebrews','James','1Peter','2Peter','1John','2John','3John','Jude','Revelation',
    ];

    const target = books && books.length ? books : ALL_BOOKS;

    function fetchBook(book: string): Promise<{book: string; chapters: string[][]}> {
      return new Promise((resolve, reject) => {
        https.get(CDN + book + '.json', (res) => {
          let raw = '';
          res.on('data', (chunk) => raw += chunk);
          res.on('end', () => {
            try { resolve(JSON.parse(raw)); }
            catch (e) { reject(new Error('Parse error for ' + book)); }
          });
          res.on('error', reject);
        }).on('error', reject);
      });
    }

    // Map "SongofSolomon" → "Song of Solomon", "1Samuel" → "1 Samuel", etc.
    function humanName(b: string): string {
      return b
        .replace(/([0-9])([A-Z])/, '$1 $2')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace('Songof Solomon', 'Song of Solomon')
        .replace('Songof', 'Song of');
    }

    const stmt = db.prepare(
      `INSERT OR REPLACE INTO scripture_entries (id, normalized_reference, book, chapter, verse, text, translation, source_label) VALUES (?, ?, ?, ?, ?, ?, 'KJV', 'King James Version')`
    );

    let imported = 0;
    const errors: string[] = [];

    for (const bookFile of target) {
      try {
        const data = await fetchBook(bookFile);
        const bookName = humanName(bookFile);
        const chapters = data.chapters || data as any;

        const insertMany = db.transaction(() => {
          for (let ci = 0; ci < chapters.length; ci++) {
            const chapter = chapters[ci];
            // Handle two formats:
            // Format A (simple): chapters[i] = string[] (verse texts)
            // Format B (rich): chapters[i] = { chapter: "N", verses: [{verse:"N", text:"..."}] }
            const isRich = chapter && typeof chapter === 'object' && !Array.isArray(chapter) && 'verses' in chapter;
            const chNum = isRich ? parseInt((chapter as any).chapter) || (ci + 1) : ci + 1;
            const verses: Array<{verse: string|number; text: string} | string> = isRich
              ? (chapter as any).verses
              : (Array.isArray(chapter) ? chapter : []);

            for (let vi = 0; vi < verses.length; vi++) {
              const v = verses[vi];
              const verseText = typeof v === 'string' ? v : (v as any).text;
              const vsNum = typeof v === 'object' ? parseInt((v as any).verse) || (vi + 1) : vi + 1;
              if (!verseText) continue;
              const ref = `${bookName} ${chNum}:${vsNum}`;
              const id = `kjv_${bookFile}_${chNum}_${vsNum}`;
              stmt.run(id, ref, bookName, chNum, vsNum, verseText, ref);
              imported++;
            }
          }
        });
        insertMany();
      } catch (e) {
        errors.push(bookFile + ': ' + String(e));
      }
    }

    return { imported, errors, books: target.length };
  });

  // ── Get full chapter ────────────────────────────────────────────────────────
  ipcMain.handle('scripture:getChapter', async (_event, book: string, chapter: number) => {
    try {
      const rows = db.prepare(
        `SELECT book, chapter, verse_start as verse, text FROM scripture_entries
         WHERE book = ? AND chapter = ? ORDER BY verse_start ASC`
      ).all(book, chapter) as { book: string; chapter: number; verse: number; text: string }[];
      return rows;
    } catch { return []; }
  });

  // ── Keyword search across all verses ────────────────────────────────────────
  ipcMain.handle('scripture:searchKeyword', async (_event, query: string, limit = 20) => {
    try {
      const rows = db.prepare(
        `SELECT book, chapter, verse_start as verse, text FROM scripture_entries
         WHERE LOWER(text) LIKE ? ORDER BY book, chapter, verse_start LIMIT ?`
      ).all('%' + query.toLowerCase() + '%', limit) as { book: string; chapter: number; verse: number; text: string }[];
      return rows;
    } catch (e) {
      console.error('[scripture:searchKeyword] failed:', e instanceof Error ? e.message : e);
      return [];
    }
  });

  // R2-Fix 9: preload.ts calls 'scripture:search' (no -Keyword suffix) and
  // had NO handler — the call silently returned undefined in production.
  // Alias to scripture:searchKeyword so both names work.
  ipcMain.handle('scripture:search', async (_event, query: string, limit = 20) => {
    try {
      const rows = db.prepare(
        `SELECT book, chapter, verse_start as verse, text FROM scripture_entries
         WHERE LOWER(text) LIKE ? ORDER BY book, chapter, verse_start LIMIT ?`
      ).all('%' + String(query || '').toLowerCase() + '%', limit) as { book: string; chapter: number; verse: number; text: string }[];
      return rows;
    } catch (e) {
      console.error('[scripture:search] failed:', e instanceof Error ? e.message : e);
      return [];
    }
  });

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
