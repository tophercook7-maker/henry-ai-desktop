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

export default function ProviderStep({ onNext, onBack }: ProviderStepProps) {
  const { providers, setProviders } = useStore();
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>(() => {
    const keys: Record<string, string> = {};
    providers.forEach((p) => {
      keys[p.id] = p.apiKey;
    });
    return keys;
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
    }
    setEnabledProviders(newEnabled);

    // Expand for key input if enabling
    if (!enabledProviders.has(id)) {
      setExpandedProvider(id);
    }
  }

  async function handleNext() {
    setSaving(true);
    try {
      // Save each enabled provider
      const allProviderIds = Object.keys(PROVIDERS) as ProviderId[];

      for (const providerId of allProviderIds) {
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

      // Reload providers
      const rawProviders = await window.henryAPI.getProviders();
      const updatedProviders = rawProviders.map((p: any) => ({
        id: p.id,
        name: p.name,
        apiKey: p.api_key,
        enabled: Boolean(p.enabled),
        models: JSON.parse(p.models || '[]'),
      }));
      setProviders(updatedProviders);

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
        <h2 className="text-2xl font-bold text-henry-text mb-2">
          Connect Your AI Providers
        </h2>
        <p className="text-henry-text-dim">
          Choose which AI services you want Henry to use. You can change these
          anytime.
        </p>
      </div>

      <div className="space-y-3 mb-8">
        {(Object.keys(PROVIDERS) as ProviderId[]).map((providerId) => {
          const provider = PROVIDERS[providerId];
          const isEnabled = enabledProviders.has(providerId);
          const isExpanded = expandedProvider === providerId;
          const models = getModelsForProvider(providerId);

          return (
            <div
              key={providerId}
              className={`rounded-xl border transition-all ${
                isEnabled
                  ? 'border-henry-accent/30 bg-henry-surface/80'
                  : 'border-henry-border/50 bg-henry-surface/30'
              }`}
            >
              {/* Provider header */}
              <div
                className="flex items-center gap-4 p-4 cursor-pointer"
                onClick={() => toggleProvider(providerId)}
              >
                <span className="text-2xl">{provider.icon}</span>
                <div className="flex-1">
                  <div className="font-medium text-henry-text">
                    {provider.name}
                  </div>
                  <div className="text-xs text-henry-text-dim">
                    {provider.description}
                  </div>
                </div>
                <div
                  className={`w-10 h-6 rounded-full flex items-center transition-all ${
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

              {/* Expanded content */}
              {isEnabled && (
                <div className="px-4 pb-4 space-y-4">
                  {/* API Key input (not for Ollama) */}
                  {!provider.local && (
                    <div>
                      <label className="block text-xs font-medium text-henry-text-dim mb-1.5">
                        API Key
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={apiKeys[providerId] || ''}
                          onChange={(e) =>
                            setApiKeys({
                              ...apiKeys,
                              [providerId]: e.target.value,
                            })
                          }
                          placeholder={`${provider.keyPrefix}...`}
                          className="flex-1 bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/50"
                        />
                        <a
                          href={provider.keyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 px-3 py-2 text-xs bg-henry-hover text-henry-text-dim rounded-lg hover:text-henry-text transition-colors"
                        >
                          Get key →
                        </a>
                      </div>
                    </div>
                  )}

                  {provider.local && (
                    <div className="p-3 rounded-lg bg-henry-bg/50 border border-henry-border/30">
                      <p className="text-xs text-henry-text-dim leading-relaxed">
                        Ollama runs models locally on your machine. Install it
                        from{' '}
                        <a
                          href="https://ollama.ai"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-henry-accent hover:underline"
                        >
                          ollama.ai
                        </a>
                        , then pull a model:
                      </p>
                      <code className="block mt-2 text-xs text-henry-accent font-mono bg-henry-bg p-2 rounded">
                        ollama pull llama3.1:70b
                      </code>
                    </div>
                  )}

                  {/* Model pricing table */}
                  <div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedProvider(
                          isExpanded ? null : providerId
                        );
                      }}
                      className="text-xs text-henry-accent hover:text-henry-accent-hover mb-2"
                    >
                      {isExpanded ? '▾ Hide' : '▸ Show'} available models &
                      pricing
                    </button>

                    {isExpanded && (
                      <div className="rounded-lg overflow-hidden border border-henry-border/30">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-henry-bg">
                              <th className="text-left px-3 py-2 font-medium text-henry-text-dim">
                                Model
                              </th>
                              <th className="text-right px-3 py-2 font-medium text-henry-text-dim">
                                Input / 1M tokens
                              </th>
                              <th className="text-right px-3 py-2 font-medium text-henry-text-dim">
                                Output / 1M tokens
                              </th>
                              <th className="text-right px-3 py-2 font-medium text-henry-text-dim">
                                Best for
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {models.map((model) => (
                              <tr
                                key={model.id}
                                className="border-t border-henry-border/20"
                              >
                                <td className="px-3 py-2 text-henry-text">
                                  {model.name}
                                </td>
                                <td className="px-3 py-2 text-right text-henry-text-dim">
                                  {formatPrice(model.inputPricePer1M)}
                                </td>
                                <td className="px-3 py-2 text-right text-henry-text-dim">
                                  {formatPrice(model.outputPricePer1M)}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {model.recommended && (
                                    <span
                                      className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                                        model.recommended === 'companion'
                                          ? 'bg-henry-companion/10 text-henry-companion'
                                          : model.recommended === 'worker'
                                          ? 'bg-henry-worker/10 text-henry-worker'
                                          : 'bg-henry-accent/10 text-henry-accent'
                                      }`}
                                    >
                                      {model.recommended}
                                    </span>
                                  )}
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
            <span className="text-xs text-henry-text-muted">
              Enable at least one provider
            </span>
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
