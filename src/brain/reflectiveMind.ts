/**
 * Henry AI — Reflective Mind
 *
 * The third operating layer. Runs after the background brain, on a slower
 * cadence. Pure heuristic — no AI calls, no async, fast (<5ms).
 *
 * It asks the questions the document specifies:
 *   - What changed since the last pass?
 *   - What became more important?
 *   - What is being neglected?
 *   - What should be gently surfaced?
 *   - What is the single most actionable next move?
 *
 * Writes output to shared state via _setReflectiveOutput().
 *
 * Three-mind architecture:
 *   Foreground Mind  → charter.ts + coordinator block (what Henry says)
 *   Background Mind  → backgroundBrain.ts + jobs       (what Henry knows)
 *   Reflective Mind  → this file                       (what Henry has synthesized)
 */

import { getSharedBrainState } from './sharedState';
import { loadActiveThreads } from '../henry/threads/threadStore';
import { inferRhythmPhase } from '../henry/dailyRhythm';
import { getInitiativeMode } from '../henry/initiativeStore';

// ── Constants ─────────────────────────────────────────────────────────────────

const REFLECTION_STATE_KEY = 'henry:reflection_state_v1';
const DRIFT_THRESHOLD_MS   = 3 * 24 * 60 * 60 * 1000;  // 3 days idle = drifting
const NEGLECT_THRESHOLD_MS = 6 * 24 * 60 * 60 * 1000;  // 6 days unresolved = neglected

// ── State tracking ────────────────────────────────────────────────────────────

interface ReflectionCheckpoint {
  lastRunAt: number;
  previousTopFocusId: string | null;
  previousUnresolvedCount: number;
  previousThreadIds: string[];
}

function loadCheckpoint(): ReflectionCheckpoint {
  try {
    if (typeof localStorage === 'undefined') return emptyCheckpoint();
    const raw = localStorage.getItem(REFLECTION_STATE_KEY);
    if (raw) return JSON.parse(raw) as ReflectionCheckpoint;
  } catch { /* ignore */ }
  return emptyCheckpoint();
}

function emptyCheckpoint(): ReflectionCheckpoint {
  return { lastRunAt: 0, previousTopFocusId: null, previousUnresolvedCount: 0, previousThreadIds: [] };
}

function saveCheckpoint(c: ReflectionCheckpoint): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(REFLECTION_STATE_KEY, JSON.stringify(c));
    }
  } catch { /* storage full */ }
}

// ── Rhythm labels ─────────────────────────────────────────────────────────────

const RHYTHM_LABELS: Record<string, string> = {
  morning_setup:  'Morning setup',
  focus_block:    'Focus block',
  admin_window:   'Admin window',
  evening_review: 'Evening review',
  weekly_reset:   'Weekly reset',
  meeting_prep:   'Meeting prep',
};

const RHYTHM_CONTEXT_HINTS: Record<string, string> = {
  morning_setup:  'Orient, choose first focus, review what changed overnight.',
  focus_block:    'Deep work time — minimize context switches, execute.',
  admin_window:   'Inbox, scheduling, logistics, follow-ups.',
  evening_review: 'Close open loops, save context, reflect on progress.',
  weekly_reset:   'Reorient across all threads, reweight priorities.',
  meeting_prep:   'Prepare for what is coming — context, questions, agenda.',
};

// ── Main export ───────────────────────────────────────────────────────────────

export interface ReflectiveOutput {
  /** The single most actionable next move right now. */
  suggestedNextMove: string | null;
  /** Active things that have stalled without resolution. */
  driftWarnings: string[];
  /** Commitments or threads past their natural check-in time. */
  neglectedItems: string[];
  /** Brief reasoning notes the coordinator can pass to the foreground mind. */
  reflectiveNotes: string[];
  /** Current daily rhythm phase identifier. */
  rhythmPhase: string;
  /** Human-readable label for the rhythm phase. */
  rhythmLabel: string;
}

/**
 * Run the reflective mind.
 * Synchronous, pure heuristic — reads shared state and localStorage only.
 * Returns structured output; does NOT write to shared state itself.
 */
