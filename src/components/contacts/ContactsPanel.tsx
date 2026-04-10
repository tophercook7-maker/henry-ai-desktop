import { useState, useEffect } from 'react';

const STORAGE_KEY = 'henry_contacts';

interface Contact {
  id: string;
  name: string;
  role: string;
  company: string;
  notes: string;
  lastInteraction: string;
  tags: string[];
}

function loadContacts(): Contact[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return [];
}

function saveContacts(contacts: Contact[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts));
  } catch {
    /* ignore */
  }
}

function newContact(): Contact {
  return {
    id: crypto.randomUUID(),
    name: '',
    role: '',
    company: '',
    notes: '',
    lastInteraction: '',
    tags: [],
  };
}

export default function ContactsPanel() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Contact | null>(null);
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    setContacts(loadContacts());
  }, []);

  function filtered() {
    if (!search.trim()) return contacts;
    const q = search.toLowerCase();
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.role.toLowerCase().includes(q) ||
        c.company.toLowerCase().includes(q) ||
        c.notes.toLowerCase().includes(q)
    );
  }

  function startNew() {
    const c = newContact();
    setDraft(c);
    setEditingId(c.id);
  }

  function startEdit(c: Contact) {
    setDraft({ ...c });
    setEditingId(c.id);
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
  }

  function patchDraft(field: keyof Contact, value: string) {
    if (!draft) return;
    setDraft({ ...draft, [field]: value });
  }

  const list = filtered();

  return (
    <div className="h-full flex flex-col bg-henry-bg overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-8 pt-8 pb-5 border-b border-henry-border/30">
        <div className="max-w-3xl flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2.5 mb-0.5">
              <span className="text-xl">👥</span>
              <h1 className="text-lg font-semibold text-henry-text">Contacts</h1>
            </div>
            <p className="text-henry-text-dim text-xs">
              {contacts.length} {contacts.length === 1 ? 'person' : 'people'} — Henry uses this context when you talk about them.
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

        {/* Search */}
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

      <div className="flex-1 overflow-y-auto px-8 py-5">
        <div className="max-w-3xl space-y-3">

          {/* Edit / New form */}
          {draft && editingId && (
            <div className="border border-henry-accent/30 rounded-xl bg-henry-surface/40 p-5 space-y-3">
              <p className="text-xs font-semibold text-henry-accent uppercase tracking-wider mb-1">
                {contacts.some((c) => c.id === draft.id) ? 'Edit contact' : 'New contact'}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-henry-text-muted uppercase tracking-wide block mb-1">Name *</label>
                  <input
                    autoFocus
                    value={draft.name}
                    onChange={(e) => patchDraft('name', e.target.value)}
                    placeholder="Full name"
                    className="w-full px-3 py-2 bg-henry-bg border border-henry-border/40 rounded-lg text-sm text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/40"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-henry-text-muted uppercase tracking-wide block mb-1">Role</label>
                  <input
                    value={draft.role}
                    onChange={(e) => patchDraft('role', e.target.value)}
                    placeholder="Title or relationship"
                    className="w-full px-3 py-2 bg-henry-bg border border-henry-border/40 rounded-lg text-sm text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/40"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-henry-text-muted uppercase tracking-wide block mb-1">Company / Org</label>
                  <input
                    value={draft.company}
                    onChange={(e) => patchDraft('company', e.target.value)}
                    placeholder="Company or organization"
                    className="w-full px-3 py-2 bg-henry-bg border border-henry-border/40 rounded-lg text-sm text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/40"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-henry-text-muted uppercase tracking-wide block mb-1">Last interaction</label>
                  <input
                    value={draft.lastInteraction}
                    onChange={(e) => patchDraft('lastInteraction', e.target.value)}
                    placeholder="e.g. Mar 28 — project call"
                    className="w-full px-3 py-2 bg-henry-bg border border-henry-border/40 rounded-lg text-sm text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/40"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-henry-text-muted uppercase tracking-wide block mb-1">Notes for Henry</label>
                <textarea
                  value={draft.notes}
                  onChange={(e) => patchDraft('notes', e.target.value)}
                  placeholder="What Henry should know: preferences, context, open threads, relationship notes..."
                  rows={3}
                  className="w-full px-3 py-2 bg-henry-bg border border-henry-border/40 rounded-lg text-sm text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/40 resize-none"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={save}
                  disabled={!draft.name.trim()}
                  className="px-4 py-2 rounded-lg bg-henry-accent text-white text-xs font-medium hover:bg-henry-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Save contact
                </button>
                <button
                  onClick={cancelEdit}
                  className="px-4 py-2 rounded-lg border border-henry-border/40 text-henry-text-dim text-xs hover:text-henry-text hover:border-henry-border/70 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Contact list */}
          {list.length === 0 && !draft && (
            <div className="text-center py-16 text-henry-text-muted">
              <div className="text-3xl mb-3">👥</div>
              <p className="text-sm font-medium text-henry-text-dim mb-1">No contacts yet</p>
              <p className="text-xs">
                Add people Henry should know about — he'll use this context when you mention them.
              </p>
              <button
                onClick={startNew}
                className="mt-4 px-4 py-2 rounded-lg bg-henry-accent/10 text-henry-accent text-xs font-medium hover:bg-henry-accent/20 transition-colors border border-henry-accent/20"
              >
                Add your first contact
              </button>
            </div>
          )}

          {list.map((contact) =>
            editingId === contact.id ? null : (
              <div
                key={contact.id}
                className="group flex items-start gap-4 p-4 rounded-xl border border-henry-border/20 bg-henry-surface/20 hover:bg-henry-surface/40 hover:border-henry-border/40 transition-all"
              >
                <div className="w-9 h-9 rounded-full bg-henry-accent/10 border border-henry-accent/20 flex items-center justify-center shrink-0 text-sm font-semibold text-henry-accent">
                  {contact.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm font-medium text-henry-text">{contact.name}</span>
                    {contact.role && (
                      <span className="text-xs text-henry-text-dim">{contact.role}</span>
                    )}
                    {contact.company && (
                      <span className="text-xs text-henry-text-muted">· {contact.company}</span>
                    )}
                  </div>
                  {contact.lastInteraction && (
                    <p className="text-xs text-henry-text-muted mt-0.5">Last: {contact.lastInteraction}</p>
                  )}
                  {contact.notes && (
                    <p className="text-xs text-henry-text-dim mt-1.5 leading-relaxed line-clamp-2">
                      {contact.notes}
                    </p>
                  )}
                </div>
                <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => startEdit(contact)}
                    className="p-1.5 rounded-lg text-henry-text-muted hover:text-henry-text hover:bg-henry-hover/50 transition-colors"
                    title="Edit"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  {confirmDelete === contact.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => remove(contact.id)}
                        className="px-2 py-1 rounded text-[10px] bg-henry-error/20 text-henry-error hover:bg-henry-error/30 transition-colors"
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="px-2 py-1 rounded text-[10px] text-henry-text-muted hover:text-henry-text"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(contact.id)}
                      className="p-1.5 rounded-lg text-henry-text-muted hover:text-henry-error hover:bg-henry-error/10 transition-colors"
                      title="Delete"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3,6 5,6 21,6" />
                        <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2V6" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
