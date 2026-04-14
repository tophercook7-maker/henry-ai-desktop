/**
 * GoogleConnectPanel — 3-step wizard
 *
 * Step 1: Open Google Cloud Console (link) and create a Desktop app client
 * Step 2: Paste Client ID + Secret
 * Step 3: Click "Connect with Google" (opens system browser via PKCE flow)
 *
 * Expired/reconnect: skips straight to Step 3 (credentials already saved).
 * Web fallback (no IPC): Step 3 shows manual token entry instead.
 */

import { useState } from 'react';
import {
  useGoogleStore,
  getGoogleClientId,
  getGoogleClientSecret,
  setGoogleClientId,
  setGoogleClientSecret,
  type GoogleConnectionStatus,
} from '../../henry/googleStore';

interface Props {
  service: 'gmail' | 'gcal' | 'gdrive';
  status: GoogleConnectionStatus;
}

function isDesktopAvailable(): boolean {
  return typeof (window as any).henryAPI?.googleStartAuth === 'function';
}

// ── Wizard steps ──────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3;

export default function GoogleConnectPanel({ service: _service, status }: Props) {
  const { startDesktopAuth, connect, errorMessage, disconnect } = useGoogleStore((s) => ({
    startDesktopAuth: s.startDesktopAuth,
    connect:          s.connect,
    errorMessage:     s.errorMessage,
    disconnect:       s.disconnect,
  }));

  const desktop = isDesktopAvailable();
  const hasCredentials = !!(getGoogleClientId() && getGoogleClientSecret());

  // If reconnecting, skip to step 3 (credentials already exist)
  const [step, setStep] = useState<Step>(
    status === 'expired' || hasCredentials ? 3 : 1
  );

  // Step 2 fields
  const [clientId,  setClientId]  = useState(getGoogleClientId());
  const [clientSec, setClientSec] = useState(getGoogleClientSecret());
  const [credErr,   setCredErr]   = useState('');

  // Step 3 manual token fallback
  const [manualToken, setManualToken] = useState('');
  const [tokenErr,    setTokenErr]    = useState('');
  const [showToken,   setShowToken]   = useState(false);

  // ── Loading states ──────────────────────────────────────────────────────────

  if (status === 'connecting') {
    return (
      <Centered>
        <div className="w-10 h-10 rounded-full border-2 border-henry-accent/30 border-t-henry-accent animate-spin mx-auto" />
        <p className="text-sm font-semibold text-henry-text mt-4">Waiting for Google…</p>
        <p className="text-xs text-henry-text-muted mt-1">
          Complete sign-in in the browser window that opened,<br />then return here.
        </p>
      </Centered>
    );
  }

  if (status === 'refreshing') {
    return (
      <Centered>
        <div className="w-8 h-8 rounded-full border-2 border-henry-accent/30 border-t-henry-accent animate-spin mx-auto" />
        <p className="text-xs text-henry-text-muted mt-3">Refreshing connection…</p>
      </Centered>
    );
  }

  // ── Step handlers ───────────────────────────────────────────────────────────

  function handleSaveCredentials() {
    const id  = clientId.trim();
    const sec = clientSec.trim();
    if (!id)  { setCredErr('Client ID is required.'); return; }
    if (!sec) { setCredErr('Client Secret is required.'); return; }
    setGoogleClientId(id);
    setGoogleClientSecret(sec);
    setCredErr('');
    setStep(3);
  }

  function handleConnect() {
    if (desktop) {
      void startDesktopAuth();
    }
  }

  function handleManualToken() {
    const t = manualToken.trim();
    if (!t) { setTokenErr('Paste your access token to continue.'); return; }
    setTokenErr('');
    void connect(t);
  }

  // ── Step content ────────────────────────────────────────────────────────────

  const isExpired = status === 'expired';
  const totalSteps = !desktop ? 1 : hasCredentials ? 1 : 3;
  const currentStep = !desktop ? 1 : step === 1 ? 1 : step === 2 ? 2 : 3;

  return (
    <div className="h-full overflow-y-auto flex items-start justify-center pt-8 pb-10">
      <div className="w-full max-w-xs px-4 space-y-6">

        {/* Progress dots — only show for multi-step desktop flow */}
        {desktop && !hasCredentials && !isExpired && (
          <div className="flex items-center justify-center gap-2">
            {([1, 2, 3] as Step[]).map((s) => (
              <button
                key={s}
                onClick={() => s < step && setStep(s)}
                className={`w-2 h-2 rounded-full transition-all ${
                  s === step
                    ? 'bg-henry-accent w-5'
                    : s < step
                    ? 'bg-henry-accent/50 cursor-pointer'
                    : 'bg-henry-border'
                }`}
              />
            ))}
          </div>
        )}

        {/* ── STEP 1: Open console ──────────────────────────────────────── */}
        {step === 1 && desktop && !hasCredentials && (
          <div className="space-y-5">
            <StepHeader
              step={1}
              total={3}
              icon="🔑"
              title="Create API credentials"
              sub="One-time setup in Google Cloud Console."
            />

            <div className="space-y-3 text-sm text-henry-text-dim">
              <Step1Row n={1}>
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noreferrer"
                  className="text-henry-accent hover:underline font-medium"
                >
                  Open Google Cloud Console →
                </a>
              </Step1Row>
              <Step1Row n={2}>
                Create an OAuth client — choose type <strong className="text-henry-text">Desktop app</strong>
              </Step1Row>
              <Step1Row n={3}>
                Enable <strong className="text-henry-text">Gmail</strong>,{' '}
                <strong className="text-henry-text">Calendar</strong> &amp;{' '}
                <strong className="text-henry-text">Drive</strong> APIs in the same project
              </Step1Row>
            </div>

            <button
              onClick={() => setStep(2)}
              className="w-full py-3 bg-henry-accent text-white rounded-xl text-sm font-semibold hover:bg-henry-accent/90 transition-colors"
            >
              I've done this →
            </button>
          </div>
        )}

        {/* ── STEP 2: Paste credentials ────────────────────────────────── */}
        {step === 2 && desktop && (
          <div className="space-y-5">
            <StepHeader
              step={2}
              total={3}
              icon="📋"
              title="Paste your credentials"
              sub="From the OAuth client you just created."
            />

            <div className="space-y-2">
              <input
                autoFocus
                type="text"
                value={clientId}
                onChange={(e) => { setClientId(e.target.value); setCredErr(''); }}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveCredentials()}
                placeholder="Client ID  (…googleusercontent.com)"
                className="w-full bg-henry-bg border border-henry-border/50 rounded-xl px-4 py-2.5 text-sm text-henry-text font-mono placeholder-henry-text-muted/50 outline-none focus:border-henry-accent/60 transition-colors"
              />
              <input
                type="password"
                value={clientSec}
                onChange={(e) => { setClientSec(e.target.value); setCredErr(''); }}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveCredentials()}
                placeholder="Client Secret"
                autoComplete="off"
                className="w-full bg-henry-bg border border-henry-border/50 rounded-xl px-4 py-2.5 text-sm text-henry-text font-mono placeholder-henry-text-muted/50 outline-none focus:border-henry-accent/60 transition-colors"
              />
              {credErr && <p className="text-xs text-henry-error">{credErr}</p>}
              <p className="text-[11px] text-henry-text-muted">
                Stored locally on your device. Safe to paste here.
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2.5 rounded-xl text-sm text-henry-text-muted border border-henry-border/40 hover:bg-henry-surface/50 transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleSaveCredentials}
                disabled={!clientId.trim() || !clientSec.trim()}
                className="flex-1 py-2.5 bg-henry-accent text-white rounded-xl text-sm font-semibold hover:bg-henry-accent/90 transition-colors disabled:opacity-40"
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Connect ───────────────────────────────────────────── */}
        {(step === 3 || !desktop) && (
          <div className="space-y-5">
            {/* Header changes based on context */}
            {isExpired ? (
              <div className="space-y-1 text-center">
                <div className="text-3xl">🔄</div>
                <p className="text-base font-bold text-henry-text">Reconnect Google</p>
                <p className="text-xs text-henry-text-muted">
                  Your authorization expired. Sign in again to restore access.
                </p>
              </div>
            ) : desktop ? (
              <StepHeader
                step={3}
                total={3}
                icon="✅"
                title="Sign in with Google"
                sub="Opens your browser. Return here when done."
              />
            ) : (
              <div className="space-y-1 text-center">
                <div className="text-3xl">🔑</div>
                <p className="text-base font-bold text-henry-text">Connect Google</p>
                <p className="text-xs text-henry-text-muted">
                  Paste a temporary access token from Google OAuth Playground.
                </p>
              </div>
            )}

            {/* Error from auth flow */}
            {(status === 'error') && errorMessage && (
              <div className="rounded-xl bg-henry-error/10 border border-henry-error/30 px-3 py-2 text-xs text-henry-error">
                {errorMessage}
              </div>
            )}

            {/* Desktop primary button */}
            {desktop && (
              <>
                <button
                  onClick={handleConnect}
                  className="w-full py-3.5 bg-white text-gray-800 border border-gray-200 shadow-sm rounded-xl font-semibold text-sm hover:bg-gray-50 transition-colors flex items-center justify-center gap-2.5"
                >
                  <GoogleLogo />
                  {isExpired ? 'Reconnect Google' : 'Connect with Google'}
                </button>

                {!isExpired && (
                  <button
                    onClick={() => setStep(2)}
                    className="w-full text-xs text-henry-text-muted hover:text-henry-text text-center"
                  >
                    ← Change credentials
                  </button>
                )}
              </>
            )}

            {/* Web / manual token fallback */}
            {!desktop && (
              <div className="space-y-2">
                <p className="text-xs text-henry-text-muted">
                  Get a token from the{' '}
                  <a
                    href="https://developers.google.com/oauthplayground/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-henry-accent hover:underline"
                  >
                    OAuth Playground
                  </a>
                  {' '}— select Gmail, Calendar & Drive scopes.
                </p>
                <div className="relative">
                  <input
                    autoFocus
                    type={showToken ? 'text' : 'password'}
                    value={manualToken}
                    onChange={(e) => { setManualToken(e.target.value); setTokenErr(''); }}
                    onKeyDown={(e) => e.key === 'Enter' && handleManualToken()}
                    placeholder="ya29.…"
                    autoComplete="off"
                    className="w-full bg-henry-surface border border-henry-border/50 rounded-xl px-4 py-2.5 text-sm text-henry-text font-mono placeholder-henry-text-muted/60 outline-none focus:border-henry-accent/60 transition-colors pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-henry-text-muted hover:text-henry-text"
                    tabIndex={-1}
                  >
                    <EyeIcon open={showToken} />
                  </button>
                </div>
                {tokenErr && <p className="text-xs text-henry-error">{tokenErr}</p>}
                <button
                  onClick={handleManualToken}
                  disabled={!manualToken.trim()}
                  className="w-full py-2.5 bg-henry-accent text-white rounded-xl text-sm font-semibold hover:bg-henry-accent/90 transition-colors disabled:opacity-40"
                >
                  Connect Google
                </button>
              </div>
            )}

            {/* Disconnect link (only when expired) */}
            {isExpired && (
              <button
                onClick={() => disconnect()}
                className="w-full text-xs text-henry-text-muted hover:text-henry-error text-center transition-colors"
              >
                Disconnect Google
              </button>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

// ── Small layout helpers ──────────────────────────────────────────────────────

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-8">
      {children}
    </div>
  );
}

function StepHeader({
  step, total, icon, title, sub,
}: {
  step: number; total: number; icon: string; title: string; sub: string;
}) {
  return (
    <div className="text-center space-y-1">
      <p className="text-[11px] text-henry-text-muted font-medium tracking-wide uppercase">
        Step {step} of {total}
      </p>
      <div className="text-3xl">{icon}</div>
      <p className="text-base font-bold text-henry-text">{title}</p>
      <p className="text-xs text-henry-text-muted">{sub}</p>
    </div>
  );
}

function Step1Row({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="shrink-0 w-5 h-5 rounded-full bg-henry-surface border border-henry-border/40 flex items-center justify-center text-[10px] font-bold text-henry-text-muted mt-0.5">
        {n}
      </span>
      <span className="leading-snug">{children}</span>
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
