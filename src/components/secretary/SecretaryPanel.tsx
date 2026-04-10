import { useStore } from '../../store';

const TODAY = new Date();
const DAY_LABEL = TODAY.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

interface QuickAction {
  icon: string;
  title: string;
  description: string;
  prompt: string;
  color: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    icon: '🌅',
    title: 'Daily Briefing',
    description: "What's on my plate today",
    prompt: `Give me my daily briefing for ${DAY_LABEL}. I'll share what's on my calendar and task list — organize it into: Schedule, Priority Tasks, Replies Needed, and Heads Up.`,
    color: 'from-amber-500/10 to-orange-500/5 border-amber-500/20 hover:border-amber-400/40',
  },
  {
    icon: '✉️',
    title: 'Draft an Email',
    description: 'BLUF-style, ready to send',
    prompt: "I need to draft an email. I'll tell you who it's to and what I need to say — write it using BLUF format, concise and ready to send.",
    color: 'from-blue-500/10 to-sky-500/5 border-blue-500/20 hover:border-blue-400/40',
  },
  {
    icon: '📅',
    title: 'Schedule Something',
    description: 'Find a time, draft an invite',
    prompt: "Help me schedule a meeting. I'll tell you who it's with and roughly what it's for — suggest 2–3 time slots, draft the invite, and flag any timezone or timing considerations.",
    color: 'from-violet-500/10 to-purple-500/5 border-violet-500/20 hover:border-violet-400/40',
  },
  {
    icon: '📋',
    title: 'Review My Tasks',
    description: 'Prioritize and clear the list',
    prompt: "Let's review my tasks. I'll share what's on my list — sort them by urgency and importance, flag what I should do today vs. defer, and identify anything I should delegate or drop.",
    color: 'from-emerald-500/10 to-teal-500/5 border-emerald-500/20 hover:border-emerald-400/40',
  },
  {
    icon: '🤝',
    title: 'Meeting Prep',
    description: 'Quick brief before you walk in',
    prompt: "Prep me for a meeting. I'll give you the details — attendees, topic, what I need to accomplish — and you'll give me a concise brief: what to know, what to ask, and what outcome I'm driving toward.",
    color: 'from-rose-500/10 to-pink-500/5 border-rose-500/20 hover:border-rose-400/40',
  },
  {
    icon: '📡',
    title: 'Follow-Up Nudge',
    description: "Who haven't I heard back from",
    prompt: "Help me draft a follow-up message. I'll tell you who I'm waiting on, what I asked for, and how long it's been — write a nudge that's direct but not pushy, calibrated to the timeline.",
    color: 'from-cyan-500/10 to-sky-500/5 border-cyan-500/20 hover:border-cyan-400/40',
  },
];

function getGreeting(): string {
  const hour = TODAY.getHours();
  if (hour < 12) return 'Good morning.';
  if (hour < 17) return 'Good afternoon.';
  return 'Good evening.';
}

export default function SecretaryPanel() {
  const { setCurrentView } = useStore();

  function launchAction(action: QuickAction) {
    try {
      localStorage.setItem('henry_operating_mode', 'secretary');
    } catch {
      /* ignore */
    }
    window.dispatchEvent(
      new CustomEvent('henry_secretary_prompt', {
        detail: { prompt: action.prompt },
      })
    );
    setCurrentView('chat');
  }

  function openSecretaryChat() {
    try {
      localStorage.setItem('henry_operating_mode', 'secretary');
    } catch {
      /* ignore */
    }
    window.dispatchEvent(
      new CustomEvent('henry_secretary_prompt', { detail: { prompt: '' } })
    );
    setCurrentView('chat');
  }

  return (
    <div className="h-full flex flex-col bg-henry-bg overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-8 pt-8 pb-6 border-b border-henry-border/30">
        <div className="max-w-3xl">
          <div className="flex items-center gap-3 mb-1">
            <span className="text-2xl">🗓️</span>
            <h1 className="text-lg font-semibold text-henry-text">Secretary</h1>
          </div>
          <p className="text-henry-text-dim text-sm leading-relaxed">
            {getGreeting()} {DAY_LABEL}. What needs handling?
          </p>
        </div>
      </div>

      {/* Quick actions grid */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="max-w-3xl">
          <p className="text-[11px] font-medium text-henry-text-muted uppercase tracking-wider mb-4">
            Quick actions
          </p>

          <div className="grid grid-cols-2 gap-3 mb-8">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.title}
                onClick={() => launchAction(action)}
                className={`group text-left p-4 rounded-xl border bg-gradient-to-br ${action.color} transition-all duration-150 hover:shadow-lg hover:shadow-black/10`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-xl leading-none mt-0.5">{action.icon}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-henry-text group-hover:text-white transition-colors">
                      {action.title}
                    </div>
                    <div className="text-xs text-henry-text-dim mt-0.5 leading-relaxed">
                      {action.description}
                    </div>
                  </div>
                  <svg
                    className="ml-auto w-3.5 h-3.5 text-henry-text-muted group-hover:text-henry-accent transition-colors shrink-0 mt-0.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            ))}
          </div>

          {/* Open-ended secretary chat */}
          <div className="border border-henry-border/30 rounded-xl p-5 bg-henry-surface/30">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-henry-text mb-0.5">Open secretary chat</p>
                <p className="text-xs text-henry-text-dim">
                  Tell Henry exactly what you need — he'll handle it.
                </p>
              </div>
              <button
                onClick={openSecretaryChat}
                className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg bg-henry-accent/10 text-henry-accent text-xs font-medium hover:bg-henry-accent/20 transition-colors border border-henry-accent/20"
              >
                Start
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>

          {/* What Henry can handle */}
          <div className="mt-6">
            <p className="text-[11px] font-medium text-henry-text-muted uppercase tracking-wider mb-3">
              What Henry handles in secretary mode
            </p>
            <div className="grid grid-cols-3 gap-2">
              {[
                'Email drafts (BLUF)',
                'Calendar scheduling',
                'Meeting agendas',
                'Task triage',
                'Follow-up messages',
                'Pre-meeting briefs',
                'Weekly planning',
                'Delegate + track',
                'Daily briefings',
              ].map((cap) => (
                <div
                  key={cap}
                  className="text-xs text-henry-text-dim px-3 py-1.5 rounded-lg bg-henry-surface/30 border border-henry-border/20"
                >
                  {cap}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
