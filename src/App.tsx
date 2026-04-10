import { useEffect, useState } from 'react';
import Layout from './components/layout/Layout';
import SetupWizard from './components/wizard/SetupWizard';
import { useStore } from './store';
import type { Task } from './types';

export default function App() {
  const [loading, setLoading] = useState(true);
  const {
    setupComplete,
    setSetupComplete,
    setConversations,
    setProviders,
    setCompanionStatus,
    setWorkerStatus,
    updateTask,
    addMessage,
  } = useStore();

  useEffect(() => {
    void initApp();
    const cleanup = setupEventListeners();
    return cleanup;
  }, []);

  async function initApp() {
    try {
      // Load settings — backend returns Record<string, string>
      const settingsMap = (await window.henryAPI.getSettings()) as Record<string, string>;

      // Load all settings into the store
      Object.entries(settingsMap).forEach(([key, value]) => {
        useStore.getState().updateSetting(key, value);
      });

      // Check if setup is complete
      if (settingsMap.setup_complete === 'true') {
        setSetupComplete(true);

        // Load initial data
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
    // Engine status events
    const unsubEngine = window.henryAPI.onEngineStatus((data) => {
      if (data.engine === 'companion') {
        setCompanionStatus(data);
      } else if (data.engine === 'worker') {
        setWorkerStatus(data);
      }
    });

    // Task update events (for real-time queue updates)
    const unsubTask = window.henryAPI.onTaskUpdate((data) => {
      updateTask(data.id, data);
    });

    // Task result events (when a Worker task completes and result should appear in chat)
    const unsubResult = window.henryAPI.onTaskResult((data) => {
      updateTask(data.taskId, {
        id: data.taskId,
        ...(data.error !== undefined ? { error: data.error } : {}),
        ...(data.result !== undefined ? { result: typeof data.result === 'string' ? data.result : JSON.stringify(data.result) } : {}),
      } as Partial<Task>);

      if (!data.conversationId) return;

      if (data.error) {
        addMessage({
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

      addMessage({
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

  // SetupWizard handles completion internally via the store
  if (!setupComplete) {
    return <SetupWizard />;
  }

  return <Layout />;
}
