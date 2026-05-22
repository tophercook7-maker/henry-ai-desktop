/**
 * Scripture Study Panel — DeepWellAudio
 * Look up passages, save verses, add study notes, study with Henry
 * Saved verses persist to SQLite (scripture_entries + saved_verses tables)
 */
import React, { useState, useEffect, useRef } from 'react';
import { sendToHenry } from '../../actions/store/chatBridgeStore';
import { useStore } from '../../store';
import { getCrossRefs } from '../../henry/crossReferences';
import { callHenryAI, NoBackendAvailableError } from '../../henry/henryAI';

const getApi = () => (window as any).henryAPI as any;

type Tab = 'read' | 'lookup' | 'saved' | 'study' | 'import';

interface VerseResult {
  found: boolean;
  normalizedReference?: string;
  text?: string;
  sourceLabel?: string;
  notes?: string;
  guidance?: string;
}

interface SavedVerse {
  ref: string;
  text: string;
  source?: string;
  note?: string;
  tags?: string[];
  saved_at: string;
}

const QUICK_REFS = [
  'John 3:16','Psalm 23','Romans 8:28','Proverbs 3:5-6',
  'Isaiah 40:31','Philippians 4:13','Matthew 5:3-12','Psalm 91',
  'Genesis 1:1','Jeremiah 29:11','Romans 12:2','James 1:2-4',
];

const STUDY_PROMPTS = [
  'What is the historical context of this passage?',
  'What is the main theological theme here?',
  'How does this connect to Jesus and the Gospel?',
  'What is a personal application from this text?',
  'What cross-references come to mind with this passage?',
  'Walk me through this verse word by word',
];

const SERMON_PROMPTS = [
  'Build a full sermon outline (hook, big idea, 3 points, application, closing)',
  'Give me three preaching points grounded in the text',
  'Suggest an opening illustration or hook',
  'How do I connect this to the Gospel?',
  'What is the clearest application for ordinary believers?',
  'Suggest a closing prayer for the sermon',
];

type StudyMode = 'study' | 'sermon';

const STUDY_SYS_PROMPT = 'You are a Bible study companion. Give clear, reverent, biblically grounded responses. Respect orthodox Christian tradition. Be concise but thoughtful.';

const SERMON_SYS_PROMPT = `You are an expository preacher helping prepare a sermon. Build outputs that are reverent, direct, and biblically faithful. When asked for a full outline, follow this structure:

  HOOK — one sentence opener that connects to a felt need or universal experience.
  BIG IDEA — the central truth of the passage in a single sentence.
  THREE POINTS — each grounded in a specific phrase or movement of the text, with brief exegesis (a sentence or two of context, then the timeless truth).
  APPLICATION — two or three concrete steps an ordinary believer can take this week.
  CLOSING — a clear gospel call, a short prayer, or both.

For shorter requests (one point, just the hook, just the closing), give just that piece in the same spirit. Tone: warm, plain, scripture-first. Length: enough to teach, short enough to preach in 20-25 minutes when expanded.`;

async function henryStudy(passage: string, text: string, prompt: string, mode: StudyMode): Promise<string> {
  const systemPrompt = mode === 'sermon' ? SERMON_SYS_PROMPT : STUDY_SYS_PROMPT;
  const userMsg = `Passage: ${passage}\n\nText: "${text}"\n\nQuestion: ${prompt}`;
  try {
    const reply = await callHenryAI({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg },
      ],
      maxTokens: mode === 'sermon' ? 900 : 600,
      temperature: 0.5,
      preferredModel: 'llama-3.3-70b-versatile',
    });
    return reply || 'No response from Henry.';
  } catch (e) {
    if (e instanceof NoBackendAvailableError) return e.userFacingMessage;
    return 'Could not reach an AI provider. ' + (e instanceof Error ? e.message : '');
  }
}


// ── ReadTab: Browse Bible by Book → Chapter → Read ────────────────────────────
const ALL_BOOKS_IN_ORDER = [
  // OT
  'Genesis','Exodus','Leviticus','Numbers','Deuteronomy','Joshua','Judges','Ruth',
  '1 Samuel','2 Samuel','1 Kings','2 Kings','1 Chronicles','2 Chronicles',
  'Ezra','Nehemiah','Esther','Job','Psalms','Proverbs','Ecclesiastes',
  'Song of Solomon','Isaiah','Jeremiah','Lamentations','Ezekiel','Daniel',
  'Hosea','Joel','Amos','Obadiah','Jonah','Micah','Nahum','Habakkuk',
  'Zephaniah','Haggai','Zechariah','Malachi',
  // NT
  'Matthew','Mark','Luke','John','Acts',
  'Romans','1 Corinthians','2 Corinthians','Galatians','Ephesians',
  'Philippians','Colossians','1 Thessalonians','2 Thessalonians',
  '1 Timothy','2 Timothy','Titus','Philemon','Hebrews',
  'James','1 Peter','2 Peter','1 John','2 John','3 John','Jude','Revelation',
];

const CHAPTER_COUNTS: Record<string,number> = {
  Genesis:50,Exodus:40,Leviticus:27,Numbers:36,Deuteronomy:34,Joshua:24,Judges:21,Ruth:4,
  '1 Samuel':31,'2 Samuel':24,'1 Kings':22,'2 Kings':25,'1 Chronicles':29,'2 Chronicles':36,
  Ezra:10,Nehemiah:13,Esther:10,Job:42,Psalms:150,Proverbs:31,Ecclesiastes:12,
  'Song of Solomon':8,Isaiah:66,Jeremiah:52,Lamentations:5,Ezekiel:48,Daniel:12,
  Hosea:14,Joel:3,Amos:9,Obadiah:1,Jonah:4,Micah:7,Nahum:3,Habakkuk:3,
  Zephaniah:3,Haggai:2,Zechariah:14,Malachi:4,
  Matthew:28,Mark:16,Luke:24,John:21,Acts:28,Romans:16,
  '1 Corinthians':16,'2 Corinthians':13,Galatians:6,Ephesians:6,
  Philippians:4,Colossians:4,'1 Thessalonians':5,'2 Thessalonians':3,
  '1 Timothy':6,'2 Timothy':4,Titus:3,Philemon:1,Hebrews:13,
  James:5,'1 Peter':5,'2 Peter':3,'1 John':5,'2 John':1,'3 John':1,Jude:1,Revelation:22,
};

