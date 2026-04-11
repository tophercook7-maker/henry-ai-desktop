/**
 * Henry Bible Corpus — full KJV Bible absorption and context injection.
 *
 * Downloads the complete KJV Bible from a public CDN, stores it in IndexedDB,
 * and provides fast lookup + context injection for Biblical mode.
 *
 * Context budget: up to MAX_BIBLE_CONTEXT_CHARS characters are injected into
 * the system prompt when biblical mode is active, selected by relevance.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BibleBook {
  abbrev: string;
  name: string;
  chapters: string[][];  // [chapter_index][verse_index] = verse_text
}

export interface BibleCorpusStatus {
  loaded: boolean;
  bookCount: number;
  verseCount: number;
  sizeBytes: number;
}

export interface VerseRef {
  book: string;
  chapter: number;   // 1-indexed
  verse: number;     // 1-indexed
  text: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Public domain KJV Bible JSON from jsDelivr CDN
// Format: [{abbrev, name, chapters: [[verse, verse, ...], ...]}]
const BIBLE_CDN_URL =
  'https://cdn.jsdelivr.net/gh/thiagobodruk/bible@master/json/en_kjv.json';

const DB_NAME = 'henry-bible-corpus';
const DB_STORE = 'books';
const DB_VERSION = 1;
const META_KEY = '__meta';

// How much scripture to inject into context (chars). 128K context - other content.
// At ~4 chars/token this is ~25K tokens of pure scripture.
export const MAX_BIBLE_CONTEXT_CHARS = 100_000;

// Books of the Bible in canonical order (KJV)
export const OT_BOOKS = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
  'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel',
  '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles',
  'Ezra', 'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs',
  'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah', 'Lamentations',
  'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos', 'Obadiah',
  'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah',
  'Haggai', 'Zechariah', 'Malachi',
];

export const NT_BOOKS = [
  'Matthew', 'Mark', 'Luke', 'John', 'Acts',
  'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
  'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians',
  '1 Timothy', '2 Timothy', 'Titus', 'Philemon',
  'Hebrews', 'James', '1 Peter', '2 Peter',
  '1 John', '2 John', '3 John', 'Jude', 'Revelation',
];

// High-priority books for context injection (loaded first when space is tight)
const PRIORITY_BOOKS = [
  'John', 'Psalms', 'Proverbs', 'Matthew', 'Romans',
  'Genesis', 'Isaiah', 'Luke', 'Acts', 'Hebrews',
  'Revelation', 'James', 'Ephesians', '1 Corinthians',
];

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) {
        db.createObjectStore(DB_STORE, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(db: IDBDatabase, record: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGet<T>(db: IDBDatabase, key: string): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function dbGetAll<T>(db: IDBDatabase): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function dbClear(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── Download + Storage ────────────────────────────────────────────────────────

export interface LoadProgress {
  phase: 'downloading' | 'parsing' | 'storing' | 'done' | 'error';
  booksStored?: number;
  totalBooks?: number;
  error?: string;
}

/**
 * Download the full KJV Bible and store in IndexedDB.
 * Calls onProgress throughout. Idempotent — safe to call again.
 */
