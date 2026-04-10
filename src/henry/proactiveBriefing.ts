/**
 * Henry Proactive Briefing — generates a daily briefing on new day.
 * Stored per-day, shows in Today panel, auto-triggers in chat.
 */

const BRIEFING_KEY_PREFIX = 'henry:briefing:';
const BRIEFING_GENERATING_KEY = 'henry:briefing:generating';

export interface DailyBriefing {
  date: string;
  content: string;
  generatedAt: string;
  model?: string;
}

export function getTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function getTodayBriefing(): DailyBriefing | null {
  try {
    const raw = localStorage.getItem(BRIEFING_KEY_PREFIX + getTodayKey());
    return raw ? (JSON.parse(raw) as DailyBriefing) : null;
  } catch {
    return null;
  }
}

export function saveBriefing(content: string, model?: string): DailyBriefing {
  const briefing: DailyBriefing = {
    date: getTodayKey(),
    content,
    generatedAt: new Date().toISOString(),
    model,
  };
  localStorage.setItem(BRIEFING_KEY_PREFIX + getTodayKey(), JSON.stringify(briefing));
  return briefing;
}

export function isGenerating(): boolean {
  return localStorage.getItem(BRIEFING_GENERATING_KEY) === 'true';
}

export function setGenerating(v: boolean): void {
  if (v) localStorage.setItem(BRIEFING_GENERATING_KEY, 'true');
  else localStorage.removeItem(BRIEFING_GENERATING_KEY);
}

export function buildBriefingPrompt(facts: string): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const hour = now.getHours();
  const greeting = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

  return `It's ${greeting} on ${dateStr} at ${timeStr}. Generate a brief, warm daily briefing for Topher.

Structure (keep it tight — under 200 words total):
1. One opening line acknowledging the day (not generic — say something true about ${now.toLocaleDateString('en-US', { weekday: 'long' })}s)
2. What to focus on (1-2 priorities based on context below)
3. One thing to keep in mind today
4. One quick win to start with

${facts ? `Context about Topher:\n${facts}\n` : ''}

Be warm and direct. No corporate language. Sound like you've been in the room all morning.`;
}
