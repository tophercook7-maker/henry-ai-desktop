import { useState, useEffect, useCallback } from 'react';
import {
  ghGetUser, ghListRepos, ghListIssues, ghListPRs, ghCreateIssue,
  isConnected,
  type GHUser, type GHRepo, type GHIssue, type GHPR,
} from '../../henry/integrations';
import { useStore } from '../../store';

type Tab = 'repos' | 'issues' | 'prs';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function priorityColor(p: number): string {
  if (p === 1) return 'text-henry-error';
  if (p === 2) return 'text-henry-warning';
  if (p === 3) return 'text-henry-accent';
  return 'text-henry-text-muted';
}

function priorityLabel(p: number): string {
  return ['', 'Urgent', 'High', 'Medium', 'Low', 'None'][p] || 'None';
}

export default function GitHubPanel() {
  const setCurrentView = useStore((s) => s.setCurrentView);
  const connected = isConnected('github');

  const [tab, setTab] = useState<Tab>('repos');
  const [user, setUser] = useState<GHUser | null>(null);
  const [repos, setRepos] = useState<GHRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<GHRepo | null>(null);
  const [issues, setIssues] = useState<GHIssue[]>([]);
  const [prs, setPRs] = useState<GHPR[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [issueFilter, setIssueFilter] = useState<'open' | 'closed'>('open');
  const [repoSearch, setRepoSearch] = useState('');

  // Create issue modal
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [creating2, setCreating2] = useState(false);

  const loadUser = useCallback(async () => {
    if (!connected) return;
    try {
      const u = await ghGetUser();
      setUser(u);
    } catch { /* ignore */ }
  }, [connected]);

  const loadRepos = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    setError('');
    try {
      const r = await ghListRepos(50);
      setRepos(r);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [connected]);

  const loadIssues = useCallback(async () => {
    if (!selectedRepo) return;
    setLoading(true);
    setError('');
    try {
      const all = await ghListIssues(selectedRepo.full_name, issueFilter, 50);
      setIssues(all.filter((i) => !i.pull_request));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedRepo, issueFilter]);

  const loadPRs = useCallback(async () => {
    if (!selectedRepo) return;
    setLoading(true);
    setError('');
    try {
      const p = await ghListPRs(selectedRepo.full_name, 'open');
      setPRs(p);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedRepo]);

  useEffect(() => { loadUser(); loadRepos(); }, [loadUser, loadRepos]);

  useEffect(() => {
    if (selectedRepo) {
      if (tab === 'issues') loadIssues();
      if (tab === 'prs') loadPRs();
    }
  }, [tab, selectedRepo, loadIssues, loadPRs]);

  async function createIssue() {
    if (!selectedRepo || !newTitle.trim()) return;
    setCreating2(true);
    try {
      await ghCreateIssue(selectedRepo.full_name, newTitle.trim(), newBody.trim());
      setCreating(false);
      setNewTitle('');
      setNewBody('');
      loadIssues();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating2(false);
    }
  }

  const filteredRepos = repos.filter((r) =>
    !repoSearch || r.name.toLowerCase().includes(repoSearch.toLowerCase())
  );

  if (!connected) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="text-5xl">🐙</div>
        <div>
          <h2 className="text-lg font-semibold text-henry-text mb-1">GitHub not connected</h2>
          <p className="text-sm text-henry-text-muted">Add your Personal Access Token to get started.</p>
        </div>
        <button
          onClick={() => setCurrentView('integrations' as any)}
          className="px-4 py-2 bg-henry-accent text-white rounded-xl text-sm font-semibold hover:bg-henry-accent/90 transition-colors"
        >
          Go to Integrations
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-henry-bg overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 pt-5 pb-3 border-b border-henry-border/30">
        <div className="flex items-center gap-3">
          <div className="text-2xl">🐙</div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold text-henry-text">GitHub</h1>
              {user && (
                <span className="text-xs text-henry-text-muted">@{user.login} · {user.public_repos} repos</span>
              )}
            </div>
          </div>
          <button
            onClick={() => { loadRepos(); }}
            className="p-1.5 rounded-lg text-henry-text-muted hover:text-henry-text hover:bg-henry-hover/50 transition-colors"
            title="Refresh"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          </button>
        </div>

        {/* Repo selector */}
        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              value={repoSearch}
              onChange={(e) => setRepoSearch(e.target.value)}
              placeholder="Search repos…"
              className="w-full bg-henry-surface/50 border border-henry-border/40 rounded-xl px-3 py-1.5 text-xs text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/50 pr-8"
            />
            {repoSearch && (
              <button onClick={() => setRepoSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-henry-text-muted hover:text-henry-text text-xs">✕</button>
            )}
          </div>
          {selectedRepo && (
            <button
              onClick={() => setSelectedRepo(null)}
              className="text-xs text-henry-accent hover:underline whitespace-nowrap"
            >
              ← All repos
            </button>
          )}
        </div>

        {/* Tabs — only show when a repo is selected */}
        {selectedRepo && (
          <div className="flex gap-1 mt-3">
            {(['repos', 'issues', 'prs'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  tab === t
                    ? 'bg-henry-accent/10 text-henry-accent border border-henry-accent/20'
                    : 'text-henry-text-muted hover:text-henry-text hover:bg-henry-hover/50'
                }`}
              >
                {t === 'repos' ? '← Repos' : t === 'issues' ? 'Issues' : 'Pull Requests'}
              </button>
            ))}
            {tab === 'issues' && (
              <div className="ml-auto flex gap-1">
                {(['open', 'closed'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setIssueFilter(f)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                      issueFilter === f
                        ? 'bg-henry-surface text-henry-text border border-henry-border/50'
                        : 'text-henry-text-muted hover:text-henry-text'
                    }`}
                  >
                    {f}
                  </button>
                ))}
                <button
                  onClick={() => setCreating(true)}
                  className="ml-1 px-3 py-1.5 bg-henry-accent text-white rounded-lg text-xs font-medium hover:bg-henry-accent/90 transition-colors flex items-center gap-1"
                >
                  <span>+</span> New issue
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="mx-4 mt-4 px-4 py-3 bg-henry-error/10 border border-henry-error/30 rounded-xl text-xs text-henry-error">
            {error}
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 rounded-full border-2 border-henry-accent/30 border-t-henry-accent animate-spin" />
          </div>
        )}

        {/* Repos list */}
        {!selectedRepo && !loading && (
          <div className="p-4 space-y-2">
            {filteredRepos.map((repo) => (
              <button
                key={repo.id}
                onClick={() => { setSelectedRepo(repo); setTab('issues'); }}
                className="w-full text-left flex items-center gap-3 p-3 rounded-2xl bg-henry-surface/40 hover:bg-henry-surface/70 border border-henry-border/20 transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-henry-text truncate">{repo.name}</span>
                    {repo.private && (
                      <span className="shrink-0 px-1.5 py-0.5 bg-henry-surface border border-henry-border/50 rounded text-[10px] text-henry-text-muted">
                        private
                      </span>
                    )}
                    {repo.language && (
                      <span className="shrink-0 text-[10px] text-henry-text-muted">{repo.language}</span>
                    )}
                  </div>
                  {repo.description && (
                    <p className="text-xs text-henry-text-muted mt-0.5 truncate">{repo.description}</p>
                  )}
                </div>
                <div className="shrink-0 flex items-center gap-3 text-[11px] text-henry-text-muted">
                  {repo.open_issues_count > 0 && (
                    <span className="flex items-center gap-1">
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      {repo.open_issues_count}
                    </span>
                  )}
                  <span>{timeAgo(repo.pushed_at)}</span>
                  <svg className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-henry-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </button>
            ))}
            {filteredRepos.length === 0 && !loading && (
              <div className="text-center py-12 text-henry-text-muted text-sm">
                {repoSearch ? 'No repos match that search.' : 'No repos found.'}
              </div>
            )}
          </div>
        )}

        {/* Issues */}
        {selectedRepo && tab === 'issues' && !loading && (
          <div className="p-4 space-y-2">
            {issues.map((issue) => (
              <a
                key={issue.id}
                href={issue.html_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-start gap-3 p-3 rounded-2xl bg-henry-surface/40 hover:bg-henry-surface/70 border border-henry-border/20 transition-colors"
              >
                <div className={`mt-0.5 shrink-0 w-4 h-4 rounded-full border-2 ${
                  issue.state === 'open' ? 'border-henry-success' : 'border-henry-text-muted'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-henry-text leading-snug">{issue.title}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <span className="text-[10px] text-henry-text-muted">#{issue.number}</span>
                    {issue.labels.slice(0, 3).map((l) => (
                      <span
                        key={l.name}
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                        style={{ background: `#${l.color}22`, color: `#${l.color}` }}
                      >
                        {l.name}
                      </span>
                    ))}
                    <span className="text-[10px] text-henry-text-muted ml-auto">{timeAgo(issue.updated_at)}</span>
                  </div>
                </div>
              </a>
            ))}
            {issues.length === 0 && (
              <div className="text-center py-12 text-henry-text-muted text-sm">
                No {issueFilter} issues in {selectedRepo.name}.
              </div>
            )}
          </div>
        )}

        {/* PRs */}
        {selectedRepo && tab === 'prs' && !loading && (
          <div className="p-4 space-y-2">
            {prs.map((pr) => (
              <a
                key={pr.id}
                href={pr.html_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-start gap-3 p-3 rounded-2xl bg-henry-surface/40 hover:bg-henry-surface/70 border border-henry-border/20 transition-colors"
              >
                <div className={`mt-0.5 shrink-0 ${pr.draft ? 'opacity-40' : ''}`}>
                  <svg className="w-4 h-4 text-henry-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" />
                    <path d="M13 6h3a2 2 0 012 2v7M6 9v12" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-henry-text leading-snug">{pr.title}</p>
                    {pr.draft && (
                      <span className="px-1.5 py-0.5 bg-henry-surface border border-henry-border/50 rounded text-[10px] text-henry-text-muted">
                        draft
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-henry-text-muted">#{pr.number}</span>
                    <span className="text-[10px] text-henry-text-muted">
                      {pr.head.ref} → {pr.base.ref}
                    </span>
                    <span className="text-[10px] text-henry-text-muted ml-auto">
                      @{pr.user.login} · {timeAgo(pr.created_at)}
                    </span>
                  </div>
                </div>
              </a>
            ))}
            {prs.length === 0 && (
              <div className="text-center py-12 text-henry-text-muted text-sm">
                No open pull requests in {selectedRepo.name}.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create issue modal */}
      {creating && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-henry-bg border border-henry-border/50 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-henry-text">New issue — {selectedRepo?.name}</h3>
              <button onClick={() => setCreating(false)} className="text-henry-text-muted hover:text-henry-text">✕</button>
            </div>
            <div className="space-y-3">
              <input
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Issue title"
                className="w-full bg-henry-surface border border-henry-border/50 rounded-xl px-3 py-2.5 text-sm text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/50"
              />
              <textarea
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                placeholder="Description (optional)"
                rows={4}
                className="w-full bg-henry-surface border border-henry-border/50 rounded-xl px-3 py-2.5 text-sm text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/50 resize-none"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={createIssue}
                disabled={!newTitle.trim() || creating2}
                className="flex-1 py-2.5 bg-henry-accent text-white rounded-xl text-sm font-semibold hover:bg-henry-accent/90 transition-colors disabled:opacity-50"
              >
                {creating2 ? 'Creating…' : 'Create Issue'}
              </button>
              <button
                onClick={() => setCreating(false)}
                className="px-4 py-2.5 bg-henry-surface border border-henry-border/50 text-henry-text-dim rounded-xl text-sm hover:bg-henry-hover/50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
