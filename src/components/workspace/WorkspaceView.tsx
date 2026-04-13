import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../../store';
import { setActiveWorkspaceContext } from '@/henry/workspaceContext';
import {
  seedWorkspace,
  repairWorkspace,
  isWorkspaceSeeded,
  getWorkspaceManifest,
} from '@/henry/workspaceSeeder';

interface FolderInfo {
  id: string;
  label: string;
  description: string;
  icon: string;
  path: string;
  fileCount: number;
}

const WORKSPACE_FOLDERS: Omit<FolderInfo, 'fileCount'>[] = [
  { id: '01', label: 'Product & Engineering', description: 'Architecture, roadmap, model routing', icon: '🔧', path: '/workspace/01_Product_Engineering' },
  { id: '02', label: 'Business Strategy', description: 'Vision, revenue, priorities, launch plan', icon: '📊', path: '/workspace/02_Business_Strategy' },
  { id: '03', label: 'Marketing & Content', description: 'Brand, messaging, content, social', icon: '📢', path: '/workspace/03_Marketing_Content' },
  { id: '04', label: 'Operations & Legal', description: 'Policies, integrations, security notes', icon: '📋', path: '/workspace/04_Operations_Legal' },
  { id: '05', label: 'Meetings & Comms', description: 'Weekly updates, meeting notes, decisions', icon: '🤝', path: '/workspace/05_Meetings_Communications' },
  { id: '06', label: 'Memory', description: 'User profile, priorities, relationship history', icon: '🧠', path: '/workspace/06_Memory' },
  { id: '07', label: 'Projects', description: 'One subfolder per active project', icon: '🚀', path: '/workspace/07_Projects' },
  { id: '08', label: 'Templates', description: 'Reusable document templates', icon: '📐', path: '/workspace/08_Templates' },
  { id: '09', label: 'Exports & Backups', description: 'Generated exports, snapshots', icon: '💾', path: '/workspace/09_Exports_Backups' },
  { id: '10', label: 'System', description: 'Config, logs, prompts, state snapshots', icon: '⚙️', path: '/workspace/10_System' },
];

interface RepairResult {
  created: number;
  timestamp: string;
}

