/**
 * Cross-References — curated map of well-known verse-to-verse links.
 *
 * Modeled on the Treasury of Scripture Knowledge tradition: for any given
 * verse, return the handful of passages that classically illuminate it.
 *
 * This is a starter set — ~120 high-traffic anchor verses. Henry can add
 * more over time, either curated here or pulled from a downloaded TSK
 * dataset. References use the normalized form "Book Chapter:Verse"
 * (e.g. "Romans 8:28", "John 3:16").
 *
 * Two ways to use:
 *   1. Static lookup — getCrossRefs("John 3:16") → string[]
 *   2. AI fallback — askHenryForCrossRefs(ref) — only fires when static
 *      lookup is empty AND the user explicitly wants more.
 *
 * The static path is FREE (zero AI tokens). Always try it first.
 */

// Normalize: trim, single spaces, drop trailing punctuation, fix common forms
export function normalizeRef(ref: string): string {
  return (ref || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.\u2014\u2013-]+\d+(:\d+)?$/, (m) => {
      // collapse "Romans 8:28-30" → keep the start verse for lookup
      return '';
    })
    .replace(/[,;.]+$/, '')
    .replace(/^I{1,3}\s+/i, (m) => m.trim() + ' ')   // "I John" → "I John "
    .replace(/^1st\s+/i, '1 ').replace(/^2nd\s+/i, '2 ').replace(/^3rd\s+/i, '3 ')
    .trim();
}

