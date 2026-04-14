/**
 * ConnectScreen — unified not-connected/expired UI for every integration.
 *
 * Drop in <ConnectScreen serviceId="slack" /> and you're done.
 * The component reads status from useConnectionStore and drives
 * the correct flow: Google OAuth popup or guided token entry.
 */

import { useState, useEffect, useRef } from 'react';
import { useConnectionStore, type ConnectionStatus } from '../../henry/connectionStore';

const GOOGLE_OAUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
].join(' ');

const GOOGLE_SERVICES = new Set(['gmail', 'gcal', 'gdrive']);

// ── Per-service config ────────────────────────────────────────────────────────

interface ServiceConfig {
  icon: string;
  name: string;
  tagline: string;
  benefits: [string, string, string];
  mode: 'google-oauth' | 'guided-token';
  steps?: string[];
  tokenLabel?: string;
  tokenPlaceholder?: string;
  docsUrl?: string;
  docsLabel?: string;
}

const CONFIG: Record<string, ServiceConfig> = {
  gmail: {
    icon: '📧', name: 'Gmail', mode: 'google-oauth',
    tagline: 'Connect Google to see your inbox.',
    benefits: [
      'See recent emails without switching apps',
      'Ask Henry to draft a reply to any message',
      'Surface what actually needs your attention',
    ],
  },
  gcal: {
    icon: '📅', name: 'Google Calendar', mode: 'google-oauth',
    tagline: 'Connect Google to see your schedule.',
    benefits: [
      "See today's events without opening Calendar",
      'Get meeting prep from Henry before every call',
      'Plan your week at a glance',
    ],
  },
  gdrive: {
    icon: '📁', name: 'Google Drive', mode: 'google-oauth',
    tagline: 'Connect Google to browse your files.',
    benefits: [
      'See recently modified files without opening Drive',
      'Ask Henry to summarize or explain any document',
      'Find files faster with natural-language search',
    ],
  },
  slack: {
    icon: '💬', name: 'Slack', mode: 'guided-token',
    tagline: 'Read channels, see messages, and send replies — all from Henry.',
    benefits: [
      'See channel activity without switching to Slack',
      'Ask Henry to summarize any channel',
      'Send messages directly from Henry',
    ],
    steps: [
      'Go to api.slack.com/apps and open your Slack app (or create a new one)',
      'Under OAuth & Permissions, add scopes: channels:read, channels:history, chat:write, users:read',
      'Click Install to Workspace and approve',
      'Copy the Bot User OAuth Token — it starts with xoxb-',
    ],
    tokenLabel: 'Bot Token', tokenPlaceholder: 'xoxb-…',
    docsUrl: 'https://api.slack.com/apps', docsLabel: 'Open Slack App settings →',
  },
  github: {
    icon: '🐙', name: 'GitHub', mode: 'guided-token',
    tagline: 'Browse repos, triage issues, and review pull requests from Henry.',
    benefits: [
      'See all your repos and open issues at a glance',
      'Ask Henry to triage or summarize any repo',
      'Create issues and track PRs without leaving the app',
    ],
    steps: [
      'Go to github.com/settings/tokens/new',
      'Give it a name, select scopes: repo, read:user, read:org',
      'Click Generate token — it starts with ghp_',
      'Copy it and paste it below',
    ],
    tokenLabel: 'Personal Access Token', tokenPlaceholder: 'ghp_…',
    docsUrl: 'https://github.com/settings/tokens/new', docsLabel: 'Create a GitHub token →',
  },
  notion: {
    icon: '📄', name: 'Notion', mode: 'guided-token',
    tagline: 'Search and read your pages and databases directly from Henry.',
    benefits: [
      'Find any Notion page without switching apps',
      'Ask Henry to summarize or reformat your notes',
      'Keep your knowledge base in reach while you work',
    ],
    steps: [
      'Go to notion.so/my-integrations and click New integration',
      'Give it a name and save — copy the Internal Integration Token (starts with secret_)',
      'In each Notion page you want Henry to see, click Share → Invite your integration',
    ],
    tokenLabel: 'Integration Token', tokenPlaceholder: 'secret_…',
    docsUrl: 'https://www.notion.so/my-integrations', docsLabel: 'Open Notion integrations →',
  },
  linear: {
    icon: '🔷', name: 'Linear', mode: 'guided-token',
    tagline: 'See all issues assigned to you, filtered by priority.',
    benefits: [
      'See your assigned issues without opening Linear',
      'Filter by urgent or high priority at a glance',
      'Stay on top of work across all your teams',
    ],
    steps: [
      'Go to linear.app/settings/api',
      'Click Create key and give it a label',
      'Copy the API key — it starts with lin_api_',
    ],
    tokenLabel: 'API Key', tokenPlaceholder: 'lin_api_…',
    docsUrl: 'https://linear.app/settings/api', docsLabel: 'Open Linear API settings →',
  },
  stripe: {
    icon: '💳', name: 'Stripe', mode: 'guided-token',
    tagline: 'See your revenue and recent charges without leaving Henry.',
    benefits: [
      'See available and pending balance at a glance',
      'Track recent charges and payment status',
      'Stay on top of revenue without opening Stripe',
    ],
    steps: [
      'Go to dashboard.stripe.com/apikeys',
      'Click Create restricted key — set read-only permissions for Balance and Charges',
      'Copy the key — it starts with rk_live_ or sk_',
    ],
    tokenLabel: 'Stripe API Key', tokenPlaceholder: 'rk_live_… or sk_live_…',
    docsUrl: 'https://dashboard.stripe.com/apikeys', docsLabel: 'Open Stripe API keys →',
  },
};

