import { useState } from 'react';
import { useStore } from '../../store';
import {
  PROVIDERS,
  getModelsForProvider,
  formatPrice,
  type ProviderId,
} from '../../providers/models';

interface ProviderStepProps {
  onNext: () => void;
  onBack: () => void;
}

const PROVIDER_ORDER: ProviderId[] = ['ollama', 'openai', 'anthropic', 'google'];

export default function ProviderStep({ onNext, onBack }: ProviderStepProps) {
  const { providers, setProviders } = useStore();
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>(() => {
    const keys: Record<string, string> = {};
    providers.forEach((p) => { keys[p.id] = p.apiKey; });
    return keys;
  });
  const [ollamaUrl, setOllamaUrl] = useState(() => {
    return (providers.find((p) => p.id === 'ollama') as any)?.baseUrl || 'http://localhost:11434';
  });
  const [enabledProviders, setEnabledProviders] = useState<Set<string>>(
    () => new Set(providers.filter((p) => p.enabled).map((p) => p.id))
  );
  const [saving, setSaving] = useState(false);

  function toggleProvider(id: string) {
    const newEnabled = new Set(enabledProviders);
    if (newEnabled.has(id)) {
      newEnabled.delete(id);
    } else {
      newEnabled.add(id);
      setExpandedProvider(id);
    }
    setEnabledProviders(newEnabled);
  }

  async function handleNext() {
    setSaving(true);
    try {
      for (const providerId of PROVIDER_ORDER) {
        const isEnabled = enabledProviders.has(providerId);
        const key = apiKeys[providerId] || '';
        const models = getModelsForProvider(providerId).map((m) => m.id);
        await window.henryAPI.saveProvider({
          id: providerId,
          name: PROVIDERS[providerId].name,
          apiKey: key,
          enabled: isEnabled,
          models: JSON.stringify(models),
        });
      }
      if (enabledProviders.has('ollama')) {
        const url = ollamaUrl.trim() || 'http://localhost:11434';
        await window.henryAPI.saveSetting('ollama_base_url', url);
        useStore.getState().updateSetting('ollama_base_url', url);
      }

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
      onNext();
    } catch (err) {
      console.error('Failed to save providers:', err);
    } finally {
      setSaving(false);
    }
  }

  const hasAtLeastOneProvider = Array.from(enabledProviders).some(
    (id) => id === 'ollama' || (apiKeys[id] && apiKeys[id].length > 0)
  );

  return (
    <div className="animate-slide-up">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-henry-text mb-2">Choose Your AI</h2>
        <p className="text-henry-text-dim max-w-md mx-auto">
          Enable Ollama to run a free local model on your computer. Optionally add a cloud provider
          as a powerful second brain.
        </p>
      </div>

      <div className="space-y-3 mb-8">
        {PROVIDER_ORDER.map((providerId) => {
          const provider = PROVIDERS[providerId];
          const isEnabled = enabledProviders.has(providerId);
          const isExpanded = expandedProvider === providerId;
          const models = getModelsForProvider(providerId);
          const isPrimary = providerId === 'ollama';

          return (
            <div
              key={providerId}
              className={`rounded-xl border transition-all ${
                isEnabled
                  ? 'border-henry-accent/30 bg-henry-surface/80'
                  : 'border-henry-border/50 bg-henry-surface/30'
              }`}
            >
              <div
                className="flex items-center gap-4 p-4 cursor-pointer"
                onClick={() => toggleProvider(providerId)}
              >
                <span className="text-2xl">{provider.icon}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="font-medium text-henry-text">{provider.name}</div>
                    {isPrimary && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-henry-success/15 text-henry-success font-medium">
                        Free · Recommended
                      </span>
                    )}
                    {!isPrimary && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-henry-accent/10 text-henry-accent/80 font-medium">
                        Second Brain
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-henry-text-dim">{provider.description}</div>
                </div>
                <div
                  className={`w-10 h-6 rounded-full flex items-center transition-all shrink-0 ${
                    isEnabled ? 'bg-henry-accent' : 'bg-henry-hover'
                  }`}
                >
                  <div
                    className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                      isEnabled ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </div>
              </div>

              {isEnabled && (
                <div className="px-4 pb-4 space-y-4">
                  {providerId === 'ollama' && (
                    <div className="space-y-3">
                      <div className="p-3 rounded-lg bg-henry-bg/50 border border-henry-border/30 text-xs text-henry-text-dim leading-relaxed">
                        <p className="mb-2">
                          Ollama runs AI on <strong className="text-henry-text">your own computer</strong> — free forever,
                          no account needed. Download from{' '}
                          <a href="https://ollama.ai" target="_blank" rel="noopener noreferrer" className="text-henry-accent hover:underline">
                            ollama.ai
                          </a>{' '}
                          then pull a model.
                        </p>
                        <p className="mb-2">
                          <strong className="text-henry-text">Mac/PC:</strong> start with{' '}
                          <code className="text-henry-accent bg-henry-bg px-1 rounded">OLLAMA_HOST=0.0.0.0 OLLAMA_ORIGINS=* ollama serve</code>
                        </p>
                        <p>
                          <strong className="text-henry-text">iPad:</strong> use your Mac's local IP
                          (e.g. <code className="text-henry-accent">192.168.1.x</code>) as the URL below —
                          both devices must be on the same Wi-Fi.
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-henry-text-dim mb-1.5">
                          Ollama URL
                        </label>
                        <input
                          type="text"
                          value={ollamaUrl}
                          onChange={(e) => setOllamaUrl(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          placeholder="http://localhost:11434"
                          className="w-full bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text font-mono outline-none focus:border-henry-accent/50"
                        />
                      </div>
                    </div>
                  )}

                  {providerId !== 'ollama' && (
                    <div>
                      <label className="block text-xs font-medium text-henry-text-dim mb-1.5">
                        API Key
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={apiKeys[providerId] || ''}
                          onChange={(e) =>
                            setApiKeys({ ...apiKeys, [providerId]: e.target.value })
                          }
                          onClick={(e) => e.stopPropagation()}
                          placeholder={`${provider.keyPrefix}...`}
                          className="flex-1 bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/50"
                        />
                        <a
                          href={provider.keyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="shrink-0 px-3 py-2 text-xs bg-henry-hover text-henry-text-dim rounded-lg hover:text-henry-text transition-colors"
                        >
                          Get key →
                        </a>
                      </div>
                    </div>
                  )}

                  <div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedProvider(isExpanded ? null : providerId);
                      }}
                      className="text-xs text-henry-accent hover:text-henry-accent-hover mb-2"
                    >
                      {isExpanded ? '▾ Hide' : '▸ Show'} available models
                    </button>

                    {isExpanded && (
                      <div className="rounded-lg overflow-hidden border border-henry-border/30">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-henry-bg">
                              <th className="text-left px-3 py-2 font-medium text-henry-text-dim">Model</th>
                              <th className="text-right px-3 py-2 font-medium text-henry-text-dim">Input / 1M</th>
                              <th className="text-right px-3 py-2 font-medium text-henry-text-dim">Output / 1M</th>
                            </tr>
                          </thead>
                          <tbody>
                            {models.map((model) => (
                              <tr key={model.id} className="border-t border-henry-border/20">
                                <td className="px-3 py-2 text-henry-text">{model.name}</td>
                                <td className="px-3 py-2 text-right text-henry-text-dim">
                                  {formatPrice(model.inputPricePer1M)}
                                </td>
                                <td className="px-3 py-2 text-right text-henry-text-dim">
                                  {formatPrice(model.outputPricePer1M)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="px-6 py-2.5 text-henry-text-dim hover:text-henry-text transition-colors text-sm"
        >
          ← Back
        </button>
        <div className="flex items-center gap-3">
          {!hasAtLeastOneProvider && (
            <span className="text-xs text-henry-text-muted">Enable at least one provider</span>
          )}
          <button
            onClick={handleNext}
            disabled={!hasAtLeastOneProvider || saving}
            className={`px-8 py-2.5 rounded-xl font-medium text-sm transition-all ${
              hasAtLeastOneProvider && !saving
                ? 'bg-henry-accent text-white hover:bg-henry-accent-hover'
                : 'bg-henry-hover text-henry-text-muted cursor-not-allowed'
            }`}
          >
            {saving ? 'Saving...' : 'Continue →'}
          </button>
        </div>
      </div>
    </div>
  );
}
