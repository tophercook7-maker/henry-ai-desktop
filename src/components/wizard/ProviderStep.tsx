import { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store';
import { type ProviderId } from '../../providers/models';

interface ProviderStepProps {
  onNext: () => void;
  onBack: () => void;
}

type PowerMode = 'ollama' | 'cloud' | null;
type CloudProvider = 'openai' | 'anthropic' | 'google';
type OllamaPhase =
  | 'detecting'
  | 'found'
  | 'no_models'
  | 'not_found'
  | 'custom_url';

const CLOUD_OPTIONS: {
  id: CloudProvider;
  label: string;
  icon: string;
  placeholder: string;
  defaultModel: string;
}[] = [
  { id: 'openai',    label: 'OpenAI',    icon: '🤖', placeholder: 'sk-...', defaultModel: 'gpt-4o' },
  { id: 'anthropic', label: 'Anthropic', icon: '🌙', placeholder: 'sk-ant-...', defaultModel: 'claude-3-5-sonnet-20241022' },
  { id: 'google',    label: 'Google',    icon: '✨', placeholder: 'AIza...', defaultModel: 'gemini-1.5-pro' },
];

const KEY_URLS: Record<CloudProvider, string> = {
  openai:    'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  google:    'https://aistudio.google.com/app/apikey',
};

const SUGGESTED_MODELS: { name: string; desc: string }[] = [
  { name: 'llama3.2',    desc: 'Fast · great all-rounder' },
  { name: 'mistral',     desc: 'Sharp · strong at writing' },
  { name: 'phi4',        desc: 'Efficient · Microsoft' },
  { name: 'gemma3',      desc: 'Lightweight · Google' },
  { name: 'qwen2.5',     desc: 'Multilingual · Alibaba' },
  { name: 'llama3.1:8b', desc: 'Smarter · more memory' },
];

async function probeOllama(baseUrl: string): Promise<{ ok: boolean; models: string[] }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, models: [] };
    const data = await res.json() as { models?: Array<{ name?: string }> };
    const models = (data.models || []).map((m) => m.name || '').filter(Boolean);
    return { ok: true, models };
  } catch {
    return { ok: false, models: [] };
  }
}

