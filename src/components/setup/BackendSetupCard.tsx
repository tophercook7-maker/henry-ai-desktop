/**
 * Backend Setup Card — the friendly "you need an AI provider" prompt.
 *
 * Rendered inline in chat (and other places) when the user tries to use
 * AI but has no backend configured. Shows three clear paths with one-tap
 * actions. Replaces the old confusing "Groq rejected the key" error.
 *
 * Cost protection: this card is the user's first impression when they're
 * unset — it must steer them toward BYOK or Ollama, NOT toward expecting
 * free service from Henry's proxy.
 */
import { useStore } from '../../store';

interface Props {
  /** Optional title override */
  title?: string;
  /** Optional reason text shown above options */
  reason?: string;
  /** Compact mode for inline-in-chat use (default true). */
  compact?: boolean;
}

export default function BackendSetupCard({
  title = 'Henry needs an AI provider',
  reason,
  compact = true,
}: Props) {
  const setCurrentView = useStore((s) => s.setCurrentView);

  const openGroq = () => {
    const url = 'https://console.groq.com/keys';
    const api = (window as { henryAPI?: { computerOpenUrl?: (u: string) => void } }).henryAPI;
    if (api?.computerOpenUrl) {
      api.computerOpenUrl(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const openOllama = () => {
    const url = 'https://ollama.com/download';
    const api = (window as { henryAPI?: { computerOpenUrl?: (u: string) => void } }).henryAPI;
    if (api?.computerOpenUrl) {
      api.computerOpenUrl(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const goToSettings = () => setCurrentView('settings');

  return (
    <div className={`bg-henry-surface border border-henry-accent/30 rounded-2xl ${compact ? 'p-4' : 'p-6'} space-y-3`}>
      <div>
        <h3 className="text-sm font-bold text-henry-text">{title}</h3>
        {reason && <p className="text-xs text-henry-text-muted mt-1">{reason}</p>}
      </div>

      <div className="space-y-2">
        {/* Option 1 — Groq (recommended) */}
        <div className="bg-henry-bg/40 border border-henry-accent/20 rounded-xl p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-henry-text flex items-center gap-1.5">
                ⚡ Free Groq key <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-henry-accent/15 text-henry-accent">Recommended</span>
              </p>
              <p className="text-[11px] text-henry-text-muted mt-0.5">
                60 seconds at console.groq.com. Generous free tier (14,400/day). Paste back into Settings.
              </p>
            </div>
          </div>
          <div className="flex gap-2 mt-2">
            <button onClick={openGroq}
              className="flex-1 text-xs px-3 py-2 rounded-lg bg-henry-accent text-white font-semibold hover:bg-henry-accent/85 transition-all">
              Get key →
            </button>
            <button onClick={goToSettings}
              className="text-xs px-3 py-2 rounded-lg bg-henry-surface border border-henry-border/30 text-henry-text-muted hover:text-henry-text transition-all">
              Paste it
            </button>
          </div>
        </div>

        {/* Option 2 — Ollama */}
        <div className="bg-henry-bg/40 border border-henry-border/20 rounded-xl p-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-henry-text">💻 Local Ollama</p>
            <p className="text-[11px] text-henry-text-muted mt-0.5">
              Fully private, fully free, runs on your Mac. No internet needed.
            </p>
          </div>
          <div className="flex gap-2 mt-2">
            <button onClick={openOllama}
              className="flex-1 text-xs px-3 py-2 rounded-lg bg-henry-surface border border-henry-border/30 text-henry-text-muted hover:text-henry-text transition-all">
              Install Ollama →
            </button>
          </div>
        </div>

        {/* Option 3 — License key */}
        <div className="bg-henry-bg/40 border border-henry-border/20 rounded-xl p-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-henry-text">🔑 Henry license</p>
            <p className="text-[11px] text-henry-text-muted mt-0.5">
              Already paid for Henry? Paste your license key in Settings → License.
            </p>
          </div>
          <div className="flex gap-2 mt-2">
            <button onClick={goToSettings}
              className="flex-1 text-xs px-3 py-2 rounded-lg bg-henry-surface border border-henry-border/30 text-henry-text-muted hover:text-henry-text transition-all">
              Open Settings →
            </button>
          </div>
        </div>
      </div>

      <p className="text-[10px] text-henry-text-muted/80 leading-relaxed pt-1 border-t border-henry-border/20">
        Henry will never charge you for AI use. Your key, your costs — and Groq's free tier
        is generous enough that most people never pay anything.
      </p>
    </div>
  );
}
