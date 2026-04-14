import { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store';
import {
  planComputerTask, executeStep, RISK_LABELS, TASK_TEMPLATES,
  type ComputerTask, type TaskStep,
} from '../../henry/computerTasks';

interface ActionLog {
  id: string;
  type: 'command' | 'result' | 'screenshot' | 'error' | 'info';
  content: string;
  timestamp: number;
  imageBase64?: string;
}

interface Permissions {
  platform: string;
  accessibility: boolean;
  screenRecording: boolean;
  accessibilityInstructions?: string | null;
  screenRecordingInstructions?: string | null;
  message?: string;
}

type TabMode = 'task' | 'shell' | 'applescript';

export default function ComputerPanel() {
  const { settings } = useStore();
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [systemInfo, setSystemInfo] = useState<any>(null);
  const [tab, setTab] = useState<TabMode>('task');
  const [screenshot, setScreenshot] = useState<string | null>(null);

  const { providers } = useStore();

  // Task mode state
  const [taskInput, setTaskInput] = useState('');
  const [task, setTask] = useState<ComputerTask | null>(null);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState('');
  const [runningStepId, setRunningStepId] = useState<string | null>(null);
  const [autoRun, setAutoRun] = useState(false);

  // Shell/AS mode state
  const [shellInput, setShellInput] = useState('');
  const [shellMode, setShellMode] = useState<'shell' | 'applescript'>('shell');
  const [log, setLog] = useState<ActionLog[]>([]);
  const [shellRunning, setShellRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const taskInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { loadPermissions(); loadSystemInfo(); }, []);
  useEffect(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, [log]);

  const isDesktop = !!window.henryAPI?.computerRunShell;

  function addLog(type: ActionLog['type'], content: string, imageBase64?: string) {
    setLog((prev) => [...prev, { id: crypto.randomUUID(), type, content, timestamp: Date.now(), imageBase64 }]);
  }

  async function loadPermissions() {
    try {
      const perms = await window.henryAPI.computerCheckPermissions();
      setPermissions(perms);
    } catch {
      setPermissions({ platform: 'web', accessibility: false, screenRecording: false, message: 'Desktop app not connected' });
    }
  }

  async function loadSystemInfo() {
    try {
      const info = await window.henryAPI.computerSystemInfo();
      setSystemInfo(info);
    } catch {}
  }

  // ── Task agent ─────────────────────────────────────────────────────────────

  async function handlePlan() {
    if (!taskInput.trim() || planning) return;
    setPlanError('');
    setTask(null);
    setPlanning(true);
    try {
      const built = await planComputerTask(taskInput.trim(), settings as any, providers as any);
      setTask(built);
    } catch (err: any) {
      setPlanError(err.message || 'Planning failed.');
    } finally {
      setPlanning(false);
    }
  }

  async function runStep(step: TaskStep) {
    if (!task) return;
    setRunningStepId(step.id);

    setTask((prev) => prev ? {
      ...prev,
      steps: prev.steps.map((s) => s.id === step.id ? { ...s, status: 'running', output: undefined, error: undefined } : s),
    } : prev);

    const result = await executeStep(step);

    setTask((prev) => prev ? {
      ...prev,
      steps: prev.steps.map((s) => s.id === step.id ? {
        ...s,
        status: result.success ? 'done' : 'error',
        output: result.output,
        error: result.error,
      } : s),
    } : prev);

    setRunningStepId(null);
    return result.success;
  }

  async function runAllSteps() {
    if (!task) return;
    setAutoRun(true);
    for (const step of task.steps) {
      if (step.status === 'done' || step.status === 'skipped') continue;
      if (step.risk === 'critical') break; // always pause on critical
      const ok = await runStep(step);
      if (!ok && !step.optional) break; // stop on non-optional failure
    }
    setAutoRun(false);
  }

  function skipStep(stepId: string) {
    setTask((prev) => prev ? {
      ...prev,
      steps: prev.steps.map((s) => s.id === stepId ? { ...s, status: 'skipped' } : s),
    } : prev);
  }

  function editStepCommand(stepId: string, command: string) {
    setTask((prev) => prev ? {
      ...prev,
      steps: prev.steps.map((s) => s.id === stepId ? { ...s, command } : s),
    } : prev);
  }

  function useTemplate(template: string) {
    setTaskInput(template);
    setTask(null);
    setTimeout(() => taskInputRef.current?.focus(), 50);
  }

  function reset() {
    setTask(null);
    setTaskInput('');
    setPlanError('');
  }

  const allDone = task?.steps.every((s) => s.status === 'done' || s.status === 'skipped');
  const hasError = task?.steps.some((s) => s.status === 'error');
  const pendingSteps = task?.steps.filter((s) => s.status === 'pending' || s.status === 'error') || [];
  const nextStep = pendingSteps[0];

  // ── Shell direct mode ──────────────────────────────────────────────────────

  async function executeShell() {
    if (!shellInput.trim() || shellRunning) return;
    const cmd = shellInput.trim();
    setShellInput('');
    setHistory((h) => [cmd, ...h.slice(0, 50)]);
    setHistoryIdx(-1);
    setShellRunning(true);
    addLog('command', `$ ${cmd}`);
    try {
      const result = shellMode === 'shell'
        ? await window.henryAPI.computerRunShell({ command: cmd, timeout: 30000 })
        : await window.henryAPI.computerOsascript(cmd);
      if (result.output) addLog('result', result.output);
      if (result.error && !result.success) addLog('error', result.error);
    } catch (e: any) {
      addLog('error', e.message);
    } finally {
      setShellRunning(false);
    }
  }

  async function takeScreenshot() {
    try {
      const result = await window.henryAPI.computerScreenshot();
      if (result.success && result.base64) {
        setScreenshot(`data:${result.mimeType || 'image/png'};base64,${result.base64}`);
      }
    } catch {}
  }

  return (
    <div className="h-full flex flex-col bg-henry-bg text-henry-text overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-henry-border/50 bg-henry-surface/30">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-henry-text flex items-center gap-2">
              🖥️ Computer
              {!isDesktop && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-yellow-400/15 text-yellow-400 font-normal">Desktop app needed</span>
              )}
            </h2>
            {systemInfo && (
              <p className="text-xs text-henry-text-muted mt-0.5">
                {systemInfo.platform} · {systemInfo.hostname}
                {systemInfo.macOS && ` · ${systemInfo.macOS.split('\n')[0]}`}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={takeScreenshot} className="text-xs px-3 py-1.5 rounded-lg bg-henry-surface border border-henry-border/30 text-henry-text-muted hover:text-henry-text transition-all">📸</button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-3">
          {([['task', '🤖 Task'], ['shell', '💻 Shell'], ['applescript', '🍎 AppleScript']] as const).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 text-xs rounded-lg font-medium transition-all ${
                tab === t ? 'bg-henry-accent text-white' : 'bg-henry-hover text-henry-text-dim hover:text-henry-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-hidden flex flex-col">

          {/* ── TASK TAB ── */}
          {tab === 'task' && (
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

              {/* Input area */}
              {!task && (
                <>
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-henry-text">What do you want done?</p>
                    <p className="text-xs text-henry-text-muted">Describe any task in plain English — Henry will plan and execute it step by step on your computer.</p>
                    <textarea
                      ref={taskInputRef}
                      value={taskInput}
                      onChange={(e) => setTaskInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handlePlan(); }}
                      placeholder="e.g. Create a new Next.js app on my Desktop called MyStartup and open it in Cursor"
                      rows={3}
                      className="w-full bg-henry-surface/40 border border-henry-border/30 rounded-xl px-4 py-3 text-sm text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/50 resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handlePlan}
                        disabled={planning || !taskInput.trim()}
                        className="px-5 py-2 bg-henry-accent text-white text-sm font-medium rounded-xl hover:bg-henry-accent/90 disabled:opacity-40 transition-all"
                      >
                        {planning ? (
                          <span className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                            Planning…
                          </span>
                        ) : 'Plan this task'}
                      </button>
                      <span className="text-xs text-henry-text-muted self-center">⌘↵ to plan</span>
                    </div>
                  </div>

                  {planError && (
                    <div className="rounded-xl bg-red-400/10 border border-red-400/20 p-3 text-sm text-red-400">{planError}</div>
                  )}

                  {/* Quick templates */}
                  <div>
                    <p className="text-xs font-medium text-henry-text-muted mb-2 uppercase tracking-wider">Quick starts</p>
                    <div className="grid grid-cols-2 gap-2">
                      {TASK_TEMPLATES.map((t) => (
                        <button
                          key={t.label}
                          onClick={() => useTemplate(t.template)}
                          className="flex items-start gap-2 p-3 rounded-xl bg-henry-surface/20 border border-henry-border/20 hover:border-henry-accent/30 hover:bg-henry-surface/40 text-left transition-all"
                        >
                          <span className="text-base shrink-0 mt-0.5">{t.icon}</span>
                          <div>
                            <p className="text-xs font-medium text-henry-text">{t.label}</p>
                            <p className="text-[10px] text-henry-text-muted mt-0.5 line-clamp-1">{t.template}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {!isDesktop && (
                    <div className="rounded-xl bg-henry-accent/5 border border-henry-accent/20 p-4">
                      <p className="text-sm font-medium text-henry-text mb-1">Desktop app required to execute tasks</p>
                      <p className="text-xs text-henry-text-muted leading-relaxed">Henry can plan tasks right now, but executing them requires the Henry desktop app (Electron). Build it with <code className="text-henry-accent">npm run build:mac</code> and run it locally.</p>
                    </div>
                  )}
                </>
              )}

              {/* Task plan view */}
              {task && (
                <div className="space-y-3">
                  {/* Goal header */}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-henry-text-muted uppercase tracking-wider mb-1">Goal</p>
                      <p className="text-sm font-medium text-henry-text">{task.goal}</p>
                    </div>
                    <button onClick={reset} className="text-xs px-3 py-1.5 rounded-lg text-henry-text-muted hover:text-henry-text border border-henry-border/30 hover:border-henry-border/60 transition-all shrink-0">
                      New task
                    </button>
                  </div>

                  {/* Run all button */}
                  {!allDone && !autoRun && (
                    <div className="flex gap-2">
                      <button
                        onClick={runAllSteps}
                        disabled={!!runningStepId || !isDesktop}
                        className="px-4 py-2 bg-henry-accent text-white text-sm font-medium rounded-xl hover:bg-henry-accent/90 disabled:opacity-40 transition-all"
                      >
                        ▶ Run all steps
                      </button>
                      {nextStep && (
                        <button
                          onClick={() => runStep(nextStep)}
                          disabled={!!runningStepId || !isDesktop}
                          className="px-4 py-2 bg-henry-surface border border-henry-border/40 text-henry-text text-sm rounded-xl hover:bg-henry-hover/50 disabled:opacity-40 transition-all"
                        >
                          Run next step only
                        </button>
                      )}
                    </div>
                  )}

                  {autoRun && (
                    <div className="flex items-center gap-2 text-xs text-henry-accent">
                      <span className="w-3 h-3 rounded-full border-2 border-henry-accent/30 border-t-henry-accent animate-spin" />
                      Running steps…
                    </div>
                  )}

                  {allDone && (
                    <div className="rounded-xl bg-green-400/10 border border-green-400/20 px-4 py-3 flex items-center gap-2">
                      <span className="text-green-400 text-base">✓</span>
                      <p className="text-sm text-green-400 font-medium">All steps complete</p>
                    </div>
                  )}

                  {hasError && !allDone && (
                    <div className="rounded-xl bg-orange-400/10 border border-orange-400/20 px-4 py-3 text-xs text-orange-400">
                      One or more steps failed. Review them below, edit the command if needed, and re-run.
                    </div>
                  )}

                  {/* Steps list */}
                  <div className="space-y-2">
                    {task.steps.map((step, i) => (
                      <StepCard
                        key={step.id}
                        step={step}
                        index={i + 1}
                        isRunning={runningStepId === step.id}
                        isDesktop={isDesktop}
                        onRun={() => runStep(step)}
                        onSkip={() => skipStep(step.id)}
                        onEditCommand={(cmd) => editStepCommand(step.id, cmd)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── SHELL / APPLESCRIPT TAB ── */}
          {(tab === 'shell' || tab === 'applescript') && (
            <>
              <div className="flex-1 overflow-y-auto px-4 py-3 font-mono text-xs space-y-1" ref={logRef}>
                {log.length === 0 && (
                  <p className="text-henry-text-muted italic">Ready. Enter a command below.</p>
                )}
                {log.map((entry) => (
                  <div key={entry.id}>
                    <LogLine entry={entry} />
                  </div>
                ))}
                {shellRunning && <div className="text-henry-accent animate-pulse">▋ running…</div>}
              </div>
              <div className="shrink-0 p-4 border-t border-henry-border/30">
                <div className="flex gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={shellInput}
                    onChange={(e) => setShellInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); executeShell(); }
                      else if (e.key === 'ArrowUp') { e.preventDefault(); const n = Math.min(historyIdx+1,history.length-1); setHistoryIdx(n); if(history[n]) setShellInput(history[n]); }
                      else if (e.key === 'ArrowDown') { e.preventDefault(); const n = Math.max(historyIdx-1,-1); setHistoryIdx(n); setShellInput(n>=0?history[n]:''); }
                    }}
                    disabled={shellRunning}
                    placeholder={tab === 'shell' ? 'Shell command… (↑↓ for history)' : 'AppleScript… e.g. tell application "Finder" to activate'}
                    className="flex-1 bg-henry-bg border border-henry-border rounded-xl px-4 py-2.5 text-sm text-henry-text font-mono outline-none focus:border-henry-accent/50 disabled:opacity-50"
                  />
                  <button
                    onClick={executeShell}
                    disabled={shellRunning || !shellInput.trim()}
                    className="px-4 py-2.5 bg-henry-accent text-white rounded-xl text-sm font-medium hover:bg-henry-accent/90 transition-all disabled:opacity-50"
                  >
                    Run
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Screenshot panel */}
        {screenshot && (
          <div className="w-72 shrink-0 border-l border-henry-border/50 flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-henry-border/30 text-xs text-henry-text-muted">
              <span>Screenshot</span>
              <button onClick={() => setScreenshot(null)} className="hover:text-henry-text">✕</button>
            </div>
            <div className="flex-1 overflow-auto p-2">
              <img src={screenshot} alt="Screenshot" className="w-full rounded border border-henry-border/30" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StepCard({
  step, index, isRunning, isDesktop, onRun, onSkip, onEditCommand,
}: {
  step: TaskStep;
  index: number;
  isRunning: boolean;
  isDesktop: boolean;
  onRun: () => void;
  onSkip: () => void;
  onEditCommand: (cmd: string) => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const [editVal, setEditVal] = useState(step.command);
  const risk = RISK_LABELS[step.risk];

  const statusIcon =
    step.status === 'done'    ? <span className="text-green-400 text-sm">✓</span> :
    step.status === 'error'   ? <span className="text-red-400 text-sm">✕</span> :
    step.status === 'skipped' ? <span className="text-henry-text-muted text-sm">–</span> :
    isRunning                 ? <span className="w-3 h-3 rounded-full border-2 border-henry-accent/30 border-t-henry-accent animate-spin shrink-0" /> :
    <span className="text-[11px] font-semibold text-henry-text-muted">{index}</span>;

  const cardBg =
    step.status === 'done'    ? 'border-green-400/20 bg-green-400/5' :
    step.status === 'error'   ? 'border-red-400/20 bg-red-400/5' :
    step.status === 'skipped' ? 'border-henry-border/10 opacity-50' :
    isRunning                 ? 'border-henry-accent/30 bg-henry-accent/5' :
    'border-henry-border/20 bg-henry-surface/10';

  return (
    <div className={`rounded-xl border p-3 transition-all ${cardBg}`}>
      <div className="flex items-start gap-3">
        <div className="w-6 h-6 rounded-full bg-henry-surface/40 flex items-center justify-center shrink-0 mt-0.5">
          {statusIcon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-xs font-semibold text-henry-text">{step.label}</p>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${risk.bg} ${risk.color}`}>{risk.label}</span>
            {step.optional && <span className="text-[9px] text-henry-text-muted">optional</span>}
          </div>
          <p className="text-[11px] text-henry-text-muted mb-1.5">{step.description}</p>

          {/* Command display / edit */}
          {editMode ? (
            <div className="flex gap-2 mt-1">
              <input
                value={editVal}
                onChange={(e) => setEditVal(e.target.value)}
                className="flex-1 text-[11px] font-mono bg-henry-bg border border-henry-border/40 rounded-lg px-2 py-1 text-henry-text outline-none focus:border-henry-accent/50"
              />
              <button
                onClick={() => { onEditCommand(editVal); setEditMode(false); }}
                className="text-[11px] px-2 py-1 rounded-lg bg-henry-accent text-white"
              >Save</button>
              <button onClick={() => setEditMode(false)} className="text-[11px] px-2 py-1 rounded-lg border border-henry-border/30 text-henry-text-muted">Cancel</button>
            </div>
          ) : (
            <code
              className="block text-[11px] font-mono text-henry-accent/90 bg-henry-surface/40 rounded-lg px-2 py-1.5 break-all cursor-pointer hover:bg-henry-surface/70 transition-all"
              title="Click to edit"
              onClick={() => { setEditVal(step.command); setEditMode(true); }}
            >
              {step.command}
            </code>
          )}

          {/* Output */}
          {step.output && (
            <pre className={`text-[10px] mt-2 px-2 py-1.5 rounded-lg bg-henry-bg/60 whitespace-pre-wrap break-all max-h-32 overflow-y-auto ${
              step.status === 'error' ? 'text-red-400' : 'text-green-400/80'
            }`}>{step.output || step.error}</pre>
          )}
          {step.error && step.status === 'error' && !step.output && (
            <p className="text-[10px] text-red-400 mt-1.5 font-mono">{step.error}</p>
          )}
        </div>

        {/* Action buttons */}
        {(step.status === 'pending' || step.status === 'error') && !isRunning && (
          <div className="flex flex-col gap-1 shrink-0">
            <button
              onClick={onRun}
              disabled={!isDesktop}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-henry-accent text-white hover:bg-henry-accent/90 disabled:opacity-40 transition-all"
            >
              {step.status === 'error' ? 'Retry' : 'Run'}
            </button>
            <button
              onClick={onSkip}
              className="text-[11px] px-2.5 py-1 rounded-lg border border-henry-border/30 text-henry-text-muted hover:text-henry-text transition-all"
            >
              Skip
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function LogLine({ entry }: { entry: ActionLog }) {
  const colors: Record<ActionLog['type'], string> = {
    command: 'text-henry-accent',
    result: 'text-henry-success',
    screenshot: 'text-henry-worker',
    error: 'text-henry-error',
    info: 'text-henry-text-muted',
  };
  return <div className={`${colors[entry.type]} leading-relaxed whitespace-pre-wrap break-all`}>{entry.content}</div>;
}
