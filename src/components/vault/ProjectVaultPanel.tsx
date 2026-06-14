/**
 * ProjectVaultPanel — the visual face of the Project Vault (build plan, Phase 1.1).
 *
 * Lists every project with its status, next action, money angle, domain, and
 * repo, all inline-editable. Reads via `vaultListProjects` and writes via
 * `vaultUpdateProject` — the same `projects` table Henry edits from chat, so the
 * panel and the agent stay in sync.
 *
 * Reliability: every IPC call is guarded; the panel always renders a clear
 * loading / empty / error state instead of a blank or broken screen.
 */

import { useCallback, useEffect, useState } from 'react';

type Project = HenryProject;

const STATUSES: Project['status'][] = ['active', 'paused', 'completed', 'archived'];

const STATUS_STYLE: Record<Project['status'], string> = {
  active: 'bg-emerald-500/15 text-emerald-400',
  paused: 'bg-amber-500/15 text-amber-400',
  completed: 'bg-sky-500/15 text-sky-400',
  archived: 'bg-henry-border/30 text-henry-text-muted',
};

function api() {
  return typeof window !== 'undefined' ? window.henryAPI : undefined;
}

export default function ProjectVaultPanel() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api()?.vaultListProjects?.();
      if (!res) { setError('Project Vault is only available in the desktop app.'); setProjects([]); return; }
      if (!res.ok) { setError(res.error || 'Could not load projects.'); setProjects([]); return; }
      setProjects(res.result ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load projects.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const patch = useCallback(async (id: string, fields: Partial<Project>) => {
    setSavingId(id);
    // optimistic update
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...fields } : p)));
    try {
      const res = await api()?.vaultUpdateProject?.(id, fields);
      if (res?.ok && res.result) {
        setProjects((prev) => prev.map((p) => (p.id === id ? (res.result as Project) : p)));
      } else if (res && !res.ok) {
        setError(res.error || 'Save failed.');
        void load(); // resync truth
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
      void load();
    } finally {
      setSavingId(null);
    }
  }, [load]);

  const create = useCallback(async () => {
    const name = newName.trim();
    if (!name) { setCreating(false); setNewName(''); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await api()?.vaultCreateProject?.({ name });
      if (res?.ok && res.result) {
        setProjects((prev) => [res.result as Project, ...prev]);
        setNewName('');
        setCreating(false);
      } else {
        setError(res?.error || 'Could not create project.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create project.');
    } finally {
      setBusy(false);
    }
  }, [newName]);

  const remove = useCallback(async (id: string) => {
    const snapshot = projects;
    setProjects((prev) => prev.filter((p) => p.id !== id)); // optimistic
    try {
      const res = await api()?.vaultDeleteProject?.(id);
      if (res && !res.ok) {
        setError(res.error || 'Could not delete project.');
        setProjects(snapshot); // restore truth
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete project.');
      setProjects(snapshot);
    }
  }, [projects]);

  return (
    <div className="h-full overflow-y-auto bg-henry-bg">
      <div className="max-w-3xl mx-auto px-5 py-6">
        <div className="flex items-end justify-between mb-1">
          <h1 className="text-xl font-semibold text-henry-text">Projects</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setCreating((c) => !c); setError(null); }}
              className="text-xs text-henry-accent hover:underline transition-colors"
            >
              + New project
            </button>
            <button
              onClick={() => void load()}
              className="text-xs text-henry-text-muted hover:text-henry-text transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>
        <p className="text-xs text-henry-text-muted mb-3">
          Your Project Vault. Henry reads and updates these in chat too — ask him "where's StrainSpotter at?"
        </p>

        {creating && (
          <div className="flex items-center gap-2 mb-5">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create();
                if (e.key === 'Escape') { setCreating(false); setNewName(''); }
              }}
              placeholder="New project name…"
              className="flex-1 bg-henry-surface border border-henry-accent/40 rounded-lg px-3 py-2 text-sm text-henry-text outline-none"
            />
            <button
              onClick={() => void create()}
              disabled={busy || !newName.trim()}
              className="text-xs px-3 py-2 rounded-lg bg-henry-accent/15 text-henry-accent hover:bg-henry-accent/25 disabled:opacity-40 transition-colors"
            >
              {busy ? 'Adding…' : 'Add'}
            </button>
            <button
              onClick={() => { setCreating(false); setNewName(''); }}
              className="text-xs text-henry-text-muted hover:text-henry-text transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {loading && <div className="text-sm text-henry-text-muted py-12 text-center">Loading projects…</div>}

        {!loading && error && (
          <div className="bg-henry-surface/50 border border-red-500/30 rounded-xl p-4 text-sm text-red-300">
            {error}
            <button onClick={() => void load()} className="block mt-2 text-henry-accent hover:underline">Try again</button>
          </div>
        )}

        {!loading && !error && projects.length === 0 && (
          <div className="text-sm text-henry-text-muted py-12 text-center">
            No projects yet. They seed automatically on first launch — or ask Henry to add one.
          </div>
        )}

        {!loading && !error && projects.length > 0 && (
          <div className="space-y-3">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} saving={savingId === p.id} onPatch={patch} onDelete={remove} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── One project card ─────────────────────────────────────────────────────────

function ProjectCard({
  project,
  saving,
  onPatch,
  onDelete,
}: {
  project: Project;
  saving: boolean;
  onPatch: (id: string, fields: Partial<Project>) => void;
  onDelete: (id: string) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="bg-henry-surface/40 border border-henry-border/30 rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-henry-text truncate">{project.name}</h2>
          {project.description && (
            <p className="text-xs text-henry-text-muted mt-0.5 leading-relaxed">{project.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {saving && <span className="text-[10px] text-henry-text-muted">saving…</span>}
          <select
            value={project.status}
            onChange={(e) => onPatch(project.id, { status: e.target.value as Project['status'] })}
            className={`text-[11px] rounded-full px-2 py-1 outline-none border-0 cursor-pointer ${STATUS_STYLE[project.status]}`}
          >
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {confirmDelete ? (
            <span className="flex items-center gap-1.5 text-[10px]">
              <span className="text-henry-text-muted">Delete?</span>
              <button
                onClick={() => { setConfirmDelete(false); onDelete(project.id); }}
                className="text-red-400 hover:text-red-300 font-medium"
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="text-henry-text-muted hover:text-henry-text"
              >
                No
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              title="Delete project"
              aria-label={`Delete ${project.name}`}
              className="text-[11px] text-henry-text-muted hover:text-red-400 transition-colors px-1"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2">
        <EditableRow label="Next action" value={project.next_action ?? ''} placeholder="What's the one next move?"
          onSave={(v) => onPatch(project.id, { next_action: v })} />
        <EditableRow label="Money angle" value={project.money_angle ?? ''} placeholder="How does this make money?"
          onSave={(v) => onPatch(project.id, { money_angle: v })} />
        <EditableRow label="Domain" value={project.domain ?? ''} placeholder="example.com" link
          onSave={(v) => onPatch(project.id, { domain: v })} />
        <EditableRow label="Repo" value={project.repo_url ?? ''} placeholder="github.com/…" link
          onSave={(v) => onPatch(project.id, { repo_url: v })} />
      </div>

      {project.last_worked_at && (
        <p className="text-[10px] text-henry-text-muted mt-3">
          Last worked: {new Date(project.last_worked_at).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}

// ── Inline-editable field ────────────────────────────────────────────────────

function EditableRow({
  label,
  value,
  placeholder,
  link,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  link?: boolean;
  onSave: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next !== (value ?? '').trim()) onSave(next);
  };

  const openHref = link && value
    ? (value.startsWith('http') ? value : `https://${value}`)
    : null;

  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[11px] text-henry-text-dim w-20 flex-shrink-0">{label}</span>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { setDraft(value); setEditing(false); }
          }}
          placeholder={placeholder}
          className="flex-1 bg-henry-surface border border-henry-accent/40 rounded-lg px-2 py-1 text-xs text-henry-text outline-none"
        />
      ) : (
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <button
            onClick={() => setEditing(true)}
            className={`flex-1 text-left text-xs truncate ${value ? 'text-henry-text' : 'text-henry-text-muted italic'} hover:text-henry-accent transition-colors`}
            title="Click to edit"
          >
            {value || placeholder || '—'}
          </button>
          {openHref && (
            <button
              onClick={() => api()?.computerOpenUrl?.(openHref)}
              className="text-[10px] text-henry-accent hover:underline flex-shrink-0"
            >
              open ↗
            </button>
          )}
        </div>
      )}
    </div>
  );
}