// ── Component ─────────────────────────────────────────────────────────────────

type Phase = 'landing' | 'guided' | 'oauth-waiting';

interface Props {
  serviceId: string;
}

export default function ConnectScreen({ serviceId }: Props) {
  const cfg = CONFIG[serviceId] ?? CONFIG.slack;
  const { connectGoogle, connectService, getStatus } = useConnectionStore();
  const status: ConnectionStatus = getStatus(serviceId);
  const expired = status === 'expired';
  const isGoogle = GOOGLE_SERVICES.has(serviceId);

  const [phase, setPhase] = useState<Phase>('landing');
  const [oauthErr, setOauthErr] = useState<'' | 'no-client-id' | 'popup-blocked'>('');
  const [showAdvanced, setShowAdvanced] = useState(expired && isGoogle);
  const [token, setTokenDraft] = useState('');
  const [showTokenText, setShowTokenText] = useState(false);
  const [tokenErr, setTokenErr] = useState('');
  const popupRef = useRef<Window | null>(null);

  useEffect(() => {
    if (!isGoogle) return;
    function handle(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'henry_google_token' && e.data.token) {
        connectGoogle(e.data.token);
      }
    }
    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, [isGoogle, connectGoogle]);

  function handlePrimary() {
    if (isGoogle) startOAuth();
    else setPhase('guided');
  }

  function startOAuth() {
    const clientId = (localStorage.getItem('henry:google_client_id') || '').trim();
    if (!clientId) { setOauthErr('no-client-id'); setShowAdvanced(true); return; }
    const redirectUri = `${window.location.origin}/oauth-google-callback.html`;
    const url = new URL(GOOGLE_OAUTH_BASE);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'token');
    url.searchParams.set('scope', GOOGLE_SCOPES);
    url.searchParams.set('prompt', 'select_account');
    const popup = window.open(url.toString(), 'henry_google_oauth', 'width=520,height=620,left=200,top=100');
    if (!popup) { setOauthErr('popup-blocked'); return; }
    popupRef.current = popup;
    setOauthErr('');
    setPhase('oauth-waiting');
  }

  function saveToken() {
    const t = token.trim();
    if (!t) { setTokenErr('Paste your token to continue.'); return; }
    setTokenErr('');
    if (isGoogle) connectGoogle(t);
    else connectService(serviceId, t);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-sm mx-auto px-6 py-10 space-y-7">

        {/* Expired banner */}
        {expired && (
          <div className="rounded-xl bg-henry-warning/10 border border-henry-warning/30 px-4 py-3 flex items-start gap-3">
            <svg className="w-4 h-4 text-henry-warning shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <div>
              <p className="text-sm font-semibold text-henry-text">Access expired</p>
              <p className="text-xs text-henry-text-muted mt-0.5">
                Your {cfg.name} connection needs to be refreshed. Reconnect below to continue.
              </p>
            </div>
          </div>
        )}

        {/* Identity */}
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-henry-surface/50 border border-henry-border/30 flex items-center justify-center text-4xl">
            {cfg.icon}
          </div>
          <div>
            <h2 className="text-xl font-bold text-henry-text">
              {expired
                ? isGoogle ? 'Reconnect Google' : `Reconnect ${cfg.name}`
                : `Connect ${isGoogle ? 'Google' : cfg.name}`
              }
            </h2>
            <p className="text-sm text-henry-text-muted mt-1 leading-relaxed">
              {expired && isGoogle
                ? 'Sign in again to restore Gmail, Calendar, and Drive access.'
                : expired
                ? `Sign in again to restore your ${cfg.name} connection.`
                : cfg.tagline
              }
            </p>
          </div>
        </div>

        {/* Benefits (landing only) */}
        {!expired && phase !== 'guided' && (
          <div className="space-y-2.5">
            {cfg.benefits.map((b, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-henry-success/15 flex items-center justify-center">
                  <svg className="w-3 h-3 text-henry-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <p className="text-sm text-henry-text-dim leading-snug">{b}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Landing CTA ── */}
        {phase === 'landing' && (
          <div className="space-y-3">
            <button
              onClick={handlePrimary}
              className={`w-full py-3.5 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2.5 ${
                isGoogle
                  ? 'bg-white text-gray-800 border border-gray-200 shadow-sm hover:bg-gray-50'
                  : 'bg-henry-accent text-white hover:bg-henry-accent/90'
              }`}
            >
              {isGoogle && <GoogleLogo />}
              {expired
                ? isGoogle ? 'Reconnect Google' : `Reconnect ${cfg.name}`
                : isGoogle ? 'Connect with Google' : `Connect ${cfg.name}`
              }
            </button>

            {isGoogle && !expired && (
              <p className="text-center text-[11px] text-henry-text-muted">
                One sign-in enables Gmail, Calendar, and Drive in Henry.
              </p>
            )}

            {oauthErr === 'no-client-id' && (
              <div className="rounded-xl bg-henry-surface/50 border border-henry-border/40 p-4 space-y-1.5">
                <p className="text-sm font-semibold text-henry-text">One-click sign-in isn't configured yet</p>
                <p className="text-xs text-henry-text-muted leading-relaxed">
                  Henry needs a Google Client ID for the sign-in popup. Until then, connect using the manual token option below — it works exactly the same way.
                </p>
              </div>
            )}
            {oauthErr === 'popup-blocked' && (
              <div className="rounded-xl bg-henry-error/10 border border-henry-error/30 p-3 space-y-1.5">
                <p className="text-xs text-henry-error">Your browser blocked the sign-in window. Allow pop-ups for this site, then try again.</p>
                <button onClick={() => setOauthErr('')} className="text-xs text-henry-accent underline">Try again</button>
              </div>
            )}
          </div>
        )}

        {/* ── OAuth waiting ── */}
        {phase === 'oauth-waiting' && (
          <div className="space-y-3 text-center">
            <div className="w-full py-4 bg-henry-surface/50 border border-henry-border/30 rounded-xl flex items-center justify-center gap-3 text-sm text-henry-text-muted">
              <div className="w-4 h-4 rounded-full border-2 border-henry-accent/30 border-t-henry-accent animate-spin" />
              Waiting for sign-in…
            </div>
            <p className="text-xs text-henry-text-muted">Complete sign-in in the window that opened.</p>
            <button onClick={() => { setPhase('landing'); popupRef.current?.close(); }} className="text-xs text-henry-text-muted underline hover:text-henry-text">Cancel</button>
          </div>
        )}

        {/* ── Guided token flow (non-Google) ── */}
        {phase === 'guided' && cfg.steps && (
          <div className="space-y-5">
            <ol className="space-y-3">
              {cfg.steps.map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-henry-accent/15 text-henry-accent text-[11px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                  <span className="text-sm text-henry-text-dim leading-snug">{step}</span>
                </li>
              ))}
            </ol>
            {cfg.docsUrl && (
              <a href={cfg.docsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-henry-accent hover:underline">
                {cfg.docsLabel}
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                  <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            )}
            <TokenField
              label={cfg.tokenLabel}
              placeholder={cfg.tokenPlaceholder}
              value={token}
              onChange={(v) => { setTokenDraft(v); setTokenErr(''); }}
              onSubmit={saveToken}
              showText={showTokenText}
              onToggleShow={() => setShowTokenText((v) => !v)}
              error={tokenErr}
            />
            <div className="flex gap-2">
              <button onClick={() => setPhase('landing')} className="px-4 py-3 text-sm text-henry-text-muted border border-henry-border/40 rounded-xl hover:bg-henry-hover/40 transition-colors">← Back</button>
              <button onClick={saveToken} disabled={!token.trim()} className="flex-1 py-3 bg-henry-accent text-white rounded-xl font-semibold text-sm hover:bg-henry-accent/90 transition-colors disabled:opacity-50">
                Connect {cfg.name}
              </button>
            </div>
          </div>
        )}

        {/* ── Advanced (Google only: manual token) ── */}
        {isGoogle && phase !== 'guided' && (
          <div className="border-t border-henry-border/20 pt-4">
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-2 text-xs text-henry-text-muted hover:text-henry-text transition-colors w-full"
            >
              <svg className={`w-3.5 h-3.5 transition-transform duration-150 ${showAdvanced ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
              Advanced — connect with an access token
            </button>
            {showAdvanced && (
              <div className="mt-4 space-y-3 pl-1">
                <p className="text-xs text-henry-text-muted leading-relaxed">
                  Get a temporary access token from the{' '}
                  <a href="https://developers.google.com/oauthplayground/" target="_blank" rel="noreferrer" className="text-henry-accent hover:underline">Google OAuth Playground</a>.
                  Select all three scopes: <span className="font-mono text-[10px]">gmail.readonly</span>, <span className="font-mono text-[10px]">calendar.readonly</span>, <span className="font-mono text-[10px]">drive.readonly</span>. Tokens expire after ~1 hour.
                </p>
                <TokenField
                  placeholder="ya29.…"
                  value={token}
                  onChange={(v) => { setTokenDraft(v); setTokenErr(''); }}
                  onSubmit={saveToken}
                  showText={showTokenText}
                  onToggleShow={() => setShowTokenText((v) => !v)}
                  error={tokenErr}
                />
                <p className="text-[11px] text-henry-text-muted">Stored locally. One token enables Gmail, Calendar, and Drive.</p>
                <button onClick={saveToken} disabled={!token.trim()} className="w-full py-2.5 bg-henry-surface border border-henry-border/50 text-henry-text rounded-xl text-sm font-medium hover:bg-henry-hover/50 transition-colors disabled:opacity-40">
                  {expired ? 'Reconnect Google' : 'Connect Google'}
                </button>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TokenField({
  label, placeholder, value, onChange, onSubmit, showText, onToggleShow, error,
}: {
  label?: string; placeholder?: string; value: string;
  onChange: (v: string) => void; onSubmit: () => void;
  showText: boolean; onToggleShow: () => void; error: string;
}) {
  return (
    <div className="space-y-2">
      {label && <label className="block text-sm font-medium text-henry-text">{label}</label>}
      <div className="relative">
        <input
          autoFocus
          type={showText ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="w-full bg-henry-surface border border-henry-border/50 rounded-xl px-4 py-3 text-sm text-henry-text font-mono placeholder-henry-text-muted/60 outline-none focus:border-henry-accent/60 transition-colors pr-10"
        />
        <button type="button" onClick={onToggleShow} className="absolute right-3 top-1/2 -translate-y-1/2 text-henry-text-muted hover:text-henry-text" tabIndex={-1}>
          <EyeIcon open={showText} />
        </button>
      </div>
      {error && <p className="text-xs text-henry-error">{error}</p>}
      <p className="text-[11px] text-henry-text-muted">Stored locally on your device. Never shared.</p>
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

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
