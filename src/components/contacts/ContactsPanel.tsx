import { useState, useEffect } from 'react';
import { useStore } from '../../store';

const STORAGE_KEY = 'henry_contacts';

interface ContactInteraction {
  id: string;
  date: string;
  summary: string;
  type: 'meeting' | 'call' | 'email' | 'message' | 'other';
}

interface Contact {
  id: string;
  name: string;
  role: string;
  company: string;
  email: string;
  notes: string;
  lastInteraction: string;
  openThreads: string;
  tags: string[];
  interactions: ContactInteraction[];
}

function loadContacts(): Contact[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Contact[];
    return parsed.map((c) => ({ ...c, email: c.email || '', openThreads: c.openThreads || '', interactions: c.interactions || [] }));
  } catch {
    return [];
  }
}

function saveContacts(contacts: Contact[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
  } catch { /* ignore */ }
}

function newContact(): Contact {
  return {
    id: crypto.randomUUID(),
    name: '',
    role: '',
    company: '',
    email: '',
    notes: '',
    lastInteraction: '',
    openThreads: '',
    tags: [],
    interactions: [],
  };
}

const INTERACTION_ICONS: Record<ContactInteraction['type'], string> = {
  meeting: '🤝',
  call: '📞',
  email: '✉️',
  message: '💬',
  other: '•',
};

