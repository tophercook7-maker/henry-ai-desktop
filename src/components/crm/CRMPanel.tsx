/**
 * Henry CRM — MixedMakerShop client pipeline
 * Pipeline view, client cards, revenue tracking, follow-ups, Henry AI outreach
 */
import { useState, useEffect, useCallback } from 'react';
import { sendToHenry } from '../../actions/store/chatBridgeStore';
import { useStore } from '../../store';

interface Contact {
  id: string; name: string; email?: string; phone?: string;
  company?: string; role?: string; notes?: string;
  tags: string[]; stage: string;
  project_value?: number; revenue_total?: number;
  next_followup?: string; priority?: number; source?: string;
  last_contact?: string; last_contacted_at?: string; created_at: string;
}

type Stage = 'lead' | 'proposal' | 'active' | 'done' | 'archived';
const STAGES: { id: Stage; label: string; color: string; bg: string; icon: string }[] = [
  { id:'lead',     label:'Leads',    color:'text-blue-400',   bg:'bg-blue-400/8 border-blue-400/20',   icon:'◎' },
  { id:'proposal', label:'Proposal', color:'text-yellow-400', bg:'bg-yellow-400/8 border-yellow-400/20', icon:'◇' },
  { id:'active',   label:'Active',   color:'text-green-400',  bg:'bg-green-400/8 border-green-400/20',  icon:'◆' },
  { id:'done',     label:'Done',     color:'text-henry-text-muted', bg:'bg-henry-surface/30 border-henry-border/20', icon:'✓' },
];

const SOURCES = ['Referral','Website','Cold Outreach','Social','Event','Other'];
const api = (window as any).henryAPI;
const fmt = (n?: number) => n ? '$' + Number(n).toLocaleString('en-US', {minimumFractionDigits:0}) : '—';
const daysSince = (iso?: string) => iso ? Math.floor((Date.now()-new Date(iso).getTime())/86400000) : null;
const daysUntil = (iso?: string) => iso ? Math.ceil((new Date(iso).getTime()-Date.now())/86400000) : null;

function emptyForm() {
  return { name:'', email:'', phone:'', company:'', role:'', notes:'',
           project_value:'', source:'Referral', next_followup:'', priority:'2' };
}

