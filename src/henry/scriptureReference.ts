/**
 * Lightweight Bible reference parsing (common English forms only).
 */

export interface ParsedScriptureReference {
  /** Display book title, e.g. "1 Corinthians" */
  book: string;
  /** Stable slug for storage keys */
  bookSlug: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  /** Canonical key used in SQLite */
  normalizedReference: string;
  rawInput: string;
}

export type ParseScriptureResult =
  | { ok: true; value: ParsedScriptureReference }
  | { ok: false; error: string };

/** When no verse is given, use a chapter-wide span for one lookup key (importers should match). */
export const CHAPTER_VERSE_PLACEHOLDER_END = 999;

const BOOK_ALIASES: Record<string, { slug: string; display: string }> = {
  genesis: { slug: 'genesis', display: 'Genesis' },
  gen: { slug: 'genesis', display: 'Genesis' },
  exodus: { slug: 'exodus', display: 'Exodus' },
  ex: { slug: 'exodus', display: 'Exodus' },
  leviticus: { slug: 'leviticus', display: 'Leviticus' },
  lev: { slug: 'leviticus', display: 'Leviticus' },
  numbers: { slug: 'numbers', display: 'Numbers' },
  num: { slug: 'numbers', display: 'Numbers' },
  deuteronomy: { slug: 'deuteronomy', display: 'Deuteronomy' },
  deut: { slug: 'deuteronomy', display: 'Deuteronomy' },
  dt: { slug: 'deuteronomy', display: 'Deuteronomy' },
  joshua: { slug: 'joshua', display: 'Joshua' },
  josh: { slug: 'joshua', display: 'Joshua' },
  judges: { slug: 'judges', display: 'Judges' },
  judg: { slug: 'judges', display: 'Judges' },
  ruth: { slug: 'ruth', display: 'Ruth' },
  '1 samuel': { slug: '1samuel', display: '1 Samuel' },
  '1 sam': { slug: '1samuel', display: '1 Samuel' },
  '1samuel': { slug: '1samuel', display: '1 Samuel' },
  '2 samuel': { slug: '2samuel', display: '2 Samuel' },
  '2 sam': { slug: '2samuel', display: '2 Samuel' },
  '2samuel': { slug: '2samuel', display: '2 Samuel' },
  '1 kings': { slug: '1kings', display: '1 Kings' },
  '1 kgs': { slug: '1kings', display: '1 Kings' },
  '1kings': { slug: '1kings', display: '1 Kings' },
  '2 kings': { slug: '2kings', display: '2 Kings' },
  '2 kgs': { slug: '2kings', display: '2 Kings' },
  '2kings': { slug: '2kings', display: '2 Kings' },
  '1 chronicles': { slug: '1chronicles', display: '1 Chronicles' },
  '1 chr': { slug: '1chronicles', display: '1 Chronicles' },
  '1chronicles': { slug: '1chronicles', display: '1 Chronicles' },
  '2 chronicles': { slug: '2chronicles', display: '2 Chronicles' },
  '2 chr': { slug: '2chronicles', display: '2 Chronicles' },
  '2chronicles': { slug: '2chronicles', display: '2 Chronicles' },
  ezra: { slug: 'ezra', display: 'Ezra' },
  nehemiah: { slug: 'nehemiah', display: 'Nehemiah' },
  neh: { slug: 'nehemiah', display: 'Nehemiah' },
  esther: { slug: 'esther', display: 'Esther' },
  esth: { slug: 'esther', display: 'Esther' },
  job: { slug: 'job', display: 'Job' },
  psalm: { slug: 'psalms', display: 'Psalms' },
  psalms: { slug: 'psalms', display: 'Psalms' },
  ps: { slug: 'psalms', display: 'Psalms' },
  proverbs: { slug: 'proverbs', display: 'Proverbs' },
  prov: { slug: 'proverbs', display: 'Proverbs' },
  ecclesiastes: { slug: 'ecclesiastes', display: 'Ecclesiastes' },
  eccl: { slug: 'ecclesiastes', display: 'Ecclesiastes' },
  'song of solomon': { slug: 'songofsolomon', display: 'Song of Solomon' },
  songofsolomon: { slug: 'songofsolomon', display: 'Song of Solomon' },
  sng: { slug: 'songofsolomon', display: 'Song of Solomon' },
  isaiah: { slug: 'isaiah', display: 'Isaiah' },
  isa: { slug: 'isaiah', display: 'Isaiah' },
  jeremiah: { slug: 'jeremiah', display: 'Jeremiah' },
  jer: { slug: 'jeremiah', display: 'Jeremiah' },
  lamentations: { slug: 'lamentations', display: 'Lamentations' },
  lam: { slug: 'lamentations', display: 'Lamentations' },
  ezekiel: { slug: 'ezekiel', display: 'Ezekiel' },
  ezek: { slug: 'ezekiel', display: 'Ezekiel' },
  daniel: { slug: 'daniel', display: 'Daniel' },
  dan: { slug: 'daniel', display: 'Daniel' },
  hosea: { slug: 'hosea', display: 'Hosea' },
  hos: { slug: 'hosea', display: 'Hosea' },
  joel: { slug: 'joel', display: 'Joel' },
  amos: { slug: 'amos', display: 'Amos' },
  obadiah: { slug: 'obadiah', display: 'Obadiah' },
  obad: { slug: 'obadiah', display: 'Obadiah' },
  jonah: { slug: 'jonah', display: 'Jonah' },
  jon: { slug: 'jonah', display: 'Jonah' },
  micah: { slug: 'micah', display: 'Micah' },
  mic: { slug: 'micah', display: 'Micah' },
  nahum: { slug: 'nahum', display: 'Nahum' },
  nah: { slug: 'nahum', display: 'Nahum' },
  habakkuk: { slug: 'habakkuk', display: 'Habakkuk' },
  hab: { slug: 'habakkuk', display: 'Habakkuk' },
  zephaniah: { slug: 'zephaniah', display: 'Zephaniah' },
  zeph: { slug: 'zephaniah', display: 'Zephaniah' },
  haggai: { slug: 'haggai', display: 'Haggai' },
  hag: { slug: 'haggai', display: 'Haggai' },
  zechariah: { slug: 'zechariah', display: 'Zechariah' },
  zech: { slug: 'zechariah', display: 'Zechariah' },
  malachi: { slug: 'malachi', display: 'Malachi' },
  mal: { slug: 'malachi', display: 'Malachi' },
  matthew: { slug: 'matthew', display: 'Matthew' },
  matt: { slug: 'matthew', display: 'Matthew' },
  mt: { slug: 'matthew', display: 'Matthew' },
  mark: { slug: 'mark', display: 'Mark' },
  mk: { slug: 'mark', display: 'Mark' },
  luke: { slug: 'luke', display: 'Luke' },
  lk: { slug: 'luke', display: 'Luke' },
  john: { slug: 'john', display: 'John' },
  jn: { slug: 'john', display: 'John' },
  acts: { slug: 'acts', display: 'Acts' },
  romans: { slug: 'romans', display: 'Romans' },
  rom: { slug: 'romans', display: 'Romans' },
  '1 corinthians': { slug: '1corinthians', display: '1 Corinthians' },
  '1 cor': { slug: '1corinthians', display: '1 Corinthians' },
  '1corinthians': { slug: '1corinthians', display: '1 Corinthians' },
  'i corinthians': { slug: '1corinthians', display: '1 Corinthians' },
  '2 corinthians': { slug: '2corinthians', display: '2 Corinthians' },
  '2 cor': { slug: '2corinthians', display: '2 Corinthians' },
  '2corinthians': { slug: '2corinthians', display: '2 Corinthians' },
  galatians: { slug: 'galatians', display: 'Galatians' },
  gal: { slug: 'galatians', display: 'Galatians' },
  ephesians: { slug: 'ephesians', display: 'Ephesians' },
  eph: { slug: 'ephesians', display: 'Ephesians' },
  philippians: { slug: 'philippians', display: 'Philippians' },
  phil: { slug: 'philippians', display: 'Philippians' },
  colossians: { slug: 'colossians', display: 'Colossians' },
  col: { slug: 'colossians', display: 'Colossians' },
  '1 thessalonians': { slug: '1thessalonians', display: '1 Thessalonians' },
  '1 thess': { slug: '1thessalonians', display: '1 Thessalonians' },
  '1thessalonians': { slug: '1thessalonians', display: '1 Thessalonians' },
  '2 thessalonians': { slug: '2thessalonians', display: '2 Thessalonians' },
  '2 thess': { slug: '2thessalonians', display: '2 Thessalonians' },
  '2thessalonians': { slug: '2thessalonians', display: '2 Thessalonians' },
  '1 timothy': { slug: '1timothy', display: '1 Timothy' },
  '1 tim': { slug: '1timothy', display: '1 Timothy' },
  '1timothy': { slug: '1timothy', display: '1 Timothy' },
  '2 timothy': { slug: '2timothy', display: '2 Timothy' },
  '2 tim': { slug: '2timothy', display: '2 Timothy' },
  '2timothy': { slug: '2timothy', display: '2 Timothy' },
  titus: { slug: 'titus', display: 'Titus' },
  tit: { slug: 'titus', display: 'Titus' },
  philemon: { slug: 'philemon', display: 'Philemon' },
  phlm: { slug: 'philemon', display: 'Philemon' },
  hebrews: { slug: 'hebrews', display: 'Hebrews' },
  heb: { slug: 'hebrews', display: 'Hebrews' },
  james: { slug: 'james', display: 'James' },
  jas: { slug: 'james', display: 'James' },
  '1 peter': { slug: '1peter', display: '1 Peter' },
  '1 pet': { slug: '1peter', display: '1 Peter' },
  '1peter': { slug: '1peter', display: '1 Peter' },
  '2 peter': { slug: '2peter', display: '2 Peter' },
  '2 pet': { slug: '2peter', display: '2 Peter' },
  '2peter': { slug: '2peter', display: '2 Peter' },
  '1 john': { slug: '1john', display: '1 John' },
  '1 jn': { slug: '1john', display: '1 John' },
  '1john': { slug: '1john', display: '1 John' },
  '2 john': { slug: '2john', display: '2 John' },
  '2 jn': { slug: '2john', display: '2 John' },
  '2john': { slug: '2john', display: '2 John' },
  '3 john': { slug: '3john', display: '3 John' },
  '3 jn': { slug: '3john', display: '3 John' },
  '3john': { slug: '3john', display: '3 John' },
  jude: { slug: 'jude', display: 'Jude' },
  revelation: { slug: 'revelation', display: 'Revelation' },
  rev: { slug: 'revelation', display: 'Revelation' },
};

