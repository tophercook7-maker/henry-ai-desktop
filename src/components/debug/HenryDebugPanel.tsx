/**
 * Henry Debug Panel — Cmd+Shift+D
 *
 * Operator-only x-ray into Henry's internals.
 * Never shown to regular users.
 *
 * Sections:
 *   A. Brain Router       — request class, brains, execution mode, rationale
 *   B. Token / Context    — tier, estimate, trim, reason
 *   C. Live Mind          — top focus, tasks, reminders, projects, captures
 *   D. Capability Truth   — integrations, AI, computer/printer
 *   E. Action Decision    — gate decision and reason
 *   F. Provider / Model   — configured vs actual, fallback
 */

import { useState } from 'react';
import { useDebugStore } from '../../henry/debugStore';
import { useStore } from '../../store';
import { useConnectionStore } from '../../henry/connectionStore';
import { getFocusNow } from '../../henry/getFocusNow';
import { getIntegrationCapabilities } from '../../henry/capabilityRegistry';
import { useExecutionModeStore, inferExecutionMode, EXECUTION_MODE_CONFIGS, type ExecutionMode } from '../../henry/executionModeStore';
import { computeInstinctFromState } from '../../henry/instinctEngine';
import { computeMomentum } from '../../henry/momentumEngine';
import { useInitiativeStore } from '../../henry/initiativeStore';

interface SectionProps {
  title: string;
  letter: string;
  children: React.ReactNode;
}

function Section({ title, letter, children }: SectionProps) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-henry-border/30 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-henry-surface/50 hover:bg-henry-surface/80 transition-colors text-left"
      >
        <span className="shrink-0 w-5 h-5 rounded-full bg-henry-accent/15 text-henry-accent text-[10px] font-bold flex items-center justify-center">
          {letter}
        </span>
        <span className="text-xs font-semibold text-henry-text flex-1">{title}</span>
        <svg className={`w-3.5 h-3.5 text-henry-text-muted transition-transform duration-150 ${open ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
      {open && <div className="px-4 py-3 space-y-2">{children}</div>}
    </div>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-henry-text-muted w-32">{label}</span>
      <span className={`text-xs font-mono leading-snug break-all ${accent ? 'text-henry-accent' : 'text-henry-text-dim'}`}>{value}</span>
    </div>
  );
}

function Pill({ ok, label }: { ok: boolean | null; label: string }) {
  const color = ok === null
    ? 'bg-henry-surface border-henry-border/40 text-henry-text-muted'
    : ok
    ? 'bg-henry-success/10 border-henry-success/30 text-henry-success'
    : 'bg-henry-error/10 border-henry-error/30 text-henry-error';
  const dot = ok === null ? '○' : ok ? '●' : '○';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium ${color}`}>
      <span>{dot}</span>
      {label}
    </span>
  );
}

