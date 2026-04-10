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

  const localModel = getModel(settings.companion_model);
  const cloudModel = getModel(settings.worker_model);

  const localName = localModel?.name || settings.companion_model || 'Not configured';
  const cloudName = cloudModel?.name || settings.worker_model || 'Not configured';

  const localIsCloud = settings.companion_provider !== 'ollama' && !!settings.companion_provider;
  const cloudIsLocal = settings.worker_provider === 'ollama';

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
        <span className="text-sm">{localIsCloud ? '☁️' : '🏠'}</span>
        <div className="text-left">
          <div className="font-medium">Local Brain</div>
          <div className="text-[10px] opacity-70 truncate max-w-[100px]">{localName}</div>
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
        <span className="text-sm">{cloudIsLocal ? '🏠' : '☁️'}</span>
        <div className="text-left">
          <div className="font-medium">Second Brain</div>
          <div className="text-[10px] opacity-70 truncate max-w-[100px]">{cloudName}</div>
        </div>
        {workerStatus.status !== 'idle' && (
          <div className="w-1.5 h-1.5 rounded-full bg-henry-worker animate-pulse" />
        )}
      </button>

      <div className="flex-1" />

      <span className="text-[10px] text-henry-text-muted">
        {selectedEngine === 'companion'
          ? 'Local · free · private'
          : 'Cloud · more power · costs tokens'}
      </span>
    </div>
  );
}
