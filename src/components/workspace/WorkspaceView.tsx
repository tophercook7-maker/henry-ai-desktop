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
  {
    id: '01',
    label: 'Product & Engineering',
    description: 'Architecture docs, roadmap, model routing, memory blueprint, personality system',
    icon: '🔧',
    path: '/workspace/01_Product_Engineering',
  },
  {
    id: '02',
    label: 'Business Strategy',
    description: 'Vision, business model, offer ideas, revenue paths, priorities, launch plan',
    icon: '📊',
    path: '/workspace/02_Business_Strategy',
  },
  {
    id: '03',
    label: 'Marketing & Content',
    description: 'Brand notes, messaging, content ideas, landing page copy, social posts',
    icon: '📢',
    path: '/workspace/03_Marketing_Content',
  },
  {
    id: '04',
    label: 'Operations & Legal',
    description: 'Policies, system notes, integrations list, security notes',
    icon: '📋',
    path: '/workspace/04_Operations_Legal',
  },
  {
    id: '05',
    label: 'Meetings & Communications',
    description: 'Weekly updates, meeting notes, decisions log',
    icon: '🤝',
    path: '/workspace/05_Meetings_Communications',
  },
  {
    id: '06',
    label: 'Memory',
    description: 'User profile, where we left off, current priorities, relationship summary, timeline',
    icon: '🧠',
    path: '/workspace/06_Memory',
  },
  {
    id: '07',
    label: 'Projects',
    description: 'One subfolder per active project — overview, plan, tasks, notes, status',
    icon: '🚀',
    path: '/workspace/07_Projects',
  },
  {
    id: '08',
    label: 'Templates',
    description: 'Reusable document templates — overview, status, roadmap, project, meeting, weekly review',
    icon: '📐',
    path: '/workspace/08_Templates',
  },
  {
    id: '09',
    label: 'Exports & Backups',
    description: 'Generated exports, manual backups, workspace snapshots',
    icon: '💾',
    path: '/workspace/09_Exports_Backups',
  },
  {
    id: '10',
    label: 'System',
    description: 'Config, memory schema notes, logs, prompts, state snapshots',
    icon: '⚙️',
    path: '/workspace/10_System',
  },
];

interface RepairResult {
  created: number;
  timestamp: string;
}

