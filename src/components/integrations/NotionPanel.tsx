import { useState, useEffect } from 'react';
import { notionSearch, isConnected, type NotionPage } from '../../henry/integrations';
import ConnectPrompt from './ConnectPrompt';

function getTitle(page: NotionPage): string {
  const props = page.properties;
  for (const key of Object.keys(props)) {
    const p = props[key];
    if (p.type === 'title' && p.title && p.title.length > 0) {
      return p.title.map((t) => t.plain_text).join('');
    }
  }
  return 'Untitled';
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function NotionPanel() {
  const [connected, setConnected] = useState(isConnected('notion'));

  const [pages, setPages] = useState<NotionPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (connected) load('');
  }, [connected]);

  async function load(q: string) {
    setLoading(true);
    setError('');
    try {
      const data = await notionSearch(q);
      setPages(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    load(query);
  }

  if (!connected) {
    return (
      <ConnectPrompt
        serviceId="notion"
        icon="📄"
        name="Notion"
        unlocks="Search and read your Notion pages and databases directly from Henry."
        steps={[
          'Go to notion.so/my-integrations and click "New integration"',
          'Give it a name and select your workspace',
          'Copy the Internal Integration Token (starts with secret_)',
          'In each Notion page you want Henry to access, click Share → Invite your integration',
          'Paste the token below',
        ]}
        tokenLabel="Notion Integration Token"
        tokenPlaceholder="secret_…"
        docsUrl="https://www.notion.so/my-integrations"
        docsLabel="Open Notion integrations →"
        onConnected={() => setConnected(true)}
      />
    );
  }

  return (
    <div className="h-full flex flex-col bg-henry-bg overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 pt-5 pb-3 border-b border-henry-border/30">
        <div className="flex items-center gap-3 mb-3">
          <div className="text-2xl">📄</div>
          <div className="flex-1">
            <h1 className="text-base font-semibold text-henry-text">Notion</h1>
            <p className="text-xs text-henry-text-muted">
              {loading ? 'Searching…' : `${pages.length} pages`}
            </p>
          </div>
          <button
            onClick={() => load(query)}
            className="p-1.5 rounded-lg text-henry-text-muted hover:text-henry-text hover:bg-henry-hover/50 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages…"
            className="flex-1 bg-henry-surface/50 border border-henry-border/40 rounded-xl px-3 py-2 text-sm text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/50 transition-colors"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-henry-accent/10 text-henry-accent rounded-xl text-sm font-medium border border-henry-accent/20 hover:bg-henry-accent/20 transition-colors"
          >
            Search
          </button>
        </form>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {error && (
          <div className="px-4 py-3 bg-henry-error/10 border border-henry-error/30 rounded-xl text-xs text-henry-error">
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 rounded-full border-2 border-henry-accent/30 border-t-henry-accent animate-spin" />
          </div>
        )}

        {!loading && pages.length === 0 && (
          <div className="text-center py-12 text-henry-text-muted text-sm">
            {query ? 'No pages match that search.' : 'No pages found. Make sure your integration has been shared with your pages.'}
          </div>
        )}

        {!loading && pages.map((page) => {
          const title = getTitle(page);
          return (
            <a
              key={page.id}
              href={page.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 p-3 rounded-2xl bg-henry-surface/40 hover:bg-henry-surface/70 border border-henry-border/20 transition-colors"
            >
              <div className="w-8 h-8 rounded-lg bg-henry-bg/50 flex items-center justify-center text-base shrink-0">
                📄
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-henry-text font-medium truncate">{title || 'Untitled'}</p>
                <p className="text-[10px] text-henry-text-muted mt-0.5">
                  Edited {timeAgo(page.last_edited_time)}
                </p>
              </div>
              <svg className="w-3.5 h-3.5 text-henry-text-muted shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          );
        })}
      </div>
    </div>
  );
}
