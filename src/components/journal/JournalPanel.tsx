import { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store';
import ReactMarkdown from 'react-markdown';

const JOURNAL_PREFIX = 'henry:journal:';

interface JournalEntry {
  date: string;
  content: string;
  henryNote?: string;
  savedAt: string;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDateLabel(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T12:00:00');
    const today = todayKey();
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (dateStr === today) return 'Today';
    if (dateStr === yesterday) return 'Yesterday';
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function loadEntry(dateKey: string): JournalEntry | null {
  try {
    const raw = localStorage.getItem(JOURNAL_PREFIX + dateKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveEntry(entry: JournalEntry): void {
  try {
    localStorage.setItem(JOURNAL_PREFIX + entry.date, JSON.stringify(entry));
  } catch { /* ignore */ }
}

function loadAllEntries(): JournalEntry[] {
  const entries: JournalEntry[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(JOURNAL_PREFIX)) {
        const raw = localStorage.getItem(key);
        if (raw) {
          try { entries.push(JSON.parse(raw)); } catch { /* skip */ }
        }
      }
    }
  } catch { /* ignore */ }
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

export default function JournalPanel() {
  const settings = useStore((s) => s.settings);
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [gettingHenryNote, setGettingHenryNote] = useState(false);
  const [liveHenryNote, setLiveHenryNote] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [view, setView] = useState<'write' | 'history'>('write');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const all = loadAllEntries();
    setEntries(all);
    const todayEntry = all.find((e) => e.date === todayKey());
    if (todayEntry) setDraft(todayEntry.content);
  }, []);

  function handleSave() {
    if (!draft.trim()) return;
    setSaving(true);
    const existing = loadEntry(selectedDate);
    const entry: JournalEntry = {
      date: selectedDate,
      content: draft.trim(),
      henryNote: existing?.henryNote,
      savedAt: new Date().toISOString(),
    };
    saveEntry(entry);
    const all = loadAllEntries();
    setEntries(all);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function handleBlur() {
    if (draft.trim()) handleSave();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
  }

  async function askHenry() {
    if (!draft.trim()) return;
    handleSave();
    setGettingHenryNote(true);
    setLiveHenryNote('');
    try {
      const s = useStore.getState().settings;
      if (!s.companion_provider || !s.companion_model) {
        setGettingHenryNote(false);
        return;
      }
      const providers = await window.henryAPI.getProviders();
      const provider = providers.find((p: any) => p.id === s.companion_provider);
      if (!provider) { setGettingHenryNote(false); return; }

      const prompt = `Here is today's journal entry:\n\n${draft}\n\nGive a brief, warm, thoughtful reflection on this — what stands out, what patterns you notice, one insight or question worth sitting with. Stay concise (2-4 sentences), no platitudes.`;

      const stream = window.henryAPI.streamMessage({
        provider: s.companion_provider,
        model: s.companion_model,
        apiKey: provider.api_key || provider.apiKey || '',
        messages: [
          { role: 'system', content: 'You are Henry — a thoughtful companion reflecting on journal entries. Be warm, perceptive, brief. No hollow affirmations.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.8,
      });
      stream.onChunk((chunk: string) => {
        setLiveHenryNote((prev) => prev + chunk);
      });
      stream.onDone((fullText: string) => {
        setLiveHenryNote('');
        const existing = loadEntry(selectedDate);
        const target = existing ?? { date: selectedDate, content: draft.trim(), savedAt: new Date().toISOString() };
        const updated = { ...target, henryNote: fullText };
        saveEntry(updated);
        setEntries(loadAllEntries());
        setGettingHenryNote(false);
      });
      stream.onError(() => { setLiveHenryNote(''); setGettingHenryNote(false); });
    } catch {
      setLiveHenryNote('');
      setGettingHenryNote(false);
    }
  }

  const selectedEntry = entries.find((e) => e.date === selectedDate);
  const filtered = searchQuery.trim()
    ? entries.filter((e) =>
        e.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.henryNote?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : entries;

  const hour = new Date().getHours();
  const eveningPrompt = hour >= 19
    ? 'What happened today? Anything worth keeping?'
    : hour < 12
    ? "What's on your mind this morning?"
    : 'What have you been working through today?';

  return (
    <div className="h-full flex flex-col bg-henry-bg">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-henry-border/50 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-henry-text">Journal</h1>
          <p className="text-xs text-henry-text-muted mt-0.5">{formatDateLabel(todayKey())}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView('write')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${view === 'write' ? 'bg-henry-accent/15 text-henry-accent' : 'text-henry-text-dim hover:text-henry-text'}`}
          >
            Write
          </button>
          <button
            onClick={() => setView('history')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${view === 'history' ? 'bg-henry-accent/15 text-henry-accent' : 'text-henry-text-dim hover:text-henry-text'}`}
          >
            History ({entries.length})
          </button>
        </div>
      </div>

      {view === 'write' ? (
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 max-w-2xl w-full mx-auto">
          {/* Today's entry */}
          <div>
            <p className="text-[11px] font-medium text-henry-text-muted uppercase tracking-wider mb-2">{eveningPrompt}</p>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              placeholder="Start typing… this is just for you."
              className="w-full min-h-[220px] bg-henry-surface/40 border border-henry-border/30 rounded-xl px-4 py-3.5 text-sm text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/40 focus:bg-henry-surface/60 transition-all resize-none leading-relaxed"
            />
            <div className="flex items-center gap-2.5 mt-3">
              <button
                onClick={handleSave}
                disabled={saving || !draft.trim()}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-henry-surface border border-henry-border/40 text-henry-text hover:bg-henry-hover/50 disabled:opacity-40 transition-all"
              >
                {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
              </button>
              <button
                onClick={askHenry}
                disabled={gettingHenryNote || !draft.trim()}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-henry-accent/15 border border-henry-accent/25 text-henry-accent hover:bg-henry-accent/25 disabled:opacity-40 transition-all"
              >
                {gettingHenryNote ? 'Henry is reading…' : 'Ask Henry to reflect'}
              </button>
              <span className="text-[10px] text-henry-text-muted ml-auto">⌘S to save</span>
            </div>
          </div>

          {/* Henry's note — streams live then persists */}
          {(liveHenryNote || selectedEntry?.henryNote) && (
            <div className="rounded-xl border border-henry-accent/20 bg-henry-accent/5 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm">🧠</span>
                <span className="text-[11px] font-medium text-henry-accent uppercase tracking-wide">Henry's reflection</span>
                {gettingHenryNote && <span className="inline-block w-1.5 h-3.5 bg-henry-accent animate-pulse rounded-sm ml-1" />}
              </div>
              <div className="text-sm text-henry-text-dim leading-relaxed">
                <ReactMarkdown>{liveHenryNote || selectedEntry?.henryNote || ''}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 py-5 max-w-2xl w-full mx-auto">
          {/* Search */}
          <div className="mb-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search entries…"
              className="w-full bg-henry-surface/40 border border-henry-border/30 rounded-xl px-4 py-2.5 text-sm text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/40 transition-all"
            />
          </div>

          {filtered.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-henry-text-muted text-sm">{searchQuery ? 'No entries match that search.' : 'No journal entries yet.'}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((entry) => (
                <button
                  key={entry.date}
                  onClick={() => {
                    setSelectedDate(entry.date);
                    setDraft(entry.content);
                    setView('write');
                  }}
                  className="w-full text-left p-4 rounded-xl border border-henry-border/20 bg-henry-surface/20 hover:bg-henry-surface/50 hover:border-henry-border/40 transition-all"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-medium text-henry-text">{formatDateLabel(entry.date)}</span>
                    {entry.henryNote && <span className="text-[10px] text-henry-accent">🧠 Henry reflected</span>}
                  </div>
                  <p className="text-xs text-henry-text-dim line-clamp-2 leading-relaxed">{entry.content}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
