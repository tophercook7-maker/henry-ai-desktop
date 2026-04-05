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

  // Get available models from enabled providers
  const enabledProviderIds = providers.filter((p) => p.enabled).map((p) => p.id);
  const availableModels = AVAILABLE_MODELS.filter((m) =>
    enabledProviderIds.includes(m.provider)
  );

  const recommendedCompanion = availableModels.filter(
    (m) => m.recommended === 'companion' || m.recommended === 'both'
  );
  const recommendedWorker = availableModels.filter(
    (m) => m.recommended === 'worker' || m.recommended === 'both'
  );

  async function handleNext() {
    const companionModelObj = AVAILABLE_MODELS.find((m) => m.id === companionModel);
    const workerModelObj = AVAILABLE_MODELS.find((m) => m.id === workerModel);

    try {
      // Save engine assignments
      await window.henryAPI.saveSetting('companion_model', companionModel);
      await window.henryAPI.saveSetting('companion_provider', companionModelObj?.provider || '');
      await window.henryAPI.saveSetting('worker_model', workerModel);
      await window.henryAPI.saveSetting('worker_provider', workerModelObj?.provider || '');

      updateSetting('companion_model', companionModel);
      updateSetting('companion_provider', companionModelObj?.provider || '');
      updateSetting('worker_model', workerModel);
      updateSetting('worker_provider', workerModelObj?.provider || '');

      onNext();
    } catch (err) {
      console.error('Failed to save engine assignments:', err);
    }
  }

  return (
    <div className="animate-slide-up">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-henry-text mb-2">
          Assign Your Engines
        </h2>
        <p className="text-henry-text-dim max-w-md mx-auto">
          Henry uses two engines. The <span className="text-henry-companion font-medium">Companion</span> is
          always available for quick chat. The <span className="text-henry-worker font-medium">Worker</span> handles
          heavy tasks in the background.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-8">
        {/* Companion Engine */}
        <EngineCard
          engine="companion"
          icon="🧠"
          title="Companion Engine"
          description="Always responsive. Handles chat, status updates, and quick answers. Choose a fast, cost-effective model."
          selectedModel={companionModel}
          onSelect={setCompanionModel}
          recommendedModels={recommendedCompanion}
          allModels={availableModels}
          color="companion"
        />

        {/* Worker Engine */}
        <EngineCard
          engine="worker"
          icon="⚡"
          title="Worker Engine"
          description="Handles heavy lifting. Code generation, research, file operations. Choose a powerful model."
          selectedModel={workerModel}
          onSelect={setWorkerModel}
          recommendedModels={recommendedWorker}
          allModels={availableModels}
          color="worker"
        />
      </div>

      {/* Cost estimate */}
      {companionModel && workerModel && (
        <CostEstimate companionModelId={companionModel} workerModelId={workerModel} />
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
          disabled={!companionModel || !workerModel}
          className={`px-8 py-2.5 rounded-xl font-medium text-sm transition-all ${
            companionModel && workerModel
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
  recommendedModels,
  allModels,
  color,
}: {
  engine: string;
  icon: string;
  title: string;
  description: string;
  selectedModel: string;
  onSelect: (id: string) => void;
  recommendedModels: AIModel[];
  allModels: AIModel[];
  color: 'companion' | 'worker';
}) {
  const borderColor = color === 'companion' ? 'border-henry-companion/30' : 'border-henry-worker/30';
  const bgColor = color === 'companion' ? 'bg-henry-companion/5' : 'bg-henry-worker/5';

  return (
    <div className={`rounded-xl border ${borderColor} ${bgColor} p-5`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl">{icon}</span>
        <h3 className="font-semibold text-henry-text">{title}</h3>
      </div>
      <p className="text-xs text-henry-text-dim mb-4 leading-relaxed">
        {description}
      </p>

      {/* Recommended */}
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
                selected={selectedModel === model.id}
                onSelect={() => onSelect(model.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* All models */}
      <div>
        <div className="text-[10px] font-medium text-henry-text-muted uppercase tracking-wider mb-2">
          All Available
        </div>
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {allModels
            .filter((m) => !recommendedModels.includes(m))
            .map((model) => (
              <ModelOption
                key={model.id}
                model={model}
                selected={selectedModel === model.id}
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
        className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${
          selected ? 'border-henry-accent' : 'border-henry-border'
        }`}
      >
        {selected && <div className="w-1.5 h-1.5 rounded-full bg-henry-accent" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs">{providerInfo?.icon}</span>
          <span className="text-xs font-medium text-henry-text truncate">
            {model.name}
          </span>
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

  // Estimate: ~100 companion messages/day (~500 tokens each), ~20 worker tasks/day (~2000 tokens each)
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
        💰 Estimated Cost (heavy usage)
      </div>
      <div className="flex items-center gap-6 text-xs text-henry-text-dim">
        <div>
          <span className="text-henry-text font-medium">
            ~${totalDaily.toFixed(2)}
          </span>{' '}
          / day
        </div>
        <div>
          <span className="text-henry-text font-medium">
            ~${totalMonthly.toFixed(2)}
          </span>{' '}
          / month
        </div>
        <div className="flex-1 text-right text-[10px] text-henry-text-muted">
          Based on ~100 companion + ~20 worker interactions/day
        </div>
      </div>
    </div>
  );
}
