import { useState, useEffect } from 'react';
import { useStore } from '../../store';
import {
  PROVIDERS,
  AVAILABLE_MODELS,
  formatPrice,
  type ProviderId,
} from '../../providers/models';

export default function SettingsView() {
  const { providers, settings, setProviders, updateSetting } = useStore();
  const [activeTab, setActiveTab] = useState<'providers' | 'engines' | 'general'>('providers');

  const tabs = [
    { id: 'providers' as const, label: 'AI Providers' },
    { id: 'engines' as const, label: 'Engines' },
    { id: 'general' as const, label: 'General' },
  ];

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-6 py-4 border-b border-henry-border/50">
        <h1 className="text-lg font-semibold text-henry-text">Settings</h1>
        <div className="flex gap-1 mt-3">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition-all ${
                activeTab === tab.id
                  ? 'bg-henry-accent/10 text-henry-accent'
                  : 'text-henry-text-dim hover:text-henry-text hover:bg-henry-hover/50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto">
          {activeTab === 'providers' && <ProvidersTab />}
          {activeTab === 'engines' && <EnginesTab />}
          {activeTab === 'general' && <GeneralTab />}
        </div>
      </div>
    </div>
  );
}

function ProvidersTab() {
  const { providers, setProviders } = useStore();
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    const keys: Record<string, string> = {};
    providers.forEach((p) => {
      keys[p.id] = p.apiKey;
    });
    setApiKeys(keys);
  }, [providers]);

  async function saveKey(providerId: string) {
    setSaving(providerId);
    try {
      const provider = PROVIDERS[providerId as ProviderId];
      const models = AVAILABLE_MODELS.filter((m) => m.provider === providerId).map(
        (m) => m.id
      );

      await window.henryAPI.saveProvider({
        id: providerId,
        name: provider.name,
        apiKey: apiKeys[providerId] || '',
        enabled: true,
        models: JSON.stringify(models),
      });

      const rawProviders = await window.henryAPI.getProviders();
      setProviders(
        rawProviders.map((p: any) => ({
          id: p.id,
          name: p.name,
          apiKey: p.api_key,
          enabled: Boolean(p.enabled),
          models: JSON.parse(p.models || '[]'),
        }))
      );
    } catch (err) {
      console.error('Failed to save provider:', err);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-4">
      {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => {
        const provider = PROVIDERS[id];
        const isConfigured = providers.some((p) => p.id === id && p.enabled && p.apiKey);

        return (
          <div
            key={id}
            className="rounded-xl border border-henry-border/50 bg-henry-surface/30 p-5"
          >
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xl">{provider.icon}</span>
              <div className="flex-1">
                <div className="font-medium text-henry-text">
                  {provider.name}
                </div>
                <div className="text-xs text-henry-text-dim">
                  {provider.description}
                </div>
              </div>
              {isConfigured && (
                <span className="text-xs bg-henry-success/10 text-henry-success px-2 py-1 rounded-full">
                  Connected
                </span>
              )}
            </div>

            {!provider.local ? (
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKeys[id] || ''}
                  onChange={(e) =>
                    setApiKeys({ ...apiKeys, [id]: e.target.value })
                  }
                  placeholder={`${provider.keyPrefix}...`}
                  className="flex-1 bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/50"
                />
                <button
                  onClick={() => saveKey(id)}
                  disabled={saving === id}
                  className="px-4 py-2 bg-henry-accent/10 text-henry-accent rounded-lg text-xs font-medium hover:bg-henry-accent/20 transition-colors"
                >
                  {saving === id ? 'Saving...' : 'Save'}
                </button>
              </div>
            ) : (
              <div className="text-xs text-henry-text-dim bg-henry-bg/50 rounded-lg p-3">
                Run <code className="text-henry-accent">ollama serve</code> to
                start, then{' '}
                <code className="text-henry-accent">ollama pull llama3.1:70b</code>{' '}
                to download models.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EnginesTab() {
  const { settings, providers } = useStore();

  const enabledProviders = providers.filter((p) => p.enabled).map((p) => p.id);
  const availableModels = AVAILABLE_MODELS.filter((m) =>
    enabledProviders.includes(m.provider)
  );

  async function updateEngine(
    engine: 'companion' | 'worker',
    modelId: string
  ) {
    const model = AVAILABLE_MODELS.find((m) => m.id === modelId);
    if (!model) return;

    try {
      await window.henryAPI.saveSetting(`${engine}_model`, modelId);
      await window.henryAPI.saveSetting(`${engine}_provider`, model.provider);
      useStore.getState().updateSetting(`${engine}_model`, modelId);
      useStore.getState().updateSetting(`${engine}_provider`, model.provider);
    } catch (err) {
      console.error('Failed to update engine:', err);
    }
  }

  return (
    <div className="space-y-6">
      {(['companion', 'worker'] as const).map((engine) => (
        <div
          key={engine}
          className="rounded-xl border border-henry-border/50 bg-henry-surface/30 p-5"
        >
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">{engine === 'companion' ? '🧠' : '⚡'}</span>
            <div>
              <div className="font-medium text-henry-text capitalize">
                {engine} Engine
              </div>
              <div className="text-xs text-henry-text-dim">
                {engine === 'companion'
                  ? 'Fast model for chat and status'
                  : 'Powerful model for deep work'}
              </div>
            </div>
          </div>

          <select
            value={settings[`${engine}_model`] || ''}
            onChange={(e) => updateEngine(engine, e.target.value)}
            className="w-full bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50"
          >
            <option value="">Select a model...</option>
            {availableModels.map((model) => {
              const provider = PROVIDERS[model.provider as ProviderId];
              return (
                <option key={model.id} value={model.id}>
                  {provider?.icon} {model.name} — {model.local ? 'Free' : `$${model.inputPricePer1M}/$${model.outputPricePer1M} per 1M`}
                </option>
              );
            })}
          </select>
        </div>
      ))}
    </div>
  );
}

function GeneralTab() {
  const { settings } = useStore();

  async function updateSetting(key: string, value: string) {
    try {
      await window.henryAPI.saveSetting(key, value);
      useStore.getState().updateSetting(key, value);
    } catch (err) {
      console.error('Failed to update setting:', err);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-henry-border/50 bg-henry-surface/30 p-5">
        <h3 className="font-medium text-henry-text mb-4">AI Behavior</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-henry-text-dim mb-1.5">
              Default Temperature ({settings.default_temperature || '0.7'})
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={settings.default_temperature || '0.7'}
              onChange={(e) =>
                updateSetting('default_temperature', e.target.value)
              }
              className="w-full accent-henry-accent"
            />
            <div className="flex justify-between text-[10px] text-henry-text-muted mt-1">
              <span>Precise</span>
              <span>Balanced</span>
              <span>Creative</span>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-henry-border/50 bg-henry-surface/30 p-5">
        <h3 className="font-medium text-henry-text mb-2">About</h3>
        <div className="space-y-2 text-xs text-henry-text-dim">
          <p>Henry AI Desktop v0.1.0</p>
          <p>Local-first AI operating system with dual-engine architecture.</p>
          <p className="text-henry-text-muted">
            Your data stays on your machine. Always.
          </p>
        </div>
      </div>
    </div>
  );
}
