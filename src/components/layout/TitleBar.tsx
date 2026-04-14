import { useState, useEffect } from 'react';
import { useStore } from '../../store';
import { wakeWordManager } from '../../henry/wakeWord';
import { useCapturesStore, selectUnroutedCaptures } from '../../ambient/capturesStore';

export default function TitleBar() {
  const { companionStatus, workerStatus, setCurrentView } = useStore();
  const captures = useCapturesStore((s) => s.captures);
  const unroutedCount = selectUnroutedCaptures(captures).length;
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(false);
  const [wakeActive, setWakeActive] = useState(false);
  const [wakeFlash, setWakeFlash] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);

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

  // Auto-updater listeners
  useEffect(() => {
    const unsubAvail = window.henryAPI.onUpdateAvailable(() => setUpdateAvailable(true));
    const unsubReady = window.henryAPI.onUpdateDownloaded(() => {
      setUpdateAvailable(false);
      setUpdateReady(true);
    });
    return () => {
      unsubAvail?.();
      unsubReady?.();
    };
  }, []);

  // Sync wake word state
  useEffect(() => {
    function onWakeState(e: Event) {
      const detail = (e as CustomEvent<{ active: boolean; error?: string }>).detail;
      setWakeActive(detail.active);
      if (detail.error === 'mic-denied') {
        setWakeFlash('Microphone access denied');
        setTimeout(() => setWakeFlash(null), 4000);
      }
    }
    function onWakeWord(e: Event) {
      const { fullTranscript } = (e as CustomEvent<{ query: string; fullTranscript: string }>).detail;
      const display = fullTranscript.length > 40 ? fullTranscript.slice(0, 40) + '…' : fullTranscript;
      setWakeFlash(`"${display}"`);
      setTimeout(() => setWakeFlash(null), 4000);
    }
    window.addEventListener('henry_wake_state', onWakeState);
    window.addEventListener('henry_wake_word', onWakeWord);
    return () => {
      window.removeEventListener('henry_wake_state', onWakeState);
      window.removeEventListener('henry_wake_word', onWakeWord);
    };
  }, []);

  async function toggleWakeWord() {
    if (wakeActive) {
      wakeWordManager.stop();
    } else {
      const result = await wakeWordManager.start();
      if (result === 'no-api') {
        setWakeFlash('Voice not supported in this browser');
        setTimeout(() => setWakeFlash(null), 3500);
      }
    }
  }

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
    <div className="titlebar-drag h-12 flex items-center justify-between px-3 md:px-4 bg-henry-surface/50 border-b border-henry-border/50 shrink-0 gap-2 relative">
      {/* Left: wordmark (mobile) | install button (desktop) */}
      <div className="titlebar-no-drag flex items-center min-w-0 shrink-0">
        <span className="md:hidden text-sm font-semibold text-henry-text tracking-tight">Henry</span>
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
      <div className="titlebar-no-drag flex-1 flex items-center justify-center gap-3 md:gap-6 text-xs min-w-0">
        <div className="flex items-center gap-1.5 md:gap-2">
          <div className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${statusColor(companionStatus.status)}`} />
          <span className="text-henry-text-dim">
            Local
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

      {/* Right: update badge + wake word toggle */}
      <div className="titlebar-no-drag flex items-center justify-end gap-2 shrink-0 min-w-0">
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
        {installed && !wakeActive && !updateReady && (
          <span className="text-[10px] text-henry-success/70 hidden sm:inline">📲 App</span>
        )}

        {/* Update downloading badge */}
        {updateAvailable && !updateReady && (
          <span
            title="Downloading update…"
            className="hidden sm:flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-henry-surface border border-henry-border/40 text-henry-text-muted animate-pulse"
          >
            <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Updating
          </span>
        )}

        {/* Update ready — install button */}
        {updateReady && (
          <button
            onClick={() => void window.henryAPI.installUpdate()}
            title="Henry update downloaded — click to restart and apply"
            className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg bg-henry-success/15 border border-henry-success/40 text-henry-success hover:bg-henry-success/25 transition-all animate-fade-in"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            <span className="hidden sm:inline">Restart to update</span>
            <span className="sm:hidden">↺</span>
          </button>
        )}

        {/* Captures count badge — navigates to captures panel */}
        {unroutedCount > 0 && (
          <button
            onClick={() => setCurrentView('captures')}
            title={`${unroutedCount} unrouted capture${unroutedCount !== 1 ? 's' : ''} — click to review`}
            className="titlebar-no-drag flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-henry-warning/15 border border-henry-warning/30 text-henry-warning hover:bg-henry-warning/25 transition-all"
          >
            <span className="font-semibold">{unroutedCount}</span>
            <span className="hidden sm:inline">to route</span>
          </button>
        )}

        {/* Wake word toggle */}
        <button
          onClick={() => void toggleWakeWord()}
          title={wakeActive
            ? 'Henry is always listening · click to stop'
            : 'Enable always-on listening — Henry wakes when he hears his name'}
          className={`titlebar-no-drag relative flex items-center gap-1.5 px-2 py-1 rounded-lg transition-all text-[11px] font-medium ${
            wakeActive
              ? 'bg-henry-accent/15 text-henry-accent border border-henry-accent/30 hover:bg-henry-accent/25'
              : 'text-henry-text-muted hover:text-henry-text hover:bg-henry-hover/50 border border-transparent'
          }`}
        >
          {/* Ear icon */}
          <svg
            className={`w-3.5 h-3.5 ${wakeActive ? 'text-henry-accent' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 9a6 6 0 1 1 12 0c0 3.1-1.7 5-3 6.5-1.3 1.5-1.5 2.5-3 2.5s-1.8-1-3-2.5C7.7 14 6 12.1 6 9z" />
            <path d="M10.5 15.5C11 17.5 12 19 13 19c2 0 4-2 4-2" />
          </svg>

          {/* Label and pulse */}
          {wakeActive ? (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-henry-accent animate-pulse" />
              <span className="hidden sm:inline">Listening</span>
            </span>
          ) : (
            <span className="hidden sm:inline">Listen</span>
          )}
        </button>
      </div>

      {/* Wake detection flash toast */}
      {wakeFlash && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50 flex items-center gap-2 px-3 py-2 rounded-xl bg-henry-surface border border-henry-accent/30 shadow-lg shadow-black/20 animate-fade-in text-xs max-w-xs">
          <span className="text-henry-accent shrink-0">👂</span>
          <span className="text-henry-text truncate">{wakeFlash}</span>
        </div>
      )}
    </div>
  );
}
