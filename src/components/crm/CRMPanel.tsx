import { useState, useEffect, useRef } from 'react';
import { sendToHenry } from '../../actions/store/chatBridgeStore';
import { useStore } from '../../store';

interface Contact {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  role?: string;
  notes?: string;
  tags: string[];
  last_contact?: string;
  created_at: string;
}

const api = (window as any).henryAPI;

function emptyContact(): Omit<Contact, 'id' | 'created_at' | 'tags'> {
  return { name: '', email: '', phone: '', company: '', role: '', notes: '' };
}

export default function CRMPanel() {
  const { setCurrentView } = useStore();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Contact | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(emptyContact());
  const [adding, setAdding] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  async function load(q?: string) {
    const data = await api.contactsList(q || undefined) as Contact[];
    setContacts(data.map(c => ({ ...c, tags: JSON.parse(c.tags as any || '[]') })));
  }

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  async function handleCreate() {
    if (!form.name.trim()) return;
    await api.contactsCreate({ id: crypto.randomUUID(), ...form });
    setAdding(false);
    setForm(emptyContact());
    await load(search);
  }

  async function handleUpdate() {
    if (!selected) return;
    await api.contactsUpdate(selected.id, form);
    setEditing(false);
    await load(search);
    setSelected(null);
  }

  async function handleDelete(id: string) {
    await api.contactsDelete(id);
    setSelected(null);
    await load(search);
  }

  function startEdit(c: Contact) {
    setSelected(c);
    setForm({ name: c.name, email: c.email || '', phone: c.phone || '', company: c.company || '', role: c.role || '', notes: c.notes || '' });
    setEditing(true);
  }

  function askHenry(c: Contact) {
    sendToHenry(`Tell me about my contact ${c.name}${c.company ? ' from ' + c.company : ''}. Notes: ${c.notes || 'none'}`);
    setCurrentView('chat');
  }

  const F = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const inputClass = "w-full bg-henry-surface border border-henry-border/30 rounded-lg px-3 py-1.5 text-sm text-henry-text placeholder:text-henry-text-muted outline-none focus:border-henry-accent/50 transition-colors";

  return (
    <div className="flex h-full bg-henry-bg overflow-hidden">
      {/* Left — contact list */}
      <div className="w-72 flex-shrink-0 border-r border-henry-border/20 flex flex-col">
        <div className="p-4 border-b border-henry-border/20">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-sm font-bold text-henry-text">Contacts</h1>
            <button onClick={() => { setAdding(true); setEditing(false); setSelected(null); setForm(emptyContact()); }}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-henry-accent text-white font-semibold hover:bg-henry-accent/80 transition-all">
              + Add
            </button>
          </div>
          <input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search contacts…"
            className={inputClass}
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {contacts.length === 0 && (
            <div className="p-6 text-center">
              <p className="text-henry-text-muted text-sm">No contacts yet.</p>
              <p className="text-henry-text-muted text-xs mt-1">Add people you work with.</p>
            </div>
          )}
          {contacts.map(c => (
            <button
              key={c.id}
              onClick={() => { setSelected(c); setEditing(false); }}
              className={`w-full text-left px-4 py-3 border-b border-henry-border/10 hover:bg-henry-surface/40 transition-all ${selected?.id === c.id ? 'bg-henry-surface/60 border-l-2 border-l-henry-accent' : ''}`}
            >
              <p className="text-sm font-semibold text-henry-text truncate">{c.name}</p>
              {c.company && <p className="text-[11px] text-henry-text-muted truncate">{c.company}</p>}
              {c.role && <p className="text-[10px] text-henry-text-muted/70 truncate">{c.role}</p>}
            </button>
          ))}
        </div>
      </div>

      {/* Right — detail / form */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Add new */}
        {adding && (
          <div className="max-w-lg">
            <h2 className="text-base font-bold text-henry-text mb-4">New Contact</h2>
            <ContactForm form={form} F={F} />
            <div className="flex gap-2 mt-4">
              <button onClick={handleCreate} className="px-4 py-2 rounded-xl bg-henry-accent text-white text-sm font-semibold hover:bg-henry-accent/80 transition-all">Save</button>
              <button onClick={() => setAdding(false)} className="px-4 py-2 rounded-xl bg-henry-surface border border-henry-border/30 text-henry-text-muted text-sm hover:text-henry-text transition-all">Cancel</button>
            </div>
          </div>
        )}

        {/* Edit existing */}
        {editing && selected && (
          <div className="max-w-lg">
            <h2 className="text-base font-bold text-henry-text mb-4">Edit {selected.name}</h2>
            <ContactForm form={form} F={F} />
            <div className="flex gap-2 mt-4">
              <button onClick={handleUpdate} className="px-4 py-2 rounded-xl bg-henry-accent text-white text-sm font-semibold">Save</button>
              <button onClick={() => setEditing(false)} className="px-4 py-2 rounded-xl bg-henry-surface border border-henry-border/30 text-henry-text-muted text-sm">Cancel</button>
              <button onClick={() => handleDelete(selected.id)} className="ml-auto px-4 py-2 rounded-xl border border-red-400/30 text-red-400 text-sm hover:bg-red-400/10 transition-all">Delete</button>
            </div>
          </div>
        )}

        {/* View contact */}
        {selected && !editing && !adding && (
          <div className="max-w-lg">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-henry-text">{selected.name}</h2>
                {selected.company && <p className="text-henry-text-muted text-sm mt-0.5">{selected.role ? `${selected.role} · ` : ''}{selected.company}</p>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => askHenry(selected)} className="text-[11px] px-3 py-1.5 rounded-lg bg-henry-surface border border-henry-border/30 text-henry-text-muted hover:text-henry-accent transition-all">Ask Henry</button>
                <button onClick={() => startEdit(selected)} className="text-[11px] px-3 py-1.5 rounded-lg bg-henry-accent/10 border border-henry-accent/30 text-henry-accent hover:bg-henry-accent/20 transition-all">Edit</button>
              </div>
            </div>

            <div className="space-y-3">
              {selected.email && <DetailRow label="Email" value={selected.email} link={`mailto:${selected.email}`} />}
              {selected.phone && <DetailRow label="Phone" value={selected.phone} link={`tel:${selected.phone}`} />}
              {selected.last_contact && <DetailRow label="Last contact" value={new Date(selected.last_contact).toLocaleDateString()} />}
              {selected.notes && (
                <div className="bg-henry-surface rounded-xl border border-henry-border/20 p-4 mt-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-henry-text-muted mb-2">Notes</p>
                  <p className="text-sm text-henry-text whitespace-pre-wrap">{selected.notes}</p>
                </div>
              )}
              <div className="pt-2">
                <button
                  onClick={() => api.contactsUpdate(selected.id, { last_contact: new Date().toISOString() }).then(() => load(search))}
                  className="text-[11px] px-3 py-1.5 rounded-lg bg-henry-surface border border-henry-border/30 text-henry-text-muted hover:text-henry-text transition-all"
                >Mark as contacted today</button>
              </div>
            </div>
          </div>
        )}

        {!selected && !adding && (
          <div className="flex-1 flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-4xl mb-3">◇</p>
              <p className="text-henry-text-muted text-sm">Select a contact or add a new one.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ContactForm({ form, F }: { form: ReturnType<typeof emptyContact>; F: (k: any) => any }) {
  const inputClass = "w-full bg-henry-surface border border-henry-border/30 rounded-lg px-3 py-2 text-sm text-henry-text placeholder:text-henry-text-muted outline-none focus:border-henry-accent/50 transition-colors";
  return (
    <div className="space-y-3">
      {[['name','Name *'],['email','Email'],['phone','Phone'],['company','Company'],['role','Role / Title']].map(([k,label]) => (
        <div key={k}>
          <label className="text-[10px] uppercase tracking-wider text-henry-text-muted mb-1 block">{label}</label>
          <input value={(form as any)[k]} onChange={F(k as any)} placeholder={label} className={inputClass} />
        </div>
      ))}
      <div>
        <label className="text-[10px] uppercase tracking-wider text-henry-text-muted mb-1 block">Notes</label>
        <textarea value={form.notes} onChange={F('notes')} placeholder="Notes about this person…" rows={4}
          className={inputClass + " resize-none"} />
      </div>
    </div>
  );
}

function DetailRow({ label, value, link }: { label: string; value: string; link?: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[10px] uppercase tracking-wider text-henry-text-muted w-24 flex-shrink-0">{label}</span>
      {link ? <a href={link} className="text-sm text-henry-accent hover:underline">{value}</a>
             : <span className="text-sm text-henry-text">{value}</span>}
    </div>
  );
}