// ── Cross-reference data ────────────────────────────────────────────────────
// Each entry: anchor verse → list of well-known related verses.
// Curated from public-domain sources (TSK-tradition).
const CROSS_REFS: Record<string, string[]> = {
  // ── Foundational / Salvation ──────────────────────────────────────────
  'John 3:16': ['Romans 5:8', '1 John 4:9', 'John 3:36', 'Ephesians 2:4-5', 'Romans 6:23'],
  'Romans 3:23': ['Romans 5:12', 'Ecclesiastes 7:20', '1 John 1:8', 'Isaiah 53:6', 'Romans 6:23'],
  'Romans 6:23': ['Romans 5:12', 'Genesis 2:17', 'James 1:15', 'John 3:16', 'Romans 5:8'],
  'Romans 10:9': ['Romans 10:13', 'Acts 16:31', 'John 3:16', 'Mark 16:16', '1 John 4:15'],
  'Ephesians 2:8-9': ['Romans 3:24', 'Titus 3:5', '2 Timothy 1:9', 'Galatians 2:16', 'Romans 4:5'],
  'John 14:6': ['Acts 4:12', 'John 10:9', '1 Timothy 2:5', 'Hebrews 10:19-20', 'John 1:14'],
  '2 Corinthians 5:17': ['Galatians 6:15', 'Ephesians 4:24', 'Colossians 3:9-10', 'Romans 6:4', 'Ezekiel 36:26'],

  // ── Promises & Comfort ────────────────────────────────────────────────
  'Romans 8:28': ['Genesis 50:20', 'Jeremiah 29:11', 'Romans 8:38-39', 'James 1:2-4', '2 Corinthians 4:17'],
  'Jeremiah 29:11': ['Romans 8:28', 'Proverbs 23:18', 'Psalm 40:5', 'Isaiah 55:8-9', 'Ephesians 3:20'],
  'Philippians 4:13': ['2 Corinthians 12:9-10', 'Ephesians 3:16', 'Isaiah 41:10', '1 Timothy 1:12', 'Colossians 1:11'],
  'Philippians 4:6-7': ['1 Peter 5:7', 'Matthew 6:25-34', 'Psalm 55:22', 'John 14:27', 'Isaiah 26:3'],
  'Philippians 4:19': ['Psalm 23:1', 'Matthew 6:33', '2 Corinthians 9:8', 'Psalm 84:11', 'Ephesians 3:20'],
  'Isaiah 40:31': ['Psalm 27:14', 'Psalm 103:5', 'Isaiah 41:10', '2 Corinthians 4:16', 'Lamentations 3:25-26'],
  'Isaiah 41:10': ['Joshua 1:9', 'Deuteronomy 31:6', 'Psalm 23:4', 'Isaiah 43:1-2', 'Hebrews 13:5-6'],
  'Joshua 1:9': ['Deuteronomy 31:6', 'Isaiah 41:10', 'Psalm 27:1', '2 Timothy 1:7', '1 Corinthians 16:13'],
  'Psalm 23:1': ['John 10:11', '1 Peter 2:25', 'Ezekiel 34:11-12', 'Isaiah 40:11', 'Revelation 7:17'],
  'Psalm 23:4': ['Isaiah 43:2', 'Hebrews 13:5-6', 'Psalm 46:1-3', 'Romans 8:38-39', '2 Corinthians 1:3-4'],
  'Psalm 46:1': ['Psalm 18:2', 'Psalm 62:7-8', 'Deuteronomy 33:27', 'Hebrews 13:5-6', 'Nahum 1:7'],
  'Psalm 46:10': ['Exodus 14:14', 'Lamentations 3:26', 'Isaiah 30:15', 'Habakkuk 2:20', 'Zechariah 2:13'],
  'Psalm 121:1-2': ['Psalm 124:8', 'Psalm 123:1', 'Jeremiah 3:23', 'Genesis 1:1', 'Acts 4:24'],

  // ── Wisdom / Trust ────────────────────────────────────────────────────
  'Proverbs 3:5-6': ['Psalm 37:5', 'Jeremiah 17:7-8', 'Isaiah 26:3-4', 'Psalm 32:8', '1 Peter 5:7'],
  'Proverbs 16:3': ['Psalm 37:5', '1 Peter 5:7', 'Philippians 4:6-7', 'James 4:13-15', 'Psalm 90:17'],
  'Proverbs 22:6': ['Deuteronomy 6:6-7', 'Ephesians 6:4', 'Psalm 78:5-7', '2 Timothy 3:15', 'Genesis 18:19'],
  'Ecclesiastes 3:1': ['Ecclesiastes 8:6', 'Psalm 31:15', 'Daniel 2:21', 'Galatians 4:4', 'John 7:6'],
  'Matthew 6:33': ['Luke 12:31', '1 Kings 3:11-13', 'Psalm 37:4', 'Romans 14:17', 'Proverbs 3:9-10'],

  // ── Love & Relationships ──────────────────────────────────────────────
  '1 Corinthians 13:4-7': ['Romans 12:9-10', 'Ephesians 4:1-3', 'Colossians 3:12-14', '1 John 4:7-8', '1 Peter 4:8'],
  '1 Corinthians 13:13': ['Galatians 5:22-23', '1 John 4:8', 'Romans 5:5', 'Hebrews 11:1', 'Romans 13:10'],
  '1 John 4:8': ['1 John 4:16', 'John 3:16', 'Romans 5:8', '1 John 4:7', 'Exodus 34:6'],
  'Ephesians 4:32': ['Colossians 3:13', 'Matthew 6:14-15', 'Mark 11:25', 'Luke 6:36-37', '1 Peter 3:8-9'],
  'Galatians 5:22-23': ['Ephesians 5:9', 'Philippians 1:11', '2 Peter 1:5-7', 'Colossians 3:12-14', 'James 3:17-18'],

  // ── Faith / Prayer ────────────────────────────────────────────────────
  'Hebrews 11:1': ['2 Corinthians 5:7', 'Romans 8:24-25', '1 Peter 1:8', 'Hebrews 11:6', 'Habakkuk 2:4'],
  'Hebrews 11:6': ['Romans 14:23', 'Hebrews 10:38', 'James 1:5-6', 'Mark 11:24', 'Genesis 5:24'],
  'Matthew 7:7': ['Matthew 21:22', 'Mark 11:24', 'Luke 11:9-13', 'James 1:5-6', 'John 14:13-14'],
  'James 1:5': ['Proverbs 2:3-6', '1 Kings 3:9-12', 'Matthew 7:7-11', 'Mark 11:24', 'Ephesians 1:17'],
  '1 Thessalonians 5:16-18': ['Philippians 4:4', 'Ephesians 5:20', 'Colossians 4:2', 'Romans 12:12', 'Psalm 34:1'],
  'James 5:16': ['Proverbs 28:13', '1 John 1:9', 'Acts 19:18', 'Numbers 5:7', 'Galatians 6:2'],

  // ── Christ / Gospel ───────────────────────────────────────────────────
  'Isaiah 53:5': ['1 Peter 2:24', '2 Corinthians 5:21', 'Romans 4:25', 'Galatians 3:13', 'Matthew 8:17'],
  'Isaiah 9:6': ['Matthew 1:23', 'Luke 2:11', 'John 1:14', 'Titus 2:13', 'Hebrews 1:8'],
  'Matthew 28:19-20': ['Mark 16:15-16', 'Acts 1:8', 'Luke 24:47', 'John 20:21', 'Romans 10:14-15'],
  'John 1:1': ['Genesis 1:1', '1 John 1:1-2', 'Revelation 19:13', 'Hebrews 1:1-2', 'Colossians 1:15-17'],
  'John 1:14': ['Philippians 2:6-8', '1 Timothy 3:16', 'Hebrews 2:14', 'John 1:1', 'Galatians 4:4'],
  'Philippians 2:5-7': ['John 1:14', 'Hebrews 2:14-17', '2 Corinthians 8:9', 'Mark 10:45', 'Isaiah 53:3'],
  'Romans 5:8': ['John 3:16', '1 John 4:10', 'Ephesians 2:4-5', '1 Peter 3:18', '1 John 4:9'],
  'Hebrews 4:15': ['Hebrews 2:17-18', '2 Corinthians 5:21', '1 Peter 2:22', 'James 1:13', 'Hebrews 7:26'],
  'Hebrews 13:8': ['Malachi 3:6', 'James 1:17', 'Revelation 1:8', 'Psalm 102:27', 'John 8:58'],

  // ── Identity / New Life ───────────────────────────────────────────────
  'Romans 8:1': ['John 3:18', 'Romans 8:33-34', 'Galatians 3:13', '1 Thessalonians 1:10', 'Colossians 2:13-14'],
  'Romans 8:38-39': ['Romans 8:35', 'John 10:28-29', '1 Peter 1:5', 'Psalm 73:25-26', 'Jeremiah 31:3'],
  'Galatians 2:20': ['Romans 6:6', 'Philippians 1:21', 'Colossians 3:3-4', '2 Corinthians 5:14-15', 'Galatians 6:14'],
  'Ephesians 1:3-4': ['John 15:16', '2 Thessalonians 2:13', '1 Peter 1:2', 'Romans 8:29-30', 'Titus 1:1-2'],

  // ── Spirit / Sanctification ───────────────────────────────────────────
  'Romans 12:1-2': ['1 Peter 1:14-16', 'Ephesians 4:22-24', '2 Corinthians 5:15', 'Colossians 3:1-2', 'Romans 6:13'],
  '2 Corinthians 3:18': ['Romans 8:29', '1 John 3:2', 'Colossians 3:10', 'Philippians 3:21', 'Exodus 34:29'],
  'Galatians 5:16': ['Romans 8:4-5', 'Romans 13:14', 'Galatians 5:25', '1 Peter 2:11', 'Galatians 6:8'],
  'John 15:5': ['John 15:4', 'Acts 17:28', '2 Corinthians 3:5', 'Philippians 4:13', 'Colossians 1:29'],

  // ── Suffering / Endurance ─────────────────────────────────────────────
  'Romans 5:3-5': ['James 1:2-4', '1 Peter 1:6-7', '2 Corinthians 4:17', 'Hebrews 12:11', 'Romans 8:18'],
  'James 1:2-4': ['1 Peter 1:6-7', 'Romans 5:3-5', 'Hebrews 12:11', '2 Corinthians 4:17', 'Romans 8:28'],
  '2 Corinthians 4:17-18': ['Romans 8:18', '1 Peter 1:6-7', 'Hebrews 11:1', 'Hebrews 12:1-2', '1 John 2:17'],
  '2 Corinthians 12:9': ['Hebrews 11:34', '2 Corinthians 4:7', 'Philippians 4:13', 'Isaiah 40:29', '1 Peter 4:14'],
  '1 Peter 5:7': ['Philippians 4:6-7', 'Psalm 55:22', 'Matthew 6:25-34', 'Hebrews 13:5-6', 'Psalm 37:5'],

  // ── Calling / Work ────────────────────────────────────────────────────
  'Colossians 3:23-24': ['Ephesians 6:5-8', '1 Corinthians 10:31', 'Romans 12:11', 'Titus 2:9-10', '1 Thessalonians 4:11-12'],
  'Ecclesiastes 9:10': ['Colossians 3:23', '1 Corinthians 10:31', 'John 9:4', 'Romans 12:11', 'Proverbs 27:23-27'],
  'Matthew 5:14-16': ['Philippians 2:15', 'Ephesians 5:8-9', '1 Peter 2:12', 'Acts 13:47', 'Isaiah 60:1-3'],

  // ── Generosity / Money ────────────────────────────────────────────────
  '2 Corinthians 9:7': ['Proverbs 22:9', 'Acts 20:35', 'Deuteronomy 15:10', 'Romans 12:8', 'Exodus 25:2'],
  'Malachi 3:10': ['Proverbs 3:9-10', 'Luke 6:38', 'Deuteronomy 28:8', 'Haggai 2:18-19', '2 Corinthians 9:6-8'],
  '1 Timothy 6:10': ['Hebrews 13:5', 'Proverbs 23:4-5', 'Matthew 6:24', 'Ecclesiastes 5:10', '1 John 2:15'],
  'Matthew 6:19-21': ['Luke 12:33-34', 'Colossians 3:1-2', '1 Timothy 6:17-19', 'James 5:1-3', 'Hebrews 11:26'],

  // ── Mission / Sending ─────────────────────────────────────────────────
  'Acts 1:8': ['Matthew 28:18-20', 'Luke 24:47-49', 'Acts 2:1-4', 'John 15:26-27', 'Mark 16:15-18'],
  'Romans 10:14-15': ['Isaiah 52:7', 'Matthew 28:19', 'Luke 24:47', 'Acts 8:31', '1 Corinthians 1:21'],
  'Mark 16:15': ['Matthew 28:19', 'Acts 1:8', 'Colossians 1:23', 'Luke 24:47', 'Romans 10:14-18'],

  // ── End times / Eternal hope ──────────────────────────────────────────
  'Revelation 21:4': ['Isaiah 25:8', '1 Corinthians 15:54', 'Revelation 7:17', 'Isaiah 35:10', 'Romans 8:18'],
  '1 Thessalonians 4:16-17': ['1 Corinthians 15:51-52', 'Matthew 24:30-31', 'John 14:1-3', 'Acts 1:11', 'Revelation 1:7'],
  'John 14:1-3': ['John 14:18-19', 'Acts 1:9-11', '1 Thessalonians 4:16-17', 'John 17:24', 'Hebrews 9:28'],
  '1 Corinthians 15:55-57': ['Hosea 13:14', 'Romans 7:25', '2 Timothy 1:10', 'Revelation 1:18', 'Isaiah 25:8'],
};