function normalizeBookKey(fragment: string): string {
  return fragment
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveBook(bookPart: string): { slug: string; display: string } | null {
  const k = normalizeBookKey(bookPart);
  if (BOOK_ALIASES[k]) return BOOK_ALIASES[k];
  return null;
}

/**
 * `bookPart` is text after optional leading "1 " style prefix is merged, e.g. "Corinthians" with leading "1 " -> "1 corinthians"
 */
function resolveBookWithLeadingNumber(leadingDigit: string | undefined, bookRest: string): { slug: string; display: string } | null {
  const rest = normalizeBookKey(bookRest);
  if (leadingDigit) {
    const combined = normalizeBookKey(`${leadingDigit} ${rest}`);
    if (BOOK_ALIASES[combined]) return BOOK_ALIASES[combined];
  }
  return resolveBook(rest);
}

export function buildNormalizedReference(p: Omit<ParsedScriptureReference, 'normalizedReference' | 'rawInput'>): string {
  return `${p.bookSlug}_c${p.chapter}_v${p.verseStart}-v${p.verseEnd}`;
}

function finishParsed(
  rawInput: string,
  meta: { slug: string; display: string },
  chapter: number,
  verseStart: number,
  verseEnd: number
): ParsedScriptureReference {
  const base = {
    book: meta.display,
    bookSlug: meta.slug,
    chapter,
    verseStart,
    verseEnd,
    rawInput: rawInput.trim(),
  };
  return {
    ...base,
    normalizedReference: buildNormalizedReference(base),
  };
}

/**
 * Parse strings like "John 3:16", "Psalm 23", "1 Corinthians 13:4-7".
 */
export function parseScriptureReference(input: string): ParseScriptureResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: 'Empty reference.' };

  const m = trimmed.match(
    /^(?:(\d)\s+)?([\w\s]+?)\s+(\d+)\s*(?::\s*(\d+)(?:\s*[-–]\s*(\d+))?)?$/i
  );
  if (!m) {
    return {
      ok: false,
      error: 'Could not parse as a common verse reference (e.g. John 3:16 or Psalm 23).',
    };
  }

  const leading = m[1];
  const bookFragment = m[2] ?? '';
  const chapter = parseInt(m[3] ?? '0', 10);
  const v1 = m[4] !== undefined ? parseInt(m[4], 10) : undefined;
  const v2 = m[5] !== undefined ? parseInt(m[5], 10) : undefined;

  if (!Number.isFinite(chapter) || chapter < 1) {
    return { ok: false, error: 'Invalid chapter number.' };
  }

  const meta = resolveBookWithLeadingNumber(leading, bookFragment);
  if (!meta) {
    return { ok: false, error: `Unknown or unsupported book name: "${bookFragment.trim()}".` };
  }

  if (v1 === undefined) {
    const verseStart = 1;
    const verseEnd = CHAPTER_VERSE_PLACEHOLDER_END;
    return { ok: true, value: finishParsed(trimmed, meta, chapter, verseStart, verseEnd) };
  }

  if (!Number.isFinite(v1) || v1 < 1) {
    return { ok: false, error: 'Invalid verse number.' };
  }

  const verseEnd = v2 !== undefined && Number.isFinite(v2) && v2 >= v1 ? v2 : v1;
  return { ok: true, value: finishParsed(trimmed, meta, chapter, v1, verseEnd) };
}

export function isParsedScriptureReference(
  r: ParseScriptureResult
): r is { ok: true; value: ParsedScriptureReference } {
  return r.ok === true;
}
