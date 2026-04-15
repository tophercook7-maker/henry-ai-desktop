import { useEffect, useState } from 'react';
import { useAmbientStore, type AmbientStateValue } from '../../henry/ambientStateStore';
import { useDebugStore } from '../../henry/debugStore';
import { getFocusNow } from '../../henry/getFocusNow';
import { useStore } from '../../store';

function stateConfig(state: AmbientStateValue): {
  label: string;
  dot: string;
  text: string;
  pulse: boolean;
} {
  switch (state) {
    case 'idle':
      return { label: 'Idle', dot: 'bg-henry-text-muted/40', text: 'text-henry-text-muted', pulse: false };
    case 'ready':
      return { label: 'Ready', dot: 'bg-henry-success', text: 'text-henry-success', pulse: false };
    case 'listening':
      return { label: 'Listening', dot: 'bg-henry-error', text: 'text-henry-error', pulse: true };
    case 'thinking':
      return { label: 'Thinking', dot: 'bg-henry-warning', text: 'text-henry-warning', pulse: true };
    case 'responding':
      return { label: 'Responding', dot: 'bg-henry-accent', text: 'text-henry-accent', pulse: true };
    case 'muted':
      return { label: 'Muted', dot: 'bg-henry-text-muted/30', text: 'text-henry-text-muted', pulse: false };
  }
}

export default function PresenceBar() {
  const ambientState = useAmbientStore((s) => s.state);
  const activeBrain = useAmbientStore((s) => s.activeBrain);
  const lastModels = useDebugStore((s) => s.lastModels);
  const settings = useStore((s) => s.settings);
  const [focusLabel, setFocusLabel] = useState<string | null>(null);

  useEffect(() => {
    function refresh() {
      const f = getFocusNow();
      setFocusLabel(f?.now ?? null);
    }
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, []);

  const cfg = stateConfig(ambientState);

  const companionEntry = lastModels.find((m) => m.role === 'companion');
  let brainLabel = activeBrain;
  if (!brainLabel && companionEntry) {
    brainLabel = companionEntry.provider === 'ollama'
      ? `Local AI · ${companionEntry.model}`
      : `Cloud AI · ${companionEntry.model}${companionEntry.isFallback ? ' ⚡' : ''}`;
  }
  if (!brainLabel) {
    const cp = settings.companion_provider;
    const cm = settings.companion_model;
    if (cp === 'ollama') brainLabel = cm ? `Local AI · ${cm}` : 'Local AI';
    else if (cp) brainLabel = cm ? `Cloud AI · ${cm}` : 'Cloud AI';
  }

  return (
    <div className="shrink-0 h-7 flex items-center px-4 gap-3 bg-henry-bg/60 border-b border-henry-border/30 text-[11px] overflow-hidden transition-all">
      <div className="flex items-center gap-1.5 shrink-0">
        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot} ${cfg.pulse ? 'animate-pulse' : ''}`} />
        <span className={`font-medium ${cfg.text} transition-colors`}>{cfg.label}</span>
      </div>

      {brainLabel && (
        <>
          <div className="w-px h-3 bg-henry-border/40 shrink-0" />
          <span className="text-henry-text-muted shrink-0 truncate max-w-[180px]" title={brainLabel}>
            {brainLabel}
          </span>
        </>
      )}

      {focusLabel && (
        <>
          <div className="w-px h-3 bg-henry-border/40 shrink-0" />
          <span
            className="text-henry-text-dim truncate"
            title={focusLabel}
          >
            {focusLabel}
          </span>
        </>
      )}
    </div>
  );
}
