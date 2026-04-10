import { useState, useEffect } from 'react';
import { useStore } from '../../store';
import {
  PROVIDERS,
  AVAILABLE_MODELS,
  formatPrice,
  type ProviderId,
} from '../../providers/models';
import { autoSelectModels } from '@/henry/modelPriority';

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
  const [customModel, setCustomModel] = useState({ companion: '', worker: '' });
  const [saving, setSaving] = useState<string | null>(null);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetectResult, setAutoDetectResult] = useState<string | null>(null);

  const enabledProviders = providers.filter((p) => p.enabled).map((p) => p.id);
  const availableModels = AVAILABLE_MODELS.filter((m) => enabledProviders.includes(m.provider));
  const ollamaEnabled = enabledProviders.includes('ollama');

  async function saveSetting(key: string, value: string) {
    await window.henryAPI.saveSetting(key, value);
    useStore.getState().updateSetting(key, value);
  }

  async function updateEngine(engine: 'companion' | 'worker', modelId: string, provider: string) {
    setSaving(engine);
    try {
      await saveSetting(`${engine}_model`, modelId);
      await saveSetting(`${engine}_provider`, provider);
    } catch (err) {
      console.error('Failed to update engine:', err);
    } finally {
      setSaving(null);
    }
  }

  async function updateCompanionFallback(modelId: string) {
    setSaving('companion_2');
    try {
      await saveSetting('companion_model_2', modelId);
      await saveSetting('companion_provider_2', 'ollama');
    } finally {
      setSaving(null);
    }
  }

  async function saveCustomModel(engine: 'companion' | 'worker') {
    const name = customModel[engine].trim();
    if (!name) return;
    await updateEngine(engine, name, 'ollama');
    setCustomModel((p) => ({ ...p, [engine]: '' }));
  }

  /** Query Ollama for installed models and auto-select the best ones. */
  async function autoDetect() {
    setAutoDetecting(true);
    setAutoDetectResult(null);
    try {
      const ollamaUrl = settings.ollama_base_url || 'http://localhost:11434';
      const raw = await window.henryAPI.ollamaModels(ollamaUrl) as any;
      const installedNames: string[] = (raw?.models ?? []).map((m: any) => m.name as string);

      if (installedNames.length === 0) {
        setAutoDetectResult('No models found in Ollama. Pull one with: ollama pull llama3.3');
        return;
      }

      const best = autoSelectModels(installedNames);
      const lines: string[] = [];

      if (best.companion) {
        await saveSetting('companion_model', best.companion.id);
        await saveSetting('companion_provider', 'ollama');
        lines.push(`Local Brain → ${best.companion.label}`);
      }
      if (best.companionFallback) {
        await saveSetting('companion_model_2', best.companionFallback.id);
        await saveSetting('companion_provider_2', 'ollama');
        lines.push(`Local Brain fallback → ${best.companionFallback.label}`);
      }
      if (best.worker) {
        await saveSetting('worker_model', best.worker.id);
        await saveSetting('worker_provider', 'ollama');
        lines.push(`Worker Brain → ${best.worker.label}`);
      }

      if (lines.length === 0) {
        setAutoDetectResult(`No priority models found among: ${installedNames.join(', ')}. Pull llama3.3, qwen2.5, or deepseek-r1.`);
      } else {
        setAutoDetectResult('✓ Auto-selected: ' + lines.join(' · '));
      }
    } catch (err) {
      setAutoDetectResult(`Could not reach Ollama: ${(err as Error).message}. Make sure it's running with OLLAMA_ORIGINS=*`);
    } finally {
      setAutoDetecting(false);
    }
  }

  function ModelSelect({ engine }: { engine: 'companion' | 'worker' }) {
    const sorted = availableModels.slice().sort((a, b) => {
      const aR = a.recommended === engine || a.recommended === 'both' ? -1 : 0;
      const bR = b.recommended === engine || b.recommended === 'both' ? -1 : 0;
      return aR - bR;
    });
    return (
      <select
        value={settings[`${engine}_model`] || ''}
        onChange={(e) => {
          const m = AVAILABLE_MODELS.find((x) => x.id === e.target.value);
          if (m) void updateEngine(engine, e.target.value, m.provider);
        }}
        className="w-full bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50"
      >
        <option value="">Choose from list…</option>
        {sorted.map((m) => {
          const prov = PROVIDERS[m.provider as ProviderId];
          const rec = m.recommended === engine || m.recommended === 'both';
          return (
            <option key={m.id} value={m.id}>
              {rec ? '★ ' : ''}{prov?.icon} {m.name} — {m.local ? 'Free' : `$${m.inputPricePer1M}/$${m.outputPricePer1M}/1M`}
            </option>
          );
        })}
      </select>
    );
  }

  return (
    <div className="space-y-5">

      {/* ── Auto-detect banner ── */}
      {ollamaEnabled && (
        <div className="rounded-xl border border-henry-accent/20 bg-henry-accent/5 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-henry-text mb-0.5">Auto-select Best Models</div>
              <div className="text-xs text-henry-text-dim leading-relaxed">
                Henry checks what's installed in Ollama and picks the strongest model for each brain automatically.
                Run this again after pulling a new model — it will upgrade itself.
              </div>
              {autoDetectResult && (
                <div className="mt-2 text-xs text-henry-text bg-henry-bg/60 rounded-lg px-3 py-2 leading-relaxed">
                  {autoDetectResult}
                </div>
              )}
            </div>
            <button
              onClick={() => void autoDetect()}
              disabled={autoDetecting}
              className="shrink-0 px-4 py-2 bg-henry-accent text-white rounded-lg text-xs font-semibold hover:bg-henry-accent/90 transition-colors disabled:opacity-50"
            >
              {autoDetecting ? 'Scanning…' : 'Auto-detect'}
            </button>
          </div>
        </div>
      )}

      {/* ── Local Brain (Companion) ── */}
      <div className="rounded-xl border border-henry-border/50 bg-henry-surface/30 p-5">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">🧠</span>
          <div className="font-medium text-henry-text">Local Brain</div>
          <span className="text-[10px] bg-henry-companion/10 text-henry-companion px-2 py-0.5 rounded-full font-medium">Primary</span>
        </div>
        <div className="text-xs text-henry-text-dim mb-4">
          Always-on — streams every conversation in real time. Delegates heavy tasks to Worker automatically.
          Set a <strong className="text-henry-text">Primary</strong> and a <strong className="text-henry-text">Fallback</strong> — Henry uses both and falls back automatically if the primary is unavailable.
        </div>

        {/* Primary */}
        <div className="mb-3">
          <div className="text-[10px] font-medium text-henry-text-muted uppercase tracking-wide mb-1.5 flex items-center gap-2">
            Primary
            {settings.companion_model && (
              <span className="text-henry-accent normal-case tracking-normal">
                {settings.companion_model} <span className="text-henry-text-muted">via {settings.companion_provider || 'unknown'}</span>
              </span>
            )}
          </div>
          <ModelSelect engine="companion" />
          {ollamaEnabled && (
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                value={customModel.companion}
                onChange={(e) => setCustomModel((p) => ({ ...p, companion: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') void saveCustomModel('companion'); }}
                placeholder="Custom Ollama model (e.g. llama3.3)"
                className="flex-1 bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50"
              />
              <button
                onClick={() => void saveCustomModel('companion')}
                disabled={!customModel.companion.trim() || saving === 'companion'}
                className="px-3 py-2 bg-henry-accent/10 text-henry-accent rounded-lg text-xs font-medium hover:bg-henry-accent/20 transition-colors disabled:opacity-40"
              >
                {saving === 'companion' ? 'Saving…' : 'Use'}
              </button>
            </div>
          )}
        </div>

        {/* Fallback / Secondary */}
        <div className="border-t border-henry-border/30 pt-3">
          <div className="text-[10px] font-medium text-henry-text-muted uppercase tracking-wide mb-1.5 flex items-center gap-2">
            Fallback (Secondary)
            {settings.companion_model_2 && (
              <span className="text-henry-text-dim normal-case tracking-normal">{settings.companion_model_2}</span>
            )}
          </div>
          <div className="text-[10px] text-henry-text-muted mb-2">
            Henry tries this if the primary fails or times out. Recommended: Qwen 2.5 14B or Phi-4.
          </div>
          <select
            value={settings.companion_model_2 || ''}
            onChange={(e) => {
              const m = AVAILABLE_MODELS.find((x) => x.id === e.target.value);
              if (m) void updateCompanionFallback(e.target.value);
              else if (!e.target.value) void updateCompanionFallback('');
            }}
            className="w-full bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50"
          >
            <option value="">None (no fallback)</option>
            {availableModels
              .filter((m) => m.local)
              .map((m) => {
                const rec = m.recommended === 'companion' || m.recommended === 'both';
                return (
                  <option key={m.id} value={m.id}>
                    {rec ? '★ ' : ''}🏠 {m.name} — Free
                  </option>
                );
              })}
          </select>
        </div>
      </div>

      {/* ── Worker Brain ── */}
      <div className="rounded-xl border border-henry-border/50 bg-henry-surface/30 p-5">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">⚡</span>
          <div className="font-medium text-henry-text">Worker Brain</div>
          <span className="text-[10px] bg-henry-worker/10 text-henry-worker px-2 py-0.5 rounded-full font-medium">Background</span>
        </div>
        <div className="text-xs text-henry-text-dim mb-4">
          Runs in the background while Local Brain keeps talking. Best models: DeepSeek R1 (reasoning) or Qwen 2.5 32B+.
          Result appears in the same thread automatically.
        </div>

        <div className="text-[10px] font-medium text-henry-text-muted uppercase tracking-wide mb-1.5 flex items-center gap-2">
          Model
          {settings.worker_model && (
            <span className="text-henry-worker normal-case tracking-normal">
              {settings.worker_model} <span className="text-henry-text-muted">via {settings.worker_provider || 'unknown'}</span>
            </span>
          )}
        </div>
        <ModelSelect engine="worker" />

        {ollamaEnabled && (
          <div className="flex gap-2 mt-2">
            <input
              type="text"
              value={customModel.worker}
              onChange={(e) => setCustomModel((p) => ({ ...p, worker: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') void saveCustomModel('worker'); }}
              placeholder="Custom Ollama model (e.g. deepseek-r1:32b)"
              className="flex-1 bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50"
            />
            <button
              onClick={() => void saveCustomModel('worker')}
              disabled={!customModel.worker.trim() || saving === 'worker'}
              className="px-3 py-2 bg-henry-accent/10 text-henry-accent rounded-lg text-xs font-medium hover:bg-henry-accent/20 transition-colors disabled:opacity-40"
            >
              {saving === 'worker' ? 'Saving…' : 'Use'}
            </button>
          </div>
        )}
      </div>

      {/* ── Recommend pull commands ── */}
      {ollamaEnabled && (
        <div className="rounded-xl border border-henry-border/30 bg-henry-bg/30 p-4">
          <div className="text-[10px] font-medium text-henry-text-muted uppercase tracking-wide mb-2">Recommended pull commands</div>
          <div className="space-y-1 font-mono text-xs text-henry-text-dim">
            <div><span className="text-henry-companion">Local Brain: </span>ollama pull llama3.3 &amp;&amp; ollama pull qwen2.5:14b</div>
            <div><span className="text-henry-worker">Worker Brain: </span>ollama pull deepseek-r1:14b</div>
            <div className="text-henry-text-muted/60 pt-1">After pulling, click Auto-detect above — Henry upgrades itself.</div>
          </div>
        </div>
      )}
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
