import { useState } from 'react';
import { useStore } from '../../store';
import { AVAILABLE_MODELS, PROVIDERS, formatPrice, type ProviderId } from '../../providers/models';
import type { AIModel } from '../../types';

interface EngineAssignStepProps {
  onNext: () => void;
  onBack: () => void;
}

export default function EngineAssignStep({ onNext, onBack }: EngineAssignStepProps) {
  const { providers, settings, updateSetting } = useStore();
  const [companionModel, setCompanionModel] = useState(settings.companion_model || '');
  const [workerModel, setWorkerModel] = useState(settings.worker_model || '');
  const [companionCustom, setCompanionCustom] = useState('');
  const [workerCustom, setWorkerCustom] = useState('');

  const enabledProviderIds = providers.filter((p) => p.enabled).map((p) => p.id);
  const availableModels = AVAILABLE_MODELS.filter((m) => enabledProviderIds.includes(m.provider));
  const ollamaEnabled = enabledProviderIds.includes('ollama');

  const effectiveCompanion = companionCustom.trim() || companionModel;
  const effectiveWorker = workerCustom.trim() || workerModel || effectiveCompanion;

  const companionProvider = companionCustom.trim()
    ? 'ollama'
    : (AVAILABLE_MODELS.find((m) => m.id === companionModel)?.provider ?? '');
  const workerProvider = workerCustom.trim()
    ? 'ollama'
    : workerModel
      ? (AVAILABLE_MODELS.find((m) => m.id === workerModel)?.provider ?? '')
      : companionProvider;

  const recommendedCompanion = availableModels.filter(
    (m) => m.recommended === 'companion' || m.recommended === 'both'
  );
  const recommendedWorker = availableModels.filter(
    (m) => m.recommended === 'worker' || m.recommended === 'both'
  );

  async function handleNext() {
    try {
      await window.henryAPI.saveSetting('companion_model', effectiveCompanion);
      await window.henryAPI.saveSetting('companion_provider', companionProvider);
      await window.henryAPI.saveSetting('worker_model', effectiveWorker);
      await window.henryAPI.saveSetting('worker_provider', workerProvider);

      updateSetting('companion_model', effectiveCompanion);
      updateSetting('companion_provider', companionProvider);
      updateSetting('worker_model', effectiveWorker);
      updateSetting('worker_provider', workerProvider);

      onNext();
    } catch (err) {
      console.error('Failed to save engine assignments:', err);
    }
  }

  const canContinue = !!(effectiveCompanion);

  return (
    <div className="animate-slide-up">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-henry-text mb-2">
          Assign Your Engines
        </h2>
        <p className="text-henry-text-dim max-w-md mx-auto">
          Henry uses two engines. The <span className="text-henry-companion font-medium">Companion</span> handles
          chat. The <span className="text-henry-worker font-medium">Worker</span> handles heavy tasks.
          You only need one model — both can share it.
        </p>
      </div>

      {ollamaEnabled && (
        <div className="mb-5 rounded-xl bg-henry-surface/40 border border-henry-border/30 px-4 py-3 text-xs text-henry-text-dim leading-relaxed">
          <span className="font-medium text-henry-text">Using Ollama locally?</span> Type your model name below
          (e.g. <code className="text-henry-text-dim">llama3</code>, <code className="text-henry-text-dim">mistral</code>,
          <code className="text-henry-text-dim">phi4</code>). Run <code className="text-henry-text-dim">ollama list</code> in
          your terminal to see what you have. Ollama must be started with <code className="text-henry-text-dim">OLLAMA_ORIGINS=*</code> so
          the browser can reach it.
        </div>
      )}

      <div className="grid grid-cols-2 gap-6 mb-8">
        <EngineCard
          engine="companion"
          icon="🧠"
          title="Companion Engine"
          description="Always responsive. Chat, quick answers, and all modes. Use a fast model here."
          selectedModel={companionModel}
          onSelect={(id) => { setCompanionModel(id); setCompanionCustom(''); }}
          customValue={companionCustom}
          onCustomChange={setCompanionCustom}
          recommendedModels={recommendedCompanion}
          allModels={availableModels}
          color="companion"
          showCustom={ollamaEnabled}
        />

        <EngineCard
          engine="worker"
          icon="⚡"
          title="Worker Engine"
          description="Heavy lifting — code, research, long tasks. Leave empty to share Companion's model."
          selectedModel={workerModel}
          onSelect={(id) => { setWorkerModel(id); setWorkerCustom(''); }}
          customValue={workerCustom}
          onCustomChange={setWorkerCustom}
          recommendedModels={recommendedWorker}
          allModels={availableModels}
          color="worker"
          showCustom={ollamaEnabled}
          optional
          placeholder={effectiveCompanion ? `Defaults to: ${effectiveCompanion}` : 'Same as Companion'}
        />
      </div>

      {effectiveCompanion && effectiveWorker && !companionCustom && !workerCustom && (
        <CostEstimate companionModelId={effectiveCompanion} workerModelId={effectiveWorker} />
      )}

      <div className="flex items-center justify-between mt-6">
        <button
          onClick={onBack}
          className="px-6 py-2.5 text-henry-text-dim hover:text-henry-text transition-colors text-sm"
        >
          ← Back
        </button>
        <button
          onClick={handleNext}
          disabled={!canContinue}
          className={`px-8 py-2.5 rounded-xl font-medium text-sm transition-all ${
            canContinue
              ? 'bg-henry-accent text-white hover:bg-henry-accent-hover'
              : 'bg-henry-hover text-henry-text-muted cursor-not-allowed'
          }`}
        >
          Continue →
        </button>
      </div>
    </div>
  );
}

