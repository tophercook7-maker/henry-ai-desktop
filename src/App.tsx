import { useEffect, useState, useRef } from 'react';
import Layout from './components/layout/Layout';
import SetupWizard from './components/wizard/SetupWizard';
import ElectronAutoSetup from './components/wizard/ElectronAutoSetup';
import ClipboardAIToast from './components/ClipboardAIToast';
import ErrorBoundary from './components/ErrorBoundary';
import { useStore } from './store';
import type { Task } from './types';
import { startProactiveNudges, type HenryNudge } from './henry/proactiveNudges';
import { seedWorkspace } from './henry/workspaceSeeder';
import { startSelfHealing, type HenryRepairEvent } from './henry/selfHealing';
import { getTodayBriefing, saveBriefing, buildBriefingPrompt, getTodayKey } from './henry/proactiveBriefing';
import { isNative } from './capacitor';
import CompanionApp from './components/mobile/CompanionApp';

// Check if companion mode is active
// Logic: on native, default to companion mode if paired (unless user explicitly chose full mode)
const COMPANION_MODE_KEY = 'henry:companion:mode';
function isCompanionMode(): boolean {
  if (!isNative) return false;
  try {
    const explicit = localStorage.getItem(COMPANION_MODE_KEY);
    if (explicit === 'full') return false;
    if (explicit === 'companion') return true;
    // Default: use companion mode if a desktop pairing config exists
    return !!localStorage.getItem('henry:companion:config');
  } catch {
    return false;
  }
}

const HENRY_FIRST_MESSAGE = `Hey. I'm up and running.

Before we dive in — what's the most important thing on your plate right now? It could be a project you're working on, something you want to write, a question you've been turning over, or honestly anything. Just tell me and we'll start there.

If you want to explore what I can do first, try saying something like "show me what you can do" — or just talk to me like you would a smart colleague who's always around.`;

