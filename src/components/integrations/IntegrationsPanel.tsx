import { useState } from 'react';
import {
  SERVICES,
  REPLIT_CONNECTED_SERVICES,
  type ServiceConfig,
} from '../../henry/integrations';
import {
  useConnectionStore,
  selectStatus,
} from '../../henry/connectionStore';
import { useStore } from '../../store';
import type { ConnectionStatus } from '../../connections/types/connectionTypes';

const CATEGORY_LABELS: Record<string, string> = {
  dev: 'Developer Tools',
  productivity: 'Productivity',
  finance: 'Finance',
};
const CATEGORY_ORDER = ['dev', 'productivity', 'finance'];

const HAS_PANEL = new Set([
  'github', 'linear', 'notion', 'slack',
  'gmail', 'gcal', 'gdrive', 'stripe',
]);

const GOOGLE_SERVICES = new Set(['gmail', 'gcal', 'gdrive']);

// ── Status pill ───────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: ConnectionStatus }) {
  if (status === 'connected') {
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium text-henry-success">
        <span className="w-1.5 h-1.5 rounded-full bg-henry-success" />
        Connected
      </span>
    );
  }
  if (status === 'expired') {
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium text-henry-warning">
        <span className="w-1.5 h-1.5 rounded-full bg-henry-warning animate-pulse" />
        Reconnect
      </span>
    );
  }
  return <span className="text-[11px] text-henry-text-muted">Not connected</span>;
}

// ── Connect modal ─────────────────────────────────────────────────────────────