export function runReflectiveMind(): ReflectiveOutput {
  const state = getSharedBrainState();
  const checkpoint = loadCheckpoint();
  const now = Date.now();
  const rhythmPhase = inferRhythmPhase(new Date());
  const rhythmLabel = RHYTHM_LABELS[rhythmPhase] ?? 'Work session';
  const initiativeMode = getInitiativeMode();

  const driftWarnings: string[] = [];
  const neglectedItems: string[] = [];
  const reflectiveNotes: string[] = [];
  let suggestedNextMove: string | null = null;

  const snapshot   = state.prioritySnapshot;
  const activeThreads = loadActiveThreads();

  // ── What changed since last pass ─────────────────────────────────────────

  const currentUnresolved = state.unresolvedCount;
  if (
    checkpoint.previousUnresolvedCount > 0 &&
    currentUnresolved > checkpoint.previousUnresolvedCount + 2
  ) {
    const delta = currentUnresolved - checkpoint.previousUnresolvedCount;
    reflectiveNotes.push(
      `${delta} new unresolved item${delta !== 1 ? 's' : ''} have appeared since the last check.`
    );
  }

  if (
    snapshot?.topFocus &&
    checkpoint.previousTopFocusId &&
    snapshot.topFocus.id !== checkpoint.previousTopFocusId
  ) {
    reflectiveNotes.push('The top priority has shifted since the last pass.');
  }

  // New threads since last reflection
  const prevIds = new Set(checkpoint.previousThreadIds);
  const newThreads = activeThreads.filter((t) => !prevIds.has(t.id));
  if (newThreads.length > 0) {
    reflectiveNotes.push(
      `${newThreads.length} new thread${newThreads.length !== 1 ? 's' : ''} opened: ${newThreads.slice(0, 2).map((t) => `"${t.title}"`).join(', ')}.`
    );
  }

  // ── Thread drift detection ────────────────────────────────────────────────

  for (const thread of activeThreads.slice(0, 8)) {
    const idleMs = now - new Date(thread.lastTouched).getTime();
    if (idleMs > DRIFT_THRESHOLD_MS && thread.weight >= 50) {
      const days = Math.round(idleMs / (24 * 60 * 60 * 1000));
      driftWarnings.push(`"${thread.title}" has not moved in ${days} day${days !== 1 ? 's' : ''}.`);
    }
  }

  // ── Neglected commitments ─────────────────────────────────────────────────

  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem('henry:commitments:v1');
      if (raw) {
        const commitments: any[] = JSON.parse(raw);
        const pending = commitments.filter((c: any) => !c.resolved && !c.dismissed);
        for (const c of pending.slice(0, 10)) {
          const label = c.title || c.text || '(unnamed)';
          if (c.dueAt) {
            if (new Date(c.dueAt).getTime() < now) {
              neglectedItems.push(`Overdue commitment: "${label}"`);
            }
          } else if (c.createdAt) {
            const age = now - new Date(c.createdAt).getTime();
            if (age > NEGLECT_THRESHOLD_MS) {
              neglectedItems.push(`Long-open commitment: "${label}"`);
            }
          }
          if (neglectedItems.length >= 3) break;
        }
      }
    }
  } catch { /* ignore */ }

  // ── Rhythm-aware context hint ─────────────────────────────────────────────

  const hint = RHYTHM_CONTEXT_HINTS[rhythmPhase];
  if (hint) {
    reflectiveNotes.push(`${rhythmLabel}: ${hint}`);
  }

  // ── Suggested next move ───────────────────────────────────────────────────
  // Only compute if initiative mode allows it

  if (initiativeMode !== 'quiet' && snapshot) {
    const urgentItems = snapshot.urgentNow;
    const topFocus = snapshot.topFocus;

    if (urgentItems.length > 0) {
      const u = urgentItems[0];
      const label = u.title.replace(/^(Project|Captured|Note|Active app|Computer):\s*/i, '').slice(0, 80);
      suggestedNextMove = `Address urgently: "${label}"${u.signals.isOverdue ? ' — overdue' : ''}`;
    } else if (activeThreads.length > 0 && activeThreads[0].suggestedNextStep) {
      suggestedNextMove = activeThreads[0].suggestedNextStep;
    } else if (topFocus) {
      const label = topFocus.title.replace(/^(Project|Captured|Note|Active app|Computer):\s*/i, '').slice(0, 80);
      suggestedNextMove = `Continue: "${label}"`;
    } else if (neglectedItems.length > 0) {
      suggestedNextMove = `Revisit ${neglectedItems[0].replace(/^(Overdue|Long-open) commitment: /i, '')}`;
    } else if (driftWarnings.length > 0) {
      suggestedNextMove = `Check in on stalled thread: ${driftWarnings[0]}`;
    }
  }

  // ── Unresolved load note ──────────────────────────────────────────────────

  if (currentUnresolved > 12) {
    reflectiveNotes.push(`${currentUnresolved} items unresolved — a triage pass would help.`);
  } else if (currentUnresolved === 0 && snapshot && snapshot.items.length > 0) {
    reflectiveNotes.push('All tracked items are resolved or parked. Priorities are clean.');
  }

  // ── Save checkpoint ───────────────────────────────────────────────────────

  saveCheckpoint({
    lastRunAt: now,
    previousTopFocusId: snapshot?.topFocus?.id ?? null,
    previousUnresolvedCount: currentUnresolved,
    previousThreadIds: activeThreads.slice(0, 8).map((t) => t.id),
  });

  return {
    suggestedNextMove,
    driftWarnings: driftWarnings.slice(0, 3),
    neglectedItems: neglectedItems.slice(0, 3),
    reflectiveNotes: reflectiveNotes.slice(0, 4),
    rhythmPhase,
    rhythmLabel,
  };
}

// ── System prompt block ───────────────────────────────────────────────────────

/**
 * Build the reflective mind's system prompt contribution.
 * Called by coordinator to include in the foreground system prompt.
 */
export function buildReflectiveMindBlock(output: ReflectiveOutput): string {
  if (!output.reflectiveNotes.length && !output.suggestedNextMove && !output.driftWarnings.length) {
    return '';
  }

  const lines: string[] = [`## Reflective mind (${output.rhythmLabel})`];

  if (output.suggestedNextMove) {
    lines.push(`Suggested next move: ${output.suggestedNextMove}`);
  }

  if (output.reflectiveNotes.length) {
    lines.push(`Context: ${output.reflectiveNotes.join(' ')}`);
  }

  if (output.driftWarnings.length) {
    lines.push(`Drift detected: ${output.driftWarnings.join('; ')}`);
  }

  if (output.neglectedItems.length) {
    lines.push(`Neglected: ${output.neglectedItems.join('; ')}`);
  }

  lines.push('Use this to inform your posture — mention it only when it adds real value.');

  return lines.join('\n');
}
