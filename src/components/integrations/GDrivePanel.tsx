import { useState, useEffect } from 'react';
import { driveListFiles, type DriveFile } from '../../henry/integrations';
import { useConnectionStore, selectStatus } from '../../henry/connectionStore';
import { useStore } from '../../store';
import ConnectScreen from './ConnectScreen';

const MIME_ICON: Record<string, string> = {
  'application/vnd.google-apps.document': '📝',
  'application/vnd.google-apps.spreadsheet': '📊',
  'application/vnd.google-apps.presentation': '📽️',
  'application/vnd.google-apps.folder': '📁',
  'application/pdf': '📄',
  'image/jpeg': '🖼️',
  'image/png': '🖼️',
  'video/mp4': '🎬',
};

const MIME_LABEL: Record<string, string> = {
  'application/vnd.google-apps.document': 'Doc',
  'application/vnd.google-apps.spreadsheet': 'Sheet',
  'application/vnd.google-apps.presentation': 'Slides',
  'application/vnd.google-apps.folder': 'Folder',
  'application/pdf': 'PDF',
};

function fileIcon(mimeType: string): string {
  return MIME_ICON[mimeType] || '📄';
}

function fileLabel(mimeType: string): string {
  return MIME_LABEL[mimeType] || mimeType.split('/').pop() || 'File';
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function GDrivePanel() {
  const status = useConnectionStore(selectStatus('gdrive'));
  const profile = useConnectionStore((s) => s.getGoogleProfile());
  const { markExpired } = useConnectionStore();
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (status === 'connected') load();
    else setFiles([]);
  }, [status]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await driveListFiles(30);
      setFiles(data);
    } catch (e: any) {
      if (e.message?.includes('reconnected')) { markExpired('gdrive'); return; }
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (status !== 'connected') return <ConnectScreen serviceId="gdrive" />;

  const filtered = search.trim()
    ? files.filter((f) => f.name.toLowerCase().includes(search.toLowerCase()))
    : files;

  return (
    <div className="h-full flex flex-col bg-henry-bg overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 pt-5 pb-3 border-b border-henry-border/30">
        <div className="flex items-center gap-3 mb-3">
          <div className="text-2xl">📁</div>
          <div className="flex-1">
            <h1 className="text-base font-semibold text-henry-text">Google Drive</h1>
            <p className="text-xs text-henry-text-muted">
              {loading ? 'Loading…' : `${files.length} recent files`}
              {profile?.email && <span className="ml-2 opacity-60">· {profile.email}</span>}
            </p>
          </div>
          <button onClick={load} disabled={loading} className="p-1.5 rounded-lg text-henry-text-muted hover:text-henry-text hover:bg-henry-hover/50 transition-colors" title="Refresh">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          </button>
        </div>

        <div className="flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter files…"
            className="flex-1 bg-henry-surface/50 border border-henry-border/40 rounded-xl px-3 py-2 text-sm text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/50 transition-colors"
          />
          {search && (
            <button onClick={() => setSearch('')} className="px-3 py-2 text-xs text-henry-text-muted border border-henry-border/40 rounded-xl hover:bg-henry-hover/50">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {error && (
          <div className="px-4 py-3 bg-henry-error/10 border border-henry-error/30 rounded-xl text-xs text-henry-error">
            {error}
            <button onClick={load} className="block mt-1 text-henry-accent underline">Try again</button>
          </div>
        )}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 rounded-full border-2 border-henry-accent/30 border-t-henry-accent animate-spin" />
          </div>
        )}

        {!loading && filtered.length === 0 && !error && (
          <div className="text-center py-12 text-henry-text-muted text-sm">
            {search ? 'No files match that search.' : 'No recent files found.'}
          </div>
        )}

        {!loading && filtered.map((file) => (
          <FileRow key={file.id} file={file} />
        ))}
      </div>
    </div>
  );
}

function FileRow({ file }: { file: DriveFile }) {
  const setCurrentView = useStore((s) => s.setCurrentView);

  function askHenry(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const prompt = `Tell me about this file from my Google Drive:\n\nName: ${file.name}\nType: ${fileLabel(file.mimeType)}\nLast modified: ${new Date(file.modifiedTime).toLocaleDateString()}\n\nWhat would you expect this file to contain, and what are some useful questions I could ask about it?`;
    window.dispatchEvent(new CustomEvent('henry_mode_launch', { detail: { mode: 'scholar', prompt } }));
    setCurrentView('chat');
  }

  return (
    <div className="group flex items-center gap-3 p-3 rounded-2xl bg-henry-surface/40 hover:bg-henry-surface/70 border border-henry-border/20 transition-colors">
      <div className="shrink-0 w-8 h-8 rounded-lg bg-henry-bg/60 flex items-center justify-center text-lg">
        {fileIcon(file.mimeType)}
      </div>
      <div className="flex-1 min-w-0">
        <a href={file.webViewLink} target="_blank" rel="noreferrer" className="block">
          <p className="text-sm text-henry-text font-medium truncate hover:underline">{file.name}</p>
        </a>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-henry-text-muted">{fileLabel(file.mimeType)}</span>
          <span className="text-[10px] text-henry-text-muted/60">·</span>
          <span className="text-[10px] text-henry-text-muted">{timeAgo(file.modifiedTime)}</span>
          {file.owners?.[0] && (
            <>
              <span className="text-[10px] text-henry-text-muted/60">·</span>
              <span className="text-[10px] text-henry-text-muted truncate">{file.owners[0].displayName}</span>
            </>
          )}
        </div>
      </div>
      <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={askHenry}
          className="px-2.5 py-1 text-[11px] font-medium bg-henry-accent/10 text-henry-accent border border-henry-accent/20 rounded-lg hover:bg-henry-accent/20 transition-colors"
          title="Ask Henry about this file"
        >
          Ask Henry
        </button>
        <a
          href={file.webViewLink}
          target="_blank"
          rel="noreferrer"
          className="p-1.5 text-henry-text-muted hover:text-henry-text rounded-lg hover:bg-henry-hover/50 transition-colors"
          title="Open in Drive"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
            <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      </div>
    </div>
  );
}
