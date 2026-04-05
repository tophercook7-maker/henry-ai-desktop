import { useEffect } from 'react';
import { useStore } from './store';
import Layout from './components/layout/Layout';
import SetupWizard from './components/wizard/SetupWizard';

function App() {
  const { initialized, setupComplete, setInitialized, setSettings, setProviders, setConversations, setSetupComplete } = useStore();

  useEffect(() => {
    async function init() {
      try {
        // Load settings
        const settings = await window.henryAPI.getSettings();
        setSettings(settings);

        // Load providers
        const rawProviders = await window.henryAPI.getProviders();
        const providers = rawProviders.map((p: any) => ({
          id: p.id,
          name: p.name,
          apiKey: p.api_key,
          enabled: Boolean(p.enabled),
          models: JSON.parse(p.models || '[]'),
        }));
        setProviders(providers);

        // Load conversations
        const conversations = await window.henryAPI.getConversations();
        setConversations(conversations);

        setInitialized(true);
      } catch (err) {
        console.error('Failed to initialize Henry:', err);
        // If running outside Electron (dev mode), still show UI
        setInitialized(true);
      }
    }
    init();
  }, []);

  if (!initialized) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-henry-bg">
        <div className="text-center animate-fade-in">
          <div className="text-4xl mb-4">🧠</div>
          <h1 className="text-xl font-semibold text-henry-text mb-2">Henry AI</h1>
          <p className="text-henry-text-dim text-sm">Starting up...</p>
        </div>
      </div>
    );
  }

  if (!setupComplete) {
    return <SetupWizard />;
  }

  return <Layout />;
}

export default App;
