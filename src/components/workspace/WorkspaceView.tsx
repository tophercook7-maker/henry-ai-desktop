import { useState, useEffect } from 'react';
import { useStore } from '../../store';
import { setActiveWorkspaceContext } from '@/henry/workspaceContext';

interface WorkspaceFolder {
  name: string;
  path: string;
  description: string;
  icon: string;
  fileCount: number;
}

/**
 * Workspace view — the organized folder structure from Henry's brief.
 * 5 core folders for business operations:
 * 1. Product & Engineering
 * 2. Business & Strategy
 * 3. Marketing & Content
 * 4. Operations & Legal
 * 5. Meetings & Communications
 */
const WORKSPACE_FOLDERS: Omit<WorkspaceFolder, 'fileCount' | 'path'>[] = [
  {
    name: 'Product & Engineering',
    description: 'Architecture docs, code plans, technical specs, PRD documents',
    icon: '🔧',
  },
  {
    name: 'Business & Strategy',
    description: 'Business plans, financial models, competitive analysis, pricing',
    icon: '📊',
  },
  {
    name: 'Marketing & Content',
    description: 'Brand assets, social content, blog posts, launch plans',
    icon: '📢',
  },
  {
    name: 'Operations & Legal',
    description: 'Contracts, policies, SOPs, compliance, vendor management',
    icon: '📋',
  },
  {
    name: 'Meetings & Communications',
    description: 'Meeting notes, agendas, follow-ups, stakeholder updates',
    icon: '🤝',
  },
];

