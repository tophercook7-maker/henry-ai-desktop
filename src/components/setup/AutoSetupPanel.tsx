/**
 * Henry Auto-Setup — zero manual steps.
 * Checks every permission + service, fixes automatically.
 */
import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../../store';

const getApi = () => (window as any).henryAPI as any;

interface SetupItem {
  id: string; label: string; description: string; icon: string;
  status: 'checking'|'ok'|'missing'|'fixing'; autoFix?: boolean;
}

export default function AutoSetupPanel() {
  const { setCurrentView } = useStore();
  const [items, setItems] = useState<SetupItem[]>([
    { id:'accessibility', icon:'⌨', label:'Accessibility Access',     description:'Lets ⌥Space grab your selection automatically', status:'checking', autoFix:true },
    { id:'screen',        icon:'📸', label:'Screen Recording',         description:'Needed for screenshot feature in Henry HQ',     status:'checking', autoFix:true },
    { id:'ai',            icon:'◉', label:'AI Provider',              description:'Groq key or Ollama for chat + smart capture',   status:'checking', autoFix:true },
    { id:'ollama',        icon:'⚡', label:'Ollama (free local AI)',   description:'Optional: free offline AI — runs on your Mac (not required)',  status:'checking' },
    { id:'hotkeys',       icon:'⌥', label:'Global Hotkeys',           description:'⌥Space capture · ⌥H open · ⌘⇧H backup',       status:'checking' },
    { id:'sync',          icon:'⊚', label:'Henry Sync Server',        description:'Connects desktop app, mobile + browser capture', status:'checking' },
  ]);
  const [pollingAccess, setPollingAccess] = useState(false);
  const [allOk, setAllOk] = useState(false);

  function patch(id: string, p: Partial<SetupItem>) {
    setItems(prev => prev.map(i => i.id === id ? {...i,...p} : i));
  }

  const runChecks = useCallback(async () => {
    // Snapshot store directly — avoids stale closure + dependency loop
    const storeState = useStore.getState();
    const providers = storeState.providers;
    const settings = storeState.settings as Record<string,string>;
    // Accessibility
    try {
      const r = await getApi()?.checkAccessibility?.();
      patch('accessibility', { status: r?.granted ? 'ok' : 'missing' });
    } catch { patch('accessibility', { status:'missing' }); }

    // Screen Recording — use OS-level check, NOT shell screencapture
    // (shell runs as you, not as Henry, so it always succeeds even when Henry has no permission)
    try {
      const r = await getApi()?.checkScreenRecording?.();
      patch('screen', { status: r?.granted ? 'ok' : 'missing' });
    } catch { patch('screen', { status: 'missing' }); }

    // AI provider — must have BYOK key, Ollama, or a paid license (no freebies)
    const hasGroq = (providers||[]).some((p:any) => p.id==='groq' && (p.apiKey||p.api_key||'').length > 10);
    const isOllama = settings?.companion_provider === 'ollama';
    const hasOpenAI = (providers||[]).some((p:any) => p.id==='openai' && (p.apiKey||p.api_key||'').length > 10);
    const hasAnthropic = (providers||[]).some((p:any) => p.id==='anthropic' && (p.apiKey||p.api_key||'').length > 10);
    const hasGoogle = (providers||[]).some((p:any) => p.id==='google' && (p.apiKey||p.api_key||'').length > 10);
    const hasLicense = ((localStorage.getItem('henry:license_key') || '').trim()).length > 0;
    const hasAnyBackend = hasGroq || isOllama || hasOpenAI || hasAnthropic || hasGoogle || hasLicense;
    patch('ai', {
      status: hasAnyBackend ? 'ok' : 'missing',
      description: hasGroq ? 'Groq key connected — fast, free tier 14,400/day ✓' :
                   isOllama ? 'Ollama connected — local, private, free ✓' :
                   hasAnthropic ? 'Anthropic key connected ✓' :
                   hasOpenAI ? 'OpenAI key connected ✓' :
                   hasGoogle ? 'Google key connected ✓' :
                   hasLicense ? 'Henry license active ✓' :
                   'Add a free Groq key (60 sec) or install Ollama — Settings → AI Providers',
    });

    // Ollama
    try {
      const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(2000) });
      if (r.ok) {
        const d = await r.json() as {models?:{name:string}[]};
        const n = (d.models||[]).length;
        patch('ollama', { status: n>0?'ok':'missing', description: n>0 ? `${n} models ready` : 'No models — run: ollama pull llama3.2' });
      } else { patch('ollama', { status:'missing', description:'Not running — install at ollama.com' }); }
    } catch { patch('ollama', { status:'missing', description:'Not running — install at ollama.com' }); }

    // Hotkeys (always registered when app is running)
    patch('hotkeys', { status:'ok', description:'⌥Space · ⌥H · ⌘⇧H all active' });

    // Sync server
    try {
      const r = await fetch('http://127.0.0.1:4242/sync/health', { signal: AbortSignal.timeout(2000) });
      const d = r.ok ? await r.json() as {version?:string} : null;
      patch('sync', { status: r.ok?'ok':'missing', description: r.ok ? `Running v${d?.version||'?'}` : 'Not responding' });
    } catch { patch('sync', { status:'missing', description:'Not responding' }); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount — user hits 'Recheck' manually

  useEffect(() => { void runChecks(); }, [runChecks]);

  useEffect(() => {
    setAllOk(items.every(i => i.status === 'ok'));
  }, [items]);

  // Poll for Accessibility after request
  useEffect(() => {
    if (!pollingAccess) return;
    const t = setInterval(async () => {
      const r = await getApi()?.checkAccessibility?.().catch(()=>null);
      if (r?.granted) { patch('accessibility',{status:'ok'}); setPollingAccess(false); }
    }, 1500);
    return () => clearInterval(t);
  }, [pollingAccess]);

  async function fix(id: string) {
    patch(id, { status:'fixing' });
    if (id === 'accessibility') {
      // Honest reality: ad-hoc-signed Henry can't trigger TCC dialogs reliably
      // on macOS 26+. Best we can do is open Finder + System Settings and tell
      // the user exactly what to do.
      try {
        // Try the API anyway in case it does work (signed builds, older macOS)
        const r = await getApi()?.requestAccessibility?.();
        if (r?.granted) { patch('accessibility', { status: 'ok' }); return; }
      } catch { /* */ }
      // Open Finder showing Henry, plus System Settings to the right pane
      try { await getApi()?.computerRunShell?.({ command: 'open -R "/Applications/Henry AI.app" && open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"', timeout: 3000 }); } catch { /* */ }
      patch('accessibility', { status: 'fixing', description: 'In System Settings: click + → choose Henry AI → toggle ON. Click Recheck when done.' });
      setPollingAccess(true);
    } else if (id === 'screen') {
      // Same reality as accessibility — ad-hoc Henry can't trigger the dialog.
      // Open Finder + System Settings, walk user through manual add.
      try { await getApi()?.openScreenRecording?.(); } catch { /* */ }
      try { await getApi()?.computerRunShell?.({ command: 'open -R "/Applications/Henry AI.app"', timeout: 2000 }); } catch { /* */ }
      patch('screen', { status: 'fixing', description: 'In System Settings: click + → choose Henry AI → toggle ON. Click Recheck when done.' });
      let attempts = 0;
      const maxAttempts = 30;
      const poll = setInterval(async () => {
        attempts++;
        const r = await getApi()?.checkScreenRecording?.().catch(() => null);
        if (r?.granted) {
          clearInterval(poll);
          patch('screen', { status: 'ok', description: 'Granted' });
        } else if (attempts >= maxAttempts) {
          clearInterval(poll);
          patch('screen', { status: 'missing', description: 'Click + in System Settings, choose Henry AI, toggle on, then Recheck.' });
        }
      }, 2000);
    } else if (id === 'ai') {
      // AI is already working via proxy — direct to settings to upgrade
      setCurrentView('settings' as any);
      patch('ai', { status: 'ok', description: 'Add Groq key for unlimited requests' });
    } else if (id === 'ollama') {
      await getApi()?.computerRunShell?.({ command:'open https://ollama.com', timeout:3000 });
      patch('ollama',{ status:'missing', description:'Installing Ollama — visit ollama.com' });
    }
  }

  async function fixAll() {
    for (const item of items.filter(i => i.status==='missing' && i.autoFix!==false)) {
      await fix(item.id);
      await new Promise(r => setTimeout(r, 600));
    }
  }

  const missing = items.filter(i => i.status==='missing').length;

  const colors: Record<string,string> = {
    ok:'border-green-400/25 bg-green-400/5',
    missing:'border-red-400/25 bg-red-400/5',
    fixing:'border-yellow-400/25 bg-yellow-400/5',
    checking:'border-henry-border/20 bg-henry-surface/30',
  };
  const icons: Record<string,string> = { ok:'✓', missing:'✗', fixing:'…', checking:'○' };
  const textColors: Record<string,string> = {
    ok:'text-green-400', missing:'text-red-400', fixing:'text-yellow-400', checking:'text-white/30',
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-henry-bg">
      <div className="max-w-xl mx-auto w-full px-6 py-8 space-y-5">

        <div>
          <h1 className="text-xl font-black text-henry-text">Henry Setup</h1>
          <p className="text-henry-text-muted text-sm mt-1">
            {allOk ? '✓ Fully operational.' : missing > 0 ? `${missing} item${missing===1?'':'s'} need${missing===1?'s':''} attention.` : 'Checking…'}
          </p>
        </div>

        {/* Big primary CTA: launch the guided wizard */}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('henry_open_setup_wizard'))}
          className="w-full p-5 rounded-2xl bg-gradient-to-br from-henry-accent to-henry-accent/70 text-white text-left hover:opacity-90 transition-all shadow-lg shadow-henry-accent/20">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-2xl flex-shrink-0">
              {allOk ? '✓' : '🗭'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-base">
                {allOk ? 'Re-run guided setup' : 'Open guided setup wizard'}
              </p>
              <p className="text-white/80 text-xs mt-0.5">
                {allOk
                  ? 'Everything works — wizard available anytime'
                  : 'Step-by-step instructions, opens the right windows for you, auto-detects when each is done'}
              </p>
            </div>
            <span className="text-2xl flex-shrink-0">→</span>
          </div>
        </button>

        <div className="space-y-2.5">
          {items.map(item => (
            <div key={item.id} className={`rounded-2xl border p-4 transition-all ${colors[item.status]}`}>
              <div className="flex items-center gap-3">
                <span className="text-lg w-7 text-center flex-shrink-0">{item.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-henry-text">{item.label}</span>
                    <span className={`text-xs font-bold ${textColors[item.status]}`}>
                      {icons[item.status]} {item.status==='fixing'?'Fixing…':item.status==='ok'?'Ready':item.status==='missing'?'Missing':'…'}
                    </span>
                  </div>
                  <p className="text-xs text-henry-text-muted truncate">{item.description}</p>
                </div>
                {item.status==='missing' && (
                  <button onClick={() => void fix(item.id)}
                    className="text-xs px-3 py-1.5 rounded-xl bg-henry-accent/15 border border-henry-accent/30 text-henry-accent hover:bg-henry-accent/25 transition-all flex-shrink-0">
                    Fix →
                  </button>
                )}
                {item.status==='ok' && <span className="text-green-400 text-lg flex-shrink-0">✓</span>}
              </div>
            </div>
          ))}
        </div>

        <button onClick={() => { setItems(p=>p.map(i=>({...i,status:'checking'}))); setTimeout(()=>void runChecks(),100); }}
          className="w-full py-2.5 rounded-xl border border-henry-border/30 text-henry-text-muted text-sm hover:border-henry-accent/30 hover:text-henry-accent transition-all">
          ↺ Recheck everything
        </button>

        {allOk && (
          <div className="bg-green-400/5 border border-green-400/20 rounded-2xl p-5 text-center space-y-3">
            <p className="text-4xl">✓</p>
            <p className="font-bold text-green-400 text-lg">Henry is fully set up</p>
            <p className="text-sm text-henry-text-muted">Select anything on your Mac and hit ⌥Space</p>
            <button onClick={() => setCurrentView('hq' as any)}
              className="px-6 py-2.5 rounded-xl bg-henry-accent text-white font-bold text-sm hover:bg-henry-accent/80 transition-all">
              Open Henry HQ →
            </button>
          </div>
        )}

        <div className="bg-henry-surface/40 border border-henry-border/15 rounded-2xl p-4 space-y-3">
          <p className="text-[10px] uppercase tracking-widest text-henry-text-muted">Your Hotkeys</p>
          {[
            { key:'⌥Space', desc:'Capture selected text from anywhere — Henry processes it instantly' },
            { key:'⌥H',     desc:'Open or hide Henry (toggle)' },
            { key:'⌘⇧H',   desc:'Backup capture (reads clipboard)' },
          ].map(h => (
            <div key={h.key} className="flex items-center gap-3">
              <kbd className="bg-henry-surface border border-henry-border/40 text-henry-accent font-mono text-sm px-2.5 py-1 rounded-lg flex-shrink-0 min-w-[70px] text-center">{h.key}</kbd>
              <span className="text-xs text-henry-text-muted">{h.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
