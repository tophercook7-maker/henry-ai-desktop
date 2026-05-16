/**
 * Prayer Panel — Henry's prayer journal.
 *
 * A faith-driven, local-only space for tracking active prayers, marking
 * answered ones (with testimony), and watching faithfulness over time
 * via the "I prayed for this" counter.
 *
 * Pairs with ScripturePanel: each prayer can carry a scripture reference,
 * and the underlying prayer:* IPC handlers live in electron/ipc/memory.ts.
 *
 * Design priorities:
 *  - Calm, uncluttered, reverent — this is sacred space for the user.
 *  - Zero AI cost — every read is a SQL query, not a model call.
 *  - One-click "I prayed" so faithfulness is easy to record on a busy day.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

type PrayerStatus = 'active' | 'answered' | 'archived';

type PrayerCategory =
  | 'petition'
  | 'intercession'
  | 'thanksgiving'
  | 'confession'
  | 'praise'
  | 'lament';

interface PrayerRequest {
  id: string;
  title: string;
  body: string | null;
  category: string | null;
  status: PrayerStatus;
  priority: number;
  scripture_ref: string | null;
  created_at: string;
  updated_at: string | null;
  answered_at: string | null;
  answered_note: string | null;
  last_prayed_at: string | null;
  pray_count: number;
}

interface PrayerStats {
  byStatus?: { active?: number; answered?: number; archived?: number };
  longestActive?: { id: string; title: string; created_at: string } | null;
  mostPrayed?: { id: string; title: string; pray_count: number } | null;
  recentAnswers?: Array<{
    id: string;
    title: string;
    answered_at: string;
    answered_note: string | null;
  }>;
}

const CATEGORIES: { id: PrayerCategory; label: string; icon: string; color: string }[] = [
  { id: 'petition',     label: 'Petition',     icon: '🤲', color: 'text-sky-400 bg-sky-400/10 border-sky-400/20' },
  { id: 'intercession', label: 'Intercession', icon: '🙏', color: 'text-violet-400 bg-violet-400/10 border-violet-400/20' },
  { id: 'thanksgiving', label: 'Thanksgiving', icon: '✨', color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' },
  { id: 'confession',   label: 'Confession',   icon: '☁',  color: 'text-slate-400 bg-slate-400/10 border-slate-400/20' },
  { id: 'praise',       label: 'Praise',       icon: '✦',  color: 'text-amber-400 bg-amber-400/10 border-amber-400/20' },
  { id: 'lament',       label: 'Lament',       icon: '◐',  color: 'text-rose-400 bg-rose-400/10 border-rose-400/20' },
];

function categoryMeta(c?: string | null) {
  if (!c) return null;
  return CATEGORIES.find(x => x.id === c) || null;
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch { return iso.slice(0, 10); }
}

function fmtRelative(iso?: string | null): string {
  if (!iso) return '';
  try {
    const then = new Date(iso).getTime();
    const now = Date.now();
    const diffSec = Math.max(0, (now - then) / 1000);
    if (diffSec < 60) return 'just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} h ago`;
    const days = Math.floor(diffSec / 86400);
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.floor(days / 7)} wk ago`;
    if (days < 365) return `${Math.floor(days / 30)} mo ago`;
    return `${Math.floor(days / 365)} yr ago`;
  } catch { return ''; }
}

const inputCls =
  'w-full bg-henry-surface border border-henry-border/30 rounded-xl px-3 py-2 text-sm text-henry-text placeholder:text-henry-text-muted outline-none focus:border-henry-accent/50 transition-all';

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-henry-text-muted mb-1.5 block">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-henry-text-muted/80 mt-1">{hint}</p>}
    </div>
  );
}

interface EditingPrayer {
  id?: string;
  title: string;
  body: string;
  category: PrayerCategory;
  scripture_ref: string;
  priority: number;
}

function blankPrayer(): EditingPrayer {
  return { title: '', body: '', category: 'petition', scripture_ref: '', priority: 1 };
}

export default function PrayerPanel() {
  const [prayers, setPrayers] = useState<PrayerRequest[]>([]);
  const [stats, setStats] = useState<PrayerStats | null>(null);
  const [statusFilter, setStatusFilter] = useState<PrayerStatus | 'all'>('active');
  const [categoryFilter, setCategoryFilter] = useState<PrayerCategory | 'all'>('all');
  const [editing, setEditing] = useState<EditingPrayer | null>(null);
  const [answering, setAnswering] = useState<{ id: string; title: string; note: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const api = (window as { henryAPI?: any }).henryAPI;
    if (!api?.prayerList || !api?.prayerStats) {
      setError('Prayer journal is not yet available in this build.');
      setLoading(false);
      return;
    }
    try {
      const opts: { status?: PrayerStatus; category?: string } = {};
      if (statusFilter !== 'all') opts.status = statusFilter;
      if (categoryFilter !== 'all') opts.category = categoryFilter;
      const list = (await api.prayerList(opts)) as PrayerRequest[] | { ok: false; error: string };
      const s = (await api.prayerStats()) as PrayerStats | { ok: false; error: string };
      if (Array.isArray(list)) setPrayers(list);
      else setPrayers([]);
      if (s && !('ok' in s && s.ok === false)) setStats(s as PrayerStats);
      setError(null);
    } catch (e) {
      console.warn('prayer load failed', e);
      setError(e instanceof Error ? e.message : 'Could not load prayers.');
    }
    setLoading(false);
  }, [statusFilter, categoryFilter]);

  useEffect(() => { void reload(); }, [reload]);

  async function save() {
    if (!editing || !editing.title.trim()) return;
    const api = (window as { henryAPI?: any }).henryAPI;
    try {
      await api?.prayerSave?.({
        id: editing.id,
        title: editing.title.trim(),
        body: editing.body.trim() || undefined,
        category: editing.category,
        scripture_ref: editing.scripture_ref.trim() || undefined,
        priority: editing.priority,
      });
      setEditing(null);
      void reload();
    } catch (e) {
      console.warn('save prayer failed', e);
      setError('Could not save. Try again.');
    }
  }

  async function markPrayed(id: string) {
    const api = (window as { henryAPI?: any }).henryAPI;
    try {
      await api?.prayerMarkPrayed?.(id);
      // Optimistic local update — bump pray_count + last_prayed_at without a round-trip
      setPrayers(prev =>
        prev.map(p =>
          p.id === id
            ? { ...p, pray_count: (p.pray_count || 0) + 1, last_prayed_at: new Date().toISOString() }
            : p
        )
      );
      // Refresh stats in background (cheap)
      api?.prayerStats?.().then((s: PrayerStats) => setStats(s)).catch(() => {});
    } catch (e) {
      console.warn('mark prayed failed', e);
    }
  }

  async function setStatus(id: string, status: PrayerStatus) {
    const api = (window as { henryAPI?: any }).henryAPI;
    try {
      await api?.prayerSetStatus?.(id, status);
      void reload();
    } catch (e) { console.warn('set status failed', e); }
  }

  async function answerPrayer() {
    if (!answering) return;
    const api = (window as { henryAPI?: any }).henryAPI;
    try {
      await api?.prayerAnswer?.(answering.id, answering.note.trim() || undefined);
      setAnswering(null);
      void reload();
    } catch (e) { console.warn('answer prayer failed', e); }
  }

  async function remove(id: string) {
    if (!confirm('Delete this prayer? This cannot be undone.')) return;
    const api = (window as { henryAPI?: any }).henryAPI;
    try {
      await api?.prayerDelete?.(id);
      void reload();
    } catch (e) { console.warn('delete prayer failed', e); }
  }

  const filtered = useMemo(() => {
    // Server already filters by status + category. Sort: priority desc, then last_prayed_at asc (least recently prayed surfaces first), then created_at desc.
    return [...prayers].sort((a, b) => {
      if (a.status === 'active' && b.status === 'active') {
        if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
        const aT = a.last_prayed_at ? new Date(a.last_prayed_at).getTime() : 0;
        const bT = b.last_prayed_at ? new Date(b.last_prayed_at).getTime() : 0;
        if (aT !== bT) return aT - bT; // older surfaces first
      }
      return new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime();
    });
  }, [prayers]);

  const activeCount   = stats?.byStatus?.active ?? 0;
  const answeredCount = stats?.byStatus?.answered ?? 0;
  const archivedCount = stats?.byStatus?.archived ?? 0;
  const totalPrayed   = useMemo(() => prayers.reduce((s, p) => s + (p.pray_count || 0), 0), [prayers]);

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-6 py-5">
      <div className="max-w-3xl mx-auto space-y-5">

        {/* ── Header ──────────────────────────────────────────────────── */}
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-henry-text flex items-center gap-2">
              <span className="text-henry-accent">✝</span> Prayer Journal
            </h2>
            <p className="text-xs text-henry-text-muted mt-1 leading-relaxed max-w-xl">
              A quiet place to bring requests, mark answers, and remember faithfulness.
              Everything stays on this device.
            </p>
          </div>
          <button
            onClick={() => setEditing(blankPrayer())}
            className="text-xs px-3.5 py-2 rounded-xl bg-henry-accent text-white font-semibold hover:bg-henry-accent/85 transition-all whitespace-nowrap"
          >
            + New prayer
          </button>
        </header>

        {/* ── Stats strip ─────────────────────────────────────────────── */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatCell label="Active"          value={String(activeCount)}    accent="sky" />
            <StatCell label="Answered"        value={String(answeredCount)}  accent="emerald" />
            <StatCell label="Times prayed"    value={String(totalPrayed)}    accent="violet" />
            <StatCell label="Archived"        value={String(archivedCount)}  accent="slate" />
          </div>
        )}

        {/* ── Most prayed / longest active hint ───────────────────────── */}
        {stats?.mostPrayed && stats.mostPrayed.pray_count > 0 && (
          <div className="bg-henry-surface/30 border border-henry-border/15 rounded-xl px-3 py-2 text-[11px] text-henry-text-muted leading-relaxed">
            <span className="text-henry-text font-medium">Most prayed:</span>{' '}
            <span className="text-henry-text">{stats.mostPrayed.title}</span>{' '}
            <span className="text-henry-text-muted">— {stats.mostPrayed.pray_count}×</span>
            {stats.longestActive && (
              <span className="ml-3">
                <span className="text-henry-text font-medium">Longest active:</span>{' '}
                <span className="text-henry-text">{stats.longestActive.title}</span>{' '}
                <span className="text-henry-text-muted">— since {fmtDate(stats.longestActive.created_at)}</span>
              </span>
            )}
          </div>
        )}

        {/* ── Status pills ────────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-1.5">
          {(['active', 'answered', 'archived', 'all'] as const).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`text-[11px] px-3 py-1.5 rounded-lg font-medium transition-all
                ${statusFilter === s
                  ? 'bg-henry-accent text-white'
                  : 'bg-henry-surface/40 text-henry-text-muted hover:text-henry-text hover:bg-henry-surface/70 border border-henry-border/20'}`}
            >
              {s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {/* ── Category filter ─────────────────────────────────────────── */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setCategoryFilter('all')}
            className={`text-[10px] px-2.5 py-1 rounded-lg transition-all
              ${categoryFilter === 'all'
                ? 'bg-henry-text/10 text-henry-text border border-henry-border/40'
                : 'text-henry-text-muted hover:text-henry-text border border-transparent'}`}
          >
            All categories
          </button>
          {CATEGORIES.map(c => (
            <button
              key={c.id}
              onClick={() => setCategoryFilter(c.id)}
              className={`text-[10px] px-2.5 py-1 rounded-lg transition-all border
                ${categoryFilter === c.id ? c.color : `${c.color.split(' ').filter(x => x.startsWith('text-')).join(' ')} border-transparent hover:border-henry-border/30 bg-transparent`}`}
            >
              {c.icon} {c.label}
            </button>
          ))}
        </div>

        {/* ── Editor (inline form replaces list while editing) ────────── */}
        {editing && (
          <div className="bg-henry-surface/60 border border-henry-accent/30 rounded-2xl p-4 space-y-3">
            <p className="text-[11px] uppercase tracking-wider text-henry-accent font-semibold">
              {editing.id ? 'Edit prayer' : 'New prayer'}
            </p>
            <Field label="Title">
              <input
                autoFocus
                value={editing.title}
                onChange={e => setEditing({ ...editing, title: e.target.value })}
                placeholder="What are you bringing before God?"
                className={inputCls}
              />
            </Field>
            <Field label="Category">
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setEditing({ ...editing, category: c.id })}
                    className={`text-[11px] px-2.5 py-1.5 rounded-lg border transition-all
                      ${editing.category === c.id ? c.color : 'text-henry-text-muted border-henry-border/30 hover:border-henry-border/60'}`}
                  >
                    {c.icon} {c.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Body" hint="Optional — write as much or as little as feels right.">
              <textarea
                value={editing.body}
                onChange={e => setEditing({ ...editing, body: e.target.value })}
                rows={4}
                placeholder="Names, specifics, what's on your heart…"
                className={`${inputCls} resize-y`}
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Scripture reference" hint="e.g., Phil 4:6–7, Psalm 27">
                <input
                  value={editing.scripture_ref}
                  onChange={e => setEditing({ ...editing, scripture_ref: e.target.value })}
                  placeholder="Optional"
                  className={inputCls}
                />
              </Field>
              <Field label="Priority">
                <div className="flex gap-1.5">
                  {[1, 2, 3].map(n => (
                    <button
                      key={n}
                      onClick={() => setEditing({ ...editing, priority: n })}
                      className={`flex-1 text-[11px] px-3 py-2 rounded-lg border transition-all
                        ${editing.priority === n
                          ? 'bg-henry-accent text-white border-henry-accent'
                          : 'text-henry-text-muted border-henry-border/30 hover:border-henry-border/60'}`}
                    >
                      {n === 1 ? 'Normal' : n === 2 ? 'Important' : 'Urgent'}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setEditing(null)}
                className="text-xs px-3 py-2 rounded-lg text-henry-text-muted hover:text-henry-text"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={!editing.title.trim()}
                className="text-xs px-4 py-2 rounded-lg bg-henry-accent text-white font-semibold disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>
        )}

        {/* ── Answered modal ──────────────────────────────────────────── */}
        {answering && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-henry-surface border border-henry-border/40 rounded-2xl p-5 max-w-md w-full space-y-3">
              <p className="text-[11px] uppercase tracking-wider text-emerald-400 font-semibold">Mark as answered</p>
              <h3 className="text-base font-bold text-henry-text">{answering.title}</h3>
              <Field label="Testimony" hint="Optional — how was this prayer answered? Future-you will be glad you wrote it down.">
                <textarea
                  autoFocus
                  rows={4}
                  value={answering.note}
                  onChange={e => setAnswering({ ...answering, note: e.target.value })}
                  placeholder="What happened? When? How did you see God's hand?"
                  className={`${inputCls} resize-y`}
                />
              </Field>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => setAnswering(null)}
                  className="text-xs px-3 py-2 rounded-lg text-henry-text-muted hover:text-henry-text"
                >
                  Cancel
                </button>
                <button
                  onClick={answerPrayer}
                  className="text-xs px-4 py-2 rounded-lg bg-emerald-500 text-white font-semibold hover:bg-emerald-600"
                >
                  Mark answered
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Error ───────────────────────────────────────────────────── */}
        {error && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-3 py-2 text-xs text-rose-300">
            {error}
          </div>
        )}

        {/* ── List ────────────────────────────────────────────────────── */}
        {loading ? (
          <p className="text-xs text-henry-text-muted text-center py-8">Loading…</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            statusFilter={statusFilter}
            onCreate={() => setEditing(blankPrayer())}
          />
        ) : (
          <div className="space-y-3">
            {filtered.map(p => (
              <PrayerCard
                key={p.id}
                prayer={p}
                onPrayed={() => markPrayed(p.id)}
                onEdit={() => setEditing({
                  id: p.id,
                  title: p.title,
                  body: p.body || '',
                  category: ((p.category || 'petition') as PrayerCategory),
                  scripture_ref: p.scripture_ref || '',
                  priority: p.priority || 1,
                })}
                onAnswer={() => setAnswering({ id: p.id, title: p.title, note: '' })}
                onArchive={() => setStatus(p.id, 'archived')}
                onUnarchive={() => setStatus(p.id, 'active')}
                onReopen={() => setStatus(p.id, 'active')}
                onDelete={() => remove(p.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function StatCell({ label, value, accent }: { label: string; value: string; accent: string }) {
  const accentMap: Record<string, string> = {
    sky:     'text-sky-400 border-sky-400/20',
    emerald: 'text-emerald-400 border-emerald-400/20',
    violet:  'text-violet-400 border-violet-400/20',
    slate:   'text-henry-text-muted border-henry-border/30',
  };
  return (
    <div className={`bg-henry-surface/40 border rounded-xl px-3 py-2.5 ${accentMap[accent] || accentMap.slate}`}>
      <p className="text-[10px] uppercase tracking-wider text-henry-text-muted">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${accentMap[accent]?.split(' ')[0] || ''}`}>{value}</p>
    </div>
  );
}

function PrayerCard({
  prayer,
  onPrayed,
  onEdit,
  onAnswer,
  onArchive,
  onUnarchive,
  onReopen,
  onDelete,
}: {
  prayer: PrayerRequest;
  onPrayed: () => void;
  onEdit: () => void;
  onAnswer: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onReopen: () => void;
  onDelete: () => void;
}) {
  const cat = categoryMeta(prayer.category);
  const isAnswered = prayer.status === 'answered';
  const isArchived = prayer.status === 'archived';
  const isActive   = prayer.status === 'active';

  return (
    <div className={`bg-henry-surface/40 border rounded-2xl p-4 transition-all
      ${isAnswered ? 'border-emerald-400/20' : isArchived ? 'border-henry-border/15 opacity-70' : 'border-henry-border/20 hover:border-henry-border/40'}`}>

      {/* Title row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {cat && (
              <span className={`text-[10px] px-2 py-0.5 rounded-md border ${cat.color}`}>
                {cat.icon} {cat.label}
              </span>
            )}
            {isActive && prayer.priority >= 3 && (
              <span className="text-[10px] px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-400 border border-rose-500/25">
                Urgent
              </span>
            )}
            {isActive && prayer.priority === 2 && (
              <span className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-400 border border-amber-500/25">
                Important
              </span>
            )}
            {isAnswered && (
              <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                ✓ Answered
              </span>
            )}
          </div>
          <h3 className={`text-sm font-bold mt-1.5 ${isAnswered ? 'text-emerald-300' : 'text-henry-text'}`}>
            {prayer.title}
          </h3>
        </div>
      </div>

      {/* Body */}
      {prayer.body && (
        <p className="text-xs text-henry-text-muted mt-2 leading-relaxed whitespace-pre-wrap">
          {prayer.body}
        </p>
      )}

      {/* Scripture ref */}
      {prayer.scripture_ref && (
        <p className="text-[11px] text-henry-accent/85 italic mt-2">
          ✝ {prayer.scripture_ref}
        </p>
      )}

      {/* Answered testimony */}
      {isAnswered && prayer.answered_note && (
        <div className="mt-3 bg-emerald-500/5 border-l-2 border-emerald-400/40 pl-3 py-2 rounded-r">
          <p className="text-[10px] uppercase tracking-wider text-emerald-400/85 mb-1">Testimony</p>
          <p className="text-xs text-henry-text leading-relaxed whitespace-pre-wrap">{prayer.answered_note}</p>
          {prayer.answered_at && (
            <p className="text-[10px] text-henry-text-muted mt-1.5">{fmtDate(prayer.answered_at)}</p>
          )}
        </div>
      )}

      {/* Footer: pray count + actions */}
      <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-henry-border/10 flex-wrap">
        <div className="text-[10px] text-henry-text-muted">
          {prayer.pray_count > 0 ? (
            <>
              <span className="text-henry-accent font-semibold">🙏 {prayer.pray_count}×</span>
              {prayer.last_prayed_at && (
                <span className="ml-2">last: {fmtRelative(prayer.last_prayed_at)}</span>
              )}
            </>
          ) : (
            <span>added {fmtRelative(prayer.created_at)}</span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {isActive && (
            <button
              onClick={onPrayed}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-henry-accent/15 text-henry-accent border border-henry-accent/25 hover:bg-henry-accent/25 transition-all font-medium"
              title="Mark that you prayed for this"
            >
              🙏 I prayed
            </button>
          )}
          {isActive && (
            <button
              onClick={onAnswer}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/25 transition-all font-medium"
              title="Mark as answered"
            >
              ✓ Answered
            </button>
          )}
          <button
            onClick={onEdit}
            className="text-[11px] px-2 py-1 rounded-lg text-henry-text-muted hover:text-henry-text transition-all"
            title="Edit"
          >
            Edit
          </button>
          {isActive && (
            <button
              onClick={onArchive}
              className="text-[11px] px-2 py-1 rounded-lg text-henry-text-muted hover:text-henry-text transition-all"
              title="Archive (kept, but not surfaced)"
            >
              Archive
            </button>
          )}
          {isArchived && (
            <button
              onClick={onUnarchive}
              className="text-[11px] px-2 py-1 rounded-lg text-henry-text-muted hover:text-henry-text transition-all"
            >
              Restore
            </button>
          )}
          {isAnswered && (
            <button
              onClick={onReopen}
              className="text-[11px] px-2 py-1 rounded-lg text-henry-text-muted hover:text-henry-text transition-all"
              title="Move back to active"
            >
              Reopen
            </button>
          )}
          <button
            onClick={onDelete}
            className="text-[11px] px-2 py-1 rounded-lg text-henry-text-muted hover:text-rose-400 transition-all"
            title="Delete forever"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  statusFilter,
  onCreate,
}: {
  statusFilter: PrayerStatus | 'all';
  onCreate: () => void;
}) {
  if (statusFilter === 'answered') {
    return (
      <div className="text-center py-12">
        <p className="text-2xl mb-2">✨</p>
        <p className="text-sm text-henry-text-muted">
          No answered prayers yet — but they'll be remembered here when they come.
        </p>
      </div>
    );
  }
  if (statusFilter === 'archived') {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-henry-text-muted">No archived prayers.</p>
      </div>
    );
  }
  return (
    <div className="text-center py-12 space-y-3">
      <p className="text-2xl">✝</p>
      <div className="space-y-1">
        <p className="text-sm text-henry-text">Your prayer journal is empty.</p>
        <p className="text-xs text-henry-text-muted">
          Bring something specific. Names. Decisions. Things that ache or matter.
        </p>
      </div>
      <button
        onClick={onCreate}
        className="text-xs px-4 py-2 rounded-xl bg-henry-accent text-white font-semibold hover:bg-henry-accent/85 transition-all"
      >
        + Add your first prayer
      </button>
    </div>
  );
}
