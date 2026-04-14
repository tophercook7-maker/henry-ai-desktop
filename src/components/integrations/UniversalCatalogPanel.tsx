import { useState, useMemo } from 'react';
import {
  CATALOG, CATEGORY_META, getCatalogToken, setCatalogToken, isCatalogConnected,
  searchCatalog, type CatalogService, type ServiceCategory,
} from '../../henry/serviceCatalog';
import {
  getSyncTarget, setSyncTarget, getNotionSyncDbId, setNotionSyncDbId,
  AVAILABLE_SYNC_TARGETS, type NotesSyncTarget,
} from '../../henry/notesSync';
import { useStore } from '../../store';
import type { ViewType } from '../../types';

const CATEGORY_ORDER: ServiceCategory[] = [
  'communication', 'notes', 'productivity', 'calendar', 'project',
  'crm', 'finance', 'analytics', 'marketing', 'social', 'dev', 'infra',
  'ai', 'ecommerce', 'hr', 'legal', 'health', 'media',
];

function ConnectBadge({ svc }: { svc: CatalogService }) {
  const connected = isCatalogConnected(svc.id);
  if (connected) return <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-400/15 text-green-400 font-medium border border-green-400/20">Connected</span>;
  if (svc.connectMethod === 'coming_soon') return <span className="text-[10px] px-2 py-0.5 rounded-full bg-henry-border/20 text-henry-text-muted font-medium">Coming soon</span>;
  return null;
}

function ServiceCard({ svc, onConnect }: { svc: CatalogService; onConnect: (svc: CatalogService) => void }) {
  const connected = isCatalogConnected(svc.id);
  const isNative = svc.connectMethod === 'native' || svc.implemented;

  return (
    <div
      className={`group relative rounded-xl border p-3 transition-all cursor-pointer hover:bg-henry-surface/40 ${
        connected ? 'border-green-400/20 bg-green-400/5' : 'border-henry-border/20 bg-henry-surface/10'
      }`}
      onClick={() => onConnect(svc)}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xl shrink-0">{svc.icon}</span>
        <ConnectBadge svc={svc} />
      </div>
      <p className="text-xs font-semibold text-henry-text mt-1.5">{svc.name}</p>
      <p className="text-[11px] text-henry-text-muted mt-0.5 leading-relaxed line-clamp-2">{svc.description}</p>
      {svc.actions && svc.actions.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {svc.actions.slice(0, 2).map((a) => (
            <span key={a} className="text-[9px] px-1.5 py-0.5 rounded bg-henry-surface/40 text-henry-text-muted">{a}</span>
          ))}
          {svc.actions.length > 2 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-henry-surface/40 text-henry-text-muted">+{svc.actions.length - 2}</span>
          )}
        </div>
      )}
    </div>
  );
}