function ConnectModal({
  svc,
  onClose,
}: {
  svc: ServiceConfig;
  onClose: () => void;
}) {
  const setCurrentView = useStore((s) => s.setCurrentView);
  const status = useConnectionStore(selectStatus(svc.id));
  const { connectService, disconnectService } = useConnectionStore();
  const isReplitOAuth = svc.connectionType === 'replit-oauth';
  const connected = status === 'connected';
  const expired = status === 'expired';

  const [draft, setDraft] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function save() {
    if (!draft.trim()) return;
    setSaving(true);
    setTimeout(() => {
      connectService(svc.id, draft.trim());
      setSaving(false);
      setSaved(true);
      setTimeout(() => onClose(), 600);
    }, 400);
  }

  function disconnect() {
    if (!confirm(`Disconnect ${svc.name}? Your saved key will be removed.`)) return;
    disconnectService(svc.id);
    onClose();
  }

  function openPanel() {
    setCurrentView(svc.id as any);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md bg-henry-bg border border-henry-border/50 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4">
          <div className="w-12 h-12 rounded-2xl bg-henry-surface/60 flex items-center justify-center text-2xl shrink-0">
            {svc.icon}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-henry-text">{svc.name}</h2>
            <StatusPill status={status} />
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-henry-text-muted hover:text-henry-text hover:bg-henry-hover/50 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="px-5 pb-5 space-y-4">
          <p className="text-sm text-henry-text-muted leading-relaxed">{svc.unlocks}</p>

          {/* Google OAuth — connected */}
          {isReplitOAuth && connected && (
            <div className="rounded-xl bg-henry-success/10 border border-henry-success/20 p-4 flex items-start gap-3">
              <span className="text-lg mt-0.5">✅</span>
              <div>
                <p className="text-sm font-medium text-henry-text">Google is connected</p>
                <p className="text-xs text-henry-text-muted mt-0.5">Gmail, Calendar, and Drive are all active.</p>
              </div>
            </div>
          )}

          {/* Google OAuth — expired */}
          {isReplitOAuth && expired && (
            <div className="rounded-xl bg-henry-warning/10 border border-henry-warning/25 p-4 flex items-start gap-3">
              <span className="text-lg mt-0.5">⚠️</span>
              <div>
                <p className="text-sm font-medium text-henry-text">Google access expired</p>
                <p className="text-xs text-henry-text-muted mt-0.5">Re-connect Google to restore Gmail, Calendar, and Drive.</p>
              </div>
            </div>
          )}

          {/* Google OAuth — not connected: send user to the panel */}
          {isReplitOAuth && !connected && !expired && (
            <div className="space-y-3">
              <div className="rounded-xl bg-henry-surface/40 border border-henry-border/30 p-4">
                <p className="text-xs text-henry-text-muted leading-relaxed">
                  One Google sign-in connects Gmail, Calendar, and Drive — all at once.
                </p>
              </div>
              <button
                onClick={openPanel}
                className="w-full py-3 bg-white text-gray-800 border border-gray-200 rounded-xl text-sm font-semibold hover:bg-gray-50 transition-colors flex items-center justify-center gap-2.5 shadow-sm"
              >
                <GoogleLogo />
                Connect with Google
              </button>
            </div>
          )}

          {/* API-key — connected */}
          {!isReplitOAuth && connected && (
            <div className="rounded-xl bg-henry-success/10 border border-henry-success/20 p-4 flex items-start gap-3">
              <span className="text-lg mt-0.5">✅</span>
              <div>
                <p className="text-sm font-medium text-henry-text">Connected</p>
                <p className="text-xs text-henry-text-muted mt-0.5">Your key is stored locally and never leaves this device.</p>
              </div>
            </div>
          )}

          {/* API-key — not connected */}
          {!isReplitOAuth && !connected && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-henry-text mb-1.5">{svc.keyLabel}</label>
                <input
                  autoFocus
                  type="password"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={svc.keyPlaceholder}
                  onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onClose(); }}
                  className="w-full bg-henry-surface border border-henry-border/50 rounded-xl px-3.5 py-2.5 text-sm text-henry-text font-mono placeholder-henry-text-muted outline-none focus:border-henry-accent/60 transition-colors"
                />
                <p className="text-xs text-henry-text-muted mt-1.5">Stored locally. Never sent anywhere except {svc.name}'s API.</p>
              </div>
              <button
                onClick={save}
                disabled={!draft.trim() || saving || saved}
                className="w-full py-2.5 bg-henry-accent text-white rounded-xl text-sm font-semibold hover:bg-henry-accent/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saved ? '✓ Connected' : saving ? 'Connecting…' : `Connect ${svc.name}`}
              </button>
              <a href={svc.docsUrl} target="_blank" rel="noreferrer" className="block text-center text-xs text-henry-accent/70 hover:text-henry-accent transition-colors">
                {svc.docsLabel} →
              </a>
            </div>
          )}

          {/* Actions when connected */}
          {connected && (
            <div className="flex gap-2">
              {HAS_PANEL.has(svc.id) && (
                <button onClick={openPanel} className="flex-1 py-2.5 bg-henry-accent text-white rounded-xl text-sm font-semibold hover:bg-henry-accent/90 transition-colors">
                  Open {svc.name}
                </button>
              )}
              {!isReplitOAuth && (
                <button onClick={disconnect} className="px-4 py-2.5 bg-henry-surface border border-henry-border/50 text-henry-text-dim rounded-xl text-sm hover:bg-henry-error/10 hover:border-henry-error/30 hover:text-henry-error transition-colors">
                  Disconnect
                </button>
              )}
            </div>
          )}

          {/* Google: reconnect or disconnect when expired */}
          {isReplitOAuth && (expired || connected) && (
            <div className="flex gap-2">
              {expired && (
                <button onClick={openPanel} className="flex-1 py-2.5 bg-henry-warning/10 text-henry-warning border border-henry-warning/25 rounded-xl text-sm font-semibold hover:bg-henry-warning/20 transition-colors">
                  Reconnect Google
                </button>
              )}
              {connected && (
                <button
                  onClick={() => { disconnectService(svc.id); onClose(); }}
                  className="px-4 py-2.5 bg-henry-surface border border-henry-border/50 text-henry-text-dim rounded-xl text-sm hover:bg-henry-error/10 hover:border-henry-error/30 hover:text-henry-error transition-colors"
                >
                  Disconnect
                </button>
              )}
            </div>
          )}

          {/* Advanced — API key services only */}
          {!isReplitOAuth && (
            <div>
              <button onClick={() => setShowAdvanced((v) => !v)} className="flex items-center gap-1.5 text-xs text-henry-text-muted hover:text-henry-text transition-colors">
                <svg className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                Advanced
              </button>

              {showAdvanced && (
                <div className="mt-3 space-y-2 pl-4 border-l border-henry-border/30">
                  <p className="text-[11px] text-henry-text-muted">
                    <span className="font-medium text-henry-text-dim">{svc.tokenLabel}.</span>{' '}
                    {svc.tokenHint}
                  </p>
                  {connected && (
                    <div className="space-y-2">
                      <label className="block text-[11px] font-medium text-henry-text-dim">Replace saved key</label>
                      <input
                        type="password"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={svc.keyPlaceholder}
                        onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
                        className="w-full bg-henry-bg border border-henry-border/40 rounded-lg px-3 py-2 text-xs text-henry-text font-mono placeholder-henry-text-muted outline-none focus:border-henry-accent/50 transition-colors"
                      />
                      <button onClick={save} disabled={!draft.trim() || saving || saved} className="px-4 py-1.5 bg-henry-surface border border-henry-border/50 text-henry-text-dim rounded-lg text-xs font-medium hover:bg-henry-hover/50 transition-colors disabled:opacity-50">
                        {saved ? '✓ Saved' : saving ? 'Saving…' : 'Update key'}
                      </button>
                    </div>
                  )}
                  <a href={svc.docsUrl} target="_blank" rel="noreferrer" className="block text-[11px] text-henry-accent/70 hover:text-henry-accent transition-colors">
                    {svc.docsLabel} →
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

// ── Service card ──────────────────────────────────────────────────────────────

function ServiceCard({
  svc,
  onOpen,
}: {
  svc: ServiceConfig;
  onOpen: () => void;
}) {
  const status = useConnectionStore(selectStatus(svc.id));
  const connected = status === 'connected';
  const expired = status === 'expired';
  const isReplitOAuth = svc.connectionType === 'replit-oauth';

  let primaryLabel = 'Connect';
  if (expired) primaryLabel = 'Reconnect';
  else if (connected && HAS_PANEL.has(svc.id)) primaryLabel = 'Open';
  else if (connected) primaryLabel = 'Manage';

  return (
    <div className={`rounded-2xl border transition-all ${
      connected
        ? 'bg-henry-surface/50 border-henry-accent/20'
        : expired
        ? 'bg-henry-warning/5 border-henry-warning/25'
        : 'bg-henry-surface/20 border-henry-border/30 hover:border-henry-border/50'
    }`}>
      <div className="flex items-center gap-3 p-4">
        <div className="w-10 h-10 rounded-xl bg-henry-bg/60 flex items-center justify-center text-xl shrink-0">
          {svc.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-henry-text">{svc.name}</span>
            <StatusPill status={status} />
          </div>
          <p className="text-xs text-henry-text-muted mt-0.5 truncate">{svc.description}</p>
        </div>
        <button
          onClick={onOpen}
          className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            connected
              ? 'bg-henry-accent/10 text-henry-accent border border-henry-accent/20 hover:bg-henry-accent/20'
              : expired
              ? 'bg-henry-warning/10 text-henry-warning border border-henry-warning/25 hover:bg-henry-warning/20'
              : 'bg-henry-surface border border-henry-border/50 text-henry-text hover:bg-henry-hover/50'
          }`}
        >
          {primaryLabel}
        </button>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function IntegrationsPanel() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const connections = useConnectionStore((s) => s.connections);

  const activeService = activeId ? SERVICES.find((s) => s.id === activeId) ?? null : null;

  const connectedServices = SERVICES.filter((s) => {
    const key = GOOGLE_SERVICES.has(s.id) ? 'google' : s.id;
    return connections[key]?.status === 'connected';
  });

  const grouped = CATEGORY_ORDER.map((cat) => ({
    cat,
    services: SERVICES.filter((s) => s.category === cat),
  }));

  return (
    <div className="h-full flex flex-col bg-henry-bg overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-henry-border/30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-henry-accent/10 flex items-center justify-center text-xl">🔌</div>
          <div>
            <h1 className="text-lg font-semibold text-henry-text">Integrations</h1>
            <p className="text-xs text-henry-text-muted">
              {connectedServices.length === 0
                ? 'Connect your accounts to get more out of Henry'
                : `${connectedServices.length} account${connectedServices.length !== 1 ? 's' : ''} connected`}
            </p>
          </div>
        </div>
      </div>

      {/* Service list */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8">

        {/* Connected quick-access tiles */}
        {connectedServices.length > 0 && (
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-henry-text-muted mb-3">
              Your connected apps
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {connectedServices.filter((s) => HAS_PANEL.has(s.id)).map((svc) => {
                const feedLabel: Record<string, string> = {
                  github: 'Repos, issues & PRs',
                  slack: 'Channels & messages',
                  notion: 'Pages & databases',
                  linear: 'Issues & projects',
                  gmail: 'Inbox & threads',
                  gcal: 'Schedule & events',
                  gdrive: 'Files & documents',
                  stripe: 'Balance & charges',
                };
                return (
                  <button
                    key={svc.id}
                    onClick={() => useStore.getState().setCurrentView(svc.id as any)}
                    className="flex items-center gap-3 p-3 rounded-xl bg-henry-surface/30 border border-henry-accent/15 hover:border-henry-accent/30 hover:bg-henry-surface/50 transition-colors text-left group"
                  >
                    <div className="w-9 h-9 rounded-xl bg-henry-bg/60 flex items-center justify-center text-lg shrink-0">{svc.icon}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-henry-text">{svc.name}</p>
                      <p className="text-[10px] text-henry-text-muted">{feedLabel[svc.id] || 'View feed'}</p>
                    </div>
                    <svg className="w-3.5 h-3.5 text-henry-accent/50 group-hover:text-henry-accent shrink-0 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Grouped service cards */}
        {grouped.map(({ cat, services }) => (
          <div key={cat}>
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-henry-text-muted mb-3">
              {CATEGORY_LABELS[cat]}
            </h2>
            <div className="space-y-2">
              {services.map((svc) => (
                <ServiceCard key={svc.id} svc={svc} onOpen={() => setActiveId(svc.id)} />
              ))}
            </div>
          </div>
        ))}

        <div className="rounded-2xl bg-henry-surface/20 border border-henry-border/20 p-4">
          <p className="text-xs text-henry-text-muted leading-relaxed">
            Your keys are stored locally on this device and never leave your machine. They are used only to call each service's API directly.
          </p>
        </div>
      </div>

      {/* Modal */}
      {activeService && (
        <ConnectModal
          svc={activeService}
          onClose={() => setActiveId(null)}
        />
      )}
    </div>
  );
}
