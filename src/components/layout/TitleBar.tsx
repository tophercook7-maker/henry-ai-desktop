import { useStore } from '../../store';

export default function TitleBar() {
  const { companionStatus, workerStatus } = useStore();

  const statusColor = (status: string) => {
    switch (status) {
      case 'idle':
        return 'bg-henry-success';
      case 'thinking':
      case 'working':
        return 'bg-henry-warning animate-pulse';
      case 'error':
        return 'bg-henry-error';
      default:
        return 'bg-henry-text-muted';
    }
  };

  return (
    <div className="titlebar-drag h-12 flex items-center justify-between px-4 bg-henry-surface/50 border-b border-henry-border/50 shrink-0">
      <div className="w-20" />

      <div className="titlebar-no-drag flex items-center gap-6 text-xs">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${statusColor(companionStatus.status)}`} />
          <span className="text-henry-text-dim">
            Local{' '}
            <span className="text-henry-text-muted">
              {companionStatus.status === 'idle' ? 'ready' : companionStatus.status}
            </span>
          </span>
        </div>
        <div className="w-px h-3 bg-henry-border" />
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${statusColor(workerStatus.status)}`} />
          <span className="text-henry-text-dim">
            Cloud{' '}
            <span className="text-henry-text-muted">
              {workerStatus.status === 'idle'
                ? 'ready'
                : workerStatus.status}
              {(workerStatus as any).queueLength > 0 &&
                ` (${(workerStatus as any).queueLength} queued)`}
            </span>
          </span>
        </div>
      </div>

      <div className="titlebar-no-drag flex items-center gap-1 w-20 justify-end" />
    </div>
  );
}
