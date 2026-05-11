import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../../store';
import { buildPairCodePayload } from '../../sync/deviceLink';

export const ONBOARDING_DONE_KEY = 'henry:onboarding_v1_complete';
export function shouldShowOnboarding(): boolean {
  return !localStorage.getItem(ONBOARDING_DONE_KEY);
}

interface Props { onComplete: () => void }

// Each step has a check function that returns whether the requirement is met.
// The wizard auto-advances when it sees ok=true, so the user never has to
// click "next" — they just complete the requirement and the wizard moves on.
type StepId = 'welcome' | 'accessibility' | 'screen' | 'ai' | 'mobile' | 'done';
const STEP_ORDER: StepId[] = ['welcome', 'accessibility', 'screen', 'ai', 'mobile', 'done'];

// Lazy getter: window.henryAPI is exposed by the preload script and may not
// be present at module-import time depending on load order.
function getApi(): any {
  return (typeof window !== 'undefined') ? (window as any).henryAPI : undefined;
}

// ---- Internal HTTP helpers (same pattern as DeviceLinkPanel) ----
const SYNC_HEADERS = { 'Content-Type': 'application/json', 'X-Henry-Internal': 'true' };
async function syncFetch<T = any>(path: string, body?: object): Promise<T | null> {
  try {
    const res = await fetch('http://127.0.0.1:4242' + path, {
      method: body ? 'POST' : 'GET', headers: SYNC_HEADERS,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch { return null; }
}

export default function OnboardingWizard({ onComplete }: Props) {
  const { setProviders, providers } = useStore();
  const [step, setStep] = useState<StepId>('welcome');
  const [acc, setAcc] = useState<boolean | null>(null);
  const [scr, setScr] = useState<boolean | null>(null);
  const [groqKey, setGroqKey] = useState('');
  const [groqError, setGroqError] = useState('');
  const [groqSaving, setGroqSaving] = useState(false);
  const [hasAi, setHasAi] = useState(false);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [pairCountdown, setPairCountdown] = useState(0);
  const [pairExpiry, setPairExpiry] = useState<number | null>(null);
  const [tunnelUrl, setTunnelUrl] = useState<string | null>(null);
  const [lanUrl, setLanUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [linkedDevices, setLinkedDevices] = useState<Array<{ id: string; name?: string }>>([]);
  const stepIdx = STEP_ORDER.indexOf(step);
  const visibleStepCount = STEP_ORDER.length - 1; // exclude 'done' from progress dots

  // ---- Permissions: poll every 2s while wizard is open ----
  const checkPerms = useCallback(async () => {
    try {
      const a = await getApi()?.checkAccessibility?.();
      const s = await getApi()?.checkScreenRecording?.();
      setAcc(!!a?.granted);
      setScr(!!s?.granted);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    void checkPerms();
    const t = setInterval(() => { void checkPerms(); }, 2000);
    return () => clearInterval(t);
  }, [checkPerms]);

  // ---- AI provider state ----
  const refreshAiState = useCallback(() => {
    try {
      const lsProviders = JSON.parse(localStorage.getItem('henry:providers') || '[]') as Array<any>;
      const groq = lsProviders.find(p => p.id === 'groq');
      const has = !!groq && (groq.apiKey || groq.api_key || '').length > 10;
      setHasAi(has);
    } catch { setHasAi(false); }
  }, []);
  useEffect(() => { refreshAiState(); }, [refreshAiState, providers]);

  // ---- Mobile pairing state ----
  const generatePair = useCallback(async () => {
    setGenerating(true);
    try {
      // Make sure server is up
      const state = await syncFetch<any>('/sync/state-internal');
      if (!state?.running) await syncFetch('/sync/start-internal', {});
      // Token
      const result = await syncFetch<{ token: string }>('/sync/generate-pair-internal', {});
      if (!result?.token) return;
      // Reload state for port + tunnel
      const fresh = await syncFetch<any>('/sync/state-internal');
      if (fresh?.tunnelUrl) setTunnelUrl(fresh.tunnelUrl);
      // LAN IP
      const ipRes = await syncFetch<{ output?: string }>('/computer/shell', { command: 'ipconfig getifaddr en0 || ipconfig getifaddr en1' });
      const localIp = ipRes?.output?.trim() || '192.168.1.1';
      const port = fresh?.port || 4242;
      setLanUrl(`http://${localIp}:${port}`);
      const payload = buildPairCodePayload(localIp, port, result.token);
      setPairCode(payload);
      setPairExpiry(Date.now() + 5 * 60 * 1000);
    } finally { setGenerating(false); }
  }, []);

  // Auto-generate pair when entering the mobile step
  useEffect(() => {
    if (step !== 'mobile' || pairCode || generating) return;
    void generatePair();
  }, [step, pairCode, generating, generatePair]);

  // Pair countdown
  useEffect(() => {
    if (!pairExpiry) return;
    const tick = () => {
      const remaining = Math.max(0, Math.floor((pairExpiry - Date.now()) / 1000));
      setPairCountdown(remaining);
      if (remaining === 0) { setPairCode(null); setPairExpiry(null); }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [pairExpiry]);

  // Watch for device linked event — auto-advance from mobile step
  useEffect(() => {
    const onLinked = () => {
      void syncFetch<any>('/sync/state-internal').then(s => {
        // The sync server returns `linkedDevices` (not `devices`).
        // Filter to only currently-linked entries since old/unlinked rows can persist.
        const list = Array.isArray(s?.linkedDevices) ? s.linkedDevices : (Array.isArray(s?.devices) ? s.devices : []);
        const linked = list.filter((d: any) => !d.linkStatus || d.linkStatus === 'linked');
        setLinkedDevices(linked);
      });
    };
    // Initial load
    onLinked();
    window.addEventListener('henry_companion_devices_changed', onLinked);
    const poll = setInterval(onLinked, 3000);
    return () => {
      window.removeEventListener('henry_companion_devices_changed', onLinked);
      clearInterval(poll);
    };
  }, []);

  // ---- Step navigation ----
  function next() {
    const i = STEP_ORDER.indexOf(step);
    if (i < STEP_ORDER.length - 1) setStep(STEP_ORDER[i + 1]);
  }
  function back() {
    const i = STEP_ORDER.indexOf(step);
    if (i > 0) setStep(STEP_ORDER[i - 1]);
  }
  function skipStep() { next(); }
  function finish() { localStorage.setItem(ONBOARDING_DONE_KEY, 'true'); onComplete(); }

  // ---- AI: Groq save ----
  async function saveGroqKey() {
    const key = groqKey.trim();
    if (!key.startsWith('gsk_') || key.length < 30) {
      setGroqError('Keys start with "gsk_" — get yours free at console.groq.com');
      return;
    }
    setGroqSaving(true);
    setGroqError('');
    try {
      const api = getApi();
      // Save to SQLite via IPC
      try { await api?.saveProvider?.({ id: 'groq', name: 'Groq', api_key: key, apiKey: key, enabled: 1, models: '[]' }); } catch { /* */ }
      try { await api?.saveSetting?.('companion_provider', 'groq'); } catch { /* */ }
      try { await api?.saveSetting?.('companion_model', 'llama-3.3-70b-versatile'); } catch { /* */ }
      try { await api?.saveSetting?.('worker_provider', 'groq'); } catch { /* */ }
      try { await api?.saveSetting?.('worker_model', 'llama-3.3-70b-versatile'); } catch { /* */ }
      // Update store + localStorage
      const updated = (providers || []).filter((p: any) => p.id !== 'groq');
      updated.push({ id: 'groq', name: 'Groq', apiKey: key, enabled: true, models: ['llama-3.3-70b-versatile'] } as any);
      setProviders(updated as any);
      try {
        const existing = JSON.parse(localStorage.getItem('henry:providers') || '[]');
        const filtered = existing.filter((p: any) => p.id !== 'groq');
        filtered.push({ id: 'groq', name: 'Groq', api_key: key, apiKey: key, enabled: true, models: '[]' });
        localStorage.setItem('henry:providers', JSON.stringify(filtered));
      } catch { /* */ }
      setHasAi(true);
      next();
    } finally { setGroqSaving(false); }
  }

  // ---- Helper: open System Settings + reveal Henry in Finder ----
  // Uses the dedicated IPC handlers (henry:openPermissions, henry:openScreenRecording)
  // which call shell.openExternal() from the main process — the Electron-recommended
  // way to open external URIs. This works reliably even on macOS 26 where
  // child-process `open` calls can be silently dropped.
  // We also kick off computerRunShell to reveal Henry in Finder, in parallel.
  function openSettings(uri: string, ipcName: 'openPermissions' | 'openScreenRecording') {
    const api = getApi();
    // 1. Open System Settings via the proper IPC (uses shell.openExternal in main)
    let opened = false;
    if (api && typeof api[ipcName] === 'function') {
      try { api[ipcName](); opened = true; } catch { /* fall through */ }
    }
    // 2. Reveal Henry in Finder (best-effort — small Mac convenience)
    try {
      if (typeof api?.computerRunShell === 'function') {
        api.computerRunShell({ command: 'open -R "/Applications/Henry AI.app"', timeout: 3000 });
      }
    } catch { /* */ }
    // 3. Fallback: window.open(URI) if neither IPC ran
    if (!opened) {
      try { window.open(uri, '_blank'); } catch { /* */ }
    }
  }

  function openAccessibilitySettings() {
    openSettings('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility', 'openPermissions');
  }
  function openScreenRecordingSettings() {
    openSettings('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture', 'openScreenRecording');
  }

  // ---- Common UI ----
  const primaryBtn = 'w-full py-3.5 rounded-xl bg-henry-accent text-white font-bold text-sm hover:bg-henry-accent/85 transition-all disabled:opacity-40 disabled:cursor-not-allowed';
  const secondaryBtn = 'w-full py-3 rounded-xl border border-white/15 text-white/70 font-medium text-sm hover:border-white/30 hover:text-white transition-all';
  const ghostBtn = 'text-white/40 text-xs hover:text-white/70 transition-all';

  return (
    <div className="fixed inset-0 z-[200] bg-henry-bg flex flex-col items-center justify-center p-6 overflow-y-auto">
      {/* Progress dots */}
      <div className="flex gap-1.5 mb-8">
        {STEP_ORDER.slice(0, visibleStepCount).map((_s, i) => (
          <div key={i} className={'h-1 rounded-full transition-all ' +
            (i < stepIdx ? 'w-8 bg-henry-accent' :
             i === stepIdx ? 'w-10 bg-white' :
             'w-4 bg-white/20')} />
        ))}
      </div>

      <div className="w-full max-w-md">

        {/* ===================== WELCOME ===================== */}
        {step === 'welcome' && (
          <div className="space-y-7 text-center">
            <div>
              <p className="text-6xl mb-4">◉</p>
              <h1 className="text-3xl font-black text-white tracking-tight">Welcome to Henry</h1>
              <p className="text-white/55 text-sm mt-3 leading-relaxed">
                Your personal AI — runs on your Mac, works on your phone, almost free.<br/>
                Let's set him up. Takes about 2 minutes.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-left">
              {[
                ['⚡', 'Permissions', 'Accessibility + Screen Recording'],
                ['🗣️', 'AI Provider', 'Free Groq key (60 sec) or skip'],
                ['📱', 'Mobile', 'Scan a QR — your phone is paired'],
                ['✓', 'Done', 'Henry is ready to use'],
              ].map(([icon, t, d]) => (
                <div key={t as string} className="bg-white/5 border border-white/10 rounded-xl p-3">
                  <p className="text-xl mb-1">{icon as string}</p>
                  <p className="text-white text-xs font-semibold">{t as string}</p>
                  <p className="text-white/40 text-[10px] mt-0.5 leading-snug">{d as string}</p>
                </div>
              ))}
            </div>
            <button onClick={next} className={primaryBtn}>Start setup →</button>
            <button onClick={finish} className={ghostBtn}>Skip setup — I know what I'm doing</button>
          </div>
        )}

        {/* ===================== ACCESSIBILITY ===================== */}
        {step === 'accessibility' && (
          <div className="space-y-5">
            <div className="text-center">
              <p className="text-5xl mb-3">⌨️</p>
              <h2 className="text-2xl font-bold text-white">Accessibility access</h2>
              <p className="text-white/55 text-sm mt-2 leading-relaxed">
                Lets Henry capture selected text with ⌥Space and control your Mac on your behalf.
              </p>
            </div>

            {acc === true ? (
              <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-5 text-center space-y-3">
                <p className="text-3xl">✓</p>
                <p className="text-green-400 font-semibold">Accessibility is enabled</p>
                <button onClick={next} className={primaryBtn}>Continue →</button>
              </div>
            ) : (
              <>
                <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
                  <p className="text-[11px] uppercase tracking-widest text-white/40">3 quick steps</p>
                  <ol className="space-y-3 text-sm text-white/80">
                    <li className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-henry-accent/20 border border-henry-accent/40 text-henry-accent flex items-center justify-center text-xs font-bold">1</span>
                      <span>Click <b className="text-white">Open Settings</b> below. Both windows will open: a Finder window with Henry highlighted, and the Accessibility list.</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-henry-accent/20 border border-henry-accent/40 text-henry-accent flex items-center justify-center text-xs font-bold">2</span>
                      <span>In System Settings, click the <b className="text-white">+</b> button below the list. In the picker, choose <b className="text-white">Henry AI</b> from /Applications.</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-henry-accent/20 border border-henry-accent/40 text-henry-accent flex items-center justify-center text-xs font-bold">3</span>
                      <span>Toggle Henry AI <b className="text-white">ON</b>. Enter your password if asked. <span className="text-henry-accent">This wizard auto-advances</span> when it's done.</span>
                    </li>
                  </ol>
                </div>

                <button onClick={openAccessibilitySettings} className={primaryBtn}>
                  Open Settings + show Henry in Finder →
                </button>

                <div className="flex items-center justify-center gap-2 text-xs text-white/40">
                  <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                  <span>Watching for permission… (auto-advances) {acc === false ? '— not detected yet' : ''}</span>
                </div>

                {/* If toggle is ON in Settings but check still says missing, user can move on. */}
                <button onClick={next} className={secondaryBtn}>
                  I already enabled it — move on →
                </button>

                <button onClick={skipStep} className={ghostBtn + ' block w-full text-center'}>
                  Skip for now — I'll grant later
                </button>
              </>
            )}
          </div>
        )}

        {/* ===================== SCREEN RECORDING ===================== */}
        {step === 'screen' && (
          <div className="space-y-5">
            <div className="text-center">
              <p className="text-5xl mb-3">📸</p>
              <h2 className="text-2xl font-bold text-white">Screen Recording</h2>
              <p className="text-white/55 text-sm mt-2 leading-relaxed">
                Lets Henry take screenshots and see your screen when you ask him to.
              </p>
            </div>

            {scr === true ? (
              <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-5 text-center space-y-3">
                <p className="text-3xl">✓</p>
                <p className="text-green-400 font-semibold">Screen Recording is enabled</p>
                <button onClick={next} className={primaryBtn}>Continue →</button>
              </div>
            ) : (
              <>
                <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4">
                  <p className="text-[11px] uppercase tracking-widest text-white/40">Same as last step — different list</p>
                  <ol className="space-y-3 text-sm text-white/80">
                    <li className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-henry-accent/20 border border-henry-accent/40 text-henry-accent flex items-center justify-center text-xs font-bold">1</span>
                      <span>Click <b className="text-white">Open Settings</b> below. The <b className="text-white">Screen &amp; System Audio Recording</b> pane will open.</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-henry-accent/20 border border-henry-accent/40 text-henry-accent flex items-center justify-center text-xs font-bold">2</span>
                      <span>Click <b className="text-white">+</b> → select <b className="text-white">Henry AI</b> from /Applications → click Open.</span>
                    </li>
                    <li className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-henry-accent/20 border border-henry-accent/40 text-henry-accent flex items-center justify-center text-xs font-bold">3</span>
                      <span>Toggle <b className="text-white">ON</b>. <span className="text-henry-accent">This wizard auto-advances</span> when it's done.</span>
                    </li>
                  </ol>
                </div>

                <button onClick={openScreenRecordingSettings} className={primaryBtn}>
                  Open Settings + show Henry in Finder →
                </button>

                <div className="flex items-center justify-center gap-2 text-xs text-white/40">
                  <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                  <span>Watching for permission… (auto-advances) {scr === false ? '— not detected yet' : ''}</span>
                </div>

                {/* Move-on escape hatch: macOS sometimes lies to adhoc-signed apps */}
                <button onClick={next} className={secondaryBtn}>
                  I already enabled it — move on →
                </button>

                <button onClick={skipStep} className={ghostBtn + ' block w-full text-center'}>
                  Skip for now
                </button>
              </>
            )}
          </div>
        )}

        {/* ===================== AI PROVIDER ===================== */}
        {step === 'ai' && (
          <div className="space-y-5">
            <div className="text-center">
              <p className="text-5xl mb-3">⚡</p>
              <h2 className="text-2xl font-bold text-white">AI brain</h2>
              <p className="text-white/55 text-sm mt-2 leading-relaxed">
                Add a free <b className="text-white">Groq</b> key (60 seconds) for fast unlimited responses,<br/>
                or skip and use Henry's bundled fallback.
              </p>
            </div>

            {hasAi ? (
              <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-5 text-center space-y-3">
                <p className="text-3xl">✓</p>
                <p className="text-green-400 font-semibold">Groq key configured</p>
                <button onClick={next} className={primaryBtn}>Continue →</button>
              </div>
            ) : (
              <>
                <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-3">
                  <p className="text-[11px] uppercase tracking-widest text-white/40">How to get a key</p>
                  <ol className="space-y-2.5 text-sm text-white/80">
                    <li className="flex gap-3"><span className="flex-shrink-0 w-6 h-6 rounded-full bg-henry-accent/20 border border-henry-accent/40 text-henry-accent flex items-center justify-center text-xs font-bold">1</span><span>Click “Open Groq” below — sign up free.</span></li>
                    <li className="flex gap-3"><span className="flex-shrink-0 w-6 h-6 rounded-full bg-henry-accent/20 border border-henry-accent/40 text-henry-accent flex items-center justify-center text-xs font-bold">2</span><span>Visit <b className="text-white">API Keys</b> → Create API Key → copy the <code className="text-henry-accent">gsk_…</code> string.</span></li>
                    <li className="flex gap-3"><span className="flex-shrink-0 w-6 h-6 rounded-full bg-henry-accent/20 border border-henry-accent/40 text-henry-accent flex items-center justify-center text-xs font-bold">3</span><span>Paste it here. Henry saves it locally on this Mac — it never leaves your machine.</span></li>
                  </ol>
                  <button
                    onClick={() => {
                      const api = getApi();
                      if (typeof api?.computerRunShell === 'function') {
                        api.computerRunShell({ command: 'open https://console.groq.com/keys', timeout: 3000 });
                      } else {
                        try { window.open('https://console.groq.com/keys', '_blank'); } catch { /* */ }
                      }
                    }}
                    className="w-full mt-2 py-2.5 rounded-lg border border-henry-accent/30 bg-henry-accent/10 text-henry-accent text-xs font-semibold hover:bg-henry-accent/20 transition-all">
                    Open console.groq.com/keys ↗
                  </button>
                </div>

                <div className="space-y-2">
                  <input
                    type="password"
                    value={groqKey}
                    onChange={e => { setGroqKey(e.target.value); if (groqError) setGroqError(''); }}
                    onKeyDown={e => { if (e.key === 'Enter' && groqKey.trim()) void saveGroqKey(); }}
                    placeholder="gsk_…"
                    className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-white placeholder:text-white/30 outline-none focus:border-henry-accent/60 transition-all font-mono text-sm"
                    autoFocus
                  />
                  {groqError && <p className="text-red-400 text-xs px-1">{groqError}</p>}
                </div>

                <button onClick={saveGroqKey} disabled={!groqKey.trim() || groqSaving} className={primaryBtn}>
                  {groqSaving ? 'Saving…' : 'Save key + continue →'}
                </button>

                <button onClick={skipStep} className={ghostBtn + ' block w-full text-center'}>
                  Skip — I'll add a key later in Settings
                </button>
              </>
            )}
          </div>
        )}

        {/* ===================== MOBILE PAIRING ===================== */}
        {step === 'mobile' && (
          <div className="space-y-5">
            <div className="text-center">
              <p className="text-5xl mb-3">📱</p>
              <h2 className="text-2xl font-bold text-white">Pair your phone</h2>
              <p className="text-white/55 text-sm mt-2 leading-relaxed">
                Scan this QR with your iPhone or iPad camera — Henry pairs automatically.<br/>
                Or open the URL below in Safari.
              </p>
            </div>

            {linkedDevices.length > 0 ? (
              <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-5 text-center space-y-2">
                <p className="text-3xl">✓</p>
                <p className="text-green-400 font-semibold">{linkedDevices.length} device{linkedDevices.length === 1 ? '' : 's'} paired</p>
                <p className="text-white/50 text-xs">{linkedDevices.map(d => d.name || 'iPhone').join(', ')}</p>
                <button onClick={next} className={primaryBtn + ' mt-3'}>Continue →</button>
              </div>
            ) : (
              <>
                <div className="bg-white border border-white/15 rounded-2xl p-5 flex flex-col items-center gap-3">
                  {pairCode ? (
                    <>
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=10&data=${encodeURIComponent(pairCode)}`}
                        alt="Pairing QR code"
                        width={240}
                        height={240}
                        className="rounded-lg"
                      />
                      <p className="text-xs text-black/60 font-medium">
                        Expires in {Math.floor(pairCountdown / 60)}:{String(pairCountdown % 60).padStart(2, '0')}
                      </p>
                    </>
                  ) : generating ? (
                    <div className="w-[240px] h-[240px] flex items-center justify-center text-black/40 text-sm">Generating QR…</div>
                  ) : (
                    <div className="w-[240px] h-[240px] flex items-center justify-center">
                      <button onClick={generatePair} className="px-4 py-2 rounded-lg bg-henry-accent text-white text-sm font-semibold">Generate QR</button>
                    </div>
                  )}
                </div>

                {(lanUrl || tunnelUrl) && (
                  <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                    {lanUrl && (
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Same Wi-Fi</p>
                        <div className="flex items-center gap-2">
                          <p className="text-white font-mono text-xs flex-1 break-all">{lanUrl}</p>
                          <button onClick={() => navigator.clipboard?.writeText(lanUrl)} className="text-[11px] text-henry-accent hover:underline flex-shrink-0">Copy</button>
                        </div>
                      </div>
                    )}
                    {tunnelUrl && (
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-green-400/70 mb-1">From anywhere (cellular OK)</p>
                        <div className="flex items-center gap-2">
                          <p className="text-white font-mono text-xs flex-1 break-all">{tunnelUrl}</p>
                          <button onClick={() => navigator.clipboard?.writeText(tunnelUrl)} className="text-[11px] text-henry-accent hover:underline flex-shrink-0">Copy</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-center gap-2 text-xs text-white/40">
                  <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                  <span>Waiting for pairing… (auto-advances when done)</span>
                </div>

                {/* Escape hatch: if pairing already happened or user wants to move on */}
                <button onClick={next} className={secondaryBtn}>
                  Already paired — move on →
                </button>

                <button onClick={skipStep} className={ghostBtn + ' block w-full text-center'}>
                  Skip — I'll pair my phone later
                </button>
              </>
            )}
          </div>
        )}

        {/* ===================== DONE ===================== */}
        {step === 'done' && (
          <div className="space-y-5">
            <div className="text-center">
              <p className="text-6xl mb-3">✓</p>
              <h2 className="text-3xl font-black text-white">Henry is ready</h2>
              <p className="text-white/55 text-sm mt-2 leading-relaxed">
                Setup complete. Your status:
              </p>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-2.5">
              {[
                { label: 'Accessibility', ok: acc === true },
                { label: 'Screen Recording', ok: scr === true },
                { label: 'AI Provider', ok: hasAi },
                { label: 'Mobile Companion', ok: linkedDevices.length > 0 },
              ].map(item => (
                <div key={item.label} className="flex items-center justify-between text-sm">
                  <span className="text-white/80">{item.label}</span>
                  <span className={item.ok ? 'text-green-400 font-semibold' : 'text-white/40'}>
                    {item.ok ? '✓ Ready' : '— Skipped'}
                  </span>
                </div>
              ))}
            </div>

            <div className="bg-henry-accent/10 border border-henry-accent/25 rounded-2xl p-4 space-y-2">
              <p className="text-[10px] uppercase tracking-widest text-henry-accent">Try saying</p>
              {[
                '“What should I work on today?”',
                '“Add a reminder to call Mom tomorrow at 10am”',
                '“Take a screenshot”',
                '“Look up John 3:16”',
              ].map(s => (
                <p key={s} className="text-white/70 text-xs">{s}</p>
              ))}
            </div>

            <button onClick={finish} className={primaryBtn}>Open Henry →</button>
            <button onClick={() => setStep('welcome')} className={ghostBtn + ' block w-full text-center'}>
              ← Restart wizard
            </button>
          </div>
        )}

        {/* Back link */}
        {stepIdx > 0 && step !== 'done' && (
          <button onClick={back} className="w-full text-center text-white/30 text-xs hover:text-white/60 transition-all mt-4">← Back</button>
        )}
      </div>
    </div>
  );
}

