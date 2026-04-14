import { useEffect, useState, useRef } from 'react';
import Layout from './components/layout/Layout';
import SetupWizard from './components/wizard/SetupWizard';
import ElectronAutoSetup from './components/wizard/ElectronAutoSetup';
import ClipboardAIToast from './components/ClipboardAIToast';
import { useStore } from './store';
import type { Task } from './types';
import { startProactiveNudges, type HenryNudge } from './henry/proactiveNudges';
import { seedWorkspace } from './henry/workspaceSeeder';
import { registerAllHandlers } from './actions/registry/actionRegistry';
import { useGoogleStore } from './henry/googleStore';
import { useCapturesStore } from './ambient/capturesStore';
import { startBackgroundBrain } from './brain/backgroundBrain';

// ── Temporary startup diagnostics — remove when hang is identified ──────────
function withTimeout<T>(promise: Promise<T>, label: string, ms = 5000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

async function diagCall<T>(label: string, p: Promise<T>): Promise<T> {
  console.log(`[Henry:diag] → ${label}`);
  const t = Date.now();
  const timer = setTimeout(
    () => console.warn(`[Henry:diag] ⚠ ${label} still pending after 4 s — likely hanging`),
    4000
  );
  try {
    const result = await p;
    clearTimeout(timer);
    console.log(`[Henry:diag] ✓ ${label} resolved in ${Date.now() - t} ms`);
    return result;
  } catch (err) {
    clearTimeout(timer);
    console.error(`[Henry:diag] ✗ ${label} rejected in ${Date.now() - t} ms:`, err);
    throw err;
  }
}

const HENRY_FIRST_MESSAGE = `Hey. I'm up and running.

Before we dive in — what's the most important thing on your plate right now? It could be a project you're working on, something you want to write, a question you've been turning over, or honestly anything. Just tell me and we'll start there.

If you want to explore what I can do first, try saying something like "show me what you can do" — or just talk to me like you would a smart colleague who's always around.`;

export default function App() {
  const [loading, setLoading] = useState(true);
  const [updateState, setUpdateState] = useState<'none' | 'available' | 'downloaded'>('none');
  const [nudge, setNudge] = useState<HenryNudge | null>(null);
  const firstContactDone = useRef(false);
  const {
    setupComplete,
    setSetupComplete,
    setConversations,
    setProviders,
    setActiveConversation,
    addMessage,
    setCompanionStatus,
    setWorkerStatus,
    updateTask,
    setCurrentView,
    settings,
  } = useStore();

  useEffect(() => {
    void initApp();
    const cleanup = setupEventListeners();
    const stopNudges = startProactiveNudges((n) => setNudge(n));
    const stopBrain = startBackgroundBrain();
    return () => { cleanup(); stopNudges(); stopBrain(); };
  }, []);

  // Henry's autonomous first contact — fires once after wizard completes
  useEffect(() => {
    if (!setupComplete || firstContactDone.current) return;
    const isFirstLaunch = useStore.getState().settings.henry_first_launch === 'true';
    if (!isFirstLaunch) return;

    firstContactDone.current = true;
    void triggerFirstContact();
  }, [setupComplete, settings.henry_first_launch]);

  async function triggerFirstContact() {
    try {
      const convo = await window.henryAPI.createConversation("First session with Henry");
      const convos = await window.henryAPI.getConversations();
      setConversations(convos);
      setActiveConversation(convo.id);

      const firstMsg = {
        id: `henry-first-${Date.now()}`,
        conversation_id: convo.id,
        role: 'assistant' as const,
        content: HENRY_FIRST_MESSAGE,
        engine: 'companion' as const,
        created_at: new Date().toISOString(),
      };

      await window.henryAPI.saveMessage(firstMsg);
      addMessage(firstMsg);
      setCurrentView('chat');

      // Clear first launch flag
      await window.henryAPI.saveSetting('henry_first_launch', 'false');
      useStore.getState().updateSetting('henry_first_launch', 'false');
    } catch (err) {
      console.error('Failed to deliver Henry first contact:', err);
    }
  }

  async function initApp() {
    console.log('[INIT] start');
    try {
      // URL bypass: ?enter or #enter skips wizard immediately
      const urlBypass =
        window.location.search.includes('enter') ||
        window.location.hash === '#enter' ||
        window.location.hash === '#henry';
      if (urlBypass) {
        await diagCall('saveSetting(setup_complete)', window.henryAPI.saveSetting('setup_complete', 'true'));
        // Clean the URL without reload
        history.replaceState(null, '', window.location.pathname);
      }

      void registerAllHandlers();
      useCapturesStore.getState().init();
      // Restore Google auth from main process (PKCE flow) or localStorage
      void useGoogleStore.getState().restoreFromStorage();
      console.log('[INIT] bootstrap providers');
      // ── Auto-bootstrap Groq from server env key (web/Replit preview mode) ──
      // Always refresh the key from the env var so stale/empty localStorage
      // entries never cause "Failed to fetch" errors.
      const envGroqKey = typeof __GROQ_API_KEY__ !== 'undefined' ? __GROQ_API_KEY__ : '';
      if (envGroqKey) {
        const existingProviders: HenryProviderRecord[] = (() => {
          try { return JSON.parse(localStorage.getItem('henry:providers') || '[]'); } catch { return []; }
        })();
        const savedGroq = existingProviders.find((p: any) => p.id === 'groq');
        const savedKey = savedGroq?.api_key || (savedGroq as any)?.apiKey || '';

        // Always upsert if the stored key differs from the env key (covers first-run
        // AND any key rotation or storage corruption scenario)
        if (savedKey !== envGroqKey) {
          await diagCall('saveProvider(groq)', window.henryAPI.saveProvider({
            id: 'groq',
            name: 'Groq',
            api_key: envGroqKey,
            enabled: 1,
            models: JSON.stringify([]),
          } as any));
          await window.henryAPI.saveSetting('companion_provider', 'groq');
          await window.henryAPI.saveSetting('companion_model', 'llama-3.1-8b-instant');
          await window.henryAPI.saveSetting('worker_provider', 'groq');
          await window.henryAPI.saveSetting('worker_model', 'llama-3.3-70b-versatile');
          await window.henryAPI.saveSetting('setup_complete', 'true');
        }
      }

      console.log('[INIT] getSettings');
      const settingsMap = (await diagCall('getSettings', window.henryAPI.getSettings())) as Record<string, string>;

      Object.entries(settingsMap).forEach(([key, value]) => {
        useStore.getState().updateSetting(key, value);
      });

      // Check setup_complete from API result OR directly from localStorage as fallback
      const lsSettings = (() => {
        try { return JSON.parse(localStorage.getItem('henry:settings') || '{}'); } catch { return {}; }
      })();

      const isComplete =
        settingsMap.setup_complete === 'true' ||
        lsSettings.setup_complete === 'true';

      // Also auto-enter if providers are already saved (returning user whose flag got cleared)
      const lsProviders: HenryProviderRecord[] = (() => {
        try { return JSON.parse(localStorage.getItem('henry:providers') || '[]'); } catch { return []; }
      })();
      const hasProviders = lsProviders.length > 0;

      if (isComplete || hasProviders) {
        // Mark complete if only providers existed without the flag
        if (!isComplete && hasProviders) {
          await window.henryAPI.saveSetting('setup_complete', 'true');
        }

        // Hardwire Groq as permanent default for both engines if not already set
        const groqProvider = lsProviders.find((p: any) => p.id === 'groq');
        if (groqProvider && groqProvider.enabled) {
          const needsCompanion = !settingsMap.companion_provider;
          const needsWorker = !settingsMap.worker_provider;
          if (needsCompanion) {
            await window.henryAPI.saveSetting('companion_provider', 'groq');
            await window.henryAPI.saveSetting('companion_model', 'llama-3.1-8b-instant');
            useStore.getState().updateSetting('companion_provider', 'groq');
            useStore.getState().updateSetting('companion_model', 'llama-3.1-8b-instant');
          }
          if (needsWorker) {
            await window.henryAPI.saveSetting('worker_provider', 'groq');
            await window.henryAPI.saveSetting('worker_model', 'llama-3.3-70b-versatile');
            useStore.getState().updateSetting('worker_provider', 'groq');
            useStore.getState().updateSetting('worker_model', 'llama-3.3-70b-versatile');
          }
        }

        setSetupComplete(true);

        // Seed workspace on first run (idempotent — safe to call every launch)
        try { seedWorkspace(); } catch { /* non-critical */ }

        console.log('[INIT] getConversations');
        const convos = await withTimeout(
          window.henryAPI.getConversations(),
          'getConversations'
        ).catch((err: unknown) => {
          console.error('[Henry] getConversations failed:', err);
          return [] as Awaited<ReturnType<typeof window.henryAPI.getConversations>>;
        });

        console.log('[INIT] getProviders');
        const providers = await withTimeout(
          window.henryAPI.getProviders(),
          'getProviders'
        ).catch((err: unknown) => {
          console.error('[Henry] getProviders failed:', err);
          return [] as Awaited<ReturnType<typeof window.henryAPI.getProviders>>;
        });

        setConversations(convos);
        setProviders(
          providers.map((p: HenryProviderRecord) => ({
            id: p.id,
            name: p.name,
            apiKey: p.api_key || p.apiKey || '',
            enabled: Boolean(p.enabled),
            models: typeof p.models === 'string' ? JSON.parse(p.models || '[]') : (p.models || []),
          }))
        );
      }
    } catch (err) {
      console.error('Failed to init app:', err);
    } finally {
      console.log('[INIT] done');
      setLoading(false);
    }
  }

  function setupEventListeners() {
    const unsubEngine = window.henryAPI.onEngineStatus((data) => {
      if (data.engine === 'companion') {
        setCompanionStatus(data);
      } else if (data.engine === 'worker') {
        setWorkerStatus(data);
      }
    });

    const unsubTask = window.henryAPI.onTaskUpdate((data) => {
      updateTask(data.id, data);
    });

    const unsubResult = window.henryAPI.onTaskResult((data) => {
      updateTask(data.taskId, {
        id: data.taskId,
        ...(data.error !== undefined ? { error: data.error } : {}),
        ...(data.result !== undefined ? { result: typeof data.result === 'string' ? data.result : JSON.stringify(data.result) } : {}),
      } as Partial<Task>);

      if (!data.conversationId) return;

      if (data.error) {
        useStore.getState().addMessage({
          id: `task-result-${data.taskId}-error`,
          conversation_id: data.conversationId,
          role: 'assistant',
          content: `⚠️ *Worker task failed:*\n\n${data.error}`,
          engine: 'worker',
          created_at: new Date().toISOString(),
        });
        return;
      }

      const result = typeof data.result === 'string'
        ? data.result
        : data.result?.content || JSON.stringify(data.result ?? {});

      useStore.getState().addMessage({
        id: `task-result-${data.taskId}`,
        conversation_id: data.conversationId,
        role: 'assistant',
        content: `⚡ *Worker task completed:*\n\n${result}`,
        engine: 'worker',
        model: typeof data.result === 'object' && data.result ? data.result.model : undefined,
        cost: typeof data.result === 'object' && data.result ? data.result.cost : undefined,
        created_at: new Date().toISOString(),
      });
    });

    const unsubUpdateAvailable = window.henryAPI.onUpdateAvailable(() => {
      setUpdateState('available');
    });
    const unsubUpdateDownloaded = window.henryAPI.onUpdateDownloaded(() => {
      setUpdateState('downloaded');
    });

    return () => {
      unsubEngine();
      unsubTask();
      unsubResult();
      unsubUpdateAvailable();
      unsubUpdateDownloaded();
    };
  }

  if (loading) {
    return (
      <div style={{ background: 'black', color: 'white', padding: 40, fontFamily: 'monospace' }}>
        Henry is loading...
      </div>
    );
  }

  if (!setupComplete) {
    // In Electron: skip the wizard entirely — run auto-setup immediately
    const isElectron = typeof window.henryAPI?.ollamaIsInstalled === 'function';
    if (isElectron) {
      return <ElectronAutoSetup onComplete={() => setSetupComplete(true)} />;
    }
    return <SetupWizard />;
  }

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden">
      {updateState !== 'none' && (
        <div className="shrink-0 flex items-center justify-between px-4 py-2 bg-henry-accent/15 border-b border-henry-accent/25 text-sm text-henry-text">
          <span>
            {updateState === 'downloaded'
              ? '✅ Henry update ready — restart to apply'
              : '⬇️ A Henry update is downloading in the background'}
          </span>
          <div className="flex items-center gap-3">
            {updateState === 'downloaded' && (
              <button
                onClick={() => void window.henryAPI.installUpdate()}
                className="text-xs px-3 py-1 rounded-lg bg-henry-accent text-white hover:bg-henry-accent/80 transition-colors font-medium"
              >
                Restart &amp; update
              </button>
            )}
            <button
              onClick={() => setUpdateState('none')}
              className="text-henry-text-muted hover:text-henry-text transition-colors"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      <div className="flex-1 min-h-0">
        <Layout />
      </div>

      {/* Proactive nudge banner */}
      {nudge && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
          <div className="flex items-center gap-3 bg-henry-surface/95 border border-henry-border/60 backdrop-blur-xl rounded-2xl shadow-xl px-5 py-3.5 max-w-sm">
            <span className="text-xl shrink-0">{nudge.icon ?? '💡'}</span>
            <p className="text-sm text-henry-text leading-snug flex-1">{nudge.message}</p>
            <button
              onClick={() => {
                useStore.getState().setCurrentView('chat');
                window.dispatchEvent(new CustomEvent('henry_inject_draft', { detail: { text: nudge.cta ?? nudge.message } }));
                setNudge(null);
              }}
              className="shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold bg-henry-accent/15 text-henry-accent border border-henry-accent/20 hover:bg-henry-accent/25 transition-all"
            >
              Open
            </button>
            <button
              onClick={() => setNudge(null)}
              className="shrink-0 text-henry-text-muted hover:text-henry-text transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Clipboard AI toast */}
      <ClipboardAIToast />
    </div>
  );
}
