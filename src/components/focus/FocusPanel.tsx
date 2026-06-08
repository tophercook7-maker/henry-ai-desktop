import { useStore } from '../../store';

/**
 * FocusPanel — placeholder surface.
 *
 * A dedicated focus-timer UI isn't built yet. Rather than show a bare line of
 * grey text (which reads as broken), present an honest "not built yet" state
 * that routes the user to where the capability actually lives today — Chat,
 * where Henry can run a focus session conversationally.
 */
export default function FocusPanel() {
  const setCurrentView = useStore((s) => s.setCurrentView);

  return (
    <div className="h-full flex items-center justify-center bg-henry-bg px-6">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 w-12 h-12 rounded-2xl bg-henry-surface/60 border border-henry-border/30 flex items-center justify-center">
          <svg className="w-6 h-6 text-henry-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 7 12 12 15 14" />
          </svg>
        </div>
        <h2 className="text-base font-semibold text-henry-text">Focus sessions</h2>
        <span className="inline-block mt-1 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-henry-accent/15 text-henry-accent">
          Coming soon
        </span>
        <p className="text-sm text-henry-text-muted mt-3 leading-relaxed">
          A dedicated focus timer isn't built yet. For now, ask Henry in Chat to run a
          focus session — set a goal, a length, and he'll keep you on track.
        </p>
        <button
          onClick={() => setCurrentView('chat')}
          className="mt-4 px-4 py-2 rounded-xl text-sm font-medium bg-henry-accent/20 text-henry-accent hover:bg-henry-accent/30 transition-colors"
        >
          Start a focus session in Chat
        </button>
      </div>
    </div>
  );
}
