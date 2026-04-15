/**
 * FocusCard — "What matters now" heartbeat
 *
 * Shows a single clean signal sourced from getFocusNow():
 *   Now   — the one thing to do
 *   Why   — the reason it surfaces
 *   Next  — the step after this
 *   Watch — an optional drift/risk signal
 *
 * Renders nothing when getFocusNow() returns null (queue empty, nothing notable).
 * Refreshes on mount and when the user explicitly dismisses or taps refresh.
 */

import { useState, useEffect, useCallback } from 'react';
import { getFocusNow, type FocusSignal } from '../../henry/getFocusNow';

interface FocusCardProps {
  /** Callback for the "Let's go →" CTA — pre-fills the chat input */
  onFocus?: (text: string) => void;
}

export default function FocusCard({ onFocus }: FocusCardProps) {
  const [signal, setSignal] = useState<FocusSignal | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const refresh = useCallback(() => {
    setSignal(getFocusNow());
    setDismissed(false);
  }, []);

  useEffect(() => {
    refresh();
    // Refresh every 5 minutes while mounted
    const id = setInterval(refresh, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [refresh]);

  if (!signal || dismissed) return null;

  function handleFocus() {
    if (!signal) return;
    onFocus?.(`Let's work on: ${signal.now}`);
  }

  return (
    <div className="mx-4 mb-3 rounded-2xl border border-henry-border/30 bg-henry-surface/40 overflow-hidden">

      {/* Header row */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-1">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-henry-accent animate-pulse" />
          <span className="text-[10px] font-semibold uppercase tracking-widest text-henry-text-muted">
            What matters now
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={refresh}
            title="Refresh"
            className="text-henry-text-muted hover:text-henry-text transition-colors p-0.5"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
            </svg>
          </button>
          <button
            onClick={() => setDismissed(true)}
            title="Dismiss"
            className="text-henry-text-muted hover:text-henry-text transition-colors p-0.5"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main signal */}
      <div className="px-4 py-3 space-y-2.5">

        {/* Now */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-henry-accent/70 mb-0.5">Now</p>
          <p className="text-sm font-semibold text-henry-text leading-snug">{signal.now}</p>
        </div>

        {/* Why */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-henry-text-muted mb-0.5">Why</p>
          <p className="text-xs text-henry-text-dim leading-relaxed">{signal.why}</p>
        </div>

        {/* Next + Watch — expandable */}
        {expanded ? (
          <>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-henry-text-muted mb-0.5">Next</p>
              <p className="text-xs text-henry-text-dim leading-relaxed">{signal.next}</p>
            </div>
            {signal.watch && (
              <div className="flex items-start gap-2 rounded-xl bg-henry-warning/8 border border-henry-warning/20 px-3 py-2">
                <svg className="w-3 h-3 text-henry-warning shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <p className="text-[11px] text-henry-text-dim leading-relaxed">
                  <span className="font-semibold text-henry-warning/80 mr-1">Watch:</span>
                  {signal.watch}
                </p>
              </div>
            )}
          </>
        ) : null}
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-between px-4 pb-3.5">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] text-henry-text-muted hover:text-henry-text transition-colors"
        >
          {expanded ? 'Show less ↑' : `Show next${signal.watch ? ' + watch' : ''} ↓`}
        </button>
        {onFocus && (
          <button
            onClick={handleFocus}
            className="text-[11px] font-semibold text-henry-accent hover:text-henry-accent/80 transition-colors"
          >
            Let's go →
          </button>
        )}
      </div>
    </div>
  );
}
