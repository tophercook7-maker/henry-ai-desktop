import { useState } from 'react';
import { setToken } from '../../henry/integrations';

interface ConnectPromptProps {
  serviceId: string;
  icon: string;
  name: string;
  unlocks: string;
  steps: string[];
  tokenLabel: string;
  tokenPlaceholder: string;
  docsUrl: string;
  docsLabel: string;
  onConnected: () => void;
}

export default function ConnectPrompt({
  serviceId,
  icon,
  name,
  unlocks,
  steps,
  tokenLabel,
  tokenPlaceholder,
  docsUrl,
  docsLabel,
  onConnected,
}: ConnectPromptProps) {
  const [token, setTokenDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showToken, setShowToken] = useState(false);

  async function connect() {
    const t = token.trim();
    if (!t) { setError('Paste your token to continue.'); return; }
    setSaving(true);
    setError('');
    try {
      setToken(serviceId, t);
      onConnected();
    } catch (e: any) {
      setError(e.message || 'Something went wrong.');
      setSaving(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-md mx-auto px-6 py-12 space-y-7">

        {/* Identity */}
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-henry-surface/50 border border-henry-border/30 flex items-center justify-center text-4xl">
            {icon}
          </div>
          <div>
            <h2 className="text-xl font-bold text-henry-text">Connect {name}</h2>
            <p className="text-sm text-henry-text-muted mt-1 leading-relaxed">{unlocks}</p>
          </div>
        </div>

        {/* Setup steps */}
        {steps.length > 0 && (
          <div className="space-y-3 bg-henry-surface/20 border border-henry-border/20 rounded-2xl p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-henry-text-muted">How to connect</p>
            <ol className="space-y-2">
              {steps.map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-henry-accent/15 text-henry-accent text-[11px] font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span className="text-sm text-henry-text-dim leading-snug">{step}</span>
                </li>
              ))}
            </ol>
            <a
              href={docsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-henry-accent hover:underline mt-1"
            >
              {docsLabel}
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          </div>
        )}

        {/* Token entry */}
        <div className="space-y-3">
          <label className="block text-sm font-medium text-henry-text">{tokenLabel}</label>
          <div className="relative">
            <input
              type={showToken ? 'text' : 'password'}
              value={token}
              onChange={(e) => { setTokenDraft(e.target.value); setError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && connect()}
              placeholder={tokenPlaceholder}
              autoComplete="off"
              spellCheck={false}
              className="w-full bg-henry-surface border border-henry-border/50 rounded-xl px-4 py-3 text-sm text-henry-text font-mono placeholder-henry-text-muted/60 outline-none focus:border-henry-accent/60 transition-colors pr-10"
            />
            <button
              type="button"
              onClick={() => setShowToken((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-henry-text-muted hover:text-henry-text transition-colors"
              tabIndex={-1}
            >
              {showToken ? (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
          {error && <p className="text-xs text-henry-error">{error}</p>}
          <p className="text-[11px] text-henry-text-muted">
            Stored only on this device. Never sent anywhere except {name}'s own API.
          </p>
        </div>

        <button
          onClick={connect}
          disabled={!token.trim() || saving}
          className="w-full py-3 bg-henry-accent text-white rounded-xl font-semibold text-sm hover:bg-henry-accent/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              Connecting…
            </>
          ) : `Connect ${name}`}
        </button>
      </div>
    </div>
  );
}
