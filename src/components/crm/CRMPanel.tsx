import { useState, useCallback, useEffect } from 'react';
import {
  loadClients, loadProjects, saveClient, saveProject, deleteClient, deleteProject,
  addInteraction, getClientInteractions, newClient, newProject,
  STATUS_META, PROJECT_STATUS_META,
  type CRMClient, type CRMProject, type ClientStatus, type ProjectStatus,
} from '../../henry/crmData';
import { useStore } from '../../store';

type Tab = 'clients' | 'projects';

export default function CRMPanel() {
  const { setCurrentView } = useStore();
  const [tab, setTab] = useState<Tab>('clients');
  const [clients, setClients] = useState<CRMClient[]>([]);
  const [projects, setProjects] = useState<CRMProject[]>([]);
  const [selectedClient, setSelectedClient] = useState<CRMClient | null>(null);
  const [editingClient, setEditingClient] = useState<CRMClient | null>(null);
  const [editingProject, setEditingProject] = useState<CRMProject | null>(null);
  const [newNote, setNewNote] = useState('');

  const reload = useCallback(() => {
    setClients(loadClients());
    setProjects(loadProjects());
  }, []);

  useEffect(() => { reload(); }, [reload]);

  function handleSaveClient() {
    if (!editingClient || !editingClient.name.trim()) return;
    saveClient(editingClient);
    setEditingClient(null);
    reload();
  }

  function handleSaveProject() {
    if (!editingProject || !editingProject.name.trim()) return;
    saveProject(editingProject);
    setEditingProject(null);
    reload();
  }

  function handleAddNote(clientId: string) {
    if (!newNote.trim()) return;
    addInteraction({ id: `int_${Date.now()}`, clientId, type: 'note', summary: newNote.trim(), date: new Date().toISOString() });
    setNewNote('');
  }

  function briefMe(client: CRMClient) {
    const interactions = getClientInteractions(client.id);
    const clientProjects = projects.filter((p) => p.clientId === client.id);
    const ctx = [
      `Client: ${client.name}${client.company ? ` (${client.company})` : ''}`,
      `Status: ${STATUS_META[client.status].label}`,
      client.value ? `Lifetime value: $${client.value.toLocaleString()}` : '',
      client.notes ? `Notes: ${client.notes}` : '',
      clientProjects.length ? `Projects: ${clientProjects.map((p) => `${p.name} (${PROJECT_STATUS_META[p.status].label})`).join(', ')}` : '',
      interactions.length ? `Last interaction: ${interactions[0].summary}` : '',
    ].filter(Boolean).join('\n');
    const prompt = `I have a meeting or call coming up with ${client.name}. Here's what I know about them:\n\n${ctx}\n\nBrief me on what I should be ready to discuss, any open items or follow-ups, and how I should approach this interaction.`;
    window.dispatchEvent(new CustomEvent('henry_mode_launch', { detail: { mode: 'secretary', prompt } }));
    setCurrentView('chat');
  }

  const clientInteractions = selectedClient ? getClientInteractions(selectedClient.id) : [];

  return (
    <div className="flex h-full bg-henry-bg">
      {/* Main content */}
      <div className={`flex flex-col flex-1 min-h-0 ${(editingClient || editingProject) ? 'hidden md:flex' : 'flex'}`}>
        {/* Header */}
        <div className="p-6 border-b border-henry-border/30">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-semibold text-henry-text">Clients</h1>
              <p className="text-xs text-henry-text-muted mt-0.5">
                {clients.filter((c) => c.status === 'active').length} active · {clients.filter((c) => c.status === 'prospect').length} prospects
              </p>
            </div>
            <button
              onClick={() => tab === 'clients' ? setEditingClient(newClient()) : setEditingProject(newProject())}
              className="flex items-center gap-2 px-4 py-2 bg-henry-accent text-henry-bg rounded-xl text-xs font-semibold hover:bg-henry-accent/90 transition-colors"
            >
              + New {tab === 'clients' ? 'Client' : 'Project'}
            </button>
          </div>
          <div className="flex gap-1">
            {(['clients', 'projects'] as Tab[]).map((t) => (
              <button key={t} onClick={() => { setTab(t); setSelectedClient(null); }}
                className={`px-4 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${tab === t ? 'bg-henry-accent/15 text-henry-accent' : 'text-henry-text-muted hover:text-henry-text'}`}
              >{t}</button>
            ))}
          </div>
        </div>

        {/* Lists */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'clients' && (
            <div>
              {clients.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-henry-text-dim">
                  <span className="text-3xl mb-2">🤝</span>
                  <p className="text-sm">No clients yet</p>
                  <button onClick={() => setEditingClient(newClient())} className="mt-3 text-henry-accent text-xs hover:underline">Add your first client</button>
                </div>
              ) : (
                <div className="divide-y divide-henry-border/20">
                  {clients.map((c) => (
                    <div key={c.id} className={`group flex items-center gap-4 px-6 py-4 cursor-pointer hover:bg-henry-surface/40 transition-colors ${selectedClient?.id === c.id ? 'bg-henry-surface/40' : ''}`}
                      onClick={() => setSelectedClient(selectedClient?.id === c.id ? null : c)}>
                      <div className="w-10 h-10 rounded-xl bg-henry-accent/15 flex items-center justify-center text-henry-accent font-semibold text-sm shrink-0">
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-henry-text">{c.name}</p>
                        {c.company && <p className="text-xs text-henry-text-muted">{c.company}</p>}
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${STATUS_META[c.status].color}`}>{STATUS_META[c.status].label}</span>
                          {c.value && <span className="text-[10px] text-henry-text-dim">${c.value.toLocaleString()}</span>}
                        </div>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={(e) => { e.stopPropagation(); briefMe(c); }} className="text-[10px] px-2 py-1 rounded bg-henry-accent/10 text-henry-accent hover:bg-henry-accent/20 transition-colors">Brief me</button>
                        <button onClick={(e) => { e.stopPropagation(); setEditingClient({ ...c }); }} className="p-1 text-henry-text-dim hover:text-henry-text">✏️</button>
                        <button onClick={(e) => { e.stopPropagation(); deleteClient(c.id); reload(); }} className="p-1 text-henry-text-dim hover:text-henry-error">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {/* Expanded client detail */}
              {selectedClient && (
                <div className="mx-6 mb-4 p-4 bg-henry-surface/40 rounded-2xl border border-henry-border/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-henry-text">{selectedClient.name}</h3>
                    <div className="flex gap-2">
                      {selectedClient.email && <a href={`mailto:${selectedClient.email}`} className="text-xs text-henry-accent hover:underline">{selectedClient.email}</a>}
                      {selectedClient.phone && <span className="text-xs text-henry-text-muted">{selectedClient.phone}</span>}
                    </div>
                  </div>
                  {selectedClient.notes && <p className="text-xs text-henry-text-muted">{selectedClient.notes}</p>}
                  {/* Interaction log */}
                  <div>
                    <p className="text-[10px] font-semibold text-henry-text-muted uppercase tracking-wider mb-2">Interaction Log</p>
                    <div className="space-y-1.5">
                      {clientInteractions.map((i) => (
                        <div key={i.id} className="flex gap-2 text-xs">
                          <span className="text-henry-text-dim shrink-0">{new Date(i.date).toLocaleDateString()}</span>
                          <span className="text-henry-text-muted">{i.summary}</span>
                        </div>
                      ))}
                      {clientInteractions.length === 0 && <p className="text-xs text-henry-text-dim">No interactions logged yet.</p>}
                    </div>
                    <div className="flex gap-2 mt-2">
                      <input value={newNote} onChange={(e) => setNewNote(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleAddNote(selectedClient.id); }}
                        placeholder="Log a note or interaction..."
                        className="flex-1 bg-henry-bg border border-henry-border/50 rounded-lg px-3 py-1.5 text-xs text-henry-text placeholder-henry-text-dim focus:outline-none focus:border-henry-accent/50" />
                      <button onClick={() => handleAddNote(selectedClient.id)} className="px-3 py-1.5 bg-henry-accent/10 text-henry-accent text-xs rounded-lg hover:bg-henry-accent/20">Add</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          {tab === 'projects' && (
            <div>
              {projects.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-henry-text-dim">
                  <span className="text-3xl mb-2">📁</span>
                  <p className="text-sm">No projects yet</p>
                  <button onClick={() => setEditingProject(newProject())} className="mt-3 text-henry-accent text-xs hover:underline">Add your first project</button>
                </div>
              ) : (
                <div className="divide-y divide-henry-border/20">
                  {projects.map((p) => {
                    const client = clients.find((c) => c.id === p.clientId);
                    return (
                      <div key={p.id} className="group flex items-center gap-4 px-6 py-4 hover:bg-henry-surface/40 transition-colors">
                        <div className="w-10 h-10 rounded-xl bg-violet-400/15 flex items-center justify-center text-violet-400 text-sm shrink-0">📁</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-henry-text">{p.name}</p>
                          {client && <p className="text-xs text-henry-text-muted">{client.name}</p>}
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${PROJECT_STATUS_META[p.status].color}`}>{PROJECT_STATUS_META[p.status].label}</span>
                            {p.value && <span className="text-[10px] text-henry-text-dim">${p.value.toLocaleString()}</span>}
                            {p.deadline && <span className="text-[10px] text-henry-text-dim">Due {new Date(p.deadline).toLocaleDateString()}</span>}
                          </div>
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => setEditingProject({ ...p })} className="p-1 text-henry-text-dim hover:text-henry-text">✏️</button>
                          <button onClick={() => { deleteProject(p.id); reload(); }} className="p-1 text-henry-text-dim hover:text-henry-error">✕</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Edit panel */}
      {(editingClient || editingProject) && (
        <div className="w-full md:w-80 border-l border-henry-border/30 bg-henry-surface/50 flex flex-col">
          {editingClient && (
            <>
              <div className="p-4 border-b border-henry-border/30 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-henry-text">Client Details</h2>
                <button onClick={() => setEditingClient(null)} className="text-henry-text-dim hover:text-henry-text text-lg leading-none">×</button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {[{ label: 'Name *', key: 'name', placeholder: 'Client name' }, { label: 'Company', key: 'company', placeholder: 'Company name' }, { label: 'Email', key: 'email', placeholder: 'email@example.com' }, { label: 'Phone', key: 'phone', placeholder: '+1 555...' }].map(({ label, key, placeholder }) => (
                  <div key={key}>
                    <label className="block text-xs text-henry-text-muted mb-1">{label}</label>
                    <input value={(editingClient as any)[key] || ''} onChange={(e) => setEditingClient({ ...editingClient, [key]: e.target.value })}
                      placeholder={placeholder}
                      className="w-full bg-henry-bg border border-henry-border/50 rounded-lg px-3 py-2 text-sm text-henry-text placeholder-henry-text-dim focus:outline-none focus:border-henry-accent/50" />
                  </div>
                ))}
                <div>
                  <label className="block text-xs text-henry-text-muted mb-1">Status</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(Object.keys(STATUS_META) as ClientStatus[]).map((s) => (
                      <button key={s} onClick={() => setEditingClient({ ...editingClient, status: s })}
                        className={`py-2 rounded-lg text-xs transition-colors border ${editingClient.status === s ? 'bg-henry-accent/15 border-henry-accent/40 text-henry-accent' : 'border-henry-border/30 text-henry-text-dim hover:text-henry-text'}`}
                      >{STATUS_META[s].label}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-henry-text-muted mb-1">Lifetime Value ($)</label>
                  <input type="number" value={editingClient.value || ''} onChange={(e) => setEditingClient({ ...editingClient, value: parseFloat(e.target.value) || undefined })}
                    placeholder="0"
                    className="w-full bg-henry-bg border border-henry-border/50 rounded-lg px-3 py-2 text-sm text-henry-text placeholder-henry-text-dim focus:outline-none focus:border-henry-accent/50" />
                </div>
                <div>
                  <label className="block text-xs text-henry-text-muted mb-1">Notes</label>
                  <textarea value={editingClient.notes} onChange={(e) => setEditingClient({ ...editingClient, notes: e.target.value })}
                    rows={4} placeholder="What's important to know about this client?"
                    className="w-full bg-henry-bg border border-henry-border/50 rounded-lg px-3 py-2 text-sm text-henry-text placeholder-henry-text-dim focus:outline-none focus:border-henry-accent/50 resize-none" />
                </div>
              </div>
              <div className="p-4 border-t border-henry-border/30 flex gap-2">
                <button onClick={handleSaveClient} disabled={!editingClient.name.trim()} className="flex-1 py-2.5 bg-henry-accent text-henry-bg rounded-xl text-sm font-semibold hover:bg-henry-accent/90 disabled:opacity-40">Save</button>
                {clients.some((c) => c.id === editingClient.id) && (
                  <button onClick={() => { deleteClient(editingClient.id); setEditingClient(null); reload(); }} className="px-3 py-2.5 text-henry-error hover:bg-henry-error/10 rounded-xl text-sm">Delete</button>
                )}
              </div>
            </>
          )}
          {editingProject && (
            <>
              <div className="p-4 border-b border-henry-border/30 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-henry-text">Project Details</h2>
                <button onClick={() => setEditingProject(null)} className="text-henry-text-dim hover:text-henry-text text-lg leading-none">×</button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                <div>
                  <label className="block text-xs text-henry-text-muted mb-1">Project Name *</label>
                  <input value={editingProject.name} onChange={(e) => setEditingProject({ ...editingProject, name: e.target.value })} placeholder="Project name"
                    className="w-full bg-henry-bg border border-henry-border/50 rounded-lg px-3 py-2 text-sm text-henry-text placeholder-henry-text-dim focus:outline-none focus:border-henry-accent/50" />
                </div>
                <div>
                  <label className="block text-xs text-henry-text-muted mb-1">Client</label>
                  <select value={editingProject.clientId || ''} onChange={(e) => setEditingProject({ ...editingProject, clientId: e.target.value || undefined })}
                    className="w-full bg-henry-bg border border-henry-border/50 rounded-lg px-3 py-2 text-sm text-henry-text focus:outline-none focus:border-henry-accent/50">
                    <option value="">No client</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-henry-text-muted mb-1">Status</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(Object.keys(PROJECT_STATUS_META) as ProjectStatus[]).map((s) => (
                      <button key={s} onClick={() => setEditingProject({ ...editingProject, status: s })}
                        className={`py-2 rounded-lg text-xs transition-colors border ${editingProject.status === s ? 'bg-henry-accent/15 border-henry-accent/40 text-henry-accent' : 'border-henry-border/30 text-henry-text-dim hover:text-henry-text'}`}
                      >{PROJECT_STATUS_META[s].label}</button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-henry-text-muted mb-1">Value ($)</label>
                    <input type="number" value={editingProject.value || ''} onChange={(e) => setEditingProject({ ...editingProject, value: parseFloat(e.target.value) || undefined })}
                      placeholder="0"
                      className="w-full bg-henry-bg border border-henry-border/50 rounded-lg px-3 py-2 text-sm text-henry-text placeholder-henry-text-dim focus:outline-none focus:border-henry-accent/50" />
                  </div>
                  <div>
                    <label className="block text-xs text-henry-text-muted mb-1">Deadline</label>
                    <input type="date" value={editingProject.deadline || ''} onChange={(e) => setEditingProject({ ...editingProject, deadline: e.target.value })}
                      className="w-full bg-henry-bg border border-henry-border/50 rounded-lg px-3 py-2 text-sm text-henry-text focus:outline-none focus:border-henry-accent/50" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-henry-text-muted mb-1">Notes</label>
                  <textarea value={editingProject.notes} onChange={(e) => setEditingProject({ ...editingProject, notes: e.target.value })}
                    rows={4} placeholder="Project details, goals, blockers..."
                    className="w-full bg-henry-bg border border-henry-border/50 rounded-lg px-3 py-2 text-sm text-henry-text placeholder-henry-text-dim focus:outline-none focus:border-henry-accent/50 resize-none" />
                </div>
              </div>
              <div className="p-4 border-t border-henry-border/30 flex gap-2">
                <button onClick={handleSaveProject} disabled={!editingProject.name.trim()} className="flex-1 py-2.5 bg-henry-accent text-henry-bg rounded-xl text-sm font-semibold hover:bg-henry-accent/90 disabled:opacity-40">Save</button>
                {projects.some((p) => p.id === editingProject.id) && (
                  <button onClick={() => { deleteProject(editingProject.id); setEditingProject(null); reload(); }} className="px-3 py-2.5 text-henry-error hover:bg-henry-error/10 rounded-xl text-sm">Delete</button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
