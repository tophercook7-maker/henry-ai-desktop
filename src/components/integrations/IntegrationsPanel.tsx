import { useState } from 'react';
import { SERVICES, REPLIT_CONNECTED_SERVICES, getToken, setToken, removeToken, isConnected, type ServiceConfig } from '../../henry/integrations';
import { useStore } from '../../store';

const CATEGORY_LABELS: Record<string, string> = {
  dev: 'Developer Tools',
  productivity: 'Productivity',
  finance: 'Finance',
};

const CATEGORY_ORDER = ['dev', 'productivity', 'finance'];

export default function IntegrationsPanel() {
  const setCurrentView = useStore((s) => s.setCurrentView);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tokenDraft, setTokenDraft] = useState('');
  const [, forceUpdate] = useState(0);
  const refresh = () => forceUpdate((n) => n + 1);

  function startEdit(svc: ServiceConfig) {
    setEditingId(svc.id);
    setTokenDraft(getToken(svc.id));
  }

  function saveToken(id: string) {
    setToken(id, tokenDraft);
    setEditingId(null);
    refresh();
  }

  function disconnect(id: string) {
    if (confirm('Disconnect this service? Your token will be removed.')) {
      removeToken(id);
      refresh();
    }
  }

  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    services: SERVICES.filter((s) => s.category === cat),
  }));

  const connected = SERVICES.filter((s) => isConnected(s.id));

  return (
    <div className="h-full flex flex-col bg-henry-bg overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-henry-border/30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-henry-accent/10 flex items-center justify-center text-xl">🔌</div>
          <div>
            <h1 className="text-lg font-semibold text-henry-text">Integrations</h1>
            <p className="text-xs text-henry-text-muted">
              {connected.length === 0
                ? 'No services connected yet'
                : `${connected.length} service${connected.length !== 1 ? 's' : ''} connected`}
            </p>
          </div>
        </div>

        {/* Connected quick-nav */}
        {connected.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4">
            {connected.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  if (s.id === 'github') setCurrentView('github' as any);
                  else if (s.id === 'linear') setCurrentView('linear' as any);
                  else if (s.id === 'notion') setCurrentView('notion' as any);
                  else if (s.id === 'slack') setCurrentView('slack' as any);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-henry-accent/10 text-henry-accent rounded-full text-xs font-medium border border-henry-accent/20 hover:bg-henry-accent/20 transition-colors"
              >
                <span>{s.icon}</span>
                <span>Open {s.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Service list */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {grouped.map(({ cat, services }) => (
          <div key={cat}>
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-henry-text-muted mb-3">
              {CATEGORY_LABELS[cat]}
            </h2>
            <div className="space-y-3">
              {services.map((svc) => {
                const connected = isConnected(svc.id);
                const editing = editingId === svc.id;
                return (
                  <div
                    key={svc.id}
                    className={`rounded-2xl border transition-all ${
                      connected
                        ? 'bg-henry-surface/60 border-henry-accent/20'
                        : 'bg-henry-surface/30 border-henry-border/30'
                    }`}
                  >
                    <div className="flex items-center gap-3 p-4">
                      <div className="w-10 h-10 rounded-xl bg-henry-bg/50 flex items-center justify-center text-xl shrink-0">
                        {svc.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-henry-text">{svc.name}</span>
                          {connected && (
                            <span className="flex items-center gap-1 text-[10px] text-henry-success font-medium">
                              <span className="w-1.5 h-1.5 rounded-full bg-henry-success" />
                              Connected
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-henry-text-muted mt-0.5">{svc.description}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {/* Replit OAuth-managed service — always connected, show Open only */}
                        {connected && REPLIT_CONNECTED_SERVICES.has(svc.id) && (
                          <>
                            <span className="text-[10px] text-henry-text-muted bg-henry-surface/60 border border-henry-border/30 rounded-full px-2 py-1">
                              via Replit
                            </span>
                            <button
                              onClick={() => setCurrentView(svc.id as any)}
                              className="px-3 py-1.5 bg-henry-accent/10 text-henry-accent rounded-lg text-xs font-medium hover:bg-henry-accent/20 transition-colors border border-henry-accent/20"
                            >
                              Open
                            </button>
                          </>
                        )}
                        {/* Manual token service — show Open + edit + disconnect when connected */}
                        {connected && !editing && !REPLIT_CONNECTED_SERVICES.has(svc.id) && (
                          <>
                            {(svc.id === 'github' || svc.id === 'linear' || svc.id === 'notion') && (
                              <button
                                onClick={() => setCurrentView(svc.id as any)}
                                className="px-3 py-1.5 bg-henry-accent/10 text-henry-accent rounded-lg text-xs font-medium hover:bg-henry-accent/20 transition-colors border border-henry-accent/20"
                              >
                                Open
                              </button>
                            )}
                            <button
                              onClick={() => startEdit(svc)}
                              className="p-1.5 text-henry-text-muted hover:text-henry-text transition-colors rounded-lg hover:bg-henry-hover/50"
                              title="Edit token"
                            >
                              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => disconnect(svc.id)}
                              className="p-1.5 text-henry-text-muted hover:text-henry-error transition-colors rounded-lg hover:bg-henry-error/10"
                              title="Disconnect"
                            >
                              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </>
                        )}
                        {!connected && !editing && !REPLIT_CONNECTED_SERVICES.has(svc.id) && (
                          <button
                            onClick={() => startEdit(svc)}
                            className="px-3 py-1.5 bg-henry-surface border border-henry-border/50 text-henry-text rounded-lg text-xs font-medium hover:bg-henry-hover/50 transition-colors"
                          >
                            Connect
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Token editor — only for manual-token services */}
                    {editing && !REPLIT_CONNECTED_SERVICES.has(svc.id) && (
                      <div className="px-4 pb-4 space-y-3">
                        <div className="h-px bg-henry-border/30" />
                        <div>
                          <label className="block text-[11px] font-medium text-henry-text-dim mb-1.5">
                            {svc.tokenLabel}
                          </label>
                          <input
                            autoFocus
                            type="password"
                            value={tokenDraft}
                            onChange={(e) => setTokenDraft(e.target.value)}
                            placeholder={`Paste your ${svc.tokenLabel.toLowerCase()}…`}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveToken(svc.id);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            className="w-full bg-henry-bg border border-henry-border/50 rounded-xl px-3 py-2.5 text-sm text-henry-text font-mono placeholder-henry-text-muted outline-none focus:border-henry-accent/50 transition-colors"
                          />
                          <p className="text-[11px] text-henry-text-muted mt-1.5">{svc.tokenHint}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => saveToken(svc.id)}
                            className="px-4 py-2 bg-henry-accent text-white rounded-xl text-xs font-semibold hover:bg-henry-accent/90 transition-colors"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-4 py-2 bg-henry-surface border border-henry-border/50 text-henry-text-dim rounded-xl text-xs font-medium hover:bg-henry-hover/50 transition-colors"
                          >
                            Cancel
                          </button>
                          <a
                            href={svc.docsUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-auto text-xs text-henry-accent/70 hover:text-henry-accent transition-colors"
                          >
                            Get token →
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Info footer */}
        <div className="rounded-2xl bg-henry-surface/30 border border-henry-border/20 p-4">
          <p className="text-xs text-henry-text-muted leading-relaxed">
            Tokens are stored locally on your device and never leave your machine. They are used only to call each service's API directly.
          </p>
        </div>
      </div>
    </div>
  );
}
