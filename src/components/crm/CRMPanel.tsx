import { useState, useEffect } from 'react';
import { sendToHenry } from '../../actions/store/chatBridgeStore';
import { useStore } from '../../store';

interface Contact {
  id: string; name: string; email?: string; phone?: string;
  company?: string; role?: string; notes?: string;
  tags: string[]; stage: string;
  last_contacted_at?: string; created_at: string;
}

type Stage = 'lead' | 'proposal' | 'active' | 'done' | 'archived';
const STAGES: { id: Stage; label: string; color: string; icon: string }[] = [
  { id: 'lead',     label: 'Lead',     color: 'text-blue-400   border-blue-400/30   bg-blue-400/5',    icon: '◎' },
  { id: 'proposal', label: 'Proposal', color: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/5',  icon: '◇' },
  { id: 'active',   label: 'Active',   color: 'text-green-400  border-green-400/30  bg-green-400/5',   icon: '◆' },
  { id: 'done',     label: 'Done',     color: 'text-henry-text-muted border-henry-border/30 bg-henry-surface/30', icon: '✓' },
];

const api = (window as any).henryAPI;

function emptyForm() {
  return { name: '', email: '', phone: '', company: '', role: '', notes: '' };
}

function daysSince(iso?: string) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

type ViewMode = 'pipeline' | 'list';

export default function CRMPanel() {
  const { setCurrentView } = useStore();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [view, setView] = useState<ViewMode>('pipeline');
  const [selected, setSelected] = useState<Contact | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const data = await api.contactsList() as Contact[];
    setContacts((data || []).map(c => ({ ...c, tags: JSON.parse(c.tags as any || '[]'), stage: c.stage || 'active' })));
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    await api.contactsCreate({ id: crypto.randomUUID(), ...form, stage: 'lead', tags: [] });
    setForm(emptyForm()); setAdding(false); await load();
  }

  async function handleUpdate() {
    if (!selected) return;
    await api.contactsUpdate({ ...selected, ...form, tags: selected.tags });
    await load(); setSelected(null);
  }

  async function handleDelete(id: string) {
    await api.contactsDelete(id);
    setSelected(null); await load();
  }

  async function setStage(id: string, stage: Stage) {
    await api.contactsSetStage(id, stage);
    await load();
    setSelected(prev => prev?.id === id ? { ...prev, stage } : prev);
  }

  async function markContacted(id: string) {
    const now = new Date().toISOString();
    const c = contacts.find(c => c.id === id);
    if (!c) return;
    await api.contactsUpdate({ ...c, lastContactedAt: now });
    await load();
  }

  function askHenry(c: Contact) {
    sendToHenry(`Tell me everything I should know about my client/contact ${c.name}${c.company ? ' from ' + c.company : ''}. Their stage is ${c.stage}. Notes: ${c.notes || 'none'}. Help me think about next steps.`);
    setCurrentView('chat');
  }

  const filtered = contacts.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.company?.toLowerCase().includes(search.toLowerCase()) ||
    c.email?.toLowerCase().includes(search.toLowerCase())
  );

  const byStage = (stage: Stage) => filtered.filter(c => (c.stage || 'active') === stage);

  const inp = "w-full bg-henry-surface border border-henry-border/30 rounded-xl px-3 py-2 text-sm text-henry-text placeholder:text-henry-text-muted outline-none focus:border-henry-accent/50 transition-all";

  return (
    <div className="flex flex-col h-full bg-henry-bg overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-henry-border/20 flex-shrink-0 space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-henry-text">Clients</h1>
          <div className="flex gap-2">
            <div className="flex rounded-lg border border-henry-border/30 overflow-hidden">
              {(['pipeline','list'] as ViewMode[]).map(v => (
                <button key={v} onClick={() => setView(v)}
                  className={'text-[11px] px-3 py-1.5 font-medium transition-all capitalize ' +
                    (view===v ? 'bg-henry-accent text-white' : 'bg-henry-surface text-henry-text-muted hover:text-henry-text')}>
                  {v==='pipeline' ? '▣ Pipeline' : '≡ List'}
                </button>
              ))}
            </div>
            <button onClick={() => { setAdding(a=>!a); setSelected(null); }}
              className="text-[11px] px-4 py-1.5 rounded-xl bg-henry-accent text-white font-semibold hover:bg-henry-accent/80 transition-all">
              + Add
            </button>
          </div>
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clients…"
          className={inp} />
      </div>

      {/* Add form */}
      {adding && (
        <form onSubmit={handleAdd} className="px-5 py-4 border-b border-henry-border/20 bg-henry-surface/30 flex-shrink-0 space-y-3">
          <p className="text-[10px] uppercase tracking-wider text-henry-text-muted">New Contact</p>
          <div className="grid grid-cols-2 gap-2">
            {[['name','Name *'],['email','Email'],['phone','Phone'],['company','Company'],['role','Role'],['notes','Notes']].map(([k,l]) => (
              <input key={k} value={(form as any)[k]} onChange={e => setForm(f=>({...f,[k]:e.target.value}))}
                placeholder={l} className={inp + (k==='notes'?' col-span-2':'')} />
            ))}
          </div>
          <div className="flex gap-2">
            <button type="submit" className="px-4 py-2 rounded-xl bg-henry-accent text-white text-sm font-semibold">Save</button>
            <button type="button" onClick={()=>setAdding(false)} className="px-4 py-2 rounded-xl bg-henry-surface border border-henry-border/30 text-henry-text-muted text-sm">Cancel</button>
          </div>
        </form>
      )}

      <div className="flex-1 overflow-hidden flex">
        {/* Pipeline view */}
        {view === 'pipeline' && !selected && (
          <div className="flex-1 overflow-x-auto flex gap-4 p-5">
            {STAGES.map(stage => {
              const cols = byStage(stage.id);
              return (
                <div key={stage.id} className="flex-shrink-0 w-60 flex flex-col gap-2">
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${stage.color} mb-1`}>
                    <span className="text-base">{stage.icon}</span>
                    <span className="text-xs font-bold">{stage.label}</span>
                    <span className="ml-auto text-[10px] opacity-60">{cols.length}</span>
                  </div>
                  <div className="space-y-2 flex-1 overflow-y-auto max-h-[calc(100vh-280px)]">
                    {cols.map(c => {
                      const days = daysSince(c.last_contacted_at);
                      return (
                        <button key={c.id} onClick={() => { setSelected(c); setForm({name:c.name,email:c.email||'',phone:c.phone||'',company:c.company||'',role:c.role||'',notes:c.notes||''}); }}
                          className="w-full text-left bg-henry-surface border border-henry-border/20 rounded-xl p-3 hover:border-henry-accent/30 transition-all space-y-1">
                          <p className="text-sm font-semibold text-henry-text truncate">{c.name}</p>
                          {c.company && <p className="text-[11px] text-henry-text-muted truncate">{c.company}</p>}
                          {days !== null && (
                            <p className={`text-[10px] ${days > 30 ? 'text-red-400' : days > 14 ? 'text-yellow-400' : 'text-henry-text-muted'}`}>
                              {days === 0 ? 'Contacted today' : `${days}d since contact`}
                            </p>
                          )}
                        </button>
                      );
                    })}
                    {cols.length === 0 && <p className="text-[11px] text-henry-text-muted/50 text-center py-4">Empty</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* List view */}
        {view === 'list' && !selected && (
          <div className="flex-1 overflow-y-auto">
            {loading && <p className="text-henry-text-muted text-sm p-5">Loading…</p>}
            {!loading && filtered.length === 0 && <p className="text-henry-text-muted text-sm p-5 text-center">No contacts yet.</p>}
            {filtered.map(c => {
              const stage = STAGES.find(s => s.id === c.stage) || STAGES[2];
              const days = daysSince(c.last_contacted_at);
              return (
                <button key={c.id} onClick={() => { setSelected(c); setForm({name:c.name,email:c.email||'',phone:c.phone||'',company:c.company||'',role:c.role||'',notes:c.notes||''}); }}
                  className="w-full text-left flex items-center gap-3 px-5 py-3 border-b border-henry-border/10 hover:bg-henry-surface/40 transition-all">
                  <div className={`w-8 h-8 rounded-lg border flex items-center justify-center text-sm flex-shrink-0 ${stage.color}`}>{stage.icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-henry-text">{c.name}</p>
                    {c.company && <p className="text-[11px] text-henry-text-muted">{c.role ? c.role + ' · ' : ''}{c.company}</p>}
                  </div>
                  {days !== null && <span className={`text-[10px] flex-shrink-0 ${days > 30 ? 'text-red-400' : 'text-henry-text-muted'}`}>{days}d</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* Detail view */}
        {selected && (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div className="flex items-center gap-3">
              <button onClick={() => setSelected(null)} className="text-henry-text-muted hover:text-henry-text text-sm transition-all">← Back</button>
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold text-henry-text">{selected.name}</h2>
                {selected.company && <p className="text-sm text-henry-text-muted">{selected.role ? selected.role + ' · ' : ''}{selected.company}</p>}
              </div>
              <button onClick={() => askHenry(selected)} className="text-[11px] px-3 py-1.5 rounded-lg bg-henry-surface border border-henry-border/30 text-henry-text-muted hover:text-henry-accent transition-all">Ask Henry</button>
            </div>

            {/* Stage selector */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-henry-text-muted mb-2">Pipeline Stage</p>
              <div className="flex gap-2 flex-wrap">
                {STAGES.map(s => (
                  <button key={s.id} onClick={() => void setStage(selected.id, s.id)}
                    className={`text-[11px] px-3 py-1.5 rounded-xl border font-medium transition-all ${selected.stage===s.id ? s.color : 'border-henry-border/30 text-henry-text-muted hover:border-henry-accent/30'}`}>
                    {s.icon} {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Contact info */}
            <div className="bg-henry-surface rounded-xl border border-henry-border/20 p-4 space-y-2">
              {selected.email && <p className="text-sm text-henry-text flex gap-2"><span className="text-henry-text-muted w-16 flex-shrink-0">Email</span><a href={'mailto:'+selected.email} className="text-henry-accent hover:underline">{selected.email}</a></p>}
              {selected.phone && <p className="text-sm text-henry-text flex gap-2"><span className="text-henry-text-muted w-16 flex-shrink-0">Phone</span>{selected.phone}</p>}
              {selected.last_contacted_at && <p className="text-sm text-henry-text flex gap-2"><span className="text-henry-text-muted w-16 flex-shrink-0">Last</span>{new Date(selected.last_contacted_at).toLocaleDateString()}</p>}
            </div>

            {/* Mark contacted */}
            <button onClick={() => void markContacted(selected.id)}
              className="w-full py-2.5 rounded-xl bg-henry-surface border border-henry-border/30 text-henry-text-muted text-sm hover:text-henry-text hover:border-henry-accent/30 transition-all">
              ✓ Mark as contacted today
            </button>

            {/* Edit form */}
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-henry-text-muted">Edit Details</p>
              <div className="grid grid-cols-2 gap-2">
                {[['name','Name *'],['email','Email'],['phone','Phone'],['company','Company'],['role','Role']].map(([k,l]) => (
                  <input key={k} value={(form as any)[k]} onChange={e => setForm(f=>({...f,[k]:e.target.value}))}
                    placeholder={l} className={inp} />
                ))}
              </div>
              <textarea value={form.notes} onChange={e => setForm(f=>({...f,notes:e.target.value}))} rows={3}
                placeholder="Notes…" className={inp + ' resize-none'} />
              <div className="flex gap-2">
                <button onClick={handleUpdate} className="flex-1 py-2 rounded-xl bg-henry-accent text-white text-sm font-semibold hover:bg-henry-accent/80 transition-all">Save</button>
                <button onClick={() => void handleDelete(selected.id)} className="px-4 py-2 rounded-xl text-red-400 hover:bg-red-400/10 text-sm transition-all">Delete</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