export default function WorkspaceView() {
  const setCurrentView = useStore((s) => s.setCurrentView);
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [folderFiles, setFolderFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeded, setSeeded] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState<RepairResult | null>(null);
  const [manifest, setManifest] = useState<ReturnType<typeof getWorkspaceManifest>>(null);

  const loadFolders = useCallback(async () => {
    const loaded: FolderInfo[] = [];
    for (const f of WORKSPACE_FOLDERS) {
      let fileCount = 0;
      try {
        const result = await window.henryAPI.readDirectory(f.path);
        fileCount = (result.entries || []).length;
      } catch { /* not yet created */ }
      loaded.push({ ...f, fileCount });
    }
    setFolders(loaded);
    setManifest(getWorkspaceManifest());
  }, []);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const already = isWorkspaceSeeded();
        setSeeded(already);
        if (already) await loadFolders();
      } finally {
        setLoading(false);
      }
    })();
  }, [loadFolders]);

  async function handleInitialize() {
    setSeeding(true);
    try {
      seedWorkspace();
      setSeeded(true);
      await loadFolders();
    } finally {
      setSeeding(false);
    }
  }

  async function handleRepair() {
    setRepairing(true);
    setRepairResult(null);
    try {
      const created = repairWorkspace();
      setRepairResult({ created, timestamp: new Date().toLocaleTimeString() });
      await loadFolders();
      if (selectedFolder) await openFolder(selectedFolder);
    } finally {
      setRepairing(false);
    }
  }

  async function openFolder(folderPath: string) {
    setSelectedFolder(folderPath);
    try {
      const result = await window.henryAPI.readDirectory(folderPath);
      setFolderFiles((result.entries || []).filter((e: any) => !e.name.startsWith('.')));
    } catch {
      setFolderFiles([]);
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-henry-text-dim text-sm animate-pulse">Loading workspace…</div>
      </div>
    );
  }

  if (!seeded) {
    return <WorkspaceInit onInit={handleInitialize} seeding={seeding} />;
  }

  const totalFiles = folders.reduce((sum, f) => sum + f.fileCount, 0);
  const selectedFolderInfo = folders.find((f) => f.path === selectedFolder);
  const activeFolders = folders.filter((f) => f.fileCount > 0);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-henry-border/50">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-henry-text">Workspace</h1>
            <p className="text-xs text-henry-text-dim mt-0.5">
              {totalFiles} documents · {activeFolders.length} active folders
            </p>
          </div>
          <div className="flex items-center gap-2">
            {repairResult && (
              <span className="text-[10px] text-henry-success bg-henry-success/10 px-2 py-1 rounded-md">
                {repairResult.created > 0 ? `${repairResult.created} files restored` : 'All files present'}
              </span>
            )}
            <button
              onClick={handleRepair}
              disabled={repairing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-henry-border/40 text-henry-text-dim hover:text-henry-text hover:border-henry-border/70 transition-colors disabled:opacity-50"
            >
              {repairing ? <span className="animate-spin text-[10px]">⟳</span> : <span>🔧</span>}
              {repairing ? 'Repairing…' : 'Repair'}
            </button>
            <button
              onClick={() => setCurrentView('files')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-henry-border/40 text-henry-text-dim hover:text-henry-accent hover:border-henry-accent/40 transition-colors"
            >
              📂 Browse files
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 space-y-6">

          {/* Quick actions */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-henry-text-muted mb-3">Quick actions</p>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('henry_mode_launch', {
                    detail: { mode: 'writer', prompt: 'Create a new document for me.' }
                  }));
                  useStore.getState().setCurrentView('chat');
                }}
                className="flex items-center gap-2 px-4 py-3 rounded-xl bg-henry-accent/10 border border-henry-accent/20 text-henry-accent hover:bg-henry-accent/20 transition-colors text-sm font-medium"
              >
                <span className="text-base">✏️</span> New document
              </button>
              <button
                onClick={() => setCurrentView('files')}
                className="flex items-center gap-2 px-4 py-3 rounded-xl bg-henry-surface/40 border border-henry-border/30 text-henry-text-dim hover:text-henry-text hover:border-henry-border/60 transition-colors text-sm font-medium"
              >
                <span className="text-base">📂</span> Browse all files
              </button>
              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('henry_mode_launch', {
                    detail: { mode: 'secretary', prompt: 'Give me a quick summary of what\'s in my workspace and what I should focus on.' }
                  }));
                  useStore.getState().setCurrentView('chat');
                }}
                className="flex items-center gap-2 px-4 py-3 rounded-xl bg-henry-surface/40 border border-henry-border/30 text-henry-text-dim hover:text-henry-text hover:border-henry-border/60 transition-colors text-sm font-medium"
              >
                <span className="text-base">🧠</span> Summarize workspace
              </button>
            </div>
          </div>

          {/* Active folders — compact grid */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-henry-text-muted">Folders</p>
              {manifest && (
                <span className="text-[10px] text-henry-text-muted">
                  Seeded {new Date(manifest.seeded_at).toLocaleDateString()}
                  {manifest.last_repair ? ` · repaired ${new Date(manifest.last_repair).toLocaleDateString()}` : ''}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  onClick={() => openFolder(folder.path)}
                  className={`text-left p-4 rounded-xl border transition-all ${
                    selectedFolder === folder.path
                      ? 'bg-henry-accent/8 border-henry-accent/40 ring-1 ring-henry-accent/20'
                      : 'bg-henry-surface/30 border-henry-border/30 hover:border-henry-border/60 hover:bg-henry-surface/50'
                  }`}
                >
                  <div className="flex items-start justify-between mb-1.5">
                    <span className="text-lg">{folder.icon}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-henry-text-muted">
                        {folder.fileCount} {folder.fileCount === 1 ? 'file' : 'files'}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveWorkspaceContext({ path: folder.path, kind: 'folder', label: folder.label });
                        }}
                        className="text-[9px] px-1.5 py-0.5 rounded border border-henry-border/40 text-henry-text-muted hover:text-henry-accent hover:border-henry-accent/40 transition-colors"
                        title="Use as context"
                      >
                        context
                      </button>
                    </div>
                  </div>
                  <div className="text-xs font-medium text-henry-text mb-0.5">{folder.label}</div>
                  <div className="text-[11px] text-henry-text-dim leading-snug truncate">{folder.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Selected folder files */}
          {selectedFolder && (
            <div className="border-t border-henry-border/30 pt-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-base">{selectedFolderInfo?.icon}</span>
                  <h2 className="text-sm font-semibold text-henry-text">{selectedFolderInfo?.label}</h2>
                  <span className="text-[10px] text-henry-text-muted">{folderFiles.length} items</span>
                </div>
                <button
                  onClick={() => setCurrentView('files')}
                  className="text-[10px] text-henry-accent hover:underline"
                >
                  Open in files →
                </button>
              </div>

              {folderFiles.length === 0 ? (
                <div className="p-6 rounded-xl bg-henry-surface/20 border border-henry-border/20 text-center">
                  <p className="text-sm text-henry-text-dim">This folder is empty.</p>
                  <p className="text-xs text-henry-text-muted mt-1">Run Repair to restore starter documents.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {folderFiles.map((file: any) => (
                    <div
                      key={file.path || file.name}
                      className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-henry-surface/30 border border-henry-border/20 hover:border-henry-border/40 transition-colors group"
                    >
                      <span className="text-sm shrink-0">{file.isDirectory ? '📁' : '📄'}</span>
                      <span className="text-xs text-henry-text flex-1 truncate">{file.name}</span>
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => setActiveWorkspaceContext({
                            path: file.path || `${selectedFolder}/${file.name}`,
                            kind: file.isDirectory ? 'folder' : 'file',
                            label: file.name,
                          })}
                          className="text-[10px] text-henry-text-muted hover:text-henry-accent"
                        >
                          Use as context
                        </button>
                        <button
                          onClick={() => setCurrentView('files')}
                          className="text-[10px] text-henry-accent hover:underline"
                        >
                          Open →
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WorkspaceInit({ onInit, seeding }: { onInit: () => void; seeding: boolean }) {
  return (
    <div className="h-full flex items-center justify-center p-6">
      <div className="text-center max-w-lg w-full">
        <div className="text-5xl mb-5">🗂️</div>
        <h2 className="text-xl font-bold text-henry-text mb-2">Set Up Your Workspace</h2>
        <p className="text-sm text-henry-text-dim mb-6 leading-relaxed">
          Henry will create a fully organized workspace with 40+ documents across 10 folders — all pre-filled with real content, no empty scaffolds.
        </p>
        <div className="grid grid-cols-2 gap-2 mb-6 text-left">
          {WORKSPACE_FOLDERS.map((folder) => (
            <div key={folder.id} className="flex items-center gap-2.5 p-2.5 rounded-lg bg-henry-surface/30 border border-henry-border/20">
              <span className="text-base shrink-0">{folder.icon}</span>
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-henry-text truncate">{folder.label}</div>
                <div className="text-[10px] text-henry-text-muted leading-snug">{folder.description}</div>
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={onInit}
          disabled={seeding}
          className="px-8 py-3 bg-henry-accent text-white rounded-xl font-medium hover:bg-henry-accent/90 transition-colors disabled:opacity-60"
        >
          {seeding ? 'Creating workspace…' : 'Set up workspace →'}
        </button>
        <p className="text-[10px] text-henry-text-muted mt-3">Never overwrites files you've edited.</p>
      </div>
    </div>
  );
}
