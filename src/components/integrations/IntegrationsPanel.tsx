import { useState } from 'react';
import {
  SERVICES,
  REPLIT_CONNECTED_SERVICES,
  getToken,
  setToken,
  removeToken,
  isConnected,
  type ServiceConfig,
} from '../../henry/integrations';
import { useStore } from '../../store';

const CATEGORY_LABELS: Record<string, string> = {
  dev: 'Developer Tools',
  productivity: 'Productivity',
  finance: 'Finance',
};
const CATEGORY_ORDER = ['dev', 'productivity', 'finance'];

const HAS_PANEL = new Set(['github', 'linear', 'notion', 'slack']);

function StatusPill({ connected }: { connected: boolean }) {
  if (connected) {
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium text-henry-success">
        <span className="w-1.5 h-1.5 rounded-full bg-henry-success" />
        Connected
      </span>
    );
  }
  return (
    <span className="text-[11px] text-henry-text-muted">Not connected</span>
  );
}

function ConnectModal({
  svc,
  onClose,
  onSaved,
}: {
  svc: ServiceConfig;
  onClose: () => void;
  onSaved: () => void;
}) {
  const setCurrentView = useStore((s) => s.setCurrentView);
  const connected = isConnected(svc.id);
  const isReplitOAuth = svc.connectionType === 'replit-oauth';

  const [draft, setDraft] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function save() {
    if (!draft.trim()) return;
    setSaving(true);
    setToken(svc.id, draft.trim());
    setTimeout(() => {
      setSaving(false);
      setSaved(true);
      setTimeout(() => {
        onSaved();
        onClose();
      }, 600);
    }, 400);
  }

  function disconnect() {
    if (!confirm(`Disconnect ${svc.name}? Your saved key will be removed.`)) return;
    removeToken(svc.id);
    onSaved();
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
            <StatusPill connected={connected} />
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
          {/* What this unlocks */}
          <p className="text-sm text-henry-text-muted leading-relaxed">{svc.unlocks}</p>

          {/* Replit-OAuth: already connected via Replit */}
          {isReplitOAuth && (
            <div className="rounded-xl bg-henry-success/10 border border-henry-success/20 p-4 flex items-start gap-3">
              <span className="text-lg mt-0.5">✅</span>
              <div>
                <p className="text-sm font-medium text-henry-text">Connected to your workspace</p>
                <p className="text-xs text-henry-text-muted mt-0.5">
                  {svc.name} is connected and ready to use.
                </p>
              </div>
            </div>
          )}

          {/* API-key: connected state */}
          {!isReplitOAuth && connected && (
            <div className="rounded-xl bg-henry-success/10 border border-henry-success/20 p-4 flex items-start gap-3">
              <span className="text-lg mt-0.5">✅</span>
              <div>
                <p className="text-sm font-medium text-henry-text">Your account is connected</p>
                <p className="text-xs text-henry-text-muted mt-0.5">
                  Henry will save your key locally on this device.
                </p>
              </div>
            </div>
          )}

          {/* API-key: not connected — friendly form */}
          {!isReplitOAuth && !connected && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-henry-text mb-1.5">
                  {svc.keyLabel}
                </label>
                <input
                  autoFocus
                  type="password"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={svc.keyPlaceholder}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') save();
                    if (e.key === 'Escape') onClose();
                  }}
                  className="w-full bg-henry-surface border border-henry-border/50 rounded-xl px-3.5 py-2.5 text-sm text-henry-text font-mono placeholder-henry-text-muted outline-none focus:border-henry-accent/60 transition-colors"
                />
                <p className="text-xs text-henry-text-muted mt-1.5">
                  Stored locally on your device. Never sent anywhere except {svc.name}'s API.
                </p>
              </div>

              <button
                onClick={save}
                disabled={!draft.trim() || saving || saved}
                className="w-full py-2.5 bg-henry-accent text-white rounded-xl text-sm font-semibold hover:bg-henry-accent/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saved ? '✓ Connected' : saving ? 'Connecting…' : `Connect ${svc.name}`}
              </button>

              <a
                href={svc.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="block text-center text-xs text-henry-accent/70 hover:text-henry-accent transition-colors"
              >
                {svc.docsLabel} →
              </a>
            </div>
          )}

          {/* Actions when connected */}
          {connected && (
            <div className="flex gap-2">
              {HAS_PANEL.has(svc.id) && (
                <button
                  onClick={openPanel}
                  className="flex-1 py-2.5 bg-henry-accent text-white rounded-xl text-sm font-semibold hover:bg-henry-accent/90 transition-colors"
                >
                  Open {svc.name}
                </button>
              )}
              {!isReplitOAuth && (
                <button
                  onClick={disconnect}
                  className="px-4 py-2.5 bg-henry-surface border border-henry-border/50 text-henry-text-dim rounded-xl text-sm hover:bg-henry-error/10 hover:border-henry-error/30 hover:text-henry-error transition-colors"
                >
                  Disconnect
                </button>
              )}
            </div>
          )}

          {/* Advanced section — raw token entry for already-connected or for advanced users */}
          {!isReplitOAuth && (
            <div>
              <button
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-henry-text-muted hover:text-henry-text transition-colors"
              >
                <svg
                  className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                >
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
                      <label className="block text-[11px] font-medium text-henry-text-dim">
                        Replace saved key
                      </label>
                      <input
                        type="password"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={svc.keyPlaceholder}
                        onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
                        className="w-full bg-henry-bg border border-henry-border/40 rounded-lg px-3 py-2 text-xs text-henry-text font-mono placeholder-henry-text-muted outline-none focus:border-henry-accent/50 transition-colors"
                      />
                      <button
                        onClick={save}
                        disabled={!draft.trim() || saving || saved}
                        className="px-4 py-1.5 bg-henry-surface border border-henry-border/50 text-henry-text-dim rounded-lg text-xs font-medium hover:bg-henry-hover/50 transition-colors disabled:opacity-50"
                      >
                        {saved ? '✓ Saved' : saving ? 'Saving…' : 'Update key'}
                      </button>
                    </div>
                  )}
                  <a
                    href={svc.docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block text-[11px] text-henry-accent/70 hover:text-henry-accent transition-colors"
                  >
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

function ServiceCard({
  svc,
  onOpen,
}: {
  svc: ServiceConfig;
  onOpen: () => void;
}) {
  const connected = isConnected(svc.id);
  const isReplitOAuth = svc.connectionType === 'replit-oauth';

  let primaryLabel = 'Connect';
  if (connected && HAS_PANEL.has(svc.id)) primaryLabel = 'Open';
  else if (connected) primaryLabel = 'Manage';
  else if (isReplitOAuth) primaryLabel = 'View';

  return (
    <div
      className={`rounded-2xl border transition-all ${
        connected
          ? 'bg-henry-surface/50 border-henry-accent/20'
          : 'bg-henry-surface/20 border-henry-border/30 hover:border-henry-border/50'
      }`}
    >
      <div className="flex items-center gap-3 p-4">
        <div className="w-10 h-10 rounded-xl bg-henry-bg/60 flex items-center justify-center text-xl shrink-0">
          {svc.icon}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-henry-text">{svc.name}</span>
            <StatusPill connected={connected} />
          </div>
          <p className="text-xs text-henry-text-muted mt-0.5 truncate">{svc.description}</p>
        </div>

        <button
          onClick={onOpen}
          className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            connected
              ? 'bg-henry-accent/10 text-henry-accent border border-henry-accent/20 hover:bg-henry-accent/20'
              : 'bg-henry-surface border border-henry-border/50 text-henry-text hover:bg-henry-hover/50'
          }`}
        >
          {primaryLabel}
        </button>
      </div>
    </div>
  );
}

export default function IntegrationsPanel() {
  const [, forceUpdate] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);

  const refresh = () => forceUpdate((n) => n + 1);

  const activeService = activeId ? SERVICES.find((s) => s.id === activeId) ?? null : null;

  const connected = SERVICES.filter((s) => isConnected(s.id));
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
              {connected.length === 0
                ? 'Connect your accounts to get more out of Henry'
                : `${connected.length} account${connected.length !== 1 ? 's' : ''} connected`}
            </p>
          </div>
        </div>
      </div>

      {/* Service list */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8">

        {/* Connected feeds — quick-access tiles for services that have live panels */}
        {connected.length > 0 && (
          <div>
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-henry-text-muted mb-3">
              Your connected apps
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {connected.filter((s) => HAS_PANEL.has(s.id)).map((svc) => {
                const feedLabel: Record<string, string> = {
                  github: 'Repos, issues & PRs',
                  slack: 'Channels & messages',
                  notion: 'Pages & databases',
                  linear: 'Issues & projects',
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

        {grouped.map(({ cat, services }) => (
          <div key={cat}>
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-henry-text-muted mb-3">
              {CATEGORY_LABELS[cat]}
            </h2>
            <div className="space-y-2">
              {services.map((svc) => (
                <ServiceCard
                  key={svc.id}
                  svc={svc}
                  onOpen={() => setActiveId(svc.id)}
                />
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
          onSaved={refresh}
        />
      )}
    </div>
  );
}
