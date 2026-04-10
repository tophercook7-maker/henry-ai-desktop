import { useState, useEffect } from 'react';
import { useStore } from '../../store';
import {
  PROVIDERS,
  AVAILABLE_MODELS,
  formatPrice,
  type ProviderId,
} from '../../providers/models';

export default function SettingsView() {
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
  const { providers, settings, setProviders } = useStore();
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [ollamaUrl, setOllamaUrl] = useState(settings.ollama_base_url || 'http://localhost:11434');
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    const keys: Record<string, string> = {};
    providers.forEach((p) => { keys[p.id] = p.apiKey; });
    setApiKeys(keys);
  }, [providers]);

  useEffect(() => {
    setOllamaUrl(settings.ollama_base_url || 'http://localhost:11434');
  }, [settings.ollama_base_url]);

  async function saveKey(providerId: string) {
    setSaving(providerId);
    try {
      const provider = PROVIDERS[providerId as ProviderId];
      const models = AVAILABLE_MODELS.filter((m) => m.provider === providerId).map((m) => m.id);

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
          apiKey: p.api_key ?? p.apiKey ?? '',
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

  async function saveOllamaUrl() {
    setSaving('ollama');
    try {
      const url = ollamaUrl.trim() || 'http://localhost:11434';
      await window.henryAPI.saveSetting('ollama_base_url', url);
      useStore.getState().updateSetting('ollama_base_url', url);

      const provider = PROVIDERS.ollama;
      const models = AVAILABLE_MODELS.filter((m) => m.provider === 'ollama').map((m) => m.id);
      await window.henryAPI.saveProvider({
        id: 'ollama',
        name: provider.name,
        apiKey: '',
        enabled: true,
        models: JSON.stringify(models),
      });
      const rawProviders = await window.henryAPI.getProviders();
      setProviders(
        rawProviders.map((p: any) => ({
          id: p.id,
          name: p.name,
          apiKey: p.api_key ?? p.apiKey ?? '',
          enabled: Boolean(p.enabled),
          models: JSON.parse(p.models || '[]'),
        }))
      );
    } catch (err) {
      console.error('Failed to save Ollama URL:', err);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-4">
      {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => {
        const provider = PROVIDERS[id];
        const isConfigured = id === 'ollama'
          ? providers.some((p) => p.id === 'ollama' && p.enabled)
          : providers.some((p) => p.id === id && p.enabled && p.apiKey);

        return (
          <div key={id} className="rounded-xl border border-henry-border/50 bg-henry-surface/30 p-5">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xl">{provider.icon}</span>
              <div className="flex-1">
                <div className="font-medium text-henry-text">{provider.name}</div>
                <div className="text-xs text-henry-text-dim">{provider.description}</div>
              </div>
              {isConfigured && (
                <span className="text-xs bg-henry-success/10 text-henry-success px-2 py-1 rounded-full">
                  Active
                </span>
              )}
            </div>

            {id === 'ollama' ? (
              <div className="space-y-3">
                <div className="text-xs text-henry-text-dim bg-henry-bg/50 rounded-lg p-3 leading-relaxed">
                  Run Ollama with <code className="text-henry-accent">OLLAMA_ORIGINS=*</code> so the browser can
                  reach it. Then pull a model: <code className="text-henry-accent">ollama pull llama3</code>
                </div>
                <div>
                  <label className="block text-xs font-medium text-henry-text-dim mb-1.5">
                    Ollama base URL
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={ollamaUrl}
                      onChange={(e) => setOllamaUrl(e.target.value)}
                      placeholder="http://localhost:11434"
                      className="flex-1 bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text font-mono outline-none focus:border-henry-accent/50"
                    />
                    <button
                      onClick={saveOllamaUrl}
                      disabled={saving === 'ollama'}
                      className="px-4 py-2 bg-henry-accent/10 text-henry-accent rounded-lg text-xs font-medium hover:bg-henry-accent/20 transition-colors"
                    >
                      {saving === 'ollama' ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKeys[id] || ''}
                  onChange={(e) => setApiKeys({ ...apiKeys, [id]: e.target.value })}
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
            )}
          </div>
        );
      })}
    </div>
  );
}

function EnginesTab() {
  const { settings, providers } = useStore();
  const [customModels, setCustomModels] = useState({
    companion: '',
    worker: '',
  });
  const [saving, setSaving] = useState<string | null>(null);

  const enabledProviders = providers.filter((p) => p.enabled).map((p) => p.id);
  const availableModels = AVAILABLE_MODELS.filter((m) => enabledProviders.includes(m.provider));
  const ollamaEnabled = enabledProviders.includes('ollama');

  async function updateEngine(engine: 'companion' | 'worker', modelId: string, provider: string) {
    setSaving(engine);
    try {
      await window.henryAPI.saveSetting(`${engine}_model`, modelId);
      await window.henryAPI.saveSetting(`${engine}_provider`, provider);
      useStore.getState().updateSetting(`${engine}_model`, modelId);
      useStore.getState().updateSetting(`${engine}_provider`, provider);
    } catch (err) {
      console.error('Failed to update engine:', err);
    } finally {
      setSaving(null);
    }
  }

  async function saveCustomModel(engine: 'companion' | 'worker') {
    const name = customModels[engine].trim();
    if (!name) return;
    await updateEngine(engine, name, 'ollama');
    setCustomModels((prev) => ({ ...prev, [engine]: '' }));
  }

  return (
    <div className="space-y-6">
      {(['companion', 'worker'] as const).map((engine) => (
        <div key={engine} className="rounded-xl border border-henry-border/50 bg-henry-surface/30 p-5">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">{engine === 'companion' ? '🧠' : '⚡'}</span>
            <div className="font-medium text-henry-text capitalize">{engine} Engine</div>
          </div>
          <div className="text-xs text-henry-text-dim mb-4">
            {engine === 'companion'
              ? 'Local Brain — always-on, streams every conversation. Automatically delegates heavy tasks (code, research) to the Worker Brain while staying alive.'
              : 'Worker Brain — runs in background while Companion keeps talking. Takes over code generation and deep research; result flows back into the same thread automatically. ★ models below are recommended.'}
          </div>

          <div className="mb-2">
            <div className="text-[10px] text-henry-text-muted uppercase tracking-wide mb-1.5">Current model</div>
            <div className="text-sm font-medium text-henry-text">
              {settings[`${engine}_model`]
                ? <><span className="text-henry-accent">{settings[`${engine}_model`]}</span> <span className="text-henry-text-muted text-xs">via {settings[`${engine}_provider`] || 'unknown'}</span></>
                : <span className="text-henry-text-muted italic">Not set</span>}
            </div>
          </div>

          <select
            value={settings[`${engine}_model`] || ''}
            onChange={(e) => {
              const model = AVAILABLE_MODELS.find((m) => m.id === e.target.value);
              if (model) updateEngine(engine, e.target.value, model.provider);
            }}
            className="w-full bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50 mb-3"
          >
            <option value="">Choose from list…</option>
            {/* Show models recommended for this brain first */}
            {availableModels
              .slice()
              .sort((a, b) => {
                const aMatch = a.recommended === engine || a.recommended === 'both' ? -1 : 0;
                const bMatch = b.recommended === engine || b.recommended === 'both' ? -1 : 0;
                return aMatch - bMatch;
              })
              .map((model) => {
                const provider = PROVIDERS[model.provider as ProviderId];
                const isRecommended = model.recommended === engine || model.recommended === 'both';
                return (
                  <option key={model.id} value={model.id}>
                    {isRecommended ? '★ ' : ''}{provider?.icon} {model.name} — {model.local ? 'Free' : `$${model.inputPricePer1M}/$${model.outputPricePer1M} per 1M`}
                  </option>
                );
              })}
          </select>

          {ollamaEnabled && (
            <div>
              <label className="block text-[10px] font-medium text-henry-text-muted uppercase tracking-wide mb-1.5">
                Or type an Ollama model name
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customModels[engine]}
                  onChange={(e) => setCustomModels((prev) => ({ ...prev, [engine]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') void saveCustomModel(engine); }}
                  placeholder="e.g. llama3, mistral, phi4, qwen2.5"
                  className="flex-1 bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50"
                />
                <button
                  onClick={() => void saveCustomModel(engine)}
                  disabled={!customModels[engine].trim() || saving === engine}
                  className="px-3 py-2 bg-henry-accent/10 text-henry-accent rounded-lg text-xs font-medium hover:bg-henry-accent/20 transition-colors disabled:opacity-40"
                >
                  {saving === engine ? 'Saving…' : 'Use'}
                </button>
              </div>
            </div>
          )}
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
            onChange={(e) => updateSetting('default_temperature', e.target.value)}
            className="w-full accent-henry-accent"
          />
          <div className="flex justify-between text-[10px] text-henry-text-muted mt-1">
            <span>Precise</span>
            <span>Balanced</span>
            <span>Creative</span>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-henry-border/50 bg-henry-surface/30 p-5">
        <h3 className="font-medium text-henry-text mb-2">Workspace path</h3>
        <p className="text-xs text-henry-text-dim leading-relaxed mb-3">
          Optional — paste the absolute path to your project folder. Enables the workspace context strip,
          Writer draft library, and export packs.
        </p>
        <input
          type="text"
          value={settings.workspace_path || ''}
          onChange={(e) => void updateSetting('workspace_path', e.target.value)}
          placeholder="/Users/you/Projects/my-app"
          className="w-full bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50 font-mono"
        />
      </div>

      <div className="rounded-xl border border-henry-border/50 bg-henry-surface/30 p-5">
        <h3 className="font-medium text-henry-text mb-2">About</h3>
        <div className="space-y-1.5 text-xs text-henry-text-dim">
          <p>Henry AI Desktop v0.1.0</p>
          <p>Local-first AI operating system.</p>
          <p className="text-henry-text-muted">Your data stays on your machine.</p>
        </div>
      </div>
    </div>
  );
}