export default function HenryDebugPanel({ onClose }: { onClose: () => void }) {
  const { lastDecision, lastModels, lastTokens, updatedAt } = useDebugStore();
  const { settings, providers } = useStore();
  const { getStatus } = useConnectionStore();
  const execMode = useExecutionModeStore((s) => s.mode);
  const execSource = useExecutionModeStore((s) => s.source);
  const setExecMode = useExecutionModeStore((s) => s.setMode);
  const initiativeMode = useInitiativeStore((s) => s.mode);

  const focus = getFocusNow();
  const integrationCaps = getIntegrationCapabilities();
  const momentum = computeMomentum();
  const instinct = computeInstinctFromState(execMode, initiativeMode);
  const inferred = inferExecutionMode();

  function safeJSON<T>(key: string, fallback: T): T {
    try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; }
    catch { return fallback; }
  }

  const tasks = safeJSON<any[]>('henry:tasks', []);
  const pending = tasks.filter((t) => t.status === 'pending' || t.status === 'queued');
  const reminders = safeJSON<any[]>('henry:reminders', []);
  const overdueReminders = reminders.filter(
    (r) => !r.done && !r.dismissed && r.dueAt && new Date(r.dueAt).getTime() < Date.now(),
  );
  const projects = safeJSON<any[]>('henry:rich_memory:projects', []);
  const activeProjects = projects.filter((p) => p.status === 'active');
  const captures = safeJSON<any[]>('henry:captures_v1', []);
  const unrouted = captures.filter((c) => c.status === 'pending' || !c.status);

  const companionProvider = settings.companion_provider || '—';
  const companionModel = settings.companion_model || '—';
  const workerProvider = settings.worker_provider || '—';
  const workerModel = settings.worker_model || '—';

  const companionKey = providers.find((p) => p.id === companionProvider)?.apiKey?.trim();
  const workerKey = providers.find((p) => p.id === workerProvider)?.apiKey?.trim();

  const SERVICES = ['gmail', 'gcal', 'gdrive', 'slack', 'github', 'notion', 'linear', 'stripe'] as const;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[640px] max-h-[85vh] bg-henry-bg border border-henry-border/40 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-henry-border/30 shrink-0">
          <div>
            <p className="text-sm font-bold text-henry-text">Henry Debug Panel</p>
            <p className="text-[11px] text-henry-text-muted">
              Operator view · Cmd+Shift+D to toggle
              {updatedAt && ` · Last updated ${new Date(updatedAt).toLocaleTimeString()}`}
            </p>
          </div>
          <button onClick={onClose} className="text-henry-text-muted hover:text-henry-text transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 p-4 space-y-3">

          {/* A. Brain Router */}
          <Section letter="A" title="Brain Router">
            {lastDecision ? (
              <>
                <Row label="Request class" value={lastDecision.requestClass} accent />
                <Row label="Primary brain" value={lastDecision.primaryBrain} accent />
                <Row label="Supporting" value={lastDecision.supportingBrains.join(', ') || 'none'} />
                <Row label="Execution mode" value={lastDecision.executionMode} accent />
                <Row label="Context tier" value={lastDecision.contextTier} />
                <Row label="Reflect needed" value={lastDecision.reflectionNeeded ? 'yes' : 'no'} />
                <Row label="Surfacing" value={lastDecision.surfacing} />
                <Row label="Rationale" value={lastDecision.rationale} />
              </>
            ) : (
              <p className="text-xs text-henry-text-muted">No routing decision captured yet — send a message first.</p>
            )}
          </Section>

          {/* B. Token / Context */}
          <Section letter="B" title="Token / Context">
            {lastTokens ? (
              <>
                <Row label="Tier" value={lastTokens.tier} accent />
                <Row label="Token estimate" value={`~${lastTokens.estimated.toLocaleString()} tokens`} />
                <Row label="History trimmed" value={lastTokens.historyTrimmed ? 'yes' : 'no'} />
                <Row label="Tier reason" value={lastTokens.tierReason} />
              </>
            ) : (
              <p className="text-xs text-henry-text-muted">No token snapshot yet — send a message first.</p>
            )}
          </Section>

          {/* C. Live Mind */}
          <Section letter="C" title="Live Mind">
            {focus ? (
              <>
                <Row label="Top focus" value={focus.now} accent />
                <Row label="Why" value={focus.why} />
                <Row label="Next" value={focus.next} />
                {focus.watch && <Row label="Watch" value={focus.watch} />}
              </>
            ) : (
              <Row label="Top focus" value="Nothing notable in queue" />
            )}
            <Row label="Pending tasks" value={`${pending.length}`} />
            <Row label="Overdue" value={`${overdueReminders.length} reminder${overdueReminders.length !== 1 ? 's' : ''}`} />
            <Row label="Active projects" value={`${activeProjects.length}`} />
            <Row label="Unrouted captures" value={`${unrouted.length}`} />
          </Section>

          {/* D. Capability Truth */}
          <Section letter="D" title="Capability Truth">
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-henry-text-muted">Integrations</p>
              <div className="flex flex-wrap gap-1.5">
                {SERVICES.map((svc) => {
                  const status = getStatus(svc);
                  const cap = integrationCaps[svc];
                  const ok = status === 'connected' && cap?.connected;
                  const expired = status === 'expired';
                  return (
                    <span
                      key={svc}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium ${
                        ok
                          ? 'bg-henry-success/10 border-henry-success/30 text-henry-success'
                          : expired
                          ? 'bg-henry-warning/10 border-henry-warning/30 text-henry-warning'
                          : 'bg-henry-surface border-henry-border/40 text-henry-text-muted'
                      }`}
                    >
                      <span>{ok ? '●' : '○'}</span>
                      {svc}
                      {expired ? ' (expired)' : ''}
                    </span>
                  );
                })}
              </div>

              <p className="text-[10px] font-semibold uppercase tracking-wider text-henry-text-muted mt-2">AI Brains</p>
              <div className="flex flex-wrap gap-1.5">
                <Pill
                  ok={companionProvider === 'ollama' ? null : !!companionKey}
                  label={companionProvider === 'ollama'
                    ? 'Companion: Ollama (local)'
                    : companionKey
                    ? `Companion: ${companionProvider} (key ✓)`
                    : `Companion: ${companionProvider} (no key)`
                  }
                />
                <Pill
                  ok={workerProvider === 'ollama' ? null : !!workerKey}
                  label={workerProvider === 'ollama'
                    ? 'Worker: Ollama (local)'
                    : workerKey
                    ? `Worker: ${workerProvider} (key ✓)`
                    : `Worker: ${workerProvider} (no key)`
                  }
                />
              </div>

              <p className="text-[10px] font-semibold uppercase tracking-wider text-henry-text-muted mt-2">Device</p>
              <div className="flex flex-wrap gap-1.5">
                <Pill ok={!!window.henryAPI} label="Electron IPC" />
                <Pill ok={null} label="Computer (check panel)" />
                <Pill ok={null} label="Printer (check panel)" />
              </div>
            </div>
          </Section>

          {/* E. Action Decision */}
          <Section letter="E" title="Action Decision">
            {lastDecision ? (
              <>
                <Row label="Gate" value={lastDecision.actionGate.decision} accent />
                {lastDecision.actionGate.reason && (
                  <Row label="Reason" value={lastDecision.actionGate.reason} />
                )}
                {lastDecision.actionGate.requiredService && (
                  <Row label="Required service" value={lastDecision.actionGate.requiredService} />
                )}
                {lastDecision.actionGate.isConnected !== undefined && (
                  <Row label="Service connected" value={lastDecision.actionGate.isConnected ? 'yes' : 'no'} />
                )}
                {lastDecision.actionGate.isDestructive !== undefined && (
                  <Row label="Destructive" value={lastDecision.actionGate.isDestructive ? 'yes' : 'no'} />
                )}
              </>
            ) : (
              <p className="text-xs text-henry-text-muted">No action decision yet — send a message first.</p>
            )}
          </Section>

          {/* F. Provider / Model */}
          <Section letter="F" title="Provider / Model">
            <Row label="Companion (cfg)" value={`${companionProvider} / ${companionModel}`} />
            <Row label="Worker (cfg)" value={`${workerProvider} / ${workerModel}`} />
            {lastModels.length > 0 ? (
              <>
                {lastModels.map((m, i) => (
                  <Row
                    key={i}
                    label={`${m.role} (actual)`}
                    value={`${m.provider} / ${m.model}${m.isFallback ? ' ⚡ fallback' : ''}`}
                    accent={m.isFallback}
                  />
                ))}
              </>
            ) : (
              <p className="text-xs text-henry-text-muted">No actual call recorded yet — send a message first.</p>
            )}
          </Section>

          {/* G. Instinct & Momentum */}
          <Section letter="G" title="Instinct & Momentum">
            {/* Execution Mode selector */}
            <div className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-henry-text-muted">Execution Mode</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {(Object.keys(EXECUTION_MODE_CONFIGS) as ExecutionMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setExecMode(m, 'manual')}
                    title={EXECUTION_MODE_CONFIGS[m].description}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all ${
                      execMode === m
                        ? 'bg-henry-accent/15 border-henry-accent/40 text-henry-accent'
                        : 'bg-henry-surface border-henry-border/30 text-henry-text-muted hover:text-henry-text'
                    }`}
                  >
                    {EXECUTION_MODE_CONFIGS[m].label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-henry-text-muted mt-0.5">
                Source: {execSource} · Initiative: {initiativeMode}
              </p>
              {inferred && inferred.mode !== execMode && (
                <p className="text-[10px] text-henry-warning mt-0.5">
                  Inferred: {EXECUTION_MODE_CONFIGS[inferred.mode].label} — {inferred.reason}
                </p>
              )}
            </div>

            {/* Momentum */}
            <div className="h-px bg-henry-border/30 my-2" />
            <Row
              label="Momentum"
              value={momentum.state.toUpperCase()}
              accent={momentum.state === 'strong' || momentum.state === 'building'}
            />
            <Row label="Reason" value={momentum.reason} />
            {momentum.oneNextStep && (
              <Row label="One next step" value={momentum.oneNextStep} accent />
            )}
            <Row label="Protect flow" value={momentum.protect ? 'yes' : 'no'} />

            {/* Instinct Decision */}
            <div className="h-px bg-henry-border/30 my-2" />
            <Row
              label="Instinct"
              value={`${instinct.decision.toUpperCase()} (${instinct.confidence} confidence)`}
              accent={instinct.decision === 'act' || instinct.decision === 'escalate'}
            />
            <Row label="Phrase style" value={instinct.phraseStyle} />
            <Row label="Reason" value={instinct.reason} />

            {/* Raw signals */}
            <div className="h-px bg-henry-border/30 my-2" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-henry-text-muted">Signals</span>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1">
              <Row label="Pending tasks" value={String(momentum.signals.pendingTasks)} />
              <Row label="Failed tasks" value={String(momentum.signals.failedTasks)} />
              <Row label="Overdue" value={String(momentum.signals.overdueReminders)} />
              <Row label="Expired conns" value={String(momentum.signals.expiredConnections)} />
              <Row label="Unrouted caps" value={String(momentum.signals.unroutedCaptures)} />
              <Row label="Active projects" value={String(momentum.signals.activeProjects)} />
            </div>
          </Section>

        </div>
      </div>
    </div>
  );
}