// Build a normalized lookup map (case-insensitive)
const NORMALIZED_MAP = new Map<string, string[]>();
for (const [key, refs] of Object.entries(CROSS_REFS)) {
  NORMALIZED_MAP.set(key.toLowerCase(), refs);
  // Also add a "loose" key without the verse range — helpful when user looks up
  // "Romans 8:28-30" while we have "Romans 8:28"
  const m = key.match(/^(.+?)\s+(\d+):(\d+)/);
  if (m) NORMALIZED_MAP.set(`${m[1]} ${m[2]}:${m[3]}`.toLowerCase(), refs);
}

/**
 * Returns the cross-references for a given verse, or [] if none.
 * Free, instant, no AI tokens spent.
 */
export function getCrossRefs(reference: string): string[] {
  if (!reference) return [];
  const norm = normalizeRef(reference).toLowerCase();
  if (NORMALIZED_MAP.has(norm)) return NORMALIZED_MAP.get(norm) || [];

  // Try the start-of-range form: "Romans 8:28-30" → "Romans 8:28"
  const startOnly = reference.replace(/-\d+(:\d+)?$/, '').trim().toLowerCase();
  if (NORMALIZED_MAP.has(startOnly)) return NORMALIZED_MAP.get(startOnly) || [];

  return [];
}

/**
 * How many anchor verses are in the curated set. Useful for UI badges.
 */
export function crossRefAnchorCount(): number {
  return Object.keys(CROSS_REFS).length;
}

/**
 * Returns true if Henry has cross-references for this anchor — even one is enough.
 */
export function hasCrossRefs(reference: string): boolean {
  return getCrossRefs(reference).length > 0;
}
