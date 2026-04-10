/**
 * Henry Recurring Macros — named, optionally scheduled agent tasks.
 * Stored in localStorage. Henry can trigger them on command or on schedule.
 */

export interface HenryMacro {
  id: string;
  name: string;
  description: string;
  prompt: string;
  mode: string;
  schedule?: 'daily' | 'weekdays' | 'manual';
  scheduleHour?: number;
  lastRunDate?: string;
  enabled: boolean;
  createdAt: string;
}

const MACROS_KEY = 'henry:macros';

export function getMacros(): HenryMacro[] {
  try {
    const raw = localStorage.getItem(MACROS_KEY);
    return raw ? (JSON.parse(raw) as HenryMacro[]) : getDefaultMacros();
  } catch {
    return getDefaultMacros();
  }
}

function getDefaultMacros(): HenryMacro[] {
  return [
    {
      id: 'morning-standup',
      name: 'Morning Standup',
      description: 'Daily briefing with tasks, schedule, and priorities',
      prompt: `Generate my morning standup briefing for ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}. Cover: (1) top 3 priorities for today, (2) anything blocking me, (3) one thing I should clear off my plate. Be concise and actionable.`,
      mode: 'secretary',
      schedule: 'weekdays',
      scheduleHour: 8,
      enabled: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'workspace-check',
      name: 'Workspace Check',
      description: 'Review open files and project status',
      prompt: `Check my current workspace and give me a quick status report: what files are open, what project seems most active, and what should I focus on next based on what you see?`,
      mode: 'developer',
      schedule: 'manual',
      enabled: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'end-of-day',
      name: 'End of Day Review',
      description: 'Summarize what was accomplished and set up tomorrow',
      prompt: `Give me an end-of-day review. Summarize what I accomplished today based on our conversations, flag anything that needs follow-up tomorrow, and suggest one thing I should do first thing in the morning.`,
      mode: 'secretary',
      schedule: 'weekdays',
      scheduleHour: 17,
      enabled: false,
      createdAt: new Date().toISOString(),
    },
  ];
}

export function saveMacros(macros: HenryMacro[]): void {
  localStorage.setItem(MACROS_KEY, JSON.stringify(macros));
}

export function saveMacro(macro: HenryMacro): void {
  const macros = getMacros();
  const idx = macros.findIndex((m) => m.id === macro.id);
  if (idx >= 0) macros[idx] = macro;
  else macros.push(macro);
  saveMacros(macros);
}

export function deleteMacro(id: string): void {
  saveMacros(getMacros().filter((m) => m.id !== id));
}

export function createMacro(partial: Omit<HenryMacro, 'id' | 'createdAt'>): HenryMacro {
  const macro: HenryMacro = {
    ...partial,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  saveMacro(macro);
  return macro;
}

export function markMacroRun(id: string): void {
  const macros = getMacros();
  const m = macros.find((m) => m.id === id);
  if (m) {
    m.lastRunDate = new Date().toISOString().slice(0, 10);
    saveMacros(macros);
  }
}

export function getDueMacros(): HenryMacro[] {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  const today = now.toISOString().slice(0, 10);
  const isWeekday = day >= 1 && day <= 5;

  return getMacros().filter((m) => {
    if (!m.enabled || m.schedule === 'manual') return false;
    if (m.lastRunDate === today) return false;
    if (m.scheduleHour !== undefined && Math.abs(hour - m.scheduleHour) > 1) return false;
    if (m.schedule === 'weekdays' && !isWeekday) return false;
    return true;
  });
}