export default function WorkspaceView() {
  const [folders, setFolders] = useState<WorkspaceFolder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [folderFiles, setFolderFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [initializing, setInitializing] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    checkWorkspace();
  }, []);

  async function checkWorkspace() {
    setLoading(true);
    try {
      // Check if workspace folders exist
      const result = await window.henryAPI.readDirectory();
      const existingDirs = (result.entries || [])
        .filter((e: any) => e.isDirectory)
        .map((e: any) => e.name);

      const wsExists = WORKSPACE_FOLDERS.some((f) =>
        existingDirs.includes(f.name)
      );

      if (wsExists) {
        setIsInitialized(true);
        await loadFolders();
      }
    } catch (err) {
      console.error('Failed to check workspace:', err);
    } finally {
      setLoading(false);
    }
  }

  async function initializeWorkspace() {
    setInitializing(true);
    try {
      // Create each workspace folder
      for (const folder of WORKSPACE_FOLDERS) {
        const readmePath = `${folder.name}/README.md`;
        const readmeContent = `# ${folder.icon} ${folder.name}\n\n${folder.description}\n\n---\n*Managed by Henry AI*\n`;

        await window.henryAPI.writeFile(readmePath, readmeContent);
      }

      setIsInitialized(true);
      await loadFolders();
    } catch (err) {
      console.error('Failed to initialize workspace:', err);
    } finally {
      setInitializing(false);
    }
  }

  async function loadFolders() {
    try {
      const result = await window.henryAPI.readDirectory();
      const existingDirs = (result.entries || [])
        .filter((e: any) => e.isDirectory)
        .map((e: any) => e.name);

      const loadedFolders: WorkspaceFolder[] = WORKSPACE_FOLDERS.map((f) => ({
        ...f,
        path: f.name,
        fileCount: 0,
      }));

      // Count files in each folder
      for (const folder of loadedFolders) {
        if (existingDirs.includes(folder.name)) {
          try {
            const dirResult = await window.henryAPI.readDirectory(folder.path);
            folder.fileCount = (dirResult.entries || []).length;
          } catch {
            // Folder might not exist yet
          }
        }
      }

      setFolders(loadedFolders);
    } catch (err) {
      console.error('Failed to load folders:', err);
    }
  }

  async function openFolder(folderPath: string) {
    setSelectedFolder(folderPath);
    try {
      const result = await window.henryAPI.readDirectory(folderPath);
      setFolderFiles(result.entries || []);
    } catch (err) {
      console.error('Failed to read folder:', err);
      setFolderFiles([]);
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-henry-text-dim text-sm">Loading workspace...</div>
      </div>
    );
  }

  if (!isInitialized) {
    return <WorkspaceInit onInit={initializeWorkspace} initializing={initializing} />;
  }

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-6 py-4 border-b border-henry-border/50">
        <h1 className="text-lg font-semibold text-henry-text">Workspace</h1>
        <p className="text-xs text-henry-text-dim mt-1">
          Your organized business folders — managed by Henry
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">
          {/* Folder grid */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            {folders.map((folder) => (
              <div
                key={folder.name}
                className={`text-left p-5 rounded-xl border transition-all ${
                  selectedFolder === folder.path
                    ? 'bg-henry-accent/5 border-henry-accent/30'
                    : 'bg-henry-surface/30 border-henry-border/30 hover:border-henry-border/60 hover:bg-henry-surface/50'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="text-2xl">{folder.icon}</span>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-[10px] text-henry-text-muted bg-henry-bg/50 px-2 py-0.5 rounded-full">
                      {folder.fileCount} files
                    </span>
                    <button
                      type="button"
                      title="Use folder as chat workspace context"
                      onClick={() =>
                        setActiveWorkspaceContext({
                          path: folder.path,
                          kind: 'folder',
                          label: folder.name,
                        })
                      }
                      className="text-[9px] px-2 py-0.5 rounded-md border border-henry-border/40 text-henry-text-muted hover:text-henry-accent"
                    >
                      Use as context
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openFolder(folder.path)}
                  className="w-full text-left"
                >
                  <h3 className="text-sm font-medium text-henry-text mb-1">
                    {folder.name}
                  </h3>
                  <p className="text-xs text-henry-text-dim leading-relaxed">
                    {folder.description}
                  </p>
                </button>
              </div>
            ))}
          </div>

          {/* Selected folder contents */}
          {selectedFolder && (
            <div className="animate-fade-in">
              <div className="flex items-center gap-2 mb-4">
                <h2 className="text-sm font-semibold text-henry-text">
                  {folders.find((f) => f.path === selectedFolder)?.icon}{' '}
                  {selectedFolder}
                </h2>
                <span className="text-[10px] text-henry-text-muted">
                  {folderFiles.length} items
                </span>
              </div>

              {folderFiles.length === 0 ? (
                <div className="p-8 rounded-xl bg-henry-surface/20 border border-henry-border/20 text-center">
                  <p className="text-sm text-henry-text-dim">
                    This folder is empty. Ask Henry to create documents here.
                  </p>
                  <p className="text-xs text-henry-text-muted mt-2">
                    Example: "Create a business plan in Business & Strategy"
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {folderFiles.map((file: any) => (
                    <div
                      key={file.path || file.name}
                      className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-henry-surface/30 border border-henry-border/20 hover:border-henry-border/40 transition-colors"
                    >
                      <span className="text-sm">
                        {file.isDirectory ? '📁' : '📄'}
                      </span>
                      <span className="text-xs text-henry-text flex-1 truncate">
                        {file.name}
                      </span>
                      <button
                        type="button"
                        title="Use as chat workspace context"
                        onClick={() =>
                          setActiveWorkspaceContext({
                            path: file.path || `${selectedFolder}/${file.name}`,
                            kind: file.isDirectory ? 'folder' : 'file',
                            label: file.name,
                          })
                        }
                        className="text-[10px] text-henry-text-muted hover:text-henry-accent shrink-0"
                      >
                        Context
                      </button>
                      {!file.isDirectory && (
                        <button
                          type="button"
                          onClick={() => {
                            useStore.getState().setCurrentView('files');
                          }}
                          className="text-[10px] text-henry-accent hover:text-henry-accent-hover shrink-0"
                        >
                          Open →
                        </button>
                      )}
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

function WorkspaceInit({
  onInit,
  initializing,
}: {
  onInit: () => void;
  initializing: boolean;
}) {
  return (
    <div className="h-full flex items-center justify-center animate-fade-in">
      <div className="text-center max-w-lg">
        <div className="text-5xl mb-6">🗂️</div>
        <h2 className="text-2xl font-bold text-henry-text mb-3">
          Set Up Your Workspace
        </h2>
        <p className="text-henry-text-dim mb-6 leading-relaxed">
          Henry organizes your work into 5 core folders. Each one has a clear
          purpose, and Henry knows where to put things.
        </p>

        <div className="grid grid-cols-1 gap-2 mb-8 text-left">
          {WORKSPACE_FOLDERS.map((folder) => (
            <div
              key={folder.name}
              className="flex items-center gap-3 p-3 rounded-lg bg-henry-surface/30 border border-henry-border/20"
            >
              <span className="text-lg">{folder.icon}</span>
              <div>
                <div className="text-xs font-medium text-henry-text">
                  {folder.name}
                </div>
                <div className="text-[10px] text-henry-text-muted">
                  {folder.description}
                </div>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={onInit}
          disabled={initializing}
          className="px-8 py-3 bg-henry-accent text-white rounded-xl font-medium hover:bg-henry-accent-hover transition-colors"
        >
          {initializing ? 'Creating folders...' : 'Initialize Workspace →'}
        </button>
      </div>
    </div>
  );
}
