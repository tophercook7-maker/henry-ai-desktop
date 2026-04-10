/**
 * Local scripture entry model (SQLite `scripture_entries` — see electron/ipc/scripture.ts).
 */

/** Row shape returned from IPC / DB */
export interface ScriptureEntry {
  id: string;
  /** User-facing reference string */
  reference: string;
  normalizedReference: string;
  book: string;
  bookSlug: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  text: string;
  sourceProfileId: string | null;
  sourceLabel: string | null;
  notes: string | null;
  createdAt: string;
}
