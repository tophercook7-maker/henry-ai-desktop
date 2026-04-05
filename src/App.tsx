import { useEffect, useState } from 'react';
import Layout from './components/layout/Layout';
import SetupWizard from './components/wizard/SetupWizard';
import { useStore } from './store';

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
    initApp();
    setupEventListeners();
  }, []);

  async function initApp() {
    try {
      // Load settings
      const settings = await window.henryAPI.getSettings();
      const settingsMap = settings.reduce((acc: any, s: any) => {
        acc[s.key] = s.value;
        return acc;
      }, {});

      // Check if setup is complete
      if (settingsMap.setup_complete === 'true') {
        setSetupComplete(true);

        // Load initial data
        const [convos, providers] = await Promise.all([
          window.henryAPI.getConversations(),
          window.henryAPI.getProviders(),
        ]);
        setConversations(convos);
        setProviders(providers);
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
      if (data.conversationId) {
        const result = typeof data.result === 'string'
          ? data.result
          : data.result?.content || JSON.stringify(data.result);

        addMessage({
          id: `task-result-${data.taskId}`,
          conversation_id: data.conversationId,
          role: 'assistant',
          content: `⚡ *Worker task completed:*\n\n${result}`,
          engine: 'worker',
          model: data.result?.model,
          cost: data.result?.cost,
          created_at: new Date().toISOString(),
        });
      }
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
    return <SetupWizard onComplete={() => setSetupComplete(true)} />;
  }

  return <Layout />;
}
