import { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store';
import {
  PROVIDERS,
  AVAILABLE_MODELS,
  formatPrice,
  type ProviderId,
} from '../../providers/models';
import { autoSelectModels } from '@/henry/modelPriority';
import {
  loadProjects, saveProject, deleteProject, newProject,
  loadGoals, saveGoal, deleteGoal, newGoal,
  loadPeople, savePerson, deletePerson, newPerson,
  type HenryProject, type HenryGoal, type HenryPerson,
} from '../../henry/richMemory';

export default function SettingsView() {
  const [activeTab, setActiveTab] = useState<'providers' | 'engines' | 'general' | 'memory'>('providers');

  const tabs = [
    { id: 'providers' as const, label: 'AI Providers' },
    { id: 'engines' as const, label: 'Engines' },
    { id: 'general' as const, label: 'General' },
    { id: 'memory' as const, label: 'Memory' },
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
          {activeTab === 'memory' && <MemoryTab />}
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
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [pullName, setPullName] = useState('');
  const [pulling, setPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState<{ downloaded: number; total: number; message: string } | null>(null);
  const [pullError, setPullError] = useState('');
  const [deletingModel, setDeletingModel] = useState<string | null>(null);
  const pullUnsubRef = useRef<(() => void) | null>(null);

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

  async function loadOllamaModels(url?: string) {
    setModelsLoading(true);
    setModelsError('');
    try {
      const result = await window.henryAPI.ollamaModels(url || ollamaUrl);
      if (result.error) { setModelsError(result.error); setOllamaModels([]); }
      else setOllamaModels(result.models.map((m) => m.name));
    } catch (err: any) {
      setModelsError(err?.message || 'Could not reach Ollama');
      setOllamaModels([]);
    } finally {
      setModelsLoading(false);
    }
  }

  useEffect(() => {
    loadOllamaModels();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pullModel() {
    const name = pullName.trim();
    if (!name || pulling) return;
    setPulling(true);
    setPullError('');
    setPullProgress(null);
    pullUnsubRef.current?.();
    pullUnsubRef.current = window.henryAPI.onOllamaPullProgress((data: any) => {
      setPullProgress({ downloaded: data.completed ?? data.downloaded ?? 0, total: data.total ?? 0, message: data.status ?? data.message ?? '' });
    });
    try {
      const result = await window.henryAPI.ollamaPull(name, ollamaUrl);
      if (!result.success) setPullError(result.error || 'Pull failed');
      else { setPullName(''); setPullProgress(null); await loadOllamaModels(); }
    } catch (err: any) {
      setPullError(err?.message || 'Pull failed');
    } finally {
      pullUnsubRef.current?.();
      pullUnsubRef.current = null;
      setPulling(false);
    }
  }

  async function deleteModel(modelName: string) {
    setDeletingModel(modelName);
    try {
      await window.henryAPI.ollamaDelete(modelName, ollamaUrl);
      await loadOllamaModels();
    } catch (err) {
      console.error('Delete model failed:', err);
    } finally {
      setDeletingModel(null);
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

                {/* ── Installed models ── */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-medium text-henry-text-dim">Installed models</label>
                    <button
                      onClick={() => loadOllamaModels()}
                      disabled={modelsLoading}
                      className="text-[10px] text-henry-text-muted hover:text-henry-text transition-colors"
                    >
                      {modelsLoading ? 'Loading…' : '↻ Refresh'}
                    </button>
                  </div>
                  {modelsError && (
                    <p className="text-xs text-henry-error mb-2">{modelsError}</p>
                  )}
                  {ollamaModels.length === 0 && !modelsLoading && !modelsError && (
                    <p className="text-xs text-henry-text-muted italic">No models found — pull one below.</p>
                  )}
                  <div className="space-y-1">
                    {ollamaModels.map((m) => (
                      <div key={m} className="flex items-center justify-between bg-henry-bg/60 rounded-lg px-3 py-2">
                        <span className="text-xs text-henry-text font-mono">{m}</span>
                        <button
                          onClick={() => deleteModel(m)}
                          disabled={deletingModel === m}
                          className="text-henry-text-muted hover:text-henry-error transition-colors text-[11px]"
                          title="Remove model"
                        >
                          {deletingModel === m ? '…' : '✕'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── Pull new model ── */}
                <div>
                  <label className="block text-xs font-medium text-henry-text-dim mb-1.5">Pull a model</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={pullName}
                      onChange={(e) => setPullName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') pullModel(); }}
                      placeholder="e.g. llama3, mistral, phi3"
                      disabled={pulling}
                      className="flex-1 bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text font-mono outline-none focus:border-henry-accent/50 disabled:opacity-50"
                    />
                    <button
                      onClick={pullModel}
                      disabled={pulling || !pullName.trim()}
                      className="px-4 py-2 bg-henry-accent/10 text-henry-accent rounded-lg text-xs font-medium hover:bg-henry-accent/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {pulling ? 'Pulling…' : 'Pull'}
                    </button>
                  </div>
                  {pullProgress && (
                    <div className="mt-2 space-y-1">
                      <p className="text-[11px] text-henry-text-dim truncate">{pullProgress.message}</p>
                      {pullProgress.total > 0 && (
                        <div className="h-1 bg-henry-bg rounded-full overflow-hidden">
                          <div
                            className="h-full bg-henry-accent transition-all duration-300"
                            style={{ width: `${Math.round((pullProgress.downloaded / pullProgress.total) * 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                  {pullError && <p className="text-xs text-henry-error mt-1">{pullError}</p>}
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
  const [ownerName, setOwnerName] = useState(() => {
    try { return localStorage.getItem('henry:owner_name') || ''; } catch { return ''; }
  });
  const [spouseName, setSpouseName] = useState(() => {
    try { return localStorage.getItem('henry:spouse_name') || ''; } catch { return ''; }
  });
  const [homeCity, setHomeCity] = useState(() => {
    try { return localStorage.getItem('henry:home_city') || ''; } catch { return ''; }
  });
  const [householdSaved, setHouseholdSaved] = useState(false);

  function saveHousehold() {
    try {
      if (ownerName.trim()) localStorage.setItem('henry:owner_name', ownerName.trim());
      else localStorage.removeItem('henry:owner_name');
      if (spouseName.trim()) localStorage.setItem('henry:spouse_name', spouseName.trim());
      else localStorage.removeItem('henry:spouse_name');
      if (homeCity.trim()) localStorage.setItem('henry:home_city', homeCity.trim());
      else localStorage.removeItem('henry:home_city');
      // Clear weather cache so it re-geocodes with the new city
      localStorage.removeItem('henry:weather_cache');
      setHouseholdSaved(true);
      setTimeout(() => setHouseholdSaved(false), 2500);
    } catch { /* ignore */ }
  }

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
      {/* Household identity */}
      <div className="rounded-xl border border-henry-border/50 bg-henry-surface/30 p-5 space-y-4">
        <div>
          <h3 className="font-medium text-henry-text">Household</h3>
          <p className="text-xs text-henry-text-dim mt-1 leading-relaxed">
            Tell Henry who he belongs to. He'll use these names in his identity, know he's at your home, and talk about weather and life from your location.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-henry-text-dim mb-1.5">Your name</label>
            <input
              type="text"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="Topher"
              className="w-full bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-henry-text-dim mb-1.5">Partner/spouse (optional)</label>
            <input
              type="text"
              value={spouseName}
              onChange={(e) => setSpouseName(e.target.value)}
              placeholder="e.g. Tiara"
              className="w-full bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50 transition-colors"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-henry-text-dim mb-1.5">Home city (optional — Henry auto-detects from GPS)</label>
          <input
            type="text"
            value={homeCity}
            onChange={(e) => setHomeCity(e.target.value)}
            placeholder="e.g. Atlanta, GA — leave blank to auto-detect"
            className="w-full bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50 transition-colors"
          />
        </div>
        <button
          onClick={saveHousehold}
          className="px-5 py-2 rounded-xl text-xs font-semibold bg-henry-accent text-white hover:bg-henry-accent/90 transition-all"
        >
          {householdSaved ? '✓ Saved' : 'Save household'}
        </button>
        <p className="text-[10px] text-henry-text-muted">
          Henry will know the weather at your location and refer to both household members naturally in conversation.
        </p>
      </div>

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

      <div className="rounded-xl border border-henry-border/50 bg-henry-surface/30 p-5 space-y-4">
        <div>
          <h3 className="font-medium text-henry-text mb-1">Web Search &amp; Browse</h3>
          <p className="text-xs text-henry-text-dim leading-relaxed mb-4">
            Henry can search the web and read any URL automatically. Without API keys he uses DuckDuckGo (limited results).
            For richer search — like Grok or ChatGPT — add a Google or Brave key.
          </p>
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-henry-text-muted uppercase tracking-wide mb-1">
            Google Custom Search API Key
          </label>
          <p className="text-[10px] text-henry-text-muted mb-2">
            Free tier: 100 searches/day. Get at console.cloud.google.com → Custom Search JSON API.
          </p>
          <input
            type="password"
            value={settings.search_google_api_key || ''}
            onChange={(e) => void updateSetting('search_google_api_key', e.target.value)}
            placeholder="AIzaSy..."
            className="w-full bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50 font-mono"
          />
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-henry-text-muted uppercase tracking-wide mb-1">
            Google CSE ID (cx)
          </label>
          <p className="text-[10px] text-henry-text-muted mb-2">
            Create a Custom Search Engine at programmablesearchengine.google.com. Set it to search the whole web.
          </p>
          <input
            type="text"
            value={settings.search_google_cx || ''}
            onChange={(e) => void updateSetting('search_google_cx', e.target.value)}
            placeholder="e.g. 017576662512468239146:omuauf..."
            className="w-full bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50 font-mono"
          />
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-henry-text-muted uppercase tracking-wide mb-1">
            Brave Search API Key
          </label>
          <p className="text-[10px] text-henry-text-muted mb-2">
            Free tier: 2,000 queries/month. Get at api.search.brave.com.
          </p>
          <input
            type="password"
            value={settings.search_brave_api_key || ''}
            onChange={(e) => void updateSetting('search_brave_api_key', e.target.value)}
            placeholder="BSA..."
            className="w-full bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50 font-mono"
          />
        </div>

        <div className="rounded-lg bg-henry-accent/5 border border-henry-accent/15 px-4 py-3">
          <p className="text-[10px] text-henry-accent/80 font-medium mb-1">URL browsing is always on</p>
          <p className="text-[10px] text-henry-text-muted">
            Paste any URL in chat and Henry will read the full page — no API key needed. Powered by r.jina.ai.
          </p>
        </div>
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

// ── Memory Tab ────────────────────────────────────────────────────────────────

function MemoryTab() {
  const [projects, setProjects] = useState<HenryProject[]>([]);
  const [goals, setGoals] = useState<HenryGoal[]>([]);
  const [people, setPeople] = useState<HenryPerson[]>([]);
  const [editingProject, setEditingProject] = useState<HenryProject | null>(null);
  const [editingGoal, setEditingGoal] = useState<HenryGoal | null>(null);
  const [editingPerson, setEditingPerson] = useState<HenryPerson | null>(null);
  const [section, setSection] = useState<'projects' | 'goals' | 'people'>('projects');

  useEffect(() => {
    setProjects(loadProjects());
    setGoals(loadGoals());
    setPeople(loadPeople());
  }, []);

  function refreshAll() {
    setProjects(loadProjects());
    setGoals(loadGoals());
    setPeople(loadPeople());
  }

  // ── Projects ──────────────────────────────────────────────────────────────

  function saveAndRefreshProject(p: HenryProject) {
    saveProject({ ...p, updatedAt: new Date().toISOString() });
    setEditingProject(null);
    refreshAll();
  }

  function removeProject(id: string) {
    deleteProject(id);
    refreshAll();
  }

  // ── Goals ─────────────────────────────────────────────────────────────────

  function saveAndRefreshGoal(g: HenryGoal) {
    saveGoal({ ...g, updatedAt: new Date().toISOString() });
    setEditingGoal(null);
    refreshAll();
  }

  function removeGoal(id: string) {
    deleteGoal(id);
    refreshAll();
  }

  // ── People ────────────────────────────────────────────────────────────────

  function saveAndRefreshPerson(p: HenryPerson) {
    savePerson({ ...p, updatedAt: new Date().toISOString() });
    setEditingPerson(null);
    refreshAll();
  }

  function removePerson(id: string) {
    deletePerson(id);
    refreshAll();
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-henry-text mb-1">Henry's Memory</h2>
        <p className="text-xs text-henry-text-dim">
          Projects, goals, and people Henry knows about — injected into every conversation so he stays aware of your world.
        </p>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-henry-border/30 pb-0">
        {([
          { id: 'projects', label: `Projects (${projects.length})` },
          { id: 'goals', label: `Goals (${goals.length})` },
          { id: 'people', label: `People (${people.length})` },
        ] as const).map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`px-4 py-2 text-xs font-medium rounded-t-lg transition-all -mb-px ${
              section === s.id
                ? 'bg-henry-surface border border-henry-border/50 border-b-henry-surface text-henry-text'
                : 'text-henry-text-muted hover:text-henry-text'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Projects section ── */}
      {section === 'projects' && (
        <div className="space-y-3">
          {projects.length === 0 && !editingProject && (
            <p className="text-xs text-henry-text-muted italic py-2">No projects yet. Add one so Henry knows what you're building.</p>
          )}
          {projects.map((p) =>
            editingProject?.id === p.id ? (
              <ProjectForm
                key={p.id}
                project={editingProject}
                onChange={setEditingProject}
                onSave={() => saveAndRefreshProject(editingProject)}
                onCancel={() => setEditingProject(null)}
              />
            ) : (
              <div key={p.id} className="rounded-xl border border-henry-border/40 bg-henry-surface/30 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-henry-text truncate">{p.name || 'Untitled'}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                        p.status === 'active' ? 'bg-henry-success/10 text-henry-success' :
                        p.status === 'paused' ? 'bg-amber-500/10 text-amber-400' :
                        'bg-henry-border/20 text-henry-text-muted'
                      }`}>{p.status}</span>
                    </div>
                    {p.description && <p className="text-xs text-henry-text-dim mb-1">{p.description}</p>}
                    {p.nextStep && (
                      <p className="text-[11px] text-henry-accent">→ {p.nextStep}</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => setEditingProject({ ...p })} className="text-[11px] text-henry-text-muted hover:text-henry-text px-2 py-1 rounded">Edit</button>
                    <button onClick={() => removeProject(p.id)} className="text-[11px] text-henry-text-muted hover:text-henry-error px-2 py-1 rounded">✕</button>
                  </div>
                </div>
              </div>
            )
          )}
          {editingProject && editingProject.id === 'new' ? (
            <ProjectForm
              project={editingProject}
              onChange={setEditingProject}
              onSave={() => saveAndRefreshProject({ ...editingProject, id: crypto.randomUUID() })}
              onCancel={() => setEditingProject(null)}
            />
          ) : (
            !editingProject && (
              <button
                onClick={() => setEditingProject({ ...newProject(), id: 'new' })}
                className="w-full py-2.5 rounded-xl border border-dashed border-henry-border/50 text-xs text-henry-text-muted hover:text-henry-text hover:border-henry-border/80 transition-all"
              >
                + Add project
              </button>
            )
          )}
        </div>
      )}

      {/* ── Goals section ── */}
      {section === 'goals' && (
        <div className="space-y-3">
          {goals.length === 0 && !editingGoal && (
            <p className="text-xs text-henry-text-muted italic py-2">No goals yet. Add what you're working toward.</p>
          )}
          {goals.map((g) =>
            editingGoal?.id === g.id ? (
              <GoalForm
                key={g.id}
                goal={editingGoal}
                onChange={setEditingGoal}
                onSave={() => saveAndRefreshGoal(editingGoal)}
                onCancel={() => setEditingGoal(null)}
              />
            ) : (
              <div key={g.id} className="rounded-xl border border-henry-border/40 bg-henry-surface/30 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-henry-text mb-1">{g.title || 'Untitled'}</p>
                    {g.description && <p className="text-xs text-henry-text-dim mb-1">{g.description}</p>}
                    <div className="flex items-center gap-3 mt-2">
                      {g.timeframe && <span className="text-[11px] text-henry-text-muted">{g.timeframe}</span>}
                      {g.progress > 0 && (
                        <div className="flex items-center gap-1.5">
                          <div className="w-20 h-1 bg-henry-bg rounded-full overflow-hidden">
                            <div className="h-full bg-henry-accent rounded-full" style={{ width: `${g.progress}%` }} />
                          </div>
                          <span className="text-[11px] text-henry-text-muted">{g.progress}%</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => setEditingGoal({ ...g })} className="text-[11px] text-henry-text-muted hover:text-henry-text px-2 py-1 rounded">Edit</button>
                    <button onClick={() => removeGoal(g.id)} className="text-[11px] text-henry-text-muted hover:text-henry-error px-2 py-1 rounded">✕</button>
                  </div>
                </div>
              </div>
            )
          )}
          {editingGoal && editingGoal.id === 'new' ? (
            <GoalForm
              goal={editingGoal}
              onChange={setEditingGoal}
              onSave={() => saveAndRefreshGoal({ ...editingGoal, id: crypto.randomUUID() })}
              onCancel={() => setEditingGoal(null)}
            />
          ) : (
            !editingGoal && (
              <button
                onClick={() => setEditingGoal({ ...newGoal(), id: 'new' })}
                className="w-full py-2.5 rounded-xl border border-dashed border-henry-border/50 text-xs text-henry-text-muted hover:text-henry-text hover:border-henry-border/80 transition-all"
              >
                + Add goal
              </button>
            )
          )}
        </div>
      )}

      {/* ── People section ── */}
      {section === 'people' && (
        <div className="space-y-3">
          <p className="text-xs text-henry-text-dim">
            People Henry should know about — family, colleagues, collaborators. Injected into every conversation so he can reference them naturally.
          </p>
          {people.length === 0 && !editingPerson && (
            <p className="text-xs text-henry-text-muted italic py-2">No people yet. Add someone so Henry knows who they are.</p>
          )}
          {people.map((p) =>
            editingPerson?.id === p.id ? (
              <PersonForm
                key={p.id}
                person={editingPerson}
                onChange={setEditingPerson}
                onSave={() => saveAndRefreshPerson(editingPerson)}
                onCancel={() => setEditingPerson(null)}
              />
            ) : (
              <div key={p.id} className="rounded-xl border border-henry-border/40 bg-henry-surface/30 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-henry-text">{p.name || 'Untitled'}</span>
                      {p.relationship && (
                        <span className="text-[11px] text-henry-text-muted bg-henry-bg px-2 py-0.5 rounded-full">{p.relationship}</span>
                      )}
                    </div>
                    {p.context && <p className="text-xs text-henry-text-dim mb-1">{p.context}</p>}
                    {p.lastNote && <p className="text-[11px] text-henry-accent">→ {p.lastNote}</p>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => setEditingPerson({ ...p })} className="text-[11px] text-henry-text-muted hover:text-henry-text px-2 py-1 rounded">Edit</button>
                    <button onClick={() => removePerson(p.id)} className="text-[11px] text-henry-text-muted hover:text-henry-error px-2 py-1 rounded">✕</button>
                  </div>
                </div>
              </div>
            )
          )}
          {editingPerson && editingPerson.id === 'new' ? (
            <PersonForm
              person={editingPerson}
              onChange={setEditingPerson}
              onSave={() => saveAndRefreshPerson({ ...editingPerson, id: crypto.randomUUID() })}
              onCancel={() => setEditingPerson(null)}
            />
          ) : (
            !editingPerson && (
              <button
                onClick={() => setEditingPerson({ ...newPerson(), id: 'new' })}
                className="w-full py-2.5 rounded-xl border border-dashed border-henry-border/50 text-xs text-henry-text-muted hover:text-henry-text hover:border-henry-border/80 transition-all"
              >
                + Add person
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

function ProjectForm({
  project, onChange, onSave, onCancel,
}: { project: HenryProject; onChange: (p: HenryProject) => void; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="rounded-xl border border-henry-accent/30 bg-henry-surface/50 p-4 space-y-3">
      <input
        autoFocus
        placeholder="Project name"
        value={project.name}
        onChange={(e) => onChange({ ...project, name: e.target.value })}
        className="w-full bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50"
      />
      <textarea
        placeholder="Short description — what is this project?"
        value={project.description}
        onChange={(e) => onChange({ ...project, description: e.target.value })}
        rows={2}
        className="w-full bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50 resize-none"
      />
      <input
        placeholder="Next step (optional)"
        value={project.nextStep}
        onChange={(e) => onChange({ ...project, nextStep: e.target.value })}
        className="w-full bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50"
      />
      <div className="flex items-center gap-2">
        <select
          value={project.status}
          onChange={(e) => onChange({ ...project, status: e.target.value as HenryProject['status'] })}
          className="bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-xs text-henry-text outline-none"
        >
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="done">Done</option>
        </select>
        <div className="flex-1" />
        <button onClick={onCancel} className="px-3 py-2 text-xs text-henry-text-muted hover:text-henry-text">Cancel</button>
        <button
          onClick={onSave}
          disabled={!project.name.trim()}
          className="px-4 py-2 bg-henry-accent text-white rounded-lg text-xs font-medium disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function GoalForm({
  goal, onChange, onSave, onCancel,
}: { goal: HenryGoal; onChange: (g: HenryGoal) => void; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="rounded-xl border border-henry-accent/30 bg-henry-surface/50 p-4 space-y-3">
      <input
        autoFocus
        placeholder="Goal title"
        value={goal.title}
        onChange={(e) => onChange({ ...goal, title: e.target.value })}
        className="w-full bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50"
      />
      <textarea
        placeholder="Description — what does success look like?"
        value={goal.description}
        onChange={(e) => onChange({ ...goal, description: e.target.value })}
        rows={2}
        className="w-full bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50 resize-none"
      />
      <div className="flex gap-3">
        <input
          placeholder="Timeframe (e.g. Q1 2025)"
          value={goal.timeframe}
          onChange={(e) => onChange({ ...goal, timeframe: e.target.value })}
          className="flex-1 bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50"
        />
        <div className="flex items-center gap-2">
          <label className="text-xs text-henry-text-muted whitespace-nowrap">Progress</label>
          <input
            type="number"
            min={0} max={100}
            value={goal.progress}
            onChange={(e) => onChange({ ...goal, progress: Math.min(100, Math.max(0, Number(e.target.value))) })}
            className="w-16 bg-henry-bg border border-henry-border rounded-lg px-2 py-2 text-xs text-henry-text outline-none focus:border-henry-accent/50 text-center"
          />
          <span className="text-xs text-henry-text-muted">%</span>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-2 text-xs text-henry-text-muted hover:text-henry-text">Cancel</button>
        <button
          onClick={onSave}
          disabled={!goal.title.trim()}
          className="px-4 py-2 bg-henry-accent text-white rounded-lg text-xs font-medium disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function PersonForm({
  person, onChange, onSave, onCancel,
}: { person: HenryPerson; onChange: (p: HenryPerson) => void; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="rounded-xl border border-henry-accent/30 bg-henry-surface/50 p-4 space-y-3">
      <div className="flex gap-3">
        <input
          autoFocus
          placeholder="Name"
          value={person.name}
          onChange={(e) => onChange({ ...person, name: e.target.value })}
          className="flex-1 bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50"
        />
        <input
          placeholder="Relationship (e.g. brother, coworker)"
          value={person.relationship}
          onChange={(e) => onChange({ ...person, relationship: e.target.value })}
          className="flex-1 bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50"
        />
      </div>
      <textarea
        placeholder="Context — what should Henry know about them?"
        value={person.context}
        onChange={(e) => onChange({ ...person, context: e.target.value })}
        rows={2}
        className="w-full bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50 resize-none"
      />
      <input
        placeholder="Latest note (optional — recent update or status)"
        value={person.lastNote}
        onChange={(e) => onChange({ ...person, lastNote: e.target.value })}
        className="w-full bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50"
      />
      <div className="flex items-center justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-2 text-xs text-henry-text-muted hover:text-henry-text">Cancel</button>
        <button
          onClick={onSave}
          disabled={!person.name.trim()}
          className="px-4 py-2 bg-henry-accent text-white rounded-lg text-xs font-medium disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  );
}