function TokenModal({ svc, onClose }: { svc: CatalogService; onClose: () => void }) {
  const [token, setToken] = useState(getCatalogToken(svc.id));
  const [saved, setSaved] = useState(false);
  const setCurrentView = useStore((s) => s.setCurrentView);

  const isNativePanel = ['google_calendar', 'gmail', 'github', 'linear', 'notion', 'slack'].includes(svc.id);

  function handleSave() {
    setCatalogToken(svc.id, token);
    setSaved(true);
    setTimeout(onClose, 800);
  }

  function handleDisconnect() {
    setCatalogToken(svc.id, '');
    onClose();
  }

  function handleGoToPanel() {
    const viewMap: Record<string, string> = {
      google_calendar: 'google_calendar',
      gmail: 'gmail',
      github: 'github',
      linear: 'linear',
      notion: 'notion',
      slack: 'slack',
    };
    const view = viewMap[svc.id];
    if (view) {
      setCurrentView(view as ViewType);
      onClose();
    }
  }

  const connected = !!getCatalogToken(svc.id) || isCatalogConnected(svc.id);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[80] flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-henry-bg rounded-2xl border border-henry-border/30 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-5 py-4 border-b border-henry-border/20">
          <span className="text-2xl">{svc.icon}</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-henry-text">{svc.name}</p>
            <p className="text-xs text-henry-text-muted">{svc.description}</p>
          </div>
          <button onClick={onClose} className="text-henry-text-muted hover:text-henry-text">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="p-5 space-y-4">
          {svc.connectMethod === 'coming_soon' ? (
            <div className="text-center py-4">
              <p className="text-2xl mb-2">🚧</p>
              <p className="text-sm text-henry-text">Coming soon</p>
              <p className="text-xs text-henry-text-muted mt-1">This integration is in development.</p>
            </div>
          ) : svc.connectMethod === 'replit_oauth' ? (
            <div className="text-center py-4">
              <p className="text-2xl mb-2">✅</p>
              <p className="text-sm text-henry-text">Auto-connected via Replit</p>
              <p className="text-xs text-henry-text-muted mt-1">No setup needed — already available.</p>
            </div>
          ) : (
            <>
              {isNativePanel && (
                <button
                  onClick={handleGoToPanel}
                  className="w-full py-2.5 rounded-lg bg-henry-accent text-white text-sm font-medium hover:bg-henry-accent/90 transition-all"
                >
                  Open {svc.name} panel
                </button>
              )}
              {!isNativePanel && (
                <>
                  {svc.actions && svc.actions.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-henry-text-muted mb-1.5">What Henry can do:</p>
                      <ul className="space-y-1">
                        {svc.actions.map((a) => (
                          <li key={a} className="text-xs text-henry-text flex items-center gap-1.5">
                            <span className="w-1 h-1 rounded-full bg-henry-accent shrink-0" />
                            {a}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-henry-text-muted">{svc.tokenLabel || 'API Key / Token'}</label>
                    <input
                      type="password"
                      placeholder={`Paste your ${svc.tokenLabel || 'token'}`}
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      className="w-full text-sm bg-henry-surface/50 border border-henry-border/30 rounded-lg px-3 py-2 text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/50"
                    />
                    {svc.tokenHint && <p className="text-[11px] text-henry-text-muted">{svc.tokenHint}</p>}
                    {svc.docsUrl && (
                      <a href={svc.docsUrl} target="_blank" rel="noreferrer" className="text-[11px] text-henry-accent hover:underline">
                        How to get this →
                      </a>
                    )}
                    {svc.connectMethod === 'oauth' && (
                      <p className="text-xs text-yellow-400/80">OAuth flow required — full setup instructions coming soon.</p>
                    )}
                  </div>
                  <div className="flex gap-3">
                    {connected && (
                      <button
                        onClick={handleDisconnect}
                        className="px-3 py-2 rounded-lg text-xs text-red-400 hover:text-red-300 border border-red-400/20 transition-all"
                      >
                        Disconnect
                      </button>
                    )}
                    <button
                      onClick={handleSave}
                      disabled={!token.trim()}
                      className="flex-1 py-2 rounded-lg bg-henry-accent text-white text-sm font-medium hover:bg-henry-accent/90 disabled:opacity-40 transition-all"
                    >
                      {saved ? 'Saved!' : 'Save & Connect'}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function NotesSyncSection() {
  const [target, setTargetState] = useState<NotesSyncTarget>(getSyncTarget);
  const [notionDbId, setNotionDbIdState] = useState(getNotionSyncDbId);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setSyncTarget(target);
    setNotionSyncDbId(notionDbId);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="rounded-xl border border-henry-border/20 bg-henry-surface/10 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-base">📝</span>
        <div>
          <p className="text-sm font-semibold text-henry-text">Notes Sync</p>
          <p className="text-xs text-henry-text-muted">Where should Henry sync your journal and notes?</p>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {AVAILABLE_SYNC_TARGETS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTargetState(t.id)}
            className={`flex flex-col items-center gap-1 p-2.5 rounded-lg border text-center transition-all ${
              target === t.id
                ? 'border-henry-accent/50 bg-henry-accent/10 text-henry-accent'
                : 'border-henry-border/20 text-henry-text-muted hover:border-henry-border/40'
            }`}
          >
            <span className="text-base">{t.icon}</span>
            <span className="text-[11px] font-medium">{t.label}</span>
          </button>
        ))}
      </div>
      {target === 'notion' && (
        <div className="space-y-1.5">
          <label className="text-xs text-henry-text-muted">Notion Database ID</label>
          <input
            type="text"
            placeholder="Paste Notion database ID (from URL)"
            value={notionDbId}
            onChange={(e) => setNotionDbIdState(e.target.value)}
            className="w-full text-sm bg-henry-surface/50 border border-henry-border/30 rounded-lg px-3 py-2 text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/50"
          />
          <p className="text-[11px] text-henry-text-muted">
            Open your Notion database → copy the ID from the URL (32-char hex string). Make sure your integration has access.
          </p>
        </div>
      )}
      <button
        onClick={handleSave}
        className="w-full py-2 rounded-lg bg-henry-surface border border-henry-border/30 text-sm text-henry-text hover:bg-henry-surface/80 transition-all"
      >
        {saved ? '✓ Saved' : 'Save sync settings'}
      </button>
    </div>
  );
}

export default function UniversalCatalogPanel() {
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ServiceCategory | 'all'>('all');
  const [selectedService, setSelectedService] = useState<CatalogService | null>(null);
  const [, forceUpdate] = useState(0);

  const connectedCount = useMemo(() => CATALOG.filter((s) => isCatalogConnected(s.id)).length, []);

  const displayed = useMemo(() => {
    let list = query.trim() ? searchCatalog(query) : CATALOG;
    if (selectedCategory !== 'all') list = list.filter((s) => s.category === selectedCategory);
    return list;
  }, [query, selectedCategory]);

  const grouped = useMemo(() => {
    if (query.trim() || selectedCategory !== 'all') {
      return [{ category: 'all' as ServiceCategory | 'all', services: displayed }];
    }
    return CATEGORY_ORDER
      .map((cat) => ({ category: cat, services: CATALOG.filter((s) => s.category === cat) }))
      .filter((g) => g.services.length > 0);
  }, [displayed, query, selectedCategory]);

  const totalCount = CATALOG.length;

  return (
    <div className="h-full flex flex-col bg-henry-bg overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b border-henry-border/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-henry-accent/10 flex items-center justify-center text-xl">🔌</div>
            <div>
              <h1 className="text-lg font-semibold text-henry-text">Integrations</h1>
              <p className="text-xs text-henry-text-muted">
                {connectedCount} connected · {totalCount} available
              </p>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="mt-4 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-henry-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input
            type="text"
            placeholder="Search services, actions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full text-sm bg-henry-surface/30 border border-henry-border/20 rounded-xl pl-9 pr-4 py-2.5 text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/40 transition-all"
          />
        </div>

        {/* Category pills */}
        <div className="flex gap-1.5 mt-3 overflow-x-auto pb-1 scrollbar-hide">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`shrink-0 text-xs px-3 py-1 rounded-full border transition-all ${
              selectedCategory === 'all'
                ? 'bg-henry-accent text-white border-henry-accent'
                : 'border-henry-border/30 text-henry-text-muted hover:border-henry-border/60'
            }`}
          >
            All ({totalCount})
          </button>
          {CATEGORY_ORDER.map((cat) => {
            const meta = CATEGORY_META[cat];
            const count = CATALOG.filter((s) => s.category === cat).length;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`shrink-0 text-xs px-3 py-1 rounded-full border transition-all ${
                  selectedCategory === cat
                    ? 'bg-henry-accent text-white border-henry-accent'
                    : 'border-henry-border/30 text-henry-text-muted hover:border-henry-border/60'
                }`}
              >
                {meta.icon} {meta.label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {/* Notes sync settings */}
        {(selectedCategory === 'all' || selectedCategory === 'notes') && !query.trim() && (
          <NotesSyncSection />
        )}

        {grouped.map(({ category, services }) => {
          const meta = CATEGORY_META[category as ServiceCategory];
          return (
            <div key={category}>
              {grouped.length > 1 && meta && (
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm">{meta.icon}</span>
                  <p className="text-xs font-semibold text-henry-text-muted uppercase tracking-wider">{meta.label}</p>
                  <div className="flex-1 h-px bg-henry-border/20" />
                  <span className="text-[11px] text-henry-text-muted">{services.length}</span>
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                {services.map((svc) => (
                  <ServiceCard
                    key={svc.id}
                    svc={svc}
                    onConnect={(s) => setSelectedService(s)}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {displayed.length === 0 && (
          <div className="text-center py-12">
            <p className="text-2xl mb-2">🔍</p>
            <p className="text-sm text-henry-text">No services found for "{query}"</p>
            <p className="text-xs text-henry-text-muted mt-1">Try a different search term.</p>
          </div>
        )}
      </div>

      {/* Token/connect modal */}
      {selectedService && (
        <TokenModal
          svc={selectedService}
          onClose={() => { setSelectedService(null); forceUpdate((n) => n + 1); }}
        />
      )}
    </div>
  );
}
