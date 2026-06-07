import { useCallback, useEffect, useState } from 'react';
import { Clock, Play, Plus, Trash2, Loader2, X } from 'lucide-react';

/**
 * RoutinesPanel — management UI for Henry's scheduled Routines (design §3).
 *
 * Lists every Routine with a human-readable schedule, an enabled toggle, and a
 * "Run Now" button, and offers a small form to add new ones. Backed by the
 * `scheduler:*` IPC channels exposed on `window.henryAPI` as
 * listRoutines/addRoutine/toggleRoutine/runRoutineNow/deleteRoutine.
 */

interface Routine {
  id: string;
  name: string;
  description: string | null;
  cronExpression: string;
  prompt: string;
  enabled: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Format minute+hour fields into a friendly "7:00 AM". Returns null if either is variable. */
function timeOfDay(min: string, hr: string): string | null {
  if (min.includes('*') || min.includes('/') || min.includes(',') || min.includes('-')) return null;
  if (hr.includes('*') || hr.includes('/') || hr.includes(',') || hr.includes('-')) return null;
  const h = Number(hr);
  const m = Number(min);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function describeDow(dow: string): string {
  if (dow === '*') return 'every day';
  if (dow === '1-5') return 'weekdays';
  if (dow === '0,6' || dow === '6,0') return 'weekends';
  const parts = dow.split(',').map((d) => DAY_NAMES[Number(d) % 7]).filter(Boolean);
  if (parts.length) return `on ${parts.join(', ')}`;
  return `(days ${dow})`;
}

/**
 * Best-effort human description of a 5-field cron expression. Covers the common
 * shapes Henry ships and most user input; falls back to the raw expression for
 * anything exotic.
 */
function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hr, dom, mon, dow] = parts;

  // Every N minutes: */N * * * *
  const everyMin = /^\*\/(\d+)$/.exec(min);
  if (everyMin && hr === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `Every ${everyMin[1]} minutes`;
  }
  // Every N minutes within an hour range: */N a-b * * *
  const hrRange = /^(\d+)-(\d+)$/.exec(hr);
  if (everyMin && hrRange && dom === '*' && mon === '*' && dow === '*') {
    return `Every ${everyMin[1]} min, ${Number(hrRange[1]) % 12 || 12}${Number(hrRange[1]) < 12 ? 'am' : 'pm'}–${Number(hrRange[2]) % 12 || 12}${Number(hrRange[2]) < 12 ? 'am' : 'pm'}`;
  }

  const time = timeOfDay(min, hr);
  if (time && dom === '*' && mon === '*') {
    if (dow === '*') return `Daily at ${time}`;
    if (dow === '1-5') return `Weekdays at ${time}`;
    return `At ${time} ${describeDow(dow)}`;
  }

  return expr;
}

function formatRunTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ` ${time}`;
}

const EMPTY_FORM = { name: '', description: '', prompt: '', cronExpression: '0 7 * * *' };