function EngineCard({
  engine,
  icon,
  title,
  description,
  selectedModel,
  onSelect,
  customValue,
  onCustomChange,
  recommendedModels,
  allModels,
  color,
  showCustom,
  optional,
  placeholder,
}: {
  engine: string;
  icon: string;
  title: string;
  description: string;
  selectedModel: string;
  onSelect: (id: string) => void;
  customValue: string;
  onCustomChange: (v: string) => void;
  recommendedModels: AIModel[];
  allModels: AIModel[];
  color: 'companion' | 'worker';
  showCustom?: boolean;
  optional?: boolean;
  placeholder?: string;
}) {
  const borderColor = color === 'companion' ? 'border-henry-companion/30' : 'border-henry-worker/30';
  const bgColor = color === 'companion' ? 'bg-henry-companion/5' : 'bg-henry-worker/5';

  return (
    <div className={`rounded-xl border ${borderColor} ${bgColor} p-5`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xl">{icon}</span>
        <h3 className="font-semibold text-henry-text">{title}</h3>
        {optional && (
          <span className="ml-auto text-[10px] text-henry-text-muted bg-henry-hover px-1.5 py-0.5 rounded">optional</span>
        )}
      </div>
      <p className="text-xs text-henry-text-dim mb-4 leading-relaxed">{description}</p>

      {showCustom && (
        <div className="mb-4">
          <label className="text-[10px] font-medium text-henry-text-muted uppercase tracking-wider block mb-1.5">
            Custom Ollama model name
          </label>
          <input
            type="text"
            value={customValue}
            onChange={(e) => onCustomChange(e.target.value)}
            placeholder={placeholder || 'e.g. llama3, mistral, phi4'}
            className="w-full text-xs rounded-lg border border-henry-border/50 bg-henry-bg/60 text-henry-text px-3 py-2 focus:outline-none focus:ring-1 focus:ring-henry-accent/50 placeholder:text-henry-text-muted/60"
          />
          {customValue.trim() && (
            <p className="text-[10px] text-henry-text-muted mt-1">
              Will use: <code className="text-henry-text-dim">{customValue.trim()}</code> via Ollama
            </p>
          )}
        </div>
      )}

      {recommendedModels.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] font-medium text-henry-text-muted uppercase tracking-wider mb-2">
            Recommended
          </div>
          <div className="space-y-1.5">
            {recommendedModels.map((model) => (
              <ModelOption
                key={model.id}
                model={model}
                selected={!customValue.trim() && selectedModel === model.id}
                onSelect={() => onSelect(model.id)}
              />
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="text-[10px] font-medium text-henry-text-muted uppercase tracking-wider mb-2">
          {allModels.filter((m) => !recommendedModels.includes(m)).length > 0 ? 'All Available' : ''}
        </div>
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {allModels
            .filter((m) => !recommendedModels.includes(m))
            .map((model) => (
              <ModelOption
                key={model.id}
                model={model}
                selected={!customValue.trim() && selectedModel === model.id}
                onSelect={() => onSelect(model.id)}
              />
            ))}
        </div>
      </div>
    </div>
  );
}

function ModelOption({
  model,
  selected,
  onSelect,
}: {
  model: AIModel;
  selected: boolean;
  onSelect: () => void;
}) {
  const providerInfo = PROVIDERS[model.provider as ProviderId];

  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-2.5 p-2.5 rounded-lg text-left transition-all ${
        selected
          ? 'bg-henry-accent/10 border border-henry-accent/30'
          : 'bg-henry-bg/50 border border-transparent hover:bg-henry-hover/50'
      }`}
    >
      <div
        className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
          selected ? 'border-henry-accent' : 'border-henry-border'
        }`}
      >
        {selected && <div className="w-1.5 h-1.5 rounded-full bg-henry-accent" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs">{providerInfo?.icon}</span>
          <span className="text-xs font-medium text-henry-text truncate">{model.name}</span>
        </div>
        <div className="text-[10px] text-henry-text-muted">
          {model.local
            ? 'Free (local)'
            : `${formatPrice(model.inputPricePer1M)} in / ${formatPrice(model.outputPricePer1M)} out per 1M tokens`}
        </div>
      </div>
    </button>
  );
}

function CostEstimate({
  companionModelId,
  workerModelId,
}: {
  companionModelId: string;
  workerModelId: string;
}) {
  const companion = AVAILABLE_MODELS.find((m) => m.id === companionModelId);
  const worker = AVAILABLE_MODELS.find((m) => m.id === workerModelId);
  if (!companion || !worker) return null;
  if (companion.local && worker.local) return null;

  const companionDaily =
    (100 * 500 * companion.inputPricePer1M) / 1_000_000 +
    (100 * 500 * companion.outputPricePer1M) / 1_000_000;
  const workerDaily =
    (20 * 2000 * worker.inputPricePer1M) / 1_000_000 +
    (20 * 2000 * worker.outputPricePer1M) / 1_000_000;
  const totalDaily = companionDaily + workerDaily;
  const totalMonthly = totalDaily * 30;

  return (
    <div className="rounded-xl bg-henry-surface/50 border border-henry-border/30 p-4">
      <div className="text-xs font-medium text-henry-text mb-2">
        Estimated Cost (heavy usage)
      </div>
      <div className="flex items-center gap-6 text-xs text-henry-text-dim">
        <div>
          <span className="text-henry-text font-medium">~${totalDaily.toFixed(2)}</span> / day
        </div>
        <div>
          <span className="text-henry-text font-medium">~${totalMonthly.toFixed(2)}</span> / month
        </div>
        <div className="flex-1 text-right text-[10px] text-henry-text-muted">
          ~100 companion + ~20 worker interactions/day
        </div>
      </div>
    </div>
  );
}
