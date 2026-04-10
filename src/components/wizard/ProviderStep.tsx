import { useState } from 'react';
import { useStore } from '../../store';
import { type ProviderId } from '../../providers/models';

interface ProviderStepProps {
  onNext: () => void;
  onBack: () => void;
}

type PowerMode = 'ollama' | 'cloud' | null;
type CloudProvider = 'openai' | 'anthropic' | 'google';

const CLOUD_OPTIONS: { id: CloudProvider; label: string; icon: string; placeholder: string; prefix: string; defaultModel: string }[] = [
  { id: 'openai',    label: 'OpenAI',    icon: '🤖', placeholder: 'sk-...', prefix: 'sk-', defaultModel: 'gpt-4o' },
  { id: 'anthropic', label: 'Anthropic', icon: '🌙', placeholder: 'sk-ant-...', prefix: 'sk-ant-', defaultModel: 'claude-3-5-sonnet-20241022' },
  { id: 'google',    label: 'Google',    icon: '✨', placeholder: 'AIza...', prefix: 'AIza', defaultModel: 'gemini-1.5-pro' },
];

const KEY_URLS: Record<CloudProvider, string> = {
  openai:    'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  google:    'https://aistudio.google.com/app/apikey',
};

export default function ProviderStep({ onNext, onBack }: ProviderStepProps) {
  const { setProviders, updateSetting } = useStore();
  const [mode, setMode] = useState<PowerMode>(null);
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState('');
  const [cloudProvider, setCloudProvider] = useState<CloudProvider>('openai');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const canContinue = mode === 'ollama'
    ? ollamaModel.trim().length > 0
    : mode === 'cloud'
      ? apiKey.trim().length > 0
      : false;

  async function handleNext() {
    if (!mode) return;
    setSaving(true);
    setError('');

    try {
      if (mode === 'ollama' || (mode === 'cloud' && apiKey.trim())) {
        const providersToSave: { id: ProviderId; name: string; apiKey: string; enabled: boolean; models: string }[] = [];

        if (mode === 'ollama') {
          providersToSave.push({ id: 'ollama', name: 'Ollama', apiKey: '', enabled: true, models: JSON.stringify([ollamaModel.trim()]) });
          await window.henryAPI.saveSetting('ollama_base_url', ollamaUrl.trim() || 'http://localhost:11434');
          updateSetting('ollama_base_url', ollamaUrl.trim() || 'http://localhost:11434');
          await window.henryAPI.saveSetting('companion_model', ollamaModel.trim());
          await window.henryAPI.saveSetting('companion_provider', 'ollama');
          await window.henryAPI.saveSetting('worker_model', ollamaModel.trim());
          await window.henryAPI.saveSetting('worker_provider', 'ollama');
          updateSetting('companion_model', ollamaModel.trim());
          updateSetting('companion_provider', 'ollama');
          updateSetting('worker_model', ollamaModel.trim());
          updateSetting('worker_provider', 'ollama');
        }

        if (mode === 'cloud') {
          const selected = CLOUD_OPTIONS.find(c => c.id === cloudProvider)!;
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
      }

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
      <div className="text-center mb-8">
        <div className="bg-henry-surface/40 border border-henry-border/30 rounded-2xl p-5 text-left relative max-w-lg mx-auto">
          <div className="absolute -top-3 left-6 text-xs font-medium text-henry-text-muted bg-henry-bg px-2">
            Henry
          </div>
          <p className="text-henry-text-dim leading-relaxed">
            How should I think? Pick one to start —{' '}
            <span className="text-henry-text font-medium">you can add more in Settings later.</span>
          </p>
        </div>
      </div>

      {/* Two big option cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* Ollama card */}
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

        {/* Cloud card */}
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

      {/* Ollama config */}
      {mode === 'ollama' && (
        <div className="bg-henry-surface/40 border border-henry-border/30 rounded-2xl p-5 mb-5 space-y-4 animate-fade-in">
          <div>
            <label className="block text-xs font-medium text-henry-text-dim mb-2">
              What model should I use?{' '}
              <span className="text-henry-text-muted">(e.g. llama3.2, mistral, phi4)</span>
            </label>
            <input
              type="text"
              value={ollamaModel}
              onChange={(e) => setOllamaModel(e.target.value)}
              placeholder="llama3.2"
              className="w-full bg-henry-bg border border-henry-border rounded-xl px-4 py-3 text-sm text-henry-text font-mono outline-none focus:border-henry-accent/50"
              autoFocus
            />
            <p className="text-[11px] text-henry-text-muted mt-1.5">
              Run <code className="text-henry-accent">ollama pull llama3.2</code> on your Mac first if you haven't.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-henry-text-dim mb-2">
              Ollama URL <span className="text-henry-text-muted">(change if using from another device)</span>
            </label>
            <input
              type="text"
              value={ollamaUrl}
              onChange={(e) => setOllamaUrl(e.target.value)}
              placeholder="http://localhost:11434"
              className="w-full bg-henry-bg border border-henry-border rounded-xl px-4 py-3 text-sm text-henry-text font-mono outline-none focus:border-henry-accent/50"
            />
            <p className="text-[11px] text-henry-text-muted mt-1.5">
              If you're on iPad, use your Mac's IP instead:{' '}
              <code className="text-henry-accent">http://192.168.x.x:11434</code>. Start Ollama with{' '}
              <code className="text-henry-accent">OLLAMA_HOST=0.0.0.0 OLLAMA_ORIGINS=* ollama serve</code>
            </p>
          </div>
        </div>
      )}

      {/* Cloud config */}
      {mode === 'cloud' && (
        <div className="bg-henry-surface/40 border border-henry-border/30 rounded-2xl p-5 mb-5 animate-fade-in">
          {/* Provider tabs */}
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
              {CLOUD_OPTIONS.find(c => c.id === cloudProvider)?.label} API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={CLOUD_OPTIONS.find(c => c.id === cloudProvider)?.placeholder}
              className="w-full bg-henry-bg border border-henry-border rounded-xl px-4 py-3 text-sm text-henry-text outline-none focus:border-henry-accent/50"
              autoFocus
            />
            <a
              href={KEY_URLS[cloudProvider]}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-henry-accent hover:underline mt-1.5 block"
            >
              Get a key from {CLOUD_OPTIONS.find(c => c.id === cloudProvider)?.label} →
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

      {error && (
        <p className="text-center text-xs text-henry-error mb-4">{error}</p>
      )}

      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="px-6 py-2.5 text-henry-text-dim hover:text-henry-text transition-colors text-sm"
        >
          ← Back
        </button>
        <div className="flex items-center gap-3">
          {!canContinue && mode && (
            <span className="text-xs text-henry-text-muted">
              {mode === 'ollama' ? 'Enter a model name' : 'Enter your API key'}
            </span>
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
