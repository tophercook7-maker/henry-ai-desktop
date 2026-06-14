/**
 * CrewsPanel — run Agent Crews (build plan, Phase 2b).
 *
 * Pick a crew, give it one line to work on, and watch the team run agent by
 * agent: each step streams in via `crews:step` as it finishes, then the final
 * deliverable lands. Reads via `listCrews`, runs via `runCrew`.
 *
 * Crews run on the Worker engine and cost real model calls, so this is always
 * user-initiated (a Run button), never automatic.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

type Crew = HenryCrewSummary;
type Step = HenryCrewRunStep;

function api() {
  return typeof window !== 'undefined' ? window.henryAPI : undefined;
}

function relativeTime(iso?: string | null): string {
  if (!iso) return '';
  const t = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z').getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function CrewsPanel() {
  const [crews, setCrews] = useState<Crew[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Crew | null>(null);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [runs, setRuns] = useState<HenryCrewRun[]>([]);

  const runningCrewId = useRef<string | null>(null);

  // Load the crew catalogue.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api()?.listCrews?.();
        if (!alive) return;
        if (!res) { setLoadError('Agent Crews are only available in the desktop app.'); return; }
        if (!res.ok) { setLoadError(res.error || 'Could not load crews.'); return; }
        setCrews(res.result ?? []);
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : 'Could not load crews.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Live per-agent progress.
  useEffect(() => {
    const off = api()?.onCrewStep?.((data) => {
      if (data.crewId !== runningCrewId.current) return;
      setSteps((prev) => [...prev, data.step]);
    });
    return () => { off?.(); };
  }, []);

  // Load saved run history (newest first).
  const loadRuns = useCallback(async () => {
    try {
      const res = await api()?.listCrewRuns?.({ limit: 20 });
      if (res?.ok) setRuns(res.result ?? []);
    } catch { /* ignore — history is best-effort */ }
  }, []);
  useEffect(() => { void loadRuns(); }, [loadRuns]);

  // Reopen a saved run's full transcript in the run view.
  const openRun = useCallback(async (runId: string, crewId: string) => {
    try {
      const res = await api()?.getCrewRun?.(runId);
      if (res?.ok && res.result) {
        const crew = crews.find((c) => c.id === crewId);
        if (crew) setSelected(crew);
        setSteps(res.result.steps ?? []);
        setInput(res.result.input ?? '');
        setRunError(null);
        setDone(true);
      }
    } catch { /* ignore */ }
  }, [crews]);

  const run = useCallback(async () => {
    if (!selected || !input.trim() || running) return;
    setRunning(true);
    setSteps([]);
    setRunError(null);
    setDone(false);
    runningCrewId.current = selected.id;
    try {
      const res = await api()?.runCrew?.(selected.id, input.trim());
      if (!res?.ok) {
        setRunError(res?.error || 'The crew run failed.');
      } else if (res.result) {
        // Authoritative final transcript (in case any step events were missed).
        setSteps(res.result.steps);
        setDone(true);
        void loadRuns(); // the run is now saved — refresh history
      }
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'The crew run failed.');
    } finally {
      setRunning(false);
      runningCrewId.current = null;
    }
  }, [selected, input, running]);

  // ── Catalogue view ─────────────────────────────────────────────────────────
  if (!selected) {
    return (
      <div className="h-full overflow-y-auto bg-henry-bg">
        <div className="max-w-3xl mx-auto px-5 py-6">
          <h1 className="text-xl font-semibold text-henry-text">Crews</h1>
          <p className="text-xs text-henry-text-muted mb-5">
            Role-based teams that work a problem agent by agent. Pick one, give it a line, and let it run.
          </p>

          {loading && <div className="text-sm text-henry-text-muted py-12 text-center">Loading crews…</div>}
          {!loading && loadError && (
            <div className="bg-henry-surface/50 border border-red-500/30 rounded-xl p-4 text-sm text-red-300">{loadError}</div>
          )}

          {!loading && !loadError && (
            <div className="space-y-3">
              {crews.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setSelected(c); setSteps([]); setRunError(null); setDone(false); setInput(''); }}
                  className="w-full text-left bg-henry-surface/40 border border-henry-border/30 rounded-2xl p-4 hover:border-henry-accent/40 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-henry-text">{c.name}</h2>
                    <span className="text-[10px] text-henry-text-muted">{c.agents.length} agents</span>
                  </div>
                  <p className="text-xs text-henry-text-muted mt-0.5">{c.description}</p>
                  <div className="flex items-center flex-wrap gap-1.5 mt-2.5">
                    {c.agents.map((a, i) => (
                      <span key={a.id} className="flex items-center gap-1.5">
                        {i > 0 && <span className="text-henry-text-muted/50 text-[10px]">→</span>}
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-henry-accent/10 text-henry-accent">{a.name}</span>
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          )}

          {runs.length > 0 && (
            <div className="mt-8">
              <h2 className="text-xs font-semibold text-henry-text-muted uppercase tracking-wide mb-2">Recent runs</h2>
              <div className="space-y-2">
                {runs.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => void openRun(r.id, r.crew_id)}
                    className="w-full text-left bg-henry-surface/30 border border-henry-border/20 rounded-xl px-3.5 py-2.5 hover:border-henry-accent/40 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-henry-text truncate">{r.crew_name}</span>
                      <span className="text-[10px] text-henry-text-muted flex-shrink-0">{relativeTime(r.created_at)}</span>
                    </div>
                    <p className="text-[11px] text-henry-text-muted mt-0.5 truncate">{r.input}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Run view ───────────────────────────────────────────────────────────────
  return (
    <div className="h-full overflow-y-auto bg-henry-bg">
      <div className="max-w-3xl mx-auto px-5 py-6">
        <button
          onClick={() => { if (!running) setSelected(null); }}
          disabled={running}
          className="text-xs text-henry-text-muted hover:text-henry-text transition-colors disabled:opacity-40"
        >
          ← All crews
        </button>

        <h1 className="text-xl font-semibold text-henry-text mt-2">{selected.name}</h1>
        <p className="text-xs text-henry-text-muted">{selected.goal}</p>

        {/* Pipeline */}
        <div className="flex items-center flex-wrap gap-1.5 mt-3">
          {selected.agents.map((a, i) => (
            <span key={a.id} className="flex items-center gap-1.5" title={a.goal}>
              {i > 0 && <span className="text-henry-text-muted/50 text-[10px]">→</span>}
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-henry-surface text-henry-text-muted">{a.name}</span>
            </span>
          ))}
        </div>

        {/* Input */}
        <div className="mt-4 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void run(); }}
            disabled={running}
            placeholder="What should the crew work on? e.g. find website leads near 97201"
            className="flex-1 bg-henry-surface border border-henry-border/30 rounded-xl px-3 py-2 text-sm text-henry-text placeholder:text-henry-text-muted outline-none focus:border-henry-accent/50 disabled:opacity-60"
          />
          <button
            onClick={() => void run()}
            disabled={running || !input.trim()}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-henry-accent/20 text-henry-accent hover:bg-henry-accent/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {running ? 'Running…' : 'Run crew'}
          </button>
        </div>

        {runError && (
          <div className="mt-4 bg-henry-surface/50 border border-red-500/30 rounded-xl p-3 text-sm text-red-300">{runError}</div>
        )}

        {/* Transcript */}
        {steps.length > 0 && (
          <div className="mt-5 space-y-3">
            {steps.map((s, i) => (
              <div key={`${s.agent}-${i}`} className="bg-henry-surface/40 border border-henry-border/30 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-henry-accent">{s.agent}</span>
                  <span className="text-[10px] text-henry-text-muted">
                    {s.rounds > 0 ? `${s.rounds} round${s.rounds === 1 ? '' : 's'}` : ''}
                  </span>
                </div>
                <p className="text-sm text-henry-text whitespace-pre-wrap leading-relaxed">{s.output}</p>
              </div>
            ))}
            {running && (
              <div className="text-xs text-henry-text-muted py-2 text-center">
                {selected.agents[steps.length]?.name
                  ? `${selected.agents[steps.length].name} is working…`
                  : 'Working…'}
              </div>
            )}
            {done && !running && (
              <div className="text-[11px] text-henry-text-muted text-center pt-1">Crew finished.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
