import { useEffect, useState, useRef } from 'react';
import Layout from './components/layout/Layout';
import SetupWizard from './components/wizard/SetupWizard';
import ElectronAutoSetup from './components/wizard/ElectronAutoSetup';
import { useStore } from './store';
import type { Task } from './types';

const HENRY_FIRST_MESSAGE = `Hey. I'm up and running.

Before we dive in — what's the most important thing on your plate right now? It could be a project you're working on, something you want to write, a question you've been turning over, or honestly anything. Just tell me and we'll start there.

If you want to explore what I can do first, try saying something like "show me what you can do" — or just talk to me like you would a smart colleague who's always around.`;

export default function App() {
  const [loading, setLoading] = useState(true);
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
    return cleanup;
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

        setSetupComplete(true);

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
            models: typeof p.models === 'string' ? JSON.parse(p.models || '[]') : (p.models || []),
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

    return () => {
      unsubEngine();
      unsubTask();
      unsubResult();
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

  return <Layout />;
}
