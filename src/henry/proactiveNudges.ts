const NUDGE_COOLDOWN_KEY = 'henry:nudge_last_fired';
const NUDGE_COOLDOWN_MS = 30 * 60 * 1000; // 30 min minimum between nudges

export interface HenryNudge {
  id: string;
  message: string;
  cta?: string;
  icon?: string;
  action?: { label: string; view: string };
  type: 'info' | 'reminder' | 'insight';
}

function canFire(): boolean {
  try {
    const last = parseInt(localStorage.getItem(NUDGE_COOLDOWN_KEY) || '0', 10);
    return Date.now() - last > NUDGE_COOLDOWN_MS;
  } catch {
    return true;
  }
}

function markFired(): void {
  try {
    localStorage.setItem(NUDGE_COOLDOWN_KEY, String(Date.now()));
  } catch { /* ignore */ }
}

function getHour(): number {
  return new Date().getHours();
}

function getTaskQueueState(): { pending: number; oldest: number | null } {
  try {
    const tasks = JSON.parse(localStorage.getItem('henry:tasks') || '[]') as any[];
    const pending = tasks.filter((t) => t.status === 'pending' || t.status === 'queued');
    if (!pending.length) return { pending: 0, oldest: null };
    const oldestMs = Math.min(...pending.map((t) => new Date(t.created_at).getTime()));
    return { pending: pending.length, oldest: Date.now() - oldestMs };
  } catch {
    return { pending: 0, oldest: null };
  }
}

function getProjectInactivity(): { name: string; daysSince: number } | null {
  try {
    const projects = JSON.parse(localStorage.getItem('henry:rich_memory:projects') || '[]') as any[];
    const active = projects.filter((p) => p.status === 'active');
    if (!active.length) return null;
    const now = Date.now();
    for (const p of active) {
      if (!p.updatedAt) continue;
      const days = (now - new Date(p.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
      if (days >= 3) return { name: p.name, daysSince: Math.floor(days) };
    }
    return null;
  } catch {
    return null;
  }
}

function selectNudge(): HenryNudge | null {
  const h = getHour();
  const nudges: HenryNudge[] = [];

  // Morning briefing nudge
  if (h >= 7 && h <= 9) {
    const briefDate = localStorage.getItem('henry_last_greeting_date') || '';
    const today = new Date().toISOString().slice(0, 10);
    if (briefDate !== today) {
      nudges.push({
        id: 'morning_briefing',
        message: "Morning. Your daily briefing is ready.",
        action: { label: 'Open Today', view: 'today' },
        type: 'info',
      });
    }
  }

  // Evening wind-down nudge
  if (h >= 20 && h <= 22) {
    const journalKey = `henry:journal:${new Date().toISOString().slice(0, 10)}`;
    const hasJournal = !!localStorage.getItem(journalKey);
    if (!hasJournal) {
      nudges.push({
        id: 'evening_journal',
        message: "Worth capturing anything from today before it slips?",
        action: { label: 'Open Journal', view: 'journal' },
        type: 'reminder',
      });
    }
  }

  // Task queue stale
  const { pending, oldest } = getTaskQueueState();
  if (pending > 0 && oldest != null && oldest > 2 * 60 * 60 * 1000) {
    const hrs = Math.floor(oldest / (1000 * 60 * 60));
    nudges.push({
      id: 'stale_tasks',
      message: `You have ${pending} task${pending > 1 ? 's' : ''} that${pending > 1 ? ' have' : ' has'} been sitting for ${hrs}+ hours.`,
      action: { label: 'View Tasks', view: 'tasks' },
      type: 'reminder',
    });
  }

  // Project inactivity
  const inactive = getProjectInactivity();
  if (inactive) {
    nudges.push({
      id: `project_inactive_${inactive.name}`,
      message: `"${inactive.name}" hasn't had any movement in ${inactive.daysSince} days.`,
      action: { label: 'Open Chat', view: 'chat' },
      type: 'insight',
    });
  }

  if (!nudges.length) return null;
  return nudges[Math.floor(Math.random() * nudges.length)];
}

let nudgeInterval: ReturnType<typeof setInterval> | null = null;

export function startProactiveNudges(
  onNudge: (nudge: HenryNudge) => void,
  checkIntervalMs = 5 * 60 * 1000
): () => void {
  if (nudgeInterval) clearInterval(nudgeInterval);

  nudgeInterval = setInterval(() => {
    if (!canFire()) return;
    const nudge = selectNudge();
    if (!nudge) return;
    markFired();
    onNudge(nudge);
  }, checkIntervalMs);

  return () => {
    if (nudgeInterval) {
      clearInterval(nudgeInterval);
      nudgeInterval = null;
    }
  };
}