export default function ProviderStep({ onNext, onBack }: ProviderStepProps) {
  const { setProviders, updateSetting } = useStore();

  const [mode, setMode] = useState<PowerMode>(null);

  // Ollama state
  const [ollamaPhase, setOllamaPhase] = useState<OllamaPhase>('detecting');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [customUrlInput, setCustomUrlInput] = useState('http://192.168.1.x:11434');
  const [detectedModels, setDetectedModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [copiedCmd, setCopiedCmd] = useState('');
  const probeRunning = useRef(false);

  // Cloud state
  const [cloudProvider, setCloudProvider] = useState<CloudProvider>('openai');
  const [apiKey, setApiKey] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function runDetection(url: string) {
    if (probeRunning.current) return;
    probeRunning.current = true;
    setOllamaPhase('detecting');
    setSelectedModel('');
    setDetectedModels([]);
    const result = await probeOllama(url);
    probeRunning.current = false;
    if (result.ok) {
      setOllamaUrl(url);
      setDetectedModels(result.models);
      setOllamaPhase(result.models.length > 0 ? 'found' : 'no_models');
      if (result.models.length === 1) {
        setSelectedModel(result.models[0]);
      }
    } else {
      setOllamaPhase('not_found');
    }
  }

  useEffect(() => {
    if (mode === 'ollama') {
      probeRunning.current = false;
      void runDetection('http://localhost:11434');
    }
  }, [mode]);

  function copyCmd(cmd: string) {
    navigator.clipboard.writeText(cmd).catch(() => {});
    setCopiedCmd(cmd);
    setTimeout(() => setCopiedCmd(''), 2000);
  }

  const canContinue =
    mode === 'ollama'
      ? selectedModel.trim().length > 0
      : mode === 'cloud'
      ? apiKey.trim().length > 0
      : false;

  async function handleNext() {
    if (!mode || !canContinue) return;
    setSaving(true);
    setError('');
    try {
      const providersToSave: { id: ProviderId; name: string; apiKey: string; enabled: boolean; models: string }[] = [];

      if (mode === 'ollama') {
        providersToSave.push({ id: 'ollama', name: 'Ollama', apiKey: '', enabled: true, models: JSON.stringify([selectedModel.trim()]) });
        await window.henryAPI.saveSetting('ollama_base_url', ollamaUrl);
        updateSetting('ollama_base_url', ollamaUrl);
        await window.henryAPI.saveSetting('companion_model', selectedModel.trim());
        await window.henryAPI.saveSetting('companion_provider', 'ollama');
        await window.henryAPI.saveSetting('worker_model', selectedModel.trim());
        await window.henryAPI.saveSetting('worker_provider', 'ollama');
        updateSetting('companion_model', selectedModel.trim());
        updateSetting('companion_provider', 'ollama');
        updateSetting('worker_model', selectedModel.trim());
        updateSetting('worker_provider', 'ollama');
      }

      if (mode === 'cloud') {
        const selected = CLOUD_OPTIONS.find((c) => c.id === cloudProvider)!;
        providersToSave.push({ id: cloudProvider, name: selected.label, apiKey: apiKey.trim(), enabled: true, models: JSON.stringify([selected.defaultModel]) });
        await window.henryAPI.saveSetting('companion_model', selected.defaultModel);
        await window.henryAPI.saveSetting('companion_provider', cloudProvider);
        await window.henryAPI.saveSetting('worker_model', selected.defaultModel);
        await window.henryAPI.saveSetting('worker_provider', cloudProvider);
        updateSetting('companion_model', selected.defaultModel);
        updateSetting('companion_provider', cloudProvider);
        updateSetting('worker_model', selected.defaultModel);
        updateSetting('worker_provider', cloudProvider);
      }

      for (const p of providersToSave) {
        await window.henryAPI.saveProvider(p);
      }

      const rawProviders = await window.henryAPI.getProviders();
      setProviders(rawProviders.map((p: any) => ({
        id: p.id,
        name: p.name,
        apiKey: p.api_key ?? p.apiKey ?? '',
        enabled: Boolean(p.enabled),
        models: JSON.parse(p.models || '[]'),
      })));

      onNext();
    } catch (err) {
      console.error('Failed to save providers:', err);
      setError('Something went wrong saving your settings. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="animate-slide-up">
      {/* Henry prompt */}
      <div className="text-center mb-8">
        <div className="bg-henry-surface/40 border border-henry-border/30 rounded-2xl p-5 text-left relative max-w-lg mx-auto">
          <div className="absolute -top-3 left-6 text-xs font-medium text-henry-text-muted bg-henry-bg px-2">Henry</div>
          <p className="text-henry-text-dim leading-relaxed">
            How should I think? Pick one to start —{' '}
            <span className="text-henry-text font-medium">you can add more in Settings later.</span>
          </p>
        </div>
      </div>

      {/* Mode cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <button
          onClick={() => setMode('ollama')}
          className={`rounded-2xl border-2 p-6 text-left transition-all ${
            mode === 'ollama'
              ? 'border-henry-success bg-henry-success/5'
              : 'border-henry-border/40 bg-henry-surface/30 hover:border-henry-border hover:bg-henry-surface/60'
          }`}
        >
          <div className="text-3xl mb-3">🏠</div>
          <div className="font-semibold text-henry-text mb-1">Ollama</div>
          <div className="text-[11px] text-henry-success font-medium mb-3">Free · Private · Offline-capable</div>
          <div className="text-xs text-henry-text-dim leading-relaxed">
            Runs AI directly on your Mac. No account, no cost, no data leaving your machine.
          </div>
        </button>

        <button
          onClick={() => setMode('cloud')}
          className={`rounded-2xl border-2 p-6 text-left transition-all ${
            mode === 'cloud'
              ? 'border-henry-accent bg-henry-accent/5'
              : 'border-henry-border/40 bg-henry-surface/30 hover:border-henry-border hover:bg-henry-surface/60'
          }`}
        >
          <div className="text-3xl mb-3">☁️</div>
          <div className="font-semibold text-henry-text mb-1">Cloud AI</div>
          <div className="text-[11px] text-henry-accent font-medium mb-3">GPT · Claude · Gemini</div>
          <div className="text-xs text-henry-text-dim leading-relaxed">
            More powerful for complex tasks. Needs an API key — costs a little per message.
          </div>
        </button>
      </div>

      {/* ── OLLAMA ONBOARDING ── */}
      {mode === 'ollama' && (
        <div className="bg-henry-surface/40 border border-henry-border/30 rounded-2xl p-5 mb-5 animate-fade-in space-y-4">

          {/* Detecting */}
          {ollamaPhase === 'detecting' && (
            <div className="flex items-center gap-3 py-2">
              <div className="w-4 h-4 border-2 border-henry-accent border-t-transparent rounded-full animate-spin shrink-0" />
              <p className="text-sm text-henry-text-dim">Checking if Ollama is running on your machine…</p>
            </div>
          )}

          {/* Found with models */}
          {ollamaPhase === 'found' && (
            <>
              <div className="flex items-center gap-2 text-henry-success text-sm font-medium">
                <span>✓</span>
                <span>Ollama is running at <code className="text-xs font-mono opacity-80">{ollamaUrl}</code></span>
              </div>
              <div>
                <p className="text-xs text-henry-text-dim mb-3">
                  {detectedModels.length === 1
                    ? 'Found one model — selecting it for you.'
                    : `Found ${detectedModels.length} models installed. Pick one:`}
                </p>
                <div className="flex flex-wrap gap-2">
                  {detectedModels.map((m) => (
                    <button
                      key={m}
                      onClick={() => setSelectedModel(m)}
                      className={`px-3 py-1.5 rounded-xl text-sm font-mono transition-all border ${
                        selectedModel === m
                          ? 'bg-henry-success/15 border-henry-success text-henry-success'
                          : 'bg-henry-hover border-henry-border text-henry-text-dim hover:border-henry-text-dim'
                      }`}
                    >
                      {selectedModel === m && <span className="mr-1.5">✓</span>}
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Found but no models */}
          {ollamaPhase === 'no_models' && (
            <>
              <div className="flex items-center gap-2 text-henry-warning text-sm font-medium">
                <span>⚠️</span>
                <span>Ollama is running but you don't have any models yet.</span>
              </div>
              <p className="text-xs text-henry-text-dim">
                Run this in your terminal to grab a good starter model:
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-henry-bg border border-henry-border rounded-xl px-4 py-2.5 text-sm text-henry-accent font-mono">
                  ollama pull llama3.2
                </code>
                <button
                  onClick={() => copyCmd('ollama pull llama3.2')}
                  className="shrink-0 px-3 py-2.5 rounded-xl bg-henry-hover border border-henry-border text-xs text-henry-text-dim hover:text-henry-text transition-all"
                >
                  {copiedCmd === 'ollama pull llama3.2' ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <p className="text-xs text-henry-text-muted">Then click Try again below.</p>
              <div className="flex flex-wrap gap-2 mt-1">
                {SUGGESTED_MODELS.map((m) => (
                  <div key={m.name} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-henry-bg border border-henry-border/50">
                    <span className="font-mono text-xs text-henry-text">{m.name}</span>
                    <span className="text-[10px] text-henry-text-muted">· {m.desc}</span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => runDetection(ollamaUrl)}
                className="w-full py-2.5 rounded-xl border border-henry-border text-sm text-henry-text-dim hover:text-henry-text hover:border-henry-text-dim transition-all"
              >
                ↻ Try again
              </button>
            </>
          )}

          {/* Not found */}
          {(ollamaPhase === 'not_found' || ollamaPhase === 'custom_url') && (
            <>
              <div className="flex items-center gap-2 text-henry-error text-sm font-medium">
                <span>✗</span>
                <span>Can't reach Ollama at {ollamaUrl}</span>
              </div>

              <div className="bg-henry-bg rounded-xl border border-henry-border/50 p-4 space-y-3">
                <p className="text-xs font-semibold text-henry-text">Get Ollama running in 3 steps:</p>

                <div className="space-y-2.5">
                  {/* Step 1 */}
                  <div className="flex gap-3">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-henry-accent/15 text-henry-accent text-[10px] font-bold flex items-center justify-center">1</span>
                    <div>
                      <p className="text-xs text-henry-text mb-1">Download and install Ollama</p>
                      <a
                        href="https://ollama.com/download"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-henry-accent hover:underline"
                      >
                        ollama.com/download →
                      </a>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="flex gap-3">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-henry-accent/15 text-henry-accent text-[10px] font-bold flex items-center justify-center">2</span>
                    <div className="flex-1">
                      <p className="text-xs text-henry-text mb-1.5">Start it with network access enabled</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 bg-henry-surface border border-henry-border/50 rounded-lg px-3 py-2 text-[11px] text-henry-accent font-mono break-all">
                          OLLAMA_HOST=0.0.0.0 OLLAMA_ORIGINS=* ollama serve
                        </code>
                        <button
                          onClick={() => copyCmd('OLLAMA_HOST=0.0.0.0 OLLAMA_ORIGINS=* ollama serve')}
                          className="shrink-0 px-2.5 py-2 rounded-lg bg-henry-hover border border-henry-border text-xs text-henry-text-dim hover:text-henry-text"
                        >
                          {copiedCmd === 'OLLAMA_HOST=0.0.0.0 OLLAMA_ORIGINS=* ollama serve' ? '✓' : 'Copy'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="flex gap-3">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-henry-accent/15 text-henry-accent text-[10px] font-bold flex items-center justify-center">3</span>
                    <div className="flex-1">
                      <p className="text-xs text-henry-text mb-1.5">Pull a model (in a new terminal tab)</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 bg-henry-surface border border-henry-border/50 rounded-lg px-3 py-2 text-[11px] text-henry-accent font-mono">
                          ollama pull llama3.2
                        </code>
                        <button
                          onClick={() => copyCmd('ollama pull llama3.2')}
                          className="shrink-0 px-2.5 py-2 rounded-lg bg-henry-hover border border-henry-border text-xs text-henry-text-dim hover:text-henry-text"
                        >
                          {copiedCmd === 'ollama pull llama3.2' ? '✓' : 'Copy'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* iPad / remote device section */}
              <details className="group">
                <summary className="text-xs text-henry-text-muted cursor-pointer hover:text-henry-text-dim select-none list-none flex items-center gap-1.5">
                  <span className="group-open:rotate-90 transition-transform inline-block">›</span>
                  Connecting from iPad or another device?
                </summary>
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-henry-text-dim">
                    Enter your Mac's local IP — find it in System Settings → Wi-Fi → Details:
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={customUrlInput}
                      onChange={(e) => setCustomUrlInput(e.target.value)}
                      placeholder="http://192.168.x.x:11434"
                      className="flex-1 bg-henry-bg border border-henry-border rounded-xl px-4 py-2.5 text-sm text-henry-text font-mono outline-none focus:border-henry-accent/50"
                    />
                    <button
                      onClick={() => {
                        const url = customUrlInput.trim().replace(/\/$/, '');
                        const fullUrl = url.startsWith('http') ? url : `http://${url}`;
                        setOllamaPhase('detecting');
                        void runDetection(fullUrl);
                      }}
                      className="shrink-0 px-4 py-2.5 rounded-xl bg-henry-accent text-white text-sm font-medium hover:bg-henry-accent-hover transition-all"
                    >
                      Try
                    </button>
                  </div>
                </div>
              </details>

              <button
                onClick={() => runDetection('http://localhost:11434')}
                className="w-full py-2.5 rounded-xl border border-henry-border text-sm text-henry-text-dim hover:text-henry-text hover:border-henry-text-dim transition-all"
              >
                ↻ Try again at localhost
              </button>
            </>
          )}
        </div>
      )}

      {/* ── CLOUD CONFIG ── */}
      {mode === 'cloud' && (
        <div className="bg-henry-surface/40 border border-henry-border/30 rounded-2xl p-5 mb-5 animate-fade-in">
          <div className="flex gap-2 mb-4">
            {CLOUD_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => { setCloudProvider(opt.id); setApiKey(''); }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-all ${
                  cloudProvider === opt.id
                    ? 'bg-henry-accent text-white'
                    : 'bg-henry-hover text-henry-text-dim hover:text-henry-text'
                }`}
              >
                <span>{opt.icon}</span>
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
          <div>
            <label className="block text-xs font-medium text-henry-text-dim mb-2">
              {CLOUD_OPTIONS.find((c) => c.id === cloudProvider)?.label} API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={CLOUD_OPTIONS.find((c) => c.id === cloudProvider)?.placeholder}
              className="w-full bg-henry-bg border border-henry-border rounded-xl px-4 py-3 text-sm text-henry-text outline-none focus:border-henry-accent/50"
              autoFocus
            />
            <a
              href={KEY_URLS[cloudProvider]}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-henry-accent hover:underline mt-1.5 block"
            >
              Get a key from {CLOUD_OPTIONS.find((c) => c.id === cloudProvider)?.label} →
            </a>
          </div>
        </div>
      )}

      {/* Not sure helper */}
      {!mode && (
        <p className="text-center text-xs text-henry-text-muted mb-5">
          Not sure?{' '}
          <button onClick={() => setMode('ollama')} className="text-henry-accent hover:underline">
            Start with Ollama
          </button>{' '}
          — it's free and runs on your Mac.
        </p>
      )}

      {error && <p className="text-center text-xs text-henry-error mb-4">{error}</p>}

      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="px-6 py-2.5 text-henry-text-dim hover:text-henry-text transition-colors text-sm"
        >
          ← Back
        </button>
        <div className="flex items-center gap-3">
          {!canContinue && mode === 'ollama' && ollamaPhase === 'found' && (
            <span className="text-xs text-henry-text-muted">Pick a model above</span>
          )}
          {!canContinue && mode === 'cloud' && (
            <span className="text-xs text-henry-text-muted">Enter your API key</span>
          )}
          <button
            onClick={handleNext}
            disabled={!canContinue || saving}
            className={`px-8 py-2.5 rounded-xl font-medium text-sm transition-all ${
              canContinue && !saving
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