export default function CRMPanel() {
  const { setCurrentView } = useStore();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tab, setTab] = useState<'pipeline'|'list'|'followups'>('pipeline');
  const [selected, setSelected] = useState<Contact | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await api.contactsList().catch(() => []) as Contact[];
    setContacts((data||[]).map(c => ({
      ...c,
      tags: JSON.parse((c.tags as any)||'[]'),
      stage: c.stage || 'lead',
    })));
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = contacts.filter(c =>
    !search || [c.name, c.company, c.email, c.role].some(f => f?.toLowerCase().includes(search.toLowerCase()))
  );

  async function save() {
    const data: any = {
      name: form.name.trim(), email: form.email||null, phone: form.phone||null,
      company: form.company||null, role: form.role||null, notes: form.notes||null,
      project_value: parseFloat(form.project_value)||null,
      source: form.source||null, priority: parseInt(form.priority)||2,
      next_followup: form.next_followup||null,
      tags: '[]', stage: 'lead',
    };
    if (!data.name) return;
    if (editing && selected) {
      await api.contactsUpdate(selected.id, data);
    } else {
      await api.contactsCreate({ ...data, id: crypto.randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    }
    setForm(emptyForm()); setAdding(false); setEditing(false);
    await load();
  }

  async function setStage(id: string, stage: Stage) {
    await api.contactsSetStage(id, stage);
    if (selected?.id === id) setSelected(s => s ? {...s, stage} : null);
    await load();
  }

  async function del(id: string) {
    await api.contactsDelete(id);
    setSelected(null); await load();
  }

  function openEdit(c: Contact) {
    setSelected(c); setEditing(true);
    setForm({
      name:c.name||'', email:c.email||'', phone:c.phone||'',
      company:c.company||'', role:c.role||'', notes:c.notes||'',
      project_value: c.project_value ? String(c.project_value) : '',
      source: c.source||'Referral', priority: String(c.priority||2),
      next_followup: c.next_followup ? c.next_followup.slice(0,10) : '',
    });
    setAdding(true);
  }

  function askHenryAbout(c: Contact) {
    const days = daysSince(c.last_contact || c.last_contacted_at);
    sendToHenry(`Write a short, warm follow-up email to ${c.name}${c.company ? ' at ' + c.company : ''}. Context: they're a ${c.stage} client${c.project_value ? ', project value ~' + fmt(c.project_value) : ''}. ${days ? 'Last contacted ' + days + ' days ago.' : ''} Notes: ${c.notes || 'none'}. Keep it brief and professional.`);
    setCurrentView('chat');
  }

  // Metrics
  const activeRevenue = contacts.filter(c => c.stage === 'active').reduce((a,c) => a+(c.project_value||0), 0);
  const pipelineValue = contacts.filter(c => ['lead','proposal'].includes(c.stage)).reduce((a,c) => a+(c.project_value||0), 0);
  const dueFollowups  = contacts.filter(c => {
    if (!c.next_followup || c.stage === 'done' || c.stage === 'archived') return false;
    return daysUntil(c.next_followup)! <= 2;
  });

  const inp = "bg-henry-surface border border-henry-border/30 rounded-xl px-3 py-2.5 text-sm text-henry-text placeholder:text-henry-text-muted outline-none focus:border-henry-accent/50 w-full transition-all";
  const tabCls = (t: string) => `px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ` +
    (tab===t ? 'bg-henry-accent text-white' : 'text-henry-text-muted hover:text-henry-text hover:bg-henry-surface/60');

  return (
    <div className="flex h-full bg-henry-bg overflow-hidden">
      {/* ── Sidebar ── */}
      <div className="flex flex-col h-full w-64 flex-shrink-0 border-r border-henry-border/20 overflow-hidden">
        {/* Header */}
        <div className="px-4 pt-5 pb-3 border-b border-henry-border/20 flex-shrink-0 space-y-3">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-bold text-henry-text">Clients</h1>
            <button onClick={() => { setAdding(true); setEditing(false); setForm(emptyForm()); }}
              className="text-[11px] px-3 py-1 rounded-lg bg-henry-accent text-white font-bold hover:bg-henry-accent/80 transition-all">
              + Add
            </button>
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search clients…"
            className="w-full bg-henry-surface border border-henry-border/30 rounded-lg px-3 py-1.5 text-sm text-henry-text placeholder:text-henry-text-muted outline-none focus:border-henry-accent/50" />
          {/* Metrics strip */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-green-400/5 border border-green-400/15 rounded-xl p-2 text-center">
              <p className="text-[9px] text-henry-text-muted uppercase tracking-wider">Active</p>
              <p className="text-sm font-bold text-green-400 font-mono">{fmt(activeRevenue)}</p>
            </div>
            <div className="bg-yellow-400/5 border border-yellow-400/15 rounded-xl p-2 text-center">
              <p className="text-[9px] text-henry-text-muted uppercase tracking-wider">Pipeline</p>
              <p className="text-sm font-bold text-yellow-400 font-mono">{fmt(pipelineValue)}</p>
            </div>
          </div>
        </div>

        {/* Contact list */}
        <div className="flex-1 overflow-y-auto">
          {loading && <p className="text-center text-henry-text-muted text-xs p-4">Loading…</p>}
          {dueFollowups.length > 0 && (
            <div className="px-3 pt-3 pb-1">
              <p className="text-[9px] uppercase tracking-widest text-yellow-400 font-bold mb-1.5">⚡ Follow up now</p>
              {dueFollowups.map(c => (
                <button key={c.id} onClick={() => setSelected(c)}
                  className={`w-full text-left px-3 py-2 rounded-xl mb-1 bg-yellow-400/8 border border-yellow-400/20 hover:border-yellow-400/40 transition-all ${selected?.id===c.id ? 'border-henry-accent/60' : ''}`}>
                  <p className="text-sm font-semibold text-henry-text truncate">{c.name}</p>
                  <p className="text-[10px] text-yellow-400">Due {daysUntil(c.next_followup)! <= 0 ? 'today' : 'in ' + daysUntil(c.next_followup) + 'd'}</p>
                </button>
              ))}
            </div>
          )}
          {STAGES.filter(s => s.id !== 'archived').map(stage => {
            const stageContacts = filtered.filter(c => c.stage === stage.id);
            if (!stageContacts.length) return null;
            return (
              <div key={stage.id} className="px-3 pt-3 pb-1">
                <p className={`text-[9px] uppercase tracking-widest font-bold mb-1.5 ${stage.color}`}>{stage.icon} {stage.label} · {stageContacts.length}</p>
                {stageContacts.map(c => {
                  const ds = daysSince(c.last_contact || c.last_contacted_at);
                  return (
                    <button key={c.id} onClick={() => setSelected(c)}
                      className={`w-full text-left px-3 py-2.5 rounded-xl mb-1 border transition-all hover:border-henry-accent/40 ${selected?.id===c.id ? 'bg-henry-accent/10 border-henry-accent/40' : 'bg-henry-surface/30 border-henry-border/15 hover:bg-henry-surface/60'}`}>
                      <div className="flex items-start justify-between gap-1">
                        <p className="text-sm font-semibold text-henry-text truncate">{c.name}</p>
                        {c.project_value ? <span className="text-[10px] text-henry-text-muted font-mono flex-shrink-0">{fmt(c.project_value)}</span> : null}
                      </div>
                      {c.company && <p className="text-[10px] text-henry-text-muted truncate">{c.company}</p>}
                      {ds !== null && ds > 14 && <p className="text-[10px] text-red-400/70 mt-0.5">{ds}d ago</p>}
                    </button>
                  );
                })}
              </div>
            );
          })}
          {!loading && filtered.length === 0 && (
            <p className="text-center text-henry-text-muted text-xs p-6">No clients yet.<br/>Add your first one →</p>
          )}
        </div>
      </div>

      {/* ── Main panel ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Add / Edit form */}
        {adding && (
          <div className="border-b border-henry-border/20 p-5 overflow-y-auto flex-shrink-0 bg-henry-surface/20">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-henry-text">{editing ? 'Edit Client' : 'New Client'}</h2>
              <button onClick={() => { setAdding(false); setEditing(false); }} className="text-henry-text-muted hover:text-henry-text text-sm">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input value={form.name} onChange={e => setForm(f=>({...f,name:e.target.value}))} placeholder="Name *" className={inp} autoFocus />
              <input value={form.company} onChange={e => setForm(f=>({...f,company:e.target.value}))} placeholder="Company" className={inp} />
              <input value={form.email} onChange={e => setForm(f=>({...f,email:e.target.value}))} placeholder="Email" className={inp} type="email" />
              <input value={form.phone} onChange={e => setForm(f=>({...f,phone:e.target.value}))} placeholder="Phone" className={inp} />
              <input value={form.role} onChange={e => setForm(f=>({...f,role:e.target.value}))} placeholder="Role / title" className={inp} />
              <input value={form.project_value} onChange={e => setForm(f=>({...f,project_value:e.target.value}))} placeholder="Project value ($)" className={inp} type="number" />
              <select value={form.source} onChange={e => setForm(f=>({...f,source:e.target.value}))} className={inp}>
                {SOURCES.map(s => <option key={s}>{s}</option>)}
              </select>
              <input value={form.next_followup} onChange={e => setForm(f=>({...f,next_followup:e.target.value}))} className={inp} type="date" title="Follow-up date" />
            </div>
            <textarea value={form.notes} onChange={e => setForm(f=>({...f,notes:e.target.value}))}
              placeholder="Notes about this client…" rows={2}
              className={inp + ' mt-3 resize-none'} />
            <div className="flex gap-2 mt-3">
              <button onClick={save} disabled={!form.name.trim()}
                className="px-5 py-2 bg-henry-accent text-white text-sm font-bold rounded-xl hover:bg-henry-accent/80 disabled:opacity-40 transition-all">
                {editing ? 'Save Changes' : 'Add Client'}
              </button>
              <button onClick={() => { setAdding(false); setEditing(false); }}
                className="px-4 py-2 text-sm text-henry-text-muted border border-henry-border/30 rounded-xl hover:text-henry-text transition-all">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Selected contact detail */}
        {selected && !adding ? (
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Contact header */}
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold text-henry-text">{selected.name}</h2>
                {selected.company && <p className="text-henry-text-muted text-sm">{selected.company}{selected.role ? ' · ' + selected.role : ''}</p>}
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  {selected.email && <a href={`mailto:${selected.email}`} className="text-xs text-henry-accent hover:underline">✉ {selected.email}</a>}
                  {selected.phone && <span className="text-xs text-henry-text-muted">📞 {selected.phone}</span>}
                  {selected.source && <span className="text-xs text-henry-text-muted bg-henry-surface px-2 py-0.5 rounded-full border border-henry-border/20">{selected.source}</span>}
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => openEdit(selected)} className="text-xs px-3 py-1.5 rounded-xl border border-henry-border/30 text-henry-text-muted hover:text-henry-text transition-all">Edit</button>
                <button onClick={() => askHenryAbout(selected)} className="text-xs px-3 py-1.5 rounded-xl bg-henry-accent/20 border border-henry-accent/30 text-henry-accent hover:bg-henry-accent/30 transition-all">✉ Draft Email</button>
                <button onClick={() => del(selected.id)} className="text-xs px-3 py-1.5 rounded-xl border border-red-400/20 text-red-400/60 hover:text-red-400 transition-all">Delete</button>
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-henry-surface border border-henry-border/20 rounded-xl p-3">
                <p className="text-[9px] uppercase tracking-wider text-henry-text-muted mb-1">Project Value</p>
                <p className="text-lg font-bold text-henry-accent font-mono">{fmt(selected.project_value)}</p>
              </div>
              <div className="bg-henry-surface border border-henry-border/20 rounded-xl p-3">
                <p className="text-[9px] uppercase tracking-wider text-henry-text-muted mb-1">Last Contact</p>
                <p className="text-sm font-semibold text-henry-text">
                  {(() => { const ds = daysSince(selected.last_contact || selected.last_contacted_at); return ds === null ? '—' : ds === 0 ? 'Today' : ds + 'd ago'; })()}
                </p>
              </div>
              <div className="bg-henry-surface border border-henry-border/20 rounded-xl p-3">
                <p className="text-[9px] uppercase tracking-wider text-henry-text-muted mb-1">Follow-up</p>
                <p className={`text-sm font-semibold ${selected.next_followup && daysUntil(selected.next_followup)! <= 1 ? 'text-yellow-400' : 'text-henry-text'}`}>
                  {selected.next_followup ? new Date(selected.next_followup + 'T12:00:00').toLocaleDateString('en-US', {month:'short',day:'numeric'}) : '—'}
                </p>
              </div>
            </div>

            {/* Pipeline stage */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-henry-text-muted mb-2">Pipeline Stage</p>
              <div className="flex gap-2 flex-wrap">
                {STAGES.map(s => (
                  <button key={s.id} onClick={() => setStage(selected.id, s.id)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${selected.stage===s.id ? s.bg + ' ' + s.color : 'border-henry-border/20 text-henry-text-muted hover:border-henry-accent/30'}`}>
                    {s.icon} {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            {selected.notes && (
              <div className="bg-henry-surface/50 border border-henry-border/15 rounded-xl p-4">
                <p className="text-[10px] uppercase tracking-wider text-henry-text-muted mb-2">Notes</p>
                <p className="text-sm text-henry-text leading-relaxed whitespace-pre-wrap">{selected.notes}</p>
              </div>
            )}

            {/* Henry actions */}
            <div className="bg-henry-surface/30 border border-henry-border/15 rounded-xl p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-henry-text-muted">Henry can help you…</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: '✉ Draft follow-up email', fn: () => askHenryAbout(selected) },
                  { label: '📋 Summarize this client', fn: () => { sendToHenry(`Summarize everything I should know about ${selected.name}${selected.company ? ' at ' + selected.company : ''}. Stage: ${selected.stage}. Project value: ${fmt(selected.project_value)}. Notes: ${selected.notes || 'none'}.`); setCurrentView('chat'); } },
                  { label: '💡 Proposal ideas', fn: () => { sendToHenry(`Generate 3 service proposal ideas for ${selected.name}${selected.company ? ' at ' + selected.company : ''}. Role: ${selected.role || 'unknown'}. Notes: ${selected.notes || 'none'}. What could MixedMakerShop offer them?`); setCurrentView('chat'); } },
                  { label: '📅 Schedule follow-up', fn: async () => {
                    const followUpDate = new Date();
                    followUpDate.setDate(followUpDate.getDate() + 7);
                    const dateStr = followUpDate.toISOString().slice(0,10);
                    const api2 = (window as any).henryAPI;
                    await api2?.remindersCreate?.({
                      id: crypto.randomUUID(),
                      title: `Follow up with ${selected.name}${selected.company ? ' at ' + selected.company : ''}`,
                      notes: `Stage: ${selected.stage}. Last contact: ${daysSince(selected.last_contact || selected.last_contacted_at) ?? '?'} days ago.`,
                      due_at: dateStr + 'T09:00:00.000Z',
                      repeat: 'none',
                      done: 0,
                      created_at: new Date().toISOString(),
                      updated_at: new Date().toISOString(),
                    }).catch(() => {});
                    alert('✓ Follow-up reminder set for ' + dateStr);
                  }},
                  { label: '📅 Next steps', fn: () => { sendToHenry(`What should my next steps be with ${selected.name}? They are in the ${selected.stage} stage. Last contacted ${daysSince(selected.last_contact || selected.last_contacted_at) ?? '?'} days ago. Notes: ${selected.notes || 'none'}.`); setCurrentView('chat'); } },
                ].map(a => (
                  <button key={a.label} onClick={a.fn}
                    className="text-left text-xs px-3 py-2.5 rounded-xl bg-henry-surface border border-henry-border/20 text-henry-text-muted hover:text-henry-accent hover:border-henry-accent/30 transition-all">
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : !adding ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-3 max-w-xs">
              <p className="text-4xl">◇</p>
              <p className="text-henry-text font-semibold">Select a client</p>
              <p className="text-henry-text-muted text-sm">Your pipeline is on the left. Click a client to see their details, move them through stages, and let Henry draft outreach.</p>
              {contacts.length === 0 && (
                <button onClick={() => setAdding(true)} className="mt-2 px-5 py-2.5 bg-henry-accent text-white font-bold text-sm rounded-xl hover:bg-henry-accent/80 transition-all">
                  + Add First Client
                </button>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
