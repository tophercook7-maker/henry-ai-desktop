/**
 * Henry Workspace Indexer — background scan of workspace files for Henry context.
 * Lightweight: stores file names, sizes, and first 500 chars of content.
 */

export interface WorkspaceFileEntry {
  path: string;
  name: string;
  ext: string;
  size: number;
  preview: string;
  indexedAt: string;
}

export interface WorkspaceIndex {
  rootPath: string;
  files: WorkspaceFileEntry[];
  indexedAt: string;
  totalFiles: number;
}

const INDEX_KEY = 'henry:workspace_index';
const CODE_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h',
  'css', 'scss', 'html', 'json', 'yaml', 'yml', 'toml', 'md', 'txt', 'sh',
  'swift', 'kt', 'rb', 'php', 'sql', 'graphql',
]);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', 'target']);

function getExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

function shouldIndex(name: string): boolean {
  if (SKIP_DIRS.has(name)) return false;
  const ext = getExt(name);
  return CODE_EXTS.has(ext) || ext === '';
}

export async function indexWorkspace(rootPath?: string): Promise<WorkspaceIndex> {
  const entries: WorkspaceFileEntry[] = [];

  async function scanDir(dirPath: string, depth = 0) {
    if (depth > 4) return;
    try {
      const result = await window.henryAPI.readDirectory(dirPath);
      for (const entry of result.entries) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (entry.isDirectory) {
          await scanDir(entry.path, depth + 1);
        } else {
          const ext = getExt(entry.name);
          if (!shouldIndex(entry.name) && !CODE_EXTS.has(ext)) continue;
          try {
            const content = await window.henryAPI.readFile(entry.path);
            entries.push({
              path: entry.path,
              name: entry.name,
              ext,
              size: content.length,
              preview: content.slice(0, 500),
              indexedAt: new Date().toISOString(),
            });
          } catch {
            entries.push({
              path: entry.path,
              name: entry.name,
              ext,
              size: 0,
              preview: '',
              indexedAt: new Date().toISOString(),
            });
          }
          if (entries.length >= 200) return;
        }
      }
    } catch {
      // dir unreadable
    }
  }

  const root = rootPath || '/workspace';
  await scanDir(root);

  const index: WorkspaceIndex = {
    rootPath: root,
    files: entries,
    indexedAt: new Date().toISOString(),
    totalFiles: entries.length,
  };

  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    // storage full, trim
    const trimmed = { ...index, files: entries.slice(0, 50) };
    localStorage.setItem(INDEX_KEY, JSON.stringify(trimmed));
  }

  return index;
}

export function getWorkspaceIndex(): WorkspaceIndex | null {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as WorkspaceIndex) : null;
  } catch {
    return null;
  }
}

export function buildWorkspaceContextSummary(index: WorkspaceIndex | null): string {
  if (!index || index.files.length === 0) return '';

  const byExt: Record<string, number> = {};
  for (const f of index.files) {
    byExt[f.ext || 'other'] = (byExt[f.ext || 'other'] || 0) + 1;
  }

  const extSummary = Object.entries(byExt)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([ext, n]) => `${ext}(${n})`)
    .join(', ');

  const recent = index.files.slice(0, 10).map((f) => f.path).join(', ');

  return `Workspace index (${index.totalFiles} files, indexed ${new Date(index.indexedAt).toLocaleTimeString()}):
File types: ${extSummary}
Recent files: ${recent}`;
}