export default function RoutinesPanel() {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    const api = window.henryAPI;
    if (typeof api?.listRoutines !== 'function') {
      setError('Routines are only available in the desktop app.');
      setLoading(false);
      return;
    }
    try {
      const res = await api.listRoutines();
      if (res?.ok) {
        setRoutines((res.result ?? []) as Routine[]);
        setError(null);
      } else {
        setError(res?.error ?? 'Failed to load Routines.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    // Refresh the list when a Routine starts/finishes so last/next-run stamps stay current.
    const api = window.henryAPI;
    const unsubs: Array<() => void> = [];
    if (typeof api?.onSchedulerTaskCompleted === 'function') {
      unsubs.push(api.onSchedulerTaskCompleted(() => void reload()));
    }
    return () => unsubs.forEach((u) => u());
  }, [reload]);

  async function handleToggle(r: Routine) {
    await window.henryAPI.toggleRoutine?.(r.id, !r.enabled);
    void reload();
  }

  async function handleRunNow(r: Routine) {
    setRunning((s) => new Set(s).add(r.id));
    try {
      await window.henryAPI.runRoutineNow?.(r.id);
    } finally {
      setRunning((s) => {
        const next = new Set(s);
        next.delete(r.id);
        return next;
      });
      void reload();
    }
  }

  async function handleDelete(r: Routine) {
    await window.henryAPI.deleteRoutine?.(r.id);
    void reload();
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.prompt.trim() || !form.cronExpression.trim()) {
      setFormError('Name, prompt, and schedule are all required.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const res = await window.henryAPI.addRoutine?.({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        prompt: form.prompt.trim(),
        cronExpression: form.cronExpression.trim(),
        enabled: true,
      });
      if (res && !res.ok) {
        setFormError(res.error ?? 'Failed to add Routine.');
        return;
      }
      setForm(EMPTY_FORM);
      setShowForm(false);
      void reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto px-5 py-5 max-w-2xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-henry-accent" />
          <h1 className="text-lg font-bold text-henry-text">Routines</h1>
        </div>
        <button
          onClick={() => {
            setForm(EMPTY_FORM);
            setFormError(null);
            setShowForm((v) => !v);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-henry-accent/15 text-henry-accent border border-henry-accent/20 hover:bg-henry-accent/25 transition-colors"
        >
          {showForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {showForm ? 'Close' : 'Add Routine'}
        </button>
      </div>
      <p className="text-xs text-henry-text-muted mb-4">
        Things Henry does on a schedule — briefings, reminders, watching for client messages.
        Outbound actions still pause for your approval.
      </p>

      {/* Add form */}
      {showForm && (
        <form
          onSubmit={(e) => void handleAdd(e)}
          className="mb-5 rounded-xl border border-henry-border/40 bg-henry-surface/30 p-4 space-y-3"
        >
          <div>
            <label className="text-[10px] uppercase tracking-wide text-henry-text-muted block mb-1">
              Name
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Morning Briefing"
              className="w-full rounded-lg border border-henry-border/40 bg-henry-bg/40 px-2.5 py-1.5 text-xs focus:outline-none focus:border-henry-accent/50"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-henry-text-muted block mb-1">
              Description <span className="text-henry-text-dim normal-case">(optional)</span>
            </label>
            <input
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="A short rundown of the day ahead"
              className="w-full rounded-lg border border-henry-border/40 bg-henry-bg/40 px-2.5 py-1.5 text-xs focus:outline-none focus:border-henry-accent/50"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-henry-text-muted block mb-1">
              Prompt — what Henry should do
            </label>
            <textarea
              value={form.prompt}
              onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
              rows={3}
              placeholder="Give me a morning briefing: today's calendar, overdue commitments, open quotes."
              className="w-full rounded-lg border border-henry-border/40 bg-henry-bg/40 px-2.5 py-1.5 text-xs leading-relaxed resize-y focus:outline-none focus:border-henry-accent/50"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-henry-text-muted block mb-1">
              Schedule (cron)
            </label>
            <input
              value={form.cronExpression}
              onChange={(e) => setForm((f) => ({ ...f, cronExpression: e.target.value }))}
              placeholder="0 7 * * *"
              className="w-full rounded-lg border border-henry-border/40 bg-henry-bg/40 px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:border-henry-accent/50"
            />
            <p className="text-[10px] text-henry-text-dim mt-1">
              {form.cronExpression.trim()
                ? `→ ${describeCron(form.cronExpression)}`
                : 'minute hour day-of-month month day-of-week'}
            </p>
          </div>
          {formError && <p className="text-[11px] text-henry-error">{formError}</p>}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-1.5 text-xs rounded-lg bg-henry-accent text-white font-medium hover:bg-henry-accent/90 disabled:opacity-40 transition-colors"
            >
              {saving ? 'Adding…' : 'Add Routine'}
            </button>
          </div>
        </form>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-henry-text-muted py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading Routines…
        </div>
      ) : error ? (
        <p className="text-xs text-henry-error py-6 text-center">{error}</p>
      ) : routines.length === 0 ? (
        <p className="text-xs text-henry-text-muted py-8 text-center">
          No Routines yet. Add one to let Henry work on a schedule.
        </p>
      ) : (
        <div className="space-y-2.5">
          {routines.map((r) => {
            const enabled = !!r.enabled;
            const isRunning = running.has(r.id);
            return (
              <div
                key={r.id}
                className={`rounded-xl border px-4 py-3 transition-colors ${
                  enabled
                    ? 'border-henry-border/40 bg-henry-surface/40'
                    : 'border-henry-border/20 bg-henry-surface/15'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3
                        className={`text-sm font-semibold truncate ${
                          enabled ? 'text-henry-text' : 'text-henry-text-muted'
                        }`}
                      >
                        {r.name}
                      </h3>
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-md bg-henry-bg/50 border border-henry-border/30 text-henry-text-muted font-mono">
                        {describeCron(r.cronExpression)}
                      </span>
                    </div>
                    {r.description && (
                      <p className="text-[11px] text-henry-text-muted mt-0.5 truncate">
                        {r.description}
                      </p>
                    )}
                    <div className="flex items-center gap-4 mt-1.5 text-[10px] text-henry-text-dim">
                      <span>Last run: {formatRunTime(r.lastRunAt)}</span>
                      <span>Next: {enabled ? formatRunTime(r.nextRunAt) : 'paused'}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Run Now */}
                    <button
                      onClick={() => void handleRunNow(r)}
                      disabled={isRunning}
                      title="Run now"
                      className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-lg border border-henry-border/40 text-henry-text-muted hover:text-henry-text hover:border-henry-border disabled:opacity-50 transition-colors"
                    >
                      {isRunning ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Play className="w-3 h-3" />
                      )}
                      Run
                    </button>

                    {/* Enabled toggle */}
                    <button
                      onClick={() => void handleToggle(r)}
                      title={enabled ? 'Disable' : 'Enable'}
                      role="switch"
                      aria-checked={enabled}
                      className={`relative w-9 h-5 rounded-full transition-colors ${
                        enabled ? 'bg-henry-accent' : 'bg-henry-border/50'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                          enabled ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>

                    {/* Delete */}
                    <button
                      onClick={() => void handleDelete(r)}
                      title="Delete Routine"
                      className="p-1 rounded-lg text-henry-text-dim hover:text-henry-error transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
