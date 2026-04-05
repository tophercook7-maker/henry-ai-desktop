import { useStore } from '../../store';
import { getModel } from '../../providers/models';

interface EngineSelectorProps {
  selectedEngine: 'companion' | 'worker';
  onSelect: (engine: 'companion' | 'worker') => void;
}

export default function EngineSelector({
  selectedEngine,
  onSelect,
}: EngineSelectorProps) {
  const { settings, companionStatus, workerStatus } = useStore();

  const companionModel = getModel(settings.companion_model);
  const workerModel = getModel(settings.worker_model);

  return (
    <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-henry-border/30 bg-henry-surface/20">
      <button
        onClick={() => onSelect('companion')}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all ${
          selectedEngine === 'companion'
            ? 'bg-henry-companion/10 text-henry-companion border border-henry-companion/20 glow-companion'
            : 'text-henry-text-dim hover:text-henry-text hover:bg-henry-hover/50'
        }`}
      >
        <span className="text-sm">🧠</span>
        <div className="text-left">
          <div className="font-medium">Companion</div>
          <div className="text-[10px] opacity-70">
            {companionModel?.name || 'Not configured'}
          </div>
        </div>
        {companionStatus.status !== 'idle' && (
          <div className="w-1.5 h-1.5 rounded-full bg-henry-companion animate-pulse" />
        )}
      </button>

      <button
        onClick={() => onSelect('worker')}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all ${
          selectedEngine === 'worker'
            ? 'bg-henry-worker/10 text-henry-worker border border-henry-worker/20 glow-worker'
            : 'text-henry-text-dim hover:text-henry-text hover:bg-henry-hover/50'
        }`}
      >
        <span className="text-sm">⚡</span>
        <div className="text-left">
          <div className="font-medium">Worker</div>
          <div className="text-[10px] opacity-70">
            {workerModel?.name || 'Not configured'}
          </div>
        </div>
        {workerStatus.status !== 'idle' && (
          <div className="w-1.5 h-1.5 rounded-full bg-henry-worker animate-pulse" />
        )}
      </button>

      <div className="flex-1" />

      <span className="text-[10px] text-henry-text-muted">
        {selectedEngine === 'companion'
          ? 'Fast responses, always available'
          : 'Deep work, thorough output'}
      </span>
    </div>
  );
}