export default function ContactsPanel() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Contact | null>(null);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState<string | null>(null);
  const [logDraft, setLogDraft] = useState<{ summary: string; type: ContactInteraction['type'] }>({ summary: '', type: 'meeting' });
  const { setCurrentView } = useStore();

  useEffect(() => {
    setContacts(loadContacts());
  }, []);

  useEffect(() => {
    function handleContactSelect(e: Event) {
      const { id } = (e as CustomEvent<{ id: string }>).detail;
      setExpandedId(id);
      setSearch('');
    }
    window.addEventListener('henry_contact_select', handleContactSelect);
    return () => window.removeEventListener('henry_contact_select', handleContactSelect);
  }, []);

  function filtered() {
    if (!search.trim()) return contacts;
    const q = search.toLowerCase();
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.role.toLowerCase().includes(q) ||
        c.company.toLowerCase().includes(q) ||
        c.notes.toLowerCase().includes(q) ||
        c.openThreads.toLowerCase().includes(q)
    );
  }

  function startNew() {
    const c = newContact();
    setDraft(c);
    setEditingId(c.id);
    setExpandedId(null);
  }

  function startEdit(c: Contact) {
    setDraft({ ...c });
    setEditingId(c.id);
    setExpandedId(null);
  }

  function cancelEdit() {
    setDraft(null);
    setEditingId(null);
  }

  function save() {
    if (!draft || !draft.name.trim()) return;
    const updated = contacts.some((c) => c.id === draft.id)
      ? contacts.map((c) => (c.id === draft.id ? draft : c))
      : [draft, ...contacts];
    setContacts(updated);
    saveContacts(updated);
    cancelEdit();
  }

  function remove(id: string) {
    const updated = contacts.filter((c) => c.id !== id);
    setContacts(updated);
    saveContacts(updated);
    setConfirmDelete(null);
    if (expandedId === id) setExpandedId(null);
  }

  function patchDraft(field: keyof Contact, value: string) {
    if (!draft) return;
    setDraft({ ...draft, [field]: value });
  }

  function logInteraction(contactId: string) {
    if (!logDraft.summary.trim()) return;
    const interaction: ContactInteraction = {
      id: crypto.randomUUID(),
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      summary: logDraft.summary.trim(),
      type: logDraft.type,
    };
    const updated = contacts.map((c) => {
      if (c.id !== contactId) return c;
      const lastInteraction = `${interaction.date} — ${interaction.summary.slice(0, 50)}`;
      return { ...c, interactions: [interaction, ...c.interactions], lastInteraction };
    });
    setContacts(updated);
    saveContacts(updated);
    setLogOpen(null);
    setLogDraft({ summary: '', type: 'meeting' });
  }

  function briefMe(contact: Contact) {
    const prompt = [
      `Brief me on ${contact.name} before I interact with them.`,
      contact.role ? `They are: ${contact.role}${contact.company ? ` at ${contact.company}` : ''}.` : '',
      contact.notes ? `Context: ${contact.notes}` : '',
      contact.openThreads ? `Open threads: ${contact.openThreads}` : '',
      contact.lastInteraction ? `Last interaction: ${contact.lastInteraction}` : '',
      contact.interactions.length > 0
        ? `Recent history:\n${contact.interactions.slice(0, 3).map((i) => `- ${i.date}: ${i.summary}`).join('\n')}`
        : '',
    ].filter(Boolean).join('\n');

    try { localStorage.setItem('henry_operating_mode', 'secretary'); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('henry_secretary_prompt', { detail: { prompt, mode: 'secretary' } }));
    setCurrentView('chat');
  }

  const list = filtered();

  return (
    <div className="h-full flex flex-col bg-henry-bg overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-4 sm:px-8 pt-6 sm:pt-8 pb-5 border-b border-henry-border/30">
        <div className="max-w-3xl flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2.5 mb-0.5">
              <span className="text-xl">👥</span>
              <h1 className="text-lg font-semibold text-henry-text">Contacts</h1>
            </div>
            <p className="text-henry-text-dim text-xs">
              {contacts.length} {contacts.length === 1 ? 'person' : 'people'} — Henry uses this when you mention them in chat.
            </p>
          </div>
          <button
            onClick={startNew}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-henry-accent/10 text-henry-accent text-xs font-medium hover:bg-henry-accent/20 transition-colors border border-henry-accent/20"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add contact
          </button>
        </div>
        <div className="max-w-3xl mt-4">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-henry-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contacts..."
              className="w-full pl-9 pr-4 py-2 bg-henry-surface/30 border border-henry-border/30 rounded-lg text-sm text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/40 transition-colors"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-5">
        <div className="max-w-3xl space-y-3">

          {/* Edit / New form */}
          {draft && editingId && (
            <div className="border border-henry-accent/30 rounded-xl bg-henry-surface/40 p-5 space-y-3">
              <p className="text-xs font-semibold text-henry-accent uppercase tracking-wider mb-1">
                {contacts.some((c) => c.id === draft.id) ? 'Edit contact' : 'New contact'}
              </p>
              <div className="grid grid-cols-2 gap-3">
                {([
                  ['name', 'Name *', 'Full name'],
                  ['role', 'Role / Relationship', 'Title or relationship'],
                  ['company', 'Company / Org', 'Company or organization'],
                  ['email', 'Email', 'email@example.com'],
                  ['lastInteraction', 'Last interaction', 'e.g. Apr 3 — project call'],
                ] as Array<[keyof Contact, string, string]>).map(([field, label, placeholder]) => (
                  <div key={field} className={field === 'name' || field === 'email' ? '' : ''}>
                    <label className="text-[10px] text-henry-text-muted uppercase tracking-wide block mb-1">{label}</label>
                    <input
                      autoFocus={field === 'name'}
                      value={(draft[field] as string) || ''}
                      onChange={(e) => patchDraft(field, e.target.value)}
                      placeholder={placeholder}
                      className="w-full px-3 py-2 bg-henry-bg border border-henry-border/40 rounded-lg text-sm text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/40"
                    />
                  </div>
                ))}
              </div>
              <div>
                <label className="text-[10px] text-henry-text-muted uppercase tracking-wide block mb-1">Open threads / waiting on</label>
                <input
                  value={draft.openThreads}
                  onChange={(e) => patchDraft('openThreads', e.target.value)}
                  placeholder="e.g. Waiting on contract signature, owes feedback on proposal..."
                  className="w-full px-3 py-2 bg-henry-bg border border-henry-border/40 rounded-lg text-sm text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/40"
                />
              </div>
              <div>
                <label className="text-[10px] text-henry-text-muted uppercase tracking-wide block mb-1">Notes for Henry</label>
                <textarea
                  value={draft.notes}
                  onChange={(e) => patchDraft('notes', e.target.value)}
                  placeholder="Preferences, context, how you know them, what matters to them..."
                  rows={3}
                  className="w-full px-3 py-2 bg-henry-bg border border-henry-border/40 rounded-lg text-sm text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/40 resize-none"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={save} disabled={!draft.name.trim()} className="px-4 py-2 rounded-lg bg-henry-accent text-white text-xs font-medium hover:bg-henry-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed">Save</button>
                <button onClick={cancelEdit} className="px-4 py-2 rounded-lg border border-henry-border/40 text-henry-text-dim text-xs hover:text-henry-text hover:border-henry-border/70 transition-colors">Cancel</button>
              </div>
            </div>
          )}

          {/* Contact list */}
          {list.length === 0 && !draft && (
            <div className="text-center py-16 text-henry-text-muted">
              <div className="text-3xl mb-3">👥</div>
              <p className="text-sm font-medium text-henry-text-dim mb-1">No contacts yet</p>
              <p className="text-xs">Add people — Henry will reference them when you mention their name.</p>
              <button onClick={startNew} className="mt-4 px-4 py-2 rounded-lg bg-henry-accent/10 text-henry-accent text-xs font-medium hover:bg-henry-accent/20 transition-colors border border-henry-accent/20">
                Add your first contact
              </button>
            </div>
          )}

          {list.map((contact) =>
            editingId === contact.id ? null : (
              <div key={contact.id} className="rounded-xl border border-henry-border/20 bg-henry-surface/20 overflow-hidden transition-all hover:border-henry-border/40">
                {/* Main row */}
                <div
                  className="flex items-start gap-4 p-4 cursor-pointer"
                  onClick={() => setExpandedId(expandedId === contact.id ? null : contact.id)}
                >
                  <div className="w-9 h-9 rounded-full bg-henry-accent/10 border border-henry-accent/20 flex items-center justify-center shrink-0 text-sm font-semibold text-henry-accent">
                    {contact.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-sm font-medium text-henry-text">{contact.name}</span>
                      {contact.role && <span className="text-xs text-henry-text-dim">{contact.role}</span>}
                      {contact.company && <span className="text-xs text-henry-text-muted">· {contact.company}</span>}
                    </div>
                    {contact.lastInteraction && (
                      <p className="text-xs text-henry-text-muted mt-0.5">Last: {contact.lastInteraction}</p>
                    )}
                    {contact.openThreads && (
                      <p className="text-xs text-amber-400/70 mt-0.5 truncate">↻ {contact.openThreads}</p>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5">
                    <button
                      onClick={(e) => { e.stopPropagation(); briefMe(contact); }}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-medium text-henry-accent bg-henry-accent/10 border border-henry-accent/20 hover:bg-henry-accent/20 transition-colors"
                      title="Let Henry brief you on this person"
                    >
                      Brief me
                    </button>
                    <svg className={`w-3.5 h-3.5 text-henry-text-muted transition-transform ${expandedId === contact.id ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </div>

                {/* Expanded section */}
                {expandedId === contact.id && (
                  <div className="border-t border-henry-border/20 px-4 py-4 space-y-4">
                    {contact.notes && (
                      <div>
                        <p className="text-[10px] font-semibold text-henry-text-muted uppercase tracking-wider mb-1">Henry's context</p>
                        <p className="text-xs text-henry-text-dim leading-relaxed">{contact.notes}</p>
                      </div>
                    )}

                    {/* Interaction history */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] font-semibold text-henry-text-muted uppercase tracking-wider">Interaction history</p>
                        <button
                          onClick={() => { setLogOpen(logOpen === contact.id ? null : contact.id); setLogDraft({ summary: '', type: 'meeting' }); }}
                          className="text-[10px] text-henry-accent hover:underline"
                        >
                          + Log interaction
                        </button>
                      </div>

                      {/* Log form */}
                      {logOpen === contact.id && (
                        <div className="bg-henry-bg/40 rounded-lg p-3 mb-3 space-y-2 border border-henry-border/30">
                          <div className="flex gap-2">
                            <select
                              value={logDraft.type}
                              onChange={(e) => setLogDraft((d) => ({ ...d, type: e.target.value as ContactInteraction['type'] }))}
                              className="text-xs bg-henry-surface border border-henry-border/40 rounded px-2 py-1.5 text-henry-text outline-none"
                            >
                              {(['meeting', 'call', 'email', 'message', 'other'] as const).map((t) => (
                                <option key={t} value={t}>{INTERACTION_ICONS[t]} {t.charAt(0).toUpperCase() + t.slice(1)}</option>
                              ))}
                            </select>
                            <input
                              autoFocus
                              value={logDraft.summary}
                              onChange={(e) => setLogDraft((d) => ({ ...d, summary: e.target.value }))}
                              placeholder="What happened? (e.g. Discussed Q2 roadmap, agreed on timeline)"
                              className="flex-1 text-xs px-3 py-1.5 bg-henry-surface border border-henry-border/40 rounded text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/40"
                              onKeyDown={(e) => { if (e.key === 'Enter') logInteraction(contact.id); }}
                            />
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => logInteraction(contact.id)} disabled={!logDraft.summary.trim()} className="px-3 py-1.5 rounded-lg bg-henry-accent text-white text-[10px] font-medium hover:bg-henry-accent-hover transition-colors disabled:opacity-40">Log</button>
                            <button onClick={() => setLogOpen(null)} className="px-3 py-1.5 rounded-lg text-henry-text-muted text-[10px] hover:text-henry-text transition-colors">Cancel</button>
                          </div>
                        </div>
                      )}

                      {contact.interactions.length === 0 ? (
                        <p className="text-xs text-henry-text-muted italic">No interactions logged yet.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {contact.interactions.slice(0, 5).map((interaction) => (
                            <div key={interaction.id} className="flex items-start gap-2 text-xs">
                              <span className="shrink-0 text-henry-text-muted">{INTERACTION_ICONS[interaction.type]}</span>
                              <span className="text-henry-text-muted shrink-0">{interaction.date}</span>
                              <span className="text-henry-text-dim">{interaction.summary}</span>
                            </div>
                          ))}
                          {contact.interactions.length > 5 && (
                            <p className="text-[10px] text-henry-text-muted">+{contact.interactions.length - 5} more</p>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => startEdit(contact)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-henry-text-dim text-[10px] hover:text-henry-text hover:bg-henry-hover/50 transition-colors border border-henry-border/30"
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                        Edit
                      </button>
                      {confirmDelete === contact.id ? (
                        <div className="flex items-center gap-1">
                          <button onClick={() => remove(contact.id)} className="px-2.5 py-1.5 rounded text-[10px] bg-henry-error/20 text-henry-error hover:bg-henry-error/30 transition-colors">Delete</button>
                          <button onClick={() => setConfirmDelete(null)} className="px-2.5 py-1.5 rounded text-[10px] text-henry-text-muted hover:text-henry-text">Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDelete(contact.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-henry-text-muted text-[10px] hover:text-henry-error hover:bg-henry-error/10 transition-colors border border-henry-border/30">
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
