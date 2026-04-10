import { useState, useEffect } from 'react';
import { useStore } from '../../store';

export default function TitleBar() {
  const { companionStatus, workerStatus } = useStore();
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);

    if (window.matchMedia('(display-mode: standalone)').matches) {
      setInstalled(true);
    }

    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  async function handleInstall() {
    if (!installPrompt) return;
    installPrompt.prompt();
    const result = await installPrompt.userChoice;
    if (result.outcome === 'accepted') {
      setInstalled(true);
      setInstallPrompt(null);
    }
  }

  const statusColor = (status: string) => {
    switch (status) {
      case 'idle': return 'bg-henry-success';
      case 'thinking':
      case 'working': return 'bg-henry-warning animate-pulse';
      case 'error': return 'bg-henry-error';
      default: return 'bg-henry-text-muted';
    }
  };

  return (
    <div className="titlebar-drag h-12 flex items-center justify-between px-3 md:px-4 bg-henry-surface/50 border-b border-henry-border/50 shrink-0">
      {/* Left: install prompt (desktop) or Henry wordmark (mobile) */}
      <div className="titlebar-no-drag flex items-center min-w-0">
        {/* Mobile: Henry name */}
        <span className="md:hidden text-sm font-semibold text-henry-text tracking-tight">Henry</span>

        {/* Desktop: install prompt / installed badge */}
        <div className="hidden md:flex items-center w-20">
          {installPrompt && !installed && (
            <button
              onClick={handleInstall}
              className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg bg-henry-accent/10 border border-henry-accent/30 text-henry-accent hover:bg-henry-accent/20 transition-all"
              title="Install Henry as an app on this device"
            >
              <span>⬇</span>
              <span>Install</span>
            </button>
          )}
          {installed && (
            <span className="text-[10px] text-henry-text-muted">Installed ✓</span>
          )}
        </div>
      </div>

      {/* Center: engine status */}
      <div className="titlebar-no-drag flex items-center gap-3 md:gap-6 text-xs">
        <div className="flex items-center gap-1.5 md:gap-2">
          <div className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${statusColor(companionStatus.status)}`} />
          <span className="text-henry-text-dim">
            Local
            {/* Status label hidden on mobile to save space */}
            <span className="hidden sm:inline text-henry-text-muted">
              {' '}{companionStatus.status === 'idle' ? 'ready' : companionStatus.status}
            </span>
          </span>
        </div>
        <div className="w-px h-3 bg-henry-border" />
        <div className="flex items-center gap-1.5 md:gap-2">
          <div className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${statusColor(workerStatus.status)}`} />
          <span className="text-henry-text-dim">
            Cloud
            <span className="hidden sm:inline text-henry-text-muted">
              {' '}{workerStatus.status === 'idle' ? 'ready' : workerStatus.status}
              {(workerStatus as any).queueLength > 0 &&
                ` (${(workerStatus as any).queueLength} queued)`}
            </span>
          </span>
        </div>
      </div>

      {/* Right: mobile install prompt / PWA badge */}
      <div className="titlebar-no-drag flex items-center justify-end min-w-0">
        {/* Mobile: install prompt */}
        {installPrompt && !installed && (
          <button
            onClick={handleInstall}
            className="md:hidden flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg bg-henry-accent/10 border border-henry-accent/30 text-henry-accent active:bg-henry-accent/20 transition-all"
          >
            <span>⬇</span>
            <span>Install</span>
          </button>
        )}
        {installed && (
          <span className="text-[10px] text-henry-success/70">📲 App</span>
        )}
      </div>
    </div>
  );
}