export default function App() {
  const [loading, setLoading] = useState(true);
  const [updateState, setUpdateState] = useState<'none' | 'available' | 'downloaded'>('none');
  const [nudge, setNudge] = useState<HenryNudge | null>(null);
  const [repair, setRepair] = useState<HenryRepairEvent | null>(null);
  const firstContactDone = useRef(false);
  const briefingInjectedRef = useRef(false);
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
    const stopHealing = startSelfHealing((event) => {
      setRepair(event);
      setTimeout(() => setRepair(null), 8000);
    });
    return () => { cleanup(); stopNudges(); stopHealing(); };
  }, []);

  // Register service worker in production only
  useEffect(() => {
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then(() => console.log('[Henry] Service worker registered'))
        .catch((err) => console.warn('[Henry] SW registration failed:', err));
    }
  }, []);

  // Electron: companion sync bridge → renderer (Settings / chat can listen)
  useEffect(() => {
    const api = window.henryAPI;
    if (typeof api?.onCompanionDeviceLinked !== 'function') return;

    const bridge = (name: string, detail: unknown) => {
      window.dispatchEvent(new CustomEvent('henry_companion_bridge', { detail: { name, detail } }));
      window.dispatchEvent(new CustomEvent('henry_companion_devices_changed'));
    };

    const u0 = api.onCompanionDeviceLinked!((device) => bridge('device-linked', device));
    const u1 = api.onCompanionCapture!((capture) => bridge('capture', capture));
    const u2 = api.onCompanionPrompt!((data) => bridge('prompt', data));
    const u3 = api.onCompanionActionDecision!((decision) => bridge('action-decision', decision));

    return () => {
      u0();
      u1();
      u2();
      u3();
    };
  }, []);

  // Henry's autonomous first contact — fires once after wizard completes
  useEffect(() => {
    if (!setupComplete || firstContactDone.current) return;
    const isFirstLaunch = useStore.getState().settings.henry_first_launch === 'true';
    if (!isFirstLaunch) return;

    firstContactDone.current = true;
    void triggerFirstContact();
  }, [setupComplete, settings.henry_first_launch]);

  // Proactive daily briefing — inject into chat once per day, automatically
  useEffect(() => {
    if (!setupComplete || loading || briefingInjectedRef.current) return;

    const injectedKey = `henry:briefing_chat_injected:${getTodayKey()}`;
    if (localStorage.getItem(injectedKey) === 'true') return;

    briefingInjectedRef.current = true;

    // Delay slightly so the conversation list is loaded first
    const timer = setTimeout(() => { void injectDailyBriefing(injectedKey); }, 3500);
    return () => clearTimeout(timer);
  }, [setupComplete, loading]);

  async function injectDailyBriefing(injectedKey: string) {
    try {
      // If a briefing was already generated (in TodayPanel), reuse it
      let content = getTodayBriefing()?.content ?? null;

      if (!content) {
        // Build context from memory facts
        const facts: string[] = [];
        try {
          const raw = localStorage.getItem('henry:facts') || '[]';
          const arr = JSON.parse(raw) as Array<{ content?: string; text?: string }>;
          facts.push(...arr.slice(0, 20).map((f) => f.content || f.text || '').filter(Boolean));
        } catch { /* ignore */ }

        const factsStr = facts.slice(0, 10).join('\n');
        const prompt = buildBriefingPrompt(factsStr);

        // Build a simple non-streaming AI call using the companion provider
        const st = useStore.getState();
        const companionProvider = st.settings.companion_provider || 'groq';
        const companionModel = st.settings.companion_model || 'llama-3.1-8b-instant';
        const providerRecord = st.providers.find((p) => p.id === companionProvider);
        const apiKey = providerRecord?.apiKey || '';

        if (!apiKey) return; // No key configured — skip silently

        const result = await window.henryAPI.sendMessage({
          provider: companionProvider,
          model: companionModel,
          apiKey,
          messages: [{ role: 'user', content: prompt }],
          maxTokens: 200,
        });

        content = result.content || String(result ?? '');
        if (content) saveBriefing(content, companionModel);
      }

      if (!content) return;

      // Find active conversation, or use the most recent one
      const st = useStore.getState();
      let conversationId = st.activeConversationId;

      if (!conversationId) {
        const convos = await window.henryAPI.getConversations();
        if (convos.length > 0) {
          conversationId = convos[0].id;
          setConversations(convos);
          setActiveConversation(conversationId);
        } else {
          const newConvo = await window.henryAPI.createConversation('Today');
          conversationId = newConvo.id;
          const convos2 = await window.henryAPI.getConversations();
          setConversations(convos2);
          setActiveConversation(conversationId);
        }
      }

      const msg = {
        id: `briefing-${getTodayKey()}`,
        conversation_id: conversationId,
        role: 'assistant' as const,
        content,
        engine: 'companion' as const,
        created_at: new Date().toISOString(),
      };

      await window.henryAPI.saveMessage(msg);
      addMessage(msg);
      setCurrentView('chat');

      localStorage.setItem(injectedKey, 'true');
    } catch (err) {
      console.warn('[Henry] Daily briefing injection failed:', err);
    }
  }

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
    try {
      // URL bypass: ?enter or #enter skips wizard immediately
      const urlBypass =
        window.location.search.includes('enter') ||
        window.location.hash === '#enter' ||
        window.location.hash === '#henry';
      if (urlBypass) {
        await window.henryAPI.saveSetting('setup_complete', 'true');
        // Clean the URL without reload
        history.replaceState(null, '', window.location.pathname);
      }

      // ── Auto-bootstrap Groq from server env key (web/Replit preview mode) ──
      // Always refresh the key from the env var so stale/empty localStorage
      // entries never cause "Failed to fetch" errors.
      const envGroqKey = typeof __GROQ_API_KEY__ !== 'undefined' ? __GROQ_API_KEY__ : '';
      if (envGroqKey) {
        const existingProviders: HenryProviderRecord[] = (() => {
          try { return JSON.parse(localStorage.getItem('henry:providers') || '[]'); } catch { return []; }
        })();
        const savedGroq = existingProviders.find((p) => p.id === 'groq');
        const savedKey = savedGroq?.api_key || savedGroq?.apiKey || '';

        // Always upsert if the stored key differs from the env key (covers first-run
        // AND any key rotation or storage corruption scenario)
        if (savedKey !== envGroqKey) {
          await window.henryAPI.saveProvider({
            id: 'groq',
            name: 'Groq',
            api_key: envGroqKey,
            enabled: 1,
            models: JSON.stringify([]),
          } as any);
          await window.henryAPI.saveSetting('companion_provider', 'groq');
          await window.henryAPI.saveSetting('companion_model', 'llama-3.1-8b-instant');
          await window.henryAPI.saveSetting('worker_provider', 'groq');
          await window.henryAPI.saveSetting('worker_model', 'llama-3.3-70b-versatile');
          await window.henryAPI.saveSetting('setup_complete', 'true');
        }
      }

      const settingsMap = (await window.henryAPI.getSettings()) as Record<string, string>;

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

        const [convos, providers] = await Promise.all([
          window.henryAPI.getConversations(),
          window.henryAPI.getProviders(),
        ]);
        setConversations(convos);
        setProviders(
          providers.map((p: HenryProviderRecord) => ({
            id: p.id,
            name: p.name,
            apiKey: p.api_key || p.apiKey || '',
            enabled: Boolean(p.enabled),
            models: typeof p.models === 'string'
              ? (() => { try { return JSON.parse(p.models || '[]'); } catch { return []; } })()
              : (p.models || []),
          }))
        );
      }
    } catch (err) {
      console.error('Failed to init app:', err);
    } finally {
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
      <div className="h-screen w-screen bg-henry-bg flex items-center justify-center">
        <div className="text-center animate-fade-in">
          <div className="text-5xl mb-4">🧠</div>
          <h1 className="text-xl font-bold text-henry-text mb-2">Henry AI</h1>
          <p className="text-sm text-henry-text-dim">Loading...</p>
        </div>
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

  // Companion mode: render the lightweight companion shell on iPhone/iPad
  if (isCompanionMode()) {
    return (
      <ErrorBoundary>
        <div className="h-screen w-screen flex flex-col overflow-hidden bg-henry-bg">
          <CompanionApp />
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
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

      {/* Self-repair notification — shown when Henry auto-fixes something */}
      {repair && (
        <div className="fixed bottom-6 right-6 z-50 animate-fade-in max-w-xs">
          <div className="flex items-start gap-3 bg-henry-surface/95 border border-emerald-500/30 backdrop-blur-xl rounded-2xl shadow-xl px-4 py-3.5">
            <span className="text-lg shrink-0 mt-0.5">🔧</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-emerald-400 mb-0.5">Henry self-repaired</p>
              <p className="text-xs text-henry-text-dim leading-snug">{repair.action}</p>
            </div>
            <button
              onClick={() => setRepair(null)}
              className="shrink-0 text-henry-text-muted hover:text-henry-text transition-colors mt-0.5"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Clipboard AI toast */}
      <ClipboardAIToast />
    </div>
    </ErrorBoundary>
  );
}