export async function absorbBible(
  onProgress?: (p: LoadProgress) => void,
): Promise<void> {
  const db = await openDB();

  onProgress?.({ phase: 'downloading' });

  let books: BibleBook[];
  try {
    const res = await fetch(BIBLE_CDN_URL, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    onProgress?.({ phase: 'parsing' });
    const raw = await res.json() as Array<{
      abbrev: string;
      name: string;
      chapters: string[][];
    }>;
    books = raw.map((b) => ({ abbrev: b.abbrev, name: b.name, chapters: b.chapters }));
  } catch (err) {
    onProgress?.({
      phase: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  onProgress?.({ phase: 'storing', booksStored: 0, totalBooks: books.length });
  await dbClear(db);

  let verseCount = 0;
  let sizeBytes = 0;
  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    for (const ch of book.chapters) verseCount += ch.length;
    const record = { ...book };
    const serialized = JSON.stringify(record);
    sizeBytes += serialized.length;
    await dbPut(db, record as unknown as Record<string, unknown>);
    onProgress?.({ phase: 'storing', booksStored: i + 1, totalBooks: books.length });
  }

  // Store metadata
  await dbPut(db, {
    name: META_KEY,
    bookCount: books.length,
    verseCount,
    sizeBytes,
    absorbedAt: new Date().toISOString(),
  } as unknown as Record<string, unknown>);

  onProgress?.({ phase: 'done', booksStored: books.length, totalBooks: books.length });
  db.close();
}

// ── Status ────────────────────────────────────────────────────────────────────

export async function getBibleCorpusStatus(): Promise<BibleCorpusStatus> {
  try {
    const db = await openDB();
    const meta = await dbGet<{
      bookCount: number;
      verseCount: number;
      sizeBytes: number;
    }>(db, META_KEY);
    db.close();
    if (!meta) return { loaded: false, bookCount: 0, verseCount: 0, sizeBytes: 0 };
    return { loaded: true, bookCount: meta.bookCount, verseCount: meta.verseCount, sizeBytes: meta.sizeBytes };
  } catch {
    return { loaded: false, bookCount: 0, verseCount: 0, sizeBytes: 0 };
  }
}

// ── Lookup ────────────────────────────────────────────────────────────────────

/**
 * Load a single book from IndexedDB by name (case-insensitive partial match).
 */
export async function getBook(nameOrAbbrev: string): Promise<BibleBook | null> {
  try {
    const db = await openDB();
    const all = await dbGetAll<BibleBook>(db);
    db.close();
    const lower = nameOrAbbrev.toLowerCase().trim();
    return (
      all.find((b) =>
        b.name.toLowerCase() === lower ||
        b.abbrev.toLowerCase() === lower ||
        b.name.toLowerCase().startsWith(lower)
      ) ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Get a specific chapter from a book (1-indexed).
 */
export async function getChapter(bookName: string, chapter: number): Promise<VerseRef[]> {
  const book = await getBook(bookName);
  if (!book) return [];
  const ch = book.chapters[chapter - 1];
  if (!ch) return [];
  return ch.map((text, i) => ({
    book: book.name,
    chapter,
    verse: i + 1,
    text,
  }));
}

/**
 * Get a specific verse (book, chapter 1-indexed, verse 1-indexed).
 */
export async function getVerse(bookName: string, chapter: number, verse: number): Promise<VerseRef | null> {
  const book = await getBook(bookName);
  if (!book) return null;
  const ch = book.chapters[chapter - 1];
  if (!ch) return null;
  const text = ch[verse - 1];
  if (!text) return null;
  return { book: book.name, chapter, verse, text };
}

/**
 * Simple keyword search across all verses.
 */
export async function searchVerses(query: string, limit = 20): Promise<VerseRef[]> {
  try {
    const db = await openDB();
    const all = await dbGetAll<BibleBook>(db);
    db.close();
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const results: VerseRef[] = [];
    for (const book of all) {
      if (book.name === META_KEY) continue;
      for (let ci = 0; ci < book.chapters.length; ci++) {
        for (let vi = 0; vi < book.chapters[ci].length; vi++) {
          const text = book.chapters[ci][vi].toLowerCase();
          if (terms.every((t) => text.includes(t))) {
            results.push({ book: book.name, chapter: ci + 1, verse: vi + 1, text: book.chapters[ci][vi] });
            if (results.length >= limit) return results;
          }
        }
      }
    }
    return results;
  } catch {
    return [];
  }
}

// ── Context injection ─────────────────────────────────────────────────────────

/**
 * Format a single book as readable scripture text for the prompt.
 */
function formatBook(book: BibleBook, maxChars: number): string {
  const lines: string[] = [`## ${book.name}`];
  let chars = book.name.length + 4;
  for (let ci = 0; ci < book.chapters.length; ci++) {
    const chapterLines: string[] = [`\n### ${book.name} ${ci + 1}`];
    chars += chapterLines[0].length;
    for (let vi = 0; vi < book.chapters[ci].length; vi++) {
      const line = `${vi + 1} ${book.chapters[ci][vi]}`;
      chars += line.length + 1;
      chapterLines.push(line);
      if (chars >= maxChars) {
        chapterLines.push('…[truncated for context length]');
        lines.push(...chapterLines);
        return lines.join('\n');
      }
    }
    lines.push(...chapterLines);
  }
  return lines.join('\n');
}

/**
 * Detect which Bible book(s) are mentioned in a user message.
 */
function detectMentionedBooks(content: string): string[] {
  const allBooks = [...OT_BOOKS, ...NT_BOOKS];
  const lower = content.toLowerCase();
  return allBooks.filter((name) => lower.includes(name.toLowerCase()));
}

/**
 * Build the Bible context block for injection into the system prompt.
 * Prioritizes:
 *  1. Books explicitly mentioned in the user's message
 *  2. NT priority books (John, Psalms, Romans, etc.)
 *  3. Remaining books in canonical order
 * Fills up to MAX_BIBLE_CONTEXT_CHARS.
 */
export async function getBibleContextForPrompt(
  userMessage: string,
  maxChars = MAX_BIBLE_CONTEXT_CHARS,
): Promise<string> {
  try {
    const db = await openDB();
    const allBooks = await dbGetAll<BibleBook>(db);
    db.close();

    if (allBooks.length === 0) return '';

    const bookMap = new Map<string, BibleBook>();
    for (const b of allBooks) {
      if (b.name && b.name !== META_KEY) bookMap.set(b.name, b);
    }

    const mentioned = detectMentionedBooks(userMessage);
    const ordered: string[] = [
      ...mentioned,
      ...PRIORITY_BOOKS.filter((n) => !mentioned.includes(n)),
      ...[...bookMap.keys()].filter(
        (n) => !mentioned.includes(n) && !PRIORITY_BOOKS.includes(n)
      ),
    ];

    const sections: string[] = [
      '## Full Bible Corpus (KJV)\nYou have access to the complete King James Bible. The following books are loaded in full:',
    ];
    let usedChars = sections[0].length;

    for (const name of ordered) {
      const book = bookMap.get(name);
      if (!book) continue;
      const remaining = maxChars - usedChars;
      if (remaining < 200) break;
      const text = formatBook(book, remaining);
      sections.push(text);
      usedChars += text.length;
    }

    return sections.join('\n\n');
  } catch {
    return '';
  }
}

/**
 * Format a simple verse search result for prompt injection.
 */
export function formatVersesForPrompt(verses: VerseRef[]): string {
  if (verses.length === 0) return '';
  return verses.map((v) => `${v.book} ${v.chapter}:${v.verse} — ${v.text}`).join('\n');
}
