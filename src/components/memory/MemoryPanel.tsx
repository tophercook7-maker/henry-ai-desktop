/**
 * Henry Memory Panel — see and manage everything Henry remembers about you.
 */
import { useState, useEffect, useCallback } from 'react';
import { sendToHenry } from '../../actions/store/chatBridgeStore';
import { useStore } from '../../store';

const api = (window as any).henryAPI;

interface MemoryFact { id: string; fact: string; category: string; importance: number; created_at: string; }
interface PersonalMem { id: string; key: string; value: string; updated_at: string; }

const CATS = ['identity','preference','goal','relationship','health','finance','work','belief','habit','other'];
const ICONS: Record<string,string> = { identity:'🪪', preference:'❤️', goal:'◎', relationship:'🤝', health:'🏃', finance:'💰', work:'💼', belief:'🙏', habit:'✓', other:'📌' };

export default function MemoryPanel() {
  const { setCurrentView } = useStore();
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [personal, setPersonal] = useState<PersonalMem[]>([]);
  const [tab, setTab] = useState<'facts'|'personal'|'add'>('facts');
  const [search, setSearch] = useState('');
  const [newFact, setNewFact] = useState({ fact: '', category: 'identity', importance: 5 });
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string|null>(null);
  const [editText, setEditText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [f, p] = await Promise.all([
        api.memoryGetAllFacts?.().catch(() => []),
        api.memoryGetPersonalMemory?.().catch(() => []),
      ]);
      setFacts(f || []);
      setPersonal(p || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function saveFact() {
    if (!newFact.fact.trim()) return;
    await api.memorySaveFact?.({ id: crypto.randomUUID(), ...newFact, created_at: new Date().toISOString() });
    setNewFact({ fact: '', category: 'identity', importance: 5 });
    setTab('facts');
    void load();
  }

  async function deleteFact(id: string) {
    await api.memoryDeleteFact?.(id);
    setFacts(f => f.filter(x => x.id !== id));
  }

  async function updateFact(id: string) {
    const existing = facts.find(f => f.id === id);
    if (!existing || !editText.trim()) return;
    await api.memorySaveFact?.({ ...existing, fact: editText });
    setEditingId(null);
    void load();
  }

  const filtered = facts.filter(f =>
    !search || f.fact.toLowerCase().includes(search.toLowerCase()) || f.category.includes(search.toLowerCase())
  );

  const grouped = CATS.reduce((acc, cat) => {
    const items = filtered.filter(f => f.category === cat);
    if (items.length) acc[cat] = items;
    return acc;
  }, {} as Record<string, MemoryFact[]>);

  return (
    <div className="flex flex-col h-full bg-henry-bg overflow-hidden">
      <div className="px-5 pt-5 pb-3 border-b border-henry-border/20 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-lg font-bold text-henry-text">Memory</h1>
            <p className="text-[11px] text-henry-text-muted mt-0.5">{facts.length} facts · {personal.length} personal</p>
          </div>
          <button onClick={() => { sendToHenry('What do you remember about me? Summarize the most important things.'); setCurrentView('chat' as any); }}
            className="text-[11px] px-3 py-1.5 rounded-xl bg-henry-accent/15 border border-henry-accent/30 text-henry-accent hover:bg-henry-accent/25 transition-all">
            ⚡ Ask Henry
          </button>
        </div>
        <div className="flex gap-1 mb-3">
          {(['facts','personal','add'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-[11px] px-3 py-1.5 rounded-lg font-medium transition-all capitalize ${tab===t ? 'bg-henry-accent text-white' : 'bg-henry-surface border border-henry-border/30 text-henry-text-muted hover:text-henry-text'}`}>
              {t === 'add' ? '+ Add' : t === 'personal' ? `Personal (${personal.length})` : `Facts (${facts.length})`}
            </button>
          ))}
        </div>
        {tab === 'facts' && (
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search memory…"
            className="w-full bg-henry-surface border border-henry-border/30 rounded-xl px-3 py-2 text-sm text-henry-text placeholder:text-henry-text-muted outline-none focus:border-henry-accent/50" />
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {loading && <p className="text-center text-henry-text-muted text-sm py-8">Loading…</p>}

        {!loading && tab === 'facts' && (
          <>
            {Object.keys(grouped).length === 0 && (
              <div className="text-center py-12 space-y-3">
                <p className="text-3xl">🧠</p>
                <p className="text-henry-text-muted text-sm">Henry hasn't stored any facts yet.</p>
                <p className="text-henry-text-muted text-xs">Chat with Henry and he'll remember things automatically. Or add facts manually.</p>
                <button onClick={() => setTab('add')} className="mt-2 text-[12px] px-4 py-2 rounded-xl bg-henry-accent text-white font-semibold">Add a fact</button>
              </div>
            )}
            {Object.entries(grouped).map(([cat, items]) => (
              <div key={cat}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-base">{ICONS[cat]||'📌'}</span>
                  <p className="text-[10px] uppercase tracking-wider text-henry-text-muted font-semibold capitalize">{cat}</p>
                  <span className="text-[9px] text-henry-text-muted/60">({items.length})</span>
                </div>
                <div className="space-y-1.5">
                  {items.sort((a,b) => b.importance - a.importance).map(f => (
                    <div key={f.id} className="group flex items-start gap-2 p-2.5 rounded-xl bg-henry-surface/40 border border-henry-border/10 hover:border-henry-border/30 transition-all">
                      <div className="flex-1 min-w-0">
                        {editingId === f.id ? (
                          <div className="flex gap-2">
                            <input value={editText} onChange={e => setEditText(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') void updateFact(f.id); if (e.key === 'Escape') setEditingId(null); }}
                              autoFocus className="flex-1 bg-henry-bg border border-henry-accent/40 rounded-lg px-2 py-1 text-sm text-henry-text outline-none" />
                            <button onClick={() => void updateFact(f.id)} className="text-[11px] px-2 py-1 bg-henry-accent text-white rounded-lg">Save</button>
                            <button onClick={() => setEditingId(null)} className="text-[11px] px-2 text-henry-text-muted">✕</button>
                          </div>
                        ) : (
                          <p className="text-sm text-henry-text leading-snug">{f.fact}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <div className="flex gap-0.5">
                            {Array.from({length:5}).map((_,i) => (
                              <div key={i} className={`w-1.5 h-1.5 rounded-full ${i < Math.round(f.importance/2) ? 'bg-henry-accent' : 'bg-henry-border/30'}`} />
                            ))}
                          </div>
                          <span className="text-[9px] text-henry-text-muted">{new Date(f.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button onClick={() => { setEditingId(f.id); setEditText(f.fact); }} className="p-1 text-henry-text-muted hover:text-henry-accent transition-all text-xs">✎</button>
                        <button onClick={() => void deleteFact(f.id)} className="p-1 text-henry-text-muted hover:text-red-400 transition-all text-xs">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        {!loading && tab === 'personal' && (
          <>
            {personal.length === 0 && <p className="text-center text-henry-text-muted text-sm py-8">No personal memory stored yet.</p>}
            <div className="space-y-2">
              {personal.map(p => (
                <div key={p.id} className="flex items-start justify-between p-3 rounded-xl bg-henry-surface/40 border border-henry-border/10">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-henry-text-muted font-semibold mb-0.5">{p.key}</p>
                    <p className="text-sm text-henry-text">{p.value}</p>
                  </div>
                  <p className="text-[10px] text-henry-text-muted flex-shrink-0 ml-3">{new Date(p.updated_at).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'add' && (
          <div className="space-y-4 max-w-lg">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-henry-text-muted mb-1.5 block">Fact</label>
              <textarea value={newFact.fact} onChange={e => setNewFact(p => ({...p, fact: e.target.value}))}
                placeholder="e.g. I run a web design business called MixedMakerShop"
                rows={3} className="w-full bg-henry-surface border border-henry-border/30 rounded-xl px-3 py-2.5 text-sm text-henry-text placeholder:text-henry-text-muted outline-none focus:border-henry-accent/50 resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-henry-text-muted mb-1.5 block">Category</label>
                <select value={newFact.category} onChange={e => setNewFact(p => ({...p, category: e.target.value}))}
                  className="w-full bg-henry-surface border border-henry-border/30 rounded-xl px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50">
                  {CATS.map(c => <option key={c} value={c}>{ICONS[c]} {c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-henry-text-muted mb-1.5 block">Importance (1–10)</label>
                <input type="number" min={1} max={10} value={newFact.importance}
                  onChange={e => setNewFact(p => ({...p, importance: Number(e.target.value)}))}
                  className="w-full bg-henry-surface border border-henry-border/30 rounded-xl px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50" />
              </div>
            </div>
            <button onClick={() => void saveFact()} disabled={!newFact.fact.trim()}
              className="w-full py-3 rounded-xl bg-henry-accent text-white font-bold text-sm hover:bg-henry-accent/80 disabled:opacity-40 transition-all">
              Save to Memory
            </button>
            <p className="text-[11px] text-henry-text-muted text-center">Henry uses this context in every conversation.</p>
          </div>
        )}
      </div>
    </div>
  );
}