const POPULAR_PASSAGES = [
  {ref:'Psalm 23',  label:'The Lord is My Shepherd'},
  {ref:'John 3:1-21',label:'Born Again'},
  {ref:'Isaiah 40', label:'Those Who Wait on the Lord'},
  {ref:'Romans 8',  label:'Life in the Spirit'},
  {ref:'Matthew 5-7',label:'Sermon on the Mount'},
  {ref:'John 1',    label:'The Word Made Flesh'},
  {ref:'Psalm 91',  label:'Dwelling in His Shelter'},
  {ref:'Philippians 4',label:'Rejoice Always'},
  {ref:'Proverbs 3',label:'Trust in the Lord'},
  {ref:'Revelation 21',label:'New Heaven & Earth'},
];

interface ReadTabProps {
  count: number;
  downloading: boolean;
  downloadProgress: string;
  onDownload: () => void;
  onLookup: (ref: string) => void;
  onStudy: (ref: string, text: string) => void;
  onDownloadImport: () => void;
}

function ReadTab({ count, downloading, downloadProgress, onDownload, onLookup, onStudy, onDownloadImport }: ReadTabProps) {
  const [book, setBook] = React.useState<string>(() => localStorage.getItem('henry:bible:book') || '');
  const [chapter, setChapter] = React.useState<number>(() => parseInt(localStorage.getItem('henry:bible:ch') || '1'));
  const [verses, setVerses] = React.useState<{book:string;chapter:number;verse:number;text:string}[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState<number|null>(null);
  const [bookSearch, setBookSearch] = React.useState('');
  const [showBookList, setShowBookList] = React.useState(!book);
  const inp2 = "bg-henry-surface border border-henry-border/30 rounded-xl px-3 py-2 text-sm text-henry-text placeholder:text-henry-text-muted outline-none focus:border-henry-accent/50 transition-all";

  React.useEffect(() => {
    if (book) loadChapter(book, chapter);
  }, []);

  async function loadChapter(b: string, ch: number) {
    setLoading(true); setVerses([]);
    try {
      const api2 = (window as any).henryAPI;
      const result = await api2?.scriptureGetChapter?.(b, ch);
      if (result && result.length > 0) {
        setVerses(result);
        setBook(b); setChapter(ch);
        try {
          localStorage.setItem('henry:bible:book', b);
          localStorage.setItem('henry:bible:ch', String(ch));
        } catch {}
        setShowBookList(false);
      } else {
        setVerses([]);
      }
    } catch { setVerses([]); }
    setLoading(false);
  }

  const chCount = book ? (CHAPTER_COUNTS[book] || 1) : 1;
  const filteredBooks = bookSearch
    ? ALL_BOOKS_IN_ORDER.filter(b => b.toLowerCase().includes(bookSearch.toLowerCase()))
    : ALL_BOOKS_IN_ORDER;

  // Group books for display
  const OT_count = 39;
  const isOT = (b: string) => ALL_BOOKS_IN_ORDER.indexOf(b) < OT_count;

  if (count === 0 && !downloading) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-8 flex flex-col items-center">
        <div className="max-w-md w-full space-y-6 text-center">
          <div>
            <div className="text-5xl mb-4">✝</div>
            <h2 className="text-xl font-bold text-henry-text mb-2">Welcome to Bible Study</h2>
            <p className="text-henry-text-muted text-sm leading-relaxed">
              Download the complete King James Bible once — free, instant, offline forever.
              Then read any chapter, look up any verse, study with Henry, build sermon outlines, and save your favorites.
            </p>
          </div>

          <div className="bg-henry-accent/8 border border-henry-accent/25 rounded-2xl p-6 space-y-4">
            <p className="text-henry-text font-semibold">📖 King James Version</p>
            <p className="text-henry-text-muted text-xs">66 books · 1,189 chapters · 31,102 verses · Free public domain text</p>
            <button
              onClick={onDownload}
              disabled={downloading}
              className="w-full py-3.5 bg-henry-accent text-white font-bold rounded-xl text-base hover:bg-henry-accent/80 transition-all shadow-lg"
            >
              ⬇ Download KJV — Free
            </button>
            <p className="text-henry-text-muted text-xs">Takes about 30 seconds on WiFi</p>
          </div>

          <div className="text-left space-y-3">
            <p className="text-[11px] uppercase tracking-wider text-henry-text-muted font-semibold">After downloading you can:</p>
            {[
              ['📖', 'Read any chapter of any book'],
              ['🔍', 'Look up any verse by reference (John 3:16)'],
              ['💾', 'Save and annotate your favorite verses'],
              ['🎓', 'Study passages with Henry — context, meaning, application'],
              ['✝', 'Build full sermon outlines from any text'],
              ['🔎', 'Search all 31,000 verses by keyword'],
            ].map(([icon, text]) => (
              <div key={text as string} className="flex items-center gap-3">
                <span className="text-base w-6">{icon}</span>
                <p className="text-sm text-henry-text-muted">{text as string}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (downloading) {
    return (
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="text-center space-y-4">
          <div className="text-4xl animate-pulse">📖</div>
          <p className="text-henry-accent font-semibold">{downloadProgress || 'Downloading...'}</p>
          <p className="text-henry-text-muted text-xs">This only happens once. Henry stores the Bible locally on your Mac.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Book/Chapter sidebar */}
      {showBookList ? (
        <div className="w-full overflow-y-auto px-4 py-4 space-y-3">
          <input
            value={bookSearch}
            onChange={e => setBookSearch(e.target.value)}
            placeholder="Search books…"
            className={inp2 + ' w-full'}
          />

          {/* Popular passages */}
          {!bookSearch && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-henry-text-muted font-semibold">Popular passages</p>
              <div className="grid grid-cols-2 gap-1.5">
                {POPULAR_PASSAGES.map(p => (
                  <button
                    key={p.ref}
                    onClick={() => onLookup(p.ref)}
                    className="text-left p-2.5 rounded-xl bg-henry-surface border border-henry-border/20 hover:border-henry-accent/40 transition-all"
                  >
                    <p className="text-[11px] font-semibold text-henry-accent">{p.ref}</p>
                    <p className="text-[10px] text-henry-text-muted mt-0.5 leading-tight">{p.label}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* OT */}
          {(!bookSearch || filteredBooks.some(b => isOT(b))) && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-henry-text-muted font-semibold">Old Testament</p>
              <div className="flex flex-wrap gap-1">
                {filteredBooks.filter(b => isOT(b)).map(b => (
                  <button
                    key={b}
                    onClick={() => loadChapter(b, 1)}
                    className="text-[11px] px-2 py-1 rounded-lg bg-henry-surface border border-henry-border/20 text-henry-text-muted hover:text-henry-accent hover:border-henry-accent/40 transition-all"
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* NT */}
          {(!bookSearch || filteredBooks.some(b => !isOT(b))) && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-henry-text-muted font-semibold">New Testament</p>
              <div className="flex flex-wrap gap-1">
                {filteredBooks.filter(b => !isOT(b)).map(b => (
                  <button
                    key={b}
                    onClick={() => loadChapter(b, 1)}
                    className="text-[11px] px-2 py-1 rounded-lg bg-henry-surface border border-henry-border/20 text-henry-text-muted hover:text-henry-accent hover:border-henry-accent/40 transition-all"
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Chapter header */}
          <div className="px-5 py-3 border-b border-henry-border/15 flex items-center gap-3 flex-shrink-0">
            <button
              onClick={() => setShowBookList(true)}
              className="text-henry-text-muted hover:text-henry-accent text-xs font-medium transition-all flex items-center gap-1"
            >
              ← Books
            </button>
            <div className="flex-1 flex items-center gap-2">
              <span className="font-bold text-henry-text">{book}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => chapter > 1 && loadChapter(book, chapter - 1)}
                  disabled={chapter <= 1}
                  className="w-6 h-6 rounded-lg bg-henry-surface text-henry-text-muted hover:text-henry-text disabled:opacity-30 text-sm flex items-center justify-center"
                >‹</button>
                <select
                  value={chapter}
                  onChange={e => loadChapter(book, parseInt(e.target.value))}
                  className="bg-henry-surface border border-henry-border/30 rounded-lg px-2 py-1 text-xs text-henry-text outline-none"
                >
                  {Array.from({length: chCount}, (_, i) => i+1).map(n => (
                    <option key={n} value={n}>Ch. {n}</option>
                  ))}
                </select>
                <button
                  onClick={() => chapter < chCount && loadChapter(book, chapter + 1)}
                  disabled={chapter >= chCount}
                  className="w-6 h-6 rounded-lg bg-henry-surface text-henry-text-muted hover:text-henry-text disabled:opacity-30 text-sm flex items-center justify-center"
                >›</button>
              </div>
            </div>
            <button
              onClick={() => {
                const text = verses.map(v => v.verse + ' ' + v.text).join(' ');
                onStudy(book + ' ' + chapter, text);
              }}
              disabled={verses.length === 0}
              className="text-[11px] px-3 py-1.5 rounded-xl bg-henry-accent/10 border border-henry-accent/30 text-henry-accent hover:bg-henry-accent/20 transition-all"
            >
              Study →
            </button>
          </div>

          {/* Verses */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {loading ? (
              <div className="flex items-center justify-center h-32">
                <p className="text-henry-text-muted text-sm animate-pulse">Loading {book} {chapter}…</p>
              </div>
            ) : verses.length === 0 ? (
              <div className="flex items-center justify-center h-32">
                <div className="text-center">
                  <p className="text-henry-text-muted text-sm">No verses found.</p>
                  <p className="text-henry-text-muted text-xs mt-1">The Bible may not be downloaded yet.</p>
                  <button onClick={onDownloadImport} className="mt-3 text-xs text-henry-accent hover:underline">Download KJV →</button>
                </div>
              </div>
            ) : (
              <div className="space-y-0.5">
                <p className="text-[10px] uppercase tracking-wider text-henry-text-muted mb-4 font-semibold">
                  {book} {chapter} · King James Version
                </p>
                {verses.map(v => (
                  <div
                    key={v.verse}
                    onClick={() => setHighlighted(highlighted === v.verse ? null : v.verse)}
                    className={`flex gap-3 py-1.5 px-2 rounded-lg cursor-pointer group transition-all ${
                      highlighted === v.verse
                        ? 'bg-henry-accent/15 border border-henry-accent/20'
                        : 'hover:bg-henry-surface/50'
                    }`}
                  >
                    <span className="text-[11px] text-henry-accent font-bold w-6 flex-shrink-0 pt-0.5">{v.verse}</span>
                    <p className="text-henry-text text-sm leading-relaxed">{v.text}</p>
                  </div>
                ))}

                {/* Chapter nav at bottom */}
                <div className="flex justify-between pt-6">
                  <button
                    onClick={() => chapter > 1 && loadChapter(book, chapter - 1)}
                    disabled={chapter <= 1}
                    className="text-sm text-henry-text-muted hover:text-henry-text disabled:opacity-30 flex items-center gap-1 transition-all"
                  >
                    ← {book} {chapter - 1}
                  </button>
                  <button
                    onClick={() => chapter < chCount && loadChapter(book, chapter + 1)}
                    disabled={chapter >= chCount}
                    className="text-sm text-henry-text-muted hover:text-henry-text disabled:opacity-30 flex items-center gap-1 transition-all"
                  >
                    {book} {chapter + 1} →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ScripturePanel() {
  const { setCurrentView, providers } = useStore();
  const [tab, setTab]         = useState<Tab>(() => (localStorage.getItem('henry:scripture:tab') as Tab) || 'read');
  const setTabPersisted = (t: Tab) => { setTab(t); try { localStorage.setItem('henry:scripture:tab', t); } catch {} };
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState('');
  const [query, setQuery]     = useState('');
  const [result, setResult]   = useState<VerseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [count, setCount]     = useState(0);
  const [saved, setSaved]     = useState<SavedVerse[]>([]);
  const [search, setSearch]   = useState('');
  const [note, setNote]       = useState('');
  const [editNoteRef, setEditNoteRef] = useState<string | null>(null);
  const [studyText, setStudyText] = useState('');
  const [readingPlanDay, setReadingPlanDay] = useState<number>(() => {
    const saved = localStorage.getItem('henry:scripture_plan_day');
    return saved ? parseInt(saved) : 1;
  });
  const [studyRef, setStudyRef]   = useState('');
  const [studyOutput, setStudyOutput] = useState('');
  const [studyLoading, setStudyLoading] = useState(false);
  const [studyMode, setStudyMode] = useState<StudyMode>(() => {
    return (localStorage.getItem('henry:scripture:study_mode') as StudyMode) || 'study';
  });
  const [customPrompt, setCustomPrompt] = useState('');
  const [showReadingPlan, setShowReadingPlan] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{imported:number;skipped:number;errors:string[]} | null>(null);
  const [importSource, setImportSource] = useState('KJV');

  useEffect(() => {
    getApi()?.scriptureCount?.().then((n: number) => setCount(n)).catch(() => {});
    loadSaved();
  }, []);

  async function loadSaved(q?: string) {
    try {
      const data = q
        ? await getApi()?.scriptureSearchSaved(q)
        : await getApi()?.scriptureSavedList();
      setSaved((data || []).map((v: any) => ({ ...v, tags: JSON.parse(v.tags || '[]') })));
    } catch { setSaved([]); }
  }

  useEffect(() => {
    const t = setTimeout(() => void loadSaved(search || undefined), 250);
    return () => clearTimeout(t);
  }, [search]);

  async function lookup(ref?: string) {
    const q = (ref || query).trim();
    if (!q) return;
    setLoading(true); setResult(null);
    try {
      const r = await getApi()?.scriptureLookup(q) as VerseResult;
      setResult(r);
      if (r.found) setQuery(r.normalizedReference || q);
    } catch { setResult({ found: false, guidance: 'Lookup failed.' }); }
    setLoading(false);
  }

  async function saveCurrentVerse() {
    if (!result?.found || !result.text) return;
    const v = {
      ref: result.normalizedReference || query,
      text: result.text,
      source: result.sourceLabel || undefined,
      note: note || undefined,
      tags: [],
    };
    await getApi()?.scriptureSaveVerse(v);
    setNote('');
    await loadSaved();
  }

  async function deleteVerse(ref: string) {
    await getApi()?.scriptureDeleteVerse(ref);
    await loadSaved();
  }

  async function saveNote(ref: string, n: string) {
    await getApi()?.scriptureUpdateNote(ref, n);
    setEditNoteRef(null);
    await loadSaved();
  }

  async function studyPassage(prompt: string) {
    const text = studyText || result?.text || '';
    const ref = studyRef || result?.normalizedReference || query;
    if (!text) return;
    setStudyLoading(true); setStudyOutput('');
    try {
      const out = await henryStudy(ref, text, prompt, studyMode);
      setStudyOutput(out);
    } catch (e) { setStudyOutput('Error: ' + String(e)); }
    setStudyLoading(false);
  }

  function setStudyModePersisted(m: StudyMode) {
    setStudyMode(m);
    try { localStorage.setItem('henry:scripture:study_mode', m); } catch { /* ignore */ }
  }

  function studyInChat() {
    const text = studyText || result?.text || '';
    const ref = studyRef || result?.normalizedReference || query;
    sendToHenry(`Let's study ${ref}:\n\n"${text}"\n\nHelp me understand this passage deeply — context, meaning, and application.`);
    setCurrentView('chat');
  }

  const inp = "bg-henry-surface border border-henry-border/30 rounded-xl px-3 py-2.5 text-sm text-henry-text placeholder:text-henry-text-muted outline-none focus:border-henry-accent/50 transition-all";
  async function handlePickImport() {
    setImporting(true); setImportResult(null);
    try {
      const result = await getApi()?.pickScriptureImportJson?.();
      if (result) { setImportResult(result); await getApi()?.scriptureCount?.().then((n:number) => setCount(n)).catch(() => {}); }
    } catch(e) { setImportResult({ imported:0, skipped:0, errors: [String(e)] }); }
    setImporting(false);
  }

  const savedCount = saved.length;

  async function downloadKJV(booksOnly?: string[]) {
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
    const CDN = 'https://cdn.jsdelivr.net/gh/aruljohn/Bible-kjv/';
    const target = booksOnly && booksOnly.length ? booksOnly : ALL_BOOKS;

    function humanName(b: string) {
      return b.replace(/([0-9])([A-Z])/,'$1 $2').replace(/([a-z])([A-Z])/g,'$1 $2')
               .replace('Songof Solomon','Song of Solomon').replace('Songof','Song of');
    }

    function parseBook(data: any, bookFile: string) {
      const bookName = humanName(bookFile);
      const chapters: any[] = data.chapters || [];
      const entries: Array<{reference:string; text:string; sourceLabel:string}> = [];
      for (let ci = 0; ci < chapters.length; ci++) {
        const ch = chapters[ci];
        const isRich = ch && !Array.isArray(ch) && 'verses' in ch;
        const chNum = isRich ? (parseInt(ch.chapter) || ci+1) : ci+1;
        const verses = isRich ? ch.verses : (Array.isArray(ch) ? ch : []);
        for (let vi = 0; vi < verses.length; vi++) {
          const v = verses[vi];
          const text = typeof v === 'string' ? v : v?.text;
          const vsNum = typeof v === 'object' ? (parseInt(v?.verse) || vi+1) : vi+1;
          if (text) entries.push({ reference: bookName + ' ' + chNum + ':' + vsNum, text, sourceLabel: 'King James Version' });
        }
      }
      return entries;
    }

    setDownloading(true);
    let total = 0;
    const errors: string[] = [];

    for (let i = 0; i < target.length; i++) {
      const book = target[i];
      setDownloadProgress('Downloading ' + humanName(book) + '… (' + (i+1) + '/' + target.length + ')');
      try {
        const resp = await fetch(CDN + book + '.json');
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        const entries = parseBook(data, book);
        if (entries.length > 0) {
          // Use existing scriptureImport IPC — already wired and confirmed working
          const henryAPI = (window as any).henryAPI;
          await henryAPI.scriptureImport(entries);
          total += entries.length;
        }
      } catch (e) {
        errors.push(book + ': ' + String(e));
      }
    }

    setDownloadProgress(
      errors.length === 0
        ? '✓ ' + total.toLocaleString() + ' verses downloaded and ready'
        : '✓ ' + total.toLocaleString() + ' verses — ' + errors.length + ' books failed'
    );
    setDownloading(false);
    // Refresh saved count
    const henryAPI = (window as any).henryAPI;
    await loadSaved();
  }

  return (
    <div className="flex flex-col h-full bg-henry-bg overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 border-b border-henry-border/20 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-henry-text">✝ Scripture</h1>
            <p className="text-[11px] text-henry-text-muted mt-0.5">
              DeepWell · {count > 0 ? `${count.toLocaleString()} verses indexed` : 'No translation loaded — use Import tab'}
            </p>
          </div>
        </div>
        {/* Tabs */}
        <div className="flex gap-1 mt-3">
          {(['read','lookup','saved','study','import'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTabPersisted(t)}
              className={'text-[12px] px-3 py-1.5 rounded-lg font-medium transition-all capitalize ' +
                (tab===t ? 'bg-henry-accent text-white' : 'bg-henry-surface border border-henry-border/30 text-henry-text-muted hover:text-henry-text')}>
              {t==='read'?'📖 Read':t==='lookup'?'Lookup':t==='saved'?`Saved${savedCount>0?' ('+savedCount+')':''}`:t==='study'?(tab==='study' ? <span className='flex items-center gap-1'>Study <button onClick={e=>{e.stopPropagation();setShowReadingPlan(s=>!s)}} className='text-[9px] bg-henry-accent/15 text-henry-accent px-1.5 rounded'>📅</button></span> : 'Study'):'📥 Import'}
            </button>
          ))}
        </div>
      </div>


      {/* ── READ TAB ── Chapter browser ─────────────────────────────────── */}
      {tab === 'read' && (
        <ReadTab
          count={count}
          downloading={downloading}
          downloadProgress={downloadProgress}
          onDownload={() => void downloadKJV()}
          onLookup={(ref) => { setQuery(ref); setTabPersisted('lookup'); void lookup(ref); }}
          onStudy={(ref, text) => { setStudyRef(ref); setStudyText(text); setTabPersisted('study'); }}
          onDownloadImport={() => { setTabPersisted('import'); setTimeout(() => void downloadKJV(), 100); }}
        />
      )}

      {/* ── LOOKUP TAB ── */}
      {tab === 'lookup' && (
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {count === 0 && !downloading && (
            <div className="bg-henry-accent/8 border border-henry-accent/25 rounded-xl p-4 space-y-2">
              <p className="text-henry-text text-sm font-semibold">Bible not downloaded yet</p>
              <p className="text-henry-text-muted text-xs leading-relaxed">Download the KJV once and every verse lookup works instantly, offline, forever.</p>
              <button onClick={() => void downloadKJV()}
                className="w-full py-2.5 rounded-xl bg-henry-accent text-white text-sm font-bold hover:bg-henry-accent/80 transition-all">
                ⬇ Download KJV Free — 31,000 verses
              </button>
            </div>
          )}
          {downloading && (
            <div className="bg-henry-accent/8 border border-henry-accent/25 rounded-xl p-3 text-center">
              <p className="text-henry-accent text-xs font-semibold">{downloadProgress || 'Downloading…'}</p>
            </div>
          )}
          <form onSubmit={e => { e.preventDefault(); void lookup(); }} className="flex gap-2">
            <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
              placeholder="John 3:16, Psalm 23, Romans 8:28-39…"
              className={inp + ' flex-1'} />
            <button type="submit" disabled={loading || !query.trim()}
              className="px-4 py-2.5 rounded-xl bg-henry-accent text-white text-sm font-bold disabled:opacity-40 hover:bg-henry-accent/80 transition-all">
              {loading ? '…' : 'Look up'}
            </button>
          </form>

          {/* Quick refs */}
          <div className="flex flex-wrap gap-1.5">
            {QUICK_REFS.map(r => (
              <button key={r} onClick={() => { setQuery(r); void lookup(r); }}
                className="text-[11px] px-2.5 py-1 rounded-full bg-henry-surface border border-henry-border/30 text-henry-text-muted hover:text-henry-accent hover:border-henry-accent/40 transition-all">
                {r}
              </button>
            ))}
          </div>

          {/* Result */}
          {result && (
            <div className="space-y-3">
              {result.found ? (
                <div className="bg-henry-surface rounded-2xl border border-henry-border/20 p-5 space-y-4">
                  <div>
                    <p className="text-[11px] uppercase tracking-wider text-henry-accent mb-2 font-semibold">
                      {result.normalizedReference}
                      {result.sourceLabel && <span className="text-henry-text-muted ml-2 normal-case">· {result.sourceLabel}</span>}
                    </p>
                    <p className="text-henry-text leading-relaxed text-base italic">"{result.text}"</p>
                  </div>
                  {result.notes && (
                    <p className="text-henry-text-muted text-xs border-t border-henry-border/20 pt-3">{result.notes}</p>
                  )}
                  {/* Cross-references — free, instant, no AI tokens */}
                  {(() => {
                    const refs = getCrossRefs(result.normalizedReference || '');
                    if (refs.length === 0) return null;
                    return (
                      <div className="border-t border-henry-border/20 pt-3">
                        <p className="text-[10px] uppercase tracking-wider text-henry-text-muted mb-2 font-semibold">
                          See also
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {refs.map(r => (
                            <button key={r}
                              onClick={() => { setQuery(r); void lookup(r); }}
                              className="text-[11px] px-2.5 py-1 rounded-full bg-henry-accent/10 border border-henry-accent/30 text-henry-accent hover:bg-henry-accent/20 transition-all">
                              {r}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  {/* Actions */}
                  <div className="space-y-2 pt-1">
                    <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
                      placeholder="Add a personal note or reflection before saving…"
                      className={inp + ' w-full resize-none text-xs'} />
                    <div className="flex gap-2">
                      <button onClick={() => void saveCurrentVerse()}
                        className="flex-1 py-2 rounded-xl bg-henry-accent/10 border border-henry-accent/30 text-henry-accent text-sm font-semibold hover:bg-henry-accent/20 transition-all">
                        ✦ Save Verse
                      </button>
                      <button onClick={() => {
                        setStudyText(result.text || '');
                        setStudyRef(result.normalizedReference || '');
                        setTabPersisted('study');
                      }} className="flex-1 py-2 rounded-xl bg-henry-surface border border-henry-border/30 text-henry-text-muted text-sm hover:text-henry-text transition-all">
                        Study →
                      </button>
                      <button onClick={studyInChat}
                        className="px-4 py-2 rounded-xl bg-henry-surface border border-henry-border/30 text-henry-text-muted text-sm hover:text-henry-text transition-all">
                        Chat
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-henry-surface rounded-xl border border-henry-border/20 p-4 space-y-3">
                  {count === 0 ? (
                    <>
                      <p className="text-henry-text text-sm font-semibold">Bible not downloaded yet</p>
                      <p className="text-henry-text-muted text-xs leading-relaxed">
                        Henry stores the Bible locally on your Mac for instant offline lookup. Download the King James Version free — 31,000 verses, takes about 30 seconds.
                      </p>
                      <button
                        onClick={() => { setTabPersisted('import'); setTimeout(() => void downloadKJV(), 100); }}
                        disabled={downloading}
                        className="w-full py-2.5 rounded-xl bg-henry-accent text-white text-sm font-bold hover:bg-henry-accent/80 transition-all disabled:opacity-40">
                        {downloading ? downloadProgress || 'Downloading…' : '⬇ Download KJV — Free'}
                      </button>
                      {downloadProgress && <p className="text-xs text-henry-text-muted">{downloadProgress}</p>}
                    </>
                  ) : (
                    <p className="text-henry-text-muted text-sm">
                      {result.guidance || 'Verse not found. Check the reference format — try "John 3:16" or "Psalm 23:1".'}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── SAVED TAB ── */}
      {tab === 'saved' && (
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search saved verses…"
            className={inp + ' w-full'} />
          {saved.length === 0 && (
            <div className="text-center py-12">
              <p className="text-3xl mb-3">✦</p>
              <p className="text-henry-text-muted text-sm">No saved verses yet.</p>
              <p className="text-henry-text-muted text-xs mt-1">Look up a passage and tap Save Verse.</p>
            </div>
          )}
          {saved.map(v => (
            <div key={v.ref} className="group bg-henry-surface rounded-xl border border-henry-border/20 p-4 space-y-2">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] uppercase tracking-wider text-henry-accent font-semibold">{v.ref}</p>
                  {v.source && <p className="text-[10px] text-henry-text-muted">{v.source}</p>}
                </div>
                <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0 ml-2">
                  <button onClick={() => {
                    setStudyText(v.text); setStudyRef(v.ref); setTabPersisted('study');
                  }} className="text-[10px] px-2 py-1 rounded bg-henry-surface2 text-henry-text-muted hover:text-henry-accent">Study</button>
                  <button onClick={() => deleteVerse(v.ref)} className="text-[10px] px-2 py-1 rounded text-henry-text-muted hover:text-red-400">✕</button>
                </div>
              </div>
              <p className="text-henry-text text-sm italic leading-relaxed">"{v.text}"</p>
              {/* Note */}
              {editNoteRef === v.ref ? (
                <div className="space-y-1.5">
                  <textarea defaultValue={v.note || ''} id={`note-${v.ref}`} rows={2} autoFocus
                    className={inp + ' w-full resize-none text-xs'} />
                  <div className="flex gap-2">
                    <button onClick={() => {
                      const el = document.getElementById(`note-${v.ref}`) as HTMLTextAreaElement;
                      void saveNote(v.ref, el?.value || '');
                    }} className="text-[11px] px-3 py-1 rounded-lg bg-henry-accent/10 border border-henry-accent/30 text-henry-accent hover:bg-henry-accent/20">Save</button>
                    <button onClick={() => setEditNoteRef(null)} className="text-[11px] px-2 py-1 text-henry-text-muted hover:text-henry-text">Cancel</button>
                  </div>
                </div>
              ) : v.note ? (
                <p className="text-henry-text-muted text-xs border-t border-henry-border/20 pt-2 cursor-pointer hover:text-henry-text transition-all"
                  onClick={() => setEditNoteRef(v.ref)}>
                  📝 {v.note}
                </p>
              ) : (
                <button onClick={() => setEditNoteRef(v.ref)}
                  className="text-[10px] text-henry-text-muted/60 hover:text-henry-text-muted transition-all">
                  + Add note
                </button>
              )}
              {/* Cross-references on saved verse */}
              {(() => {
                const refs = getCrossRefs(v.ref);
                if (refs.length === 0) return null;
                return (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {refs.slice(0, 5).map(r => (
                      <button key={r}
                        onClick={() => { setTabPersisted('lookup'); setQuery(r); void lookup(r); }}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-henry-accent/8 border border-henry-accent/20 text-henry-accent/80 hover:bg-henry-accent/15 transition-all">
                        {r}
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      )}

      {/* ── STUDY TAB ── */}
      {tab === 'study' && (
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 max-w-2xl">
          {/* Mode toggle: Study vs Sermon */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-henry-text-muted">Mode:</span>
            <div className="inline-flex rounded-xl border border-henry-border/30 bg-henry-surface p-0.5">
              <button onClick={() => setStudyModePersisted('study')}
                className={`text-[11px] px-3 py-1 rounded-lg font-medium transition-all ${
                  studyMode === 'study'
                    ? 'bg-henry-accent text-white'
                    : 'text-henry-text-muted hover:text-henry-text'
                }`}>
                📖 Study
              </button>
              <button onClick={() => setStudyModePersisted('sermon')}
                className={`text-[11px] px-3 py-1 rounded-lg font-medium transition-all ${
                  studyMode === 'sermon'
                    ? 'bg-henry-accent text-white'
                    : 'text-henry-text-muted hover:text-henry-text'
                }`}>
                ✝ Sermon
              </button>
            </div>
            <span className="text-[10px] text-henry-text-muted">
              {studyMode === 'sermon'
                ? 'Henry builds outlines: hook, big idea, 3 points, application, closing.'
                : 'Henry explores context, meaning, and application.'}
            </span>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-wider text-henry-text-muted block">Passage reference</label>
            <input value={studyRef} onChange={e => setStudyRef(e.target.value)} placeholder="e.g. Romans 8:28"
              className={inp + ' w-full'} />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] uppercase tracking-wider text-henry-text-muted block">Passage text</label>
            <textarea value={studyText} onChange={e => setStudyText(e.target.value)} rows={4}
              placeholder="Paste or type the passage text here…"
              className={inp + ' w-full resize-none'} />
          </div>

          {/* Mode-specific prompts */}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-henry-text-muted mb-2">
              {studyMode === 'sermon' ? 'Sermon prompts' : 'Study questions'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(studyMode === 'sermon' ? SERMON_PROMPTS : STUDY_PROMPTS).map(p => (
                <button key={p} onClick={() => void studyPassage(p)} disabled={!studyText.trim() || studyLoading}
                  className="text-left text-[11px] px-3 py-2 rounded-xl bg-henry-surface border border-henry-border/30 text-henry-text-muted hover:text-henry-text hover:border-henry-accent/30 disabled:opacity-40 transition-all leading-snug">
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Custom prompt */}
          <div className="flex gap-2">
            <input value={customPrompt} onChange={e => setCustomPrompt(e.target.value)}
              placeholder="Ask your own question about this passage…"
              className={inp + ' flex-1'}
              onKeyDown={e => { if (e.key === 'Enter' && customPrompt.trim()) void studyPassage(customPrompt); }} />
            <button onClick={() => void studyPassage(customPrompt)} disabled={!studyText.trim() || !customPrompt.trim() || studyLoading}
              className="px-4 py-2.5 rounded-xl bg-henry-accent text-white text-sm font-bold disabled:opacity-40 hover:bg-henry-accent/80 transition-all">
              Ask
            </button>
          </div>

          <button onClick={studyInChat} disabled={!studyText.trim()}
            className="w-full py-2.5 rounded-xl bg-henry-surface border border-henry-border/30 text-henry-text-muted text-sm hover:text-henry-text transition-all disabled:opacity-40">
            Deep dive in Chat →
          </button>

          {/* Output */}
          {studyLoading && (
            <div className="bg-henry-surface rounded-xl border border-henry-border/20 p-4">
              <p className="text-henry-text-muted text-sm animate-pulse">Henry is studying…</p>
            </div>
          )}
          {studyOutput && !studyLoading && (
            <div className="bg-henry-surface rounded-xl border border-henry-accent/20 p-5 space-y-3">
              <p className="text-henry-text text-sm leading-relaxed whitespace-pre-wrap">{studyOutput}</p>
              <div className="flex gap-2 pt-2 border-t border-henry-border/20">
                <button onClick={async () => {
                  const api2 = (window as any).henryAPI;
                  if (!api2?.journalSave) return;
                  const today = new Date().toISOString().slice(0,10);
                  await api2.journalSave({
                    id: crypto.randomUUID(),
                    date: today,
                    title: 'Bible Study: ' + (studyRef || query),
                    content: (studyRef || query) + '\n\n' + studyOutput,
                    mood: '🙏',
                    tags: JSON.stringify(['scripture','study']),
                  });
                  alert('Saved to Journal ✓');
                }}
                  className="text-xs px-2.5 py-1 rounded-lg border border-henry-border/30 text-henry-text-muted hover:text-henry-accent transition-all">
                  📔 Save to Journal
                </button>
                <button onClick={() => navigator.clipboard?.writeText(studyOutput)}
                  className="text-[11px] px-3 py-1 rounded-lg border border-henry-border/30 text-henry-text-muted hover:text-henry-text transition-all">
                  Copy
                </button>
                <button onClick={() => {
                  if (studyRef) void getApi()?.scriptureUpdateNote(studyRef, studyOutput.slice(0, 500));
                }} className="text-[11px] px-3 py-1 rounded-lg border border-henry-border/30 text-henry-text-muted hover:text-henry-text transition-all">
                  Save as note
                </button>
                <button onClick={() => setStudyOutput('')}
                  className="text-[11px] px-2 py-1 text-henry-text-muted hover:text-red-400 transition-all ml-auto">✕</button>
              </div>
            </div>
          )}
        </div>
      )}
      {/* ── IMPORT TAB ── */}
      {/* 31-Day NT Reading Plan */}
      {tab === 'study' && showReadingPlan && (
        <div className="px-6 pb-2">
          <div className="bg-henry-surface/40 border border-henry-border/15 rounded-xl p-3 max-h-40 overflow-y-auto space-y-1">
            {Object.entries({1:"Matthew 1-2",2:"Matthew 3-4",3:"Matthew 5-7",4:"Matthew 8-10",5:"Matthew 11-13",6:"Matthew 14-16",7:"Matthew 17-19",8:"Matthew 20-22",9:"Matthew 23-25",10:"Matthew 26-28",11:"Mark 1-2",12:"Mark 3-4",13:"Mark 5-7",14:"Mark 8-10",15:"Mark 11-13",16:"Mark 14-16",17:"Luke 1-3",18:"Luke 4-6",19:"Luke 7-9",20:"Luke 10-12",21:"Luke 13-15",22:"Luke 16-18",23:"Luke 19-21",24:"Luke 22-24",25:"John 1-3",26:"John 4-6",27:"John 7-9",28:"John 10-12",29:"John 13-15",30:"John 16-18",31:"John 19-21"}).map(([day, passage]) => {
              const isToday = parseInt(day) === new Date().getDate();
              return (
                <div key={day} className="flex items-center gap-2">
                  <span className="text-[10px] text-henry-text-muted w-5">{day}</span>
                  <button onClick={() => { setQuery(passage); setTabPersisted('lookup'); setShowReadingPlan(false); }}
                    className={`text-xs hover:text-henry-accent transition-all ${isToday ? 'text-henry-accent font-bold' : 'text-henry-text-muted'}`}>
                    {isToday && '→ '}{passage}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

            {tab === 'import' && (
        <div className="flex-1 overflow-y-auto px-6 py-5 max-w-2xl space-y-5">
          {/* One-click KJV download */}
          <div className="bg-henry-surface rounded-2xl border border-henry-border/20 p-5 space-y-3">
            <div className="flex items-start gap-3">
              <span className="text-2xl">📖</span>
              <div>
                <p className="font-semibold text-henry-text">Download King James Bible</p>
                <p className="text-xs text-henry-text-muted mt-0.5">
                  Full KJV — 66 books, 31,102 verses — downloaded from a free public CDN.
                  Takes about 30 seconds on WiFi.
                </p>
              </div>
            </div>
            {downloadProgress && (
              <div className={`text-sm px-3 py-2 rounded-xl ${downloadProgress.startsWith('✓') ? 'bg-green-400/10 text-green-400 border border-green-400/20' : downloadProgress.startsWith('Error') ? 'bg-red-400/10 text-red-400' : 'bg-henry-bg text-henry-text-muted'}`}>
                {downloading && <span className="inline-block animate-spin mr-2">⟳</span>}
                {downloadProgress}
              </div>
            )}
            <button onClick={() => void downloadKJV()} disabled={downloading}
              className="w-full py-3 bg-henry-accent text-white font-bold rounded-xl text-sm hover:bg-henry-accent/80 disabled:opacity-50 transition-all">
              {downloading ? 'Downloading…' : '⬇ Download Full KJV (31,102 verses)'}
            </button>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: '📜 New Testament only', books: ['Matthew','Mark','Luke','John','Acts','Romans','1Corinthians','2Corinthians','Galatians','Ephesians','Philippians','Colossians','1Thessalonians','2Thessalonians','1Timothy','2Timothy','Titus','Philemon','Hebrews','James','1Peter','2Peter','1John','2John','3John','Jude','Revelation'] },
                { label: '📜 Psalms & Proverbs', books: ['Psalms','Proverbs'] },
                { label: '📜 Gospels only', books: ['Matthew','Mark','Luke','John'] },
                { label: "📜 Paul's Letters", books: ['Romans','1Corinthians','2Corinthians','Galatians','Ephesians','Philippians','Colossians','1Thessalonians','2Thessalonians','1Timothy','2Timothy','Titus','Philemon'] },
              ].map(s => (
                <button key={s.label} onClick={() => void downloadKJV(s.books)} disabled={downloading}
                  className="py-2 px-3 rounded-xl border border-henry-border/30 text-xs text-henry-text-muted hover:text-henry-text hover:border-henry-accent/40 disabled:opacity-40 transition-all text-left">
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Manual JSON import */}
          <div className="bg-henry-surface/50 rounded-2xl border border-henry-border/15 p-5 space-y-3">
            <p className="text-sm font-semibold text-henry-text">Import your own translation</p>
            <p className="text-xs text-henry-text-muted leading-relaxed">
              Import any translation as a JSON file. Format: array of objects with
              <code className="bg-henry-bg px-1 rounded text-henry-accent mx-1">reference</code>,
              <code className="bg-henry-bg px-1 rounded text-henry-accent mx-1">text</code> fields.
            </p>
            <div className="bg-henry-bg rounded-xl p-3 text-[11px] font-mono text-henry-text-muted">
              {'[{"reference":"John 3:16","text":"For God so loved..."},...]'}
            </div>
            <div className="flex gap-2">
              <p className="text-xs text-henry-text-muted">Free translations: KJV, ASV, WEB, Darby — available at ebible.org</p>
              <button onClick={() => getApi()?.computerRunShell?.({ command: 'open https://ebible.org/find/', timeout: 3000 })}
                className="text-xs text-henry-accent hover:underline flex-shrink-0">Open ↗</button>
            </div>
            <button onClick={async () => {
              const result = await getApi()?.scripturePickImportJson?.();
              if (result?.imported) setDownloadProgress('✓ Imported ' + result.imported + ' verses from file');
            }} className="w-full py-2.5 rounded-xl border border-henry-border/30 text-sm text-henry-text-muted hover:text-henry-text hover:border-henry-accent/30 transition-all">
              📁 Choose JSON file…
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
