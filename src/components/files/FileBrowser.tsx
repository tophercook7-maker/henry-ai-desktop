import { useState, useEffect } from 'react';
import CodeEditor from './CodeEditor';

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modified?: string;
}

export default function FileBrowser() {
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<string[]>([]);
  const [editedContent, setEditedContent] = useState<string>('');
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadDirectory(currentPath);
  }, [currentPath]);

  async function loadDirectory(path: string) {
    setLoading(true);
    setError(null);
    try {
      const result = await window.henryAPI.readDirectory(path || undefined);
      setEntries(result.entries || []);
      setBreadcrumbs(result.path ? result.path.split('/').filter(Boolean) : []);
    } catch (err: any) {
      setError(err.message || 'Failed to read directory');
    } finally {
      setLoading(false);
    }
  }

  async function openFile(filePath: string) {
    try {
      const content = await window.henryAPI.readFile(filePath);
      setSelectedFile(filePath);
      setFileContent(content);
      setEditedContent(content);
      setHasChanges(false);
    } catch (err: any) {
      setError(err.message || 'Failed to read file');
    }
  }

  async function saveFile() {
    if (!selectedFile || !hasChanges) return;
    setSaving(true);
    try {
      await window.henryAPI.writeFile(selectedFile, editedContent);
      setFileContent(editedContent);
      setHasChanges(false);
    } catch (err: any) {
      setError(err.message || 'Failed to save file');
    } finally {
      setSaving(false);
    }
  }

  function navigateToDirectory(entry: FileEntry) {
    if (entry.isDirectory) {
      setCurrentPath(entry.path);
      setSelectedFile(null);
    } else {
      openFile(entry.path);
    }
  }

  function navigateUp() {
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    setCurrentPath(parts.length > 0 ? '/' + parts.join('/') : '');
  }

  function navigateToBreadcrumb(index: number) {
    const parts = breadcrumbs.slice(0, index + 1);
    setCurrentPath('/' + parts.join('/'));
  }

  function getFileIcon(entry: FileEntry): string {
    if (entry.isDirectory) return '📁';
    const ext = entry.name.split('.').pop()?.toLowerCase();
    const icons: Record<string, string> = {
      ts: '🔷', tsx: '⚛️', js: '🟨', jsx: '⚛️',
      json: '📋', md: '📝', html: '🌐', css: '🎨',
      py: '🐍', rs: '🦀', go: '🔵', yaml: '⚙️',
      yml: '⚙️', toml: '⚙️', txt: '📄', svg: '🖼️',
      png: '🖼️', jpg: '🖼️', gif: '🖼️',
      sh: '💻', sql: '🗄️', env: '🔐', lock: '🔒',
    };
    return icons[ext || ''] || '📄';
  }

  function getLanguage(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase();
    const langs: Record<string, string> = {
      ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
      json: 'json', md: 'markdown', html: 'html', css: 'css',
      py: 'python', rs: 'rust', go: 'go', yaml: 'yaml',
      yml: 'yaml', toml: 'toml', sh: 'bash', sql: 'sql',
    };
    return langs[ext || ''] || 'text';
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-henry-border/50">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-lg font-semibold text-henry-text">Files</h1>
          {selectedFile && hasChanges && (
            <button
              onClick={saveFile}
              disabled={saving}
              className="px-4 py-1.5 bg-henry-accent text-white rounded-lg text-xs font-medium hover:bg-henry-accent-hover transition-colors"
            >
              {saving ? 'Saving...' : 'Save Changes (⌘S)'}
            </button>
          )}
        </div>

        {/* Breadcrumbs */}
        <div className="flex items-center gap-1 text-xs">
          <button
            onClick={() => setCurrentPath('')}
            className="text-henry-text-dim hover:text-henry-text transition-colors"
          >
            ~
          </button>
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="text-henry-text-muted">/</span>
              <button
                onClick={() => navigateToBreadcrumb(i)}
                className="text-henry-text-dim hover:text-henry-text transition-colors"
              >
                {crumb}
              </button>
            </span>
          ))}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* File list */}
        <div className="w-64 shrink-0 border-r border-henry-border/30 overflow-y-auto">
          {currentPath && (
            <button
              onClick={navigateUp}
              className="w-full flex items-center gap-2 px-4 py-2 text-xs text-henry-text-dim hover:bg-henry-hover/50 transition-colors"
            >
              <span>⬆️</span>
              <span>..</span>
            </button>
          )}

          {loading ? (
            <div className="p-4 text-xs text-henry-text-muted">Loading...</div>
          ) : error ? (
            <div className="p-4 text-xs text-henry-error">{error}</div>
          ) : entries.length === 0 ? (
            <div className="p-4 text-xs text-henry-text-muted">Empty directory</div>
          ) : (
            <div>
              {/* Directories first, then files */}
              {[...entries]
                .sort((a, b) => {
                  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
                  return a.name.localeCompare(b.name);
                })
                .map((entry) => (
                  <button
                    key={entry.path}
                    onClick={() => navigateToDirectory(entry)}
                    className={`w-full flex items-center gap-2 px-4 py-2 text-xs transition-colors ${
                      selectedFile === entry.path
                        ? 'bg-henry-accent/10 text-henry-accent'
                        : 'text-henry-text hover:bg-henry-hover/50'
                    }`}
                  >
                    <span className="text-sm">{getFileIcon(entry)}</span>
                    <span className="truncate">{entry.name}</span>
                    {entry.isDirectory && (
                      <span className="ml-auto text-henry-text-muted">→</span>
                    )}
                  </button>
                ))}
            </div>
          )}
        </div>

        {/* File content / editor */}
        <div className="flex-1 overflow-hidden">
          {selectedFile ? (
            <div className="h-full flex flex-col">
              {/* File tab */}
              <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-henry-surface/30 border-b border-henry-border/30">
                <span className="text-xs text-henry-text-dim">
                  {selectedFile.split('/').pop()}
                </span>
                {hasChanges && (
                  <span className="w-2 h-2 rounded-full bg-henry-accent" />
                )}
              </div>

              {/* Editor */}
              <div className="flex-1 overflow-auto">
                <CodeEditor
                  content={editedContent}
                  language={getLanguage(selectedFile)}
                  onChange={(value) => {
                    setEditedContent(value);
                    setHasChanges(value !== fileContent);
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="text-3xl mb-3">📂</div>
                <p className="text-sm text-henry-text-dim">
                  Select a file to view or edit
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