export default function WorkspaceView() {
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
      } catch { /* folder may not exist yet */ }
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
      setFolderFiles(
        (result.entries || []).filter((e: any) => !e.name.startsWith('.')),
      );
    } catch {
      setFolderFiles([]);
    }
  }

  function openFileInBrowser() {
    useStore.getState().setCurrentView('files');
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-henry-text-dim text-sm animate-pulse">Checking workspace...</div>
      </div>
    );
  }

  if (!seeded) {
    return <WorkspaceInit onInit={handleInitialize} seeding={seeding} />;
  }

  const selectedFolderInfo = folders.find((f) => f.path === selectedFolder);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-henry-border/50">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-henry-text">Workspace</h1>
            <p className="text-xs text-henry-text-dim mt-0.5">
              {manifest
                ? `${manifest.files.length} documents across ${manifest.folders.length} folders`
                : 'Henry\'s organized operating environment'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {repairResult && (
              <span className="text-[10px] text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded-md">
                {repairResult.created > 0
                  ? `Repaired: ${repairResult.created} files restored`
                  : `Checked at ${repairResult.timestamp} — all files present`}
              </span>
            )}
            <button
              type="button"
              onClick={handleRepair}
              disabled={repairing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-henry-border/40 text-henry-text-dim hover:text-henry-text hover:border-henry-border/70 transition-colors disabled:opacity-50"
            >
              {repairing ? (
                <span className="animate-spin text-[10px]">⟳</span>
              ) : (
                <span>🔧</span>
              )}
              {repairing ? 'Repairing…' : 'Repair Workspace'}
            </button>
            <button
              type="button"
              onClick={openFileInBrowser}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-henry-border/40 text-henry-text-dim hover:text-henry-accent hover:border-henry-accent/40 transition-colors"
            >
              📂 Browse Files
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6">
          {/* Folder grid */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            {folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => openFolder(folder.path)}
                className={`text-left p-4 rounded-xl border transition-all ${
                  selectedFolder === folder.path
                    ? 'bg-henry-accent/8 border-henry-accent/40 ring-1 ring-henry-accent/20'
                    : 'bg-henry-surface/30 border-henry-border/30 hover:border-henry-border/60 hover:bg-henry-surface/50'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <span className="text-xl">{folder.icon}</span>
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-[10px] text-henry-text-muted bg-henry-bg/60 px-2 py-0.5 rounded-full">
                      {folder.fileCount} {folder.fileCount === 1 ? 'file' : 'files'}
                    </span>
                    <button
                      type="button"
                      title="Use as Henry's active workspace context"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveWorkspaceContext({
                          path: folder.path,
                          kind: 'folder',
                          label: folder.label,
                        });
                      }}
                      className="text-[9px] px-2 py-0.5 rounded border border-henry-border/40 text-henry-text-muted hover:text-henry-accent hover:border-henry-accent/40 transition-colors"
                    >
                      Use as context
                    </button>
                  </div>
                </div>
                <div className="text-xs font-medium text-henry-text mb-1">{folder.label}</div>
                <div className="text-[11px] text-henry-text-dim leading-relaxed">{folder.description}</div>
              </button>
            ))}
          </div>

          {/* Selected folder contents */}
          {selectedFolder && (
            <div className="animate-fade-in border-t border-henry-border/30 pt-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-base">{selectedFolderInfo?.icon}</span>
                  <h2 className="text-sm font-semibold text-henry-text">{selectedFolderInfo?.label}</h2>
                  <span className="text-[10px] text-henry-text-muted">
                    {folderFiles.length} {folderFiles.length === 1 ? 'item' : 'items'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={openFileInBrowser}
                  className="text-[10px] text-henry-accent hover:text-henry-accent-hover"
                >
                  Open in file browser →
                </button>
              </div>

              {folderFiles.length === 0 ? (
                <div className="p-6 rounded-xl bg-henry-surface/20 border border-henry-border/20 text-center">
                  <p className="text-sm text-henry-text-dim">This folder is empty.</p>
                  <p className="text-xs text-henry-text-muted mt-1">
                    Run Repair Workspace to restore starter documents.
                  </p>
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
                          type="button"
                          title="Use as Henry's active workspace context"
                          onClick={() =>
                            setActiveWorkspaceContext({
                              path: file.path || `${selectedFolder}/${file.name}`,
                              kind: file.isDirectory ? 'folder' : 'file',
                              label: file.name,
                            })
                          }
                          className="text-[10px] text-henry-text-muted hover:text-henry-accent"
                        >
                          Context
                        </button>
                        <button
                          type="button"
                          onClick={openFileInBrowser}
                          className="text-[10px] text-henry-accent hover:text-henry-accent-hover"
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

          {/* Workspace manifest info */}
          {manifest && (
            <div className="mt-6 pt-4 border-t border-henry-border/20">
              <div className="flex items-center gap-4 text-[10px] text-henry-text-muted">
                <span>Seeded: {new Date(manifest.seeded_at).toLocaleDateString()}</span>
                {manifest.last_repair && (
                  <span>Last repair: {new Date(manifest.last_repair).toLocaleDateString()}</span>
                )}
                <span>v{manifest.version}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Init screen ───────────────────────────────────────────────────────────────

function WorkspaceInit({
  onInit,
  seeding,
}: {
  onInit: () => void;
  seeding: boolean;
}) {
  return (
    <div className="h-full flex items-center justify-center animate-fade-in p-6">
      <div className="text-center max-w-lg w-full">
        <div className="text-5xl mb-5">🗂️</div>
        <h2 className="text-xl font-bold text-henry-text mb-2">Set Up Your Workspace</h2>
        <p className="text-sm text-henry-text-dim mb-6 leading-relaxed">
          Henry will create a fully seeded workspace with 40+ real documents across 10 organized folders.
          Every file starts with meaningful content — no placeholders, no empty scaffolds.
        </p>

        <div className="grid grid-cols-2 gap-2 mb-6 text-left">
          {WORKSPACE_FOLDERS.map((folder) => (
            <div
              key={folder.id}
              className="flex items-center gap-2.5 p-2.5 rounded-lg bg-henry-surface/30 border border-henry-border/20"
            >
              <span className="text-base shrink-0">{folder.icon}</span>
              <div className="min-w-0">
                <div className="text-[11px] font-medium text-henry-text truncate">{folder.label}</div>
                <div className="text-[10px] text-henry-text-muted leading-snug line-clamp-2">{folder.description}</div>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={onInit}
          disabled={seeding}
          className="px-8 py-3 bg-henry-accent text-white rounded-xl font-medium hover:bg-henry-accent-hover transition-colors disabled:opacity-60 disabled:cursor-wait"
        >
          {seeding ? 'Creating workspace…' : 'Initialize Workspace →'}
        </button>
        <p className="text-[10px] text-henry-text-muted mt-3">
          Safe to run any time — never overwrites files you've edited.
        </p>
      </div>
    </div>
  );
}
