import { useState, useEffect } from 'react';
import { linearGetMyIssues, isConnected, type LinearIssue } from '../../henry/integrations';
import ConnectPrompt from './ConnectPrompt';

function priorityIcon(p: number): string {
  return ['', '🔴', '🟠', '🔵', '⚪', '⚪'][p] || '⚪';
}

function priorityLabel(p: number): string {
  return ['', 'Urgent', 'High', 'Medium', 'Low', 'No priority'][p] || 'No priority';
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function LinearPanel() {
  const [connected, setConnected] = useState(isConnected('linear'));

  const [issues, setIssues] = useState<LinearIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'urgent' | 'high'>('all');

  useEffect(() => {
    if (!connected) return;
    load();
  }, [connected]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await linearGetMyIssues();
      setIssues(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (!connected) {
    return (
      <ConnectPrompt
        serviceId="linear"
        icon="🔷"
        name="Linear"
        unlocks="See all issues assigned to you, filtered by priority, grouped by team."
        steps={[
          'Go to linear.app/settings/api',
          'Click "Create key", give it a label, and copy the key (starts with lin_api_)',
          'Paste it below',
        ]}
        tokenLabel="Linear API Key"
        tokenPlaceholder="lin_api_…"
        docsUrl="https://linear.app/settings/api"
        docsLabel="Open Linear API settings →"
        onConnected={() => setConnected(true)}
      />
    );
  }

  const filtered = issues.filter((i) => {
    if (filter === 'urgent') return i.priority === 1;
    if (filter === 'high') return i.priority <= 2;
    return true;
  });

  const byTeam = filtered.reduce<Record<string, LinearIssue[]>>((acc, i) => {
    const team = i.team.name;
    if (!acc[team]) acc[team] = [];
    acc[team].push(i);
    return acc;
  }, {});

  return (
    <div className="h-full flex flex-col bg-henry-bg overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 pt-5 pb-3 border-b border-henry-border/30">
        <div className="flex items-center gap-3">
          <div className="text-2xl">🔷</div>
          <div className="flex-1">
            <h1 className="text-base font-semibold text-henry-text">Linear</h1>
            <p className="text-xs text-henry-text-muted">
              {loading ? 'Loading…' : `${issues.length} issue${issues.length !== 1 ? 's' : ''} assigned to you`}
            </p>
          </div>
          <button
            onClick={load}
            className="p-1.5 rounded-lg text-henry-text-muted hover:text-henry-text hover:bg-henry-hover/50 transition-colors"
            title="Refresh"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          </button>
        </div>

        {/* Filters */}
        <div className="flex gap-1.5 mt-3">
          {(['all', 'urgent', 'high'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === f
                  ? 'bg-henry-accent/10 text-henry-accent border border-henry-accent/20'
                  : 'text-henry-text-muted hover:text-henry-text hover:bg-henry-hover/50'
              }`}
            >
              {f === 'all' ? 'All' : f === 'urgent' ? '🔴 Urgent' : '🟠 High+'}
            </button>
          ))}
          <span className="ml-auto text-xs text-henry-text-muted self-center">{filtered.length} shown</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
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

        {!loading && Object.keys(byTeam).length === 0 && (
          <div className="text-center py-12 text-henry-text-muted text-sm">
            No issues assigned to you right now.
          </div>
        )}

        {!loading && Object.entries(byTeam).map(([team, teamIssues]) => (
          <div key={team}>
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-henry-text-muted mb-2">{team}</h2>
            <div className="space-y-2">
              {teamIssues.map((issue) => (
                <a
                  key={issue.id}
                  href={issue.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-start gap-3 p-3 rounded-2xl bg-henry-surface/40 hover:bg-henry-surface/70 border border-henry-border/20 transition-colors"
                >
                  {/* State dot */}
                  <div
                    className="mt-1 shrink-0 w-3.5 h-3.5 rounded-full border-2"
                    style={{ borderColor: issue.state.color || '#888' }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-henry-text leading-snug">{issue.title}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="text-[10px]">{priorityIcon(issue.priority)}</span>
                      <span className="text-[10px] text-henry-text-muted">{priorityLabel(issue.priority)}</span>
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                        style={{ background: `${issue.state.color}22`, color: issue.state.color }}
                      >
                        {issue.state.name}
                      </span>
                      {issue.labels.nodes.slice(0, 2).map((l) => (
                        <span
                          key={l.name}
                          className="px-1.5 py-0.5 rounded text-[10px]"
                          style={{ background: `${l.color}22`, color: l.color }}
                        >
                          {l.name}
                        </span>
                      ))}
                      <span className="text-[10px] text-henry-text-muted ml-auto">{timeAgo(issue.updatedAt)}</span>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
