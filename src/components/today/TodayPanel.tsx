import { useEffect, useState } from 'react';
import { useStore } from '../../store';

const HENRY_OPERATING_MODE_KEY = 'henry_operating_mode';
const HENRY_LAST_GREETING_KEY = 'henry_last_greeting_date';

interface ModeCard {
  mode: string;
  icon: string;
  label: string;
  desc: string;
  border: string;
  glow: string;
}

const MODE_CARDS: ModeCard[] = [
  {
    mode: 'companion',
    icon: '💬',
    label: 'Chat',
    desc: 'Think out loud, ask anything, get unstuck',
    border: 'border-henry-accent/20 hover:border-henry-accent/50',
    glow: 'hover:shadow-henry-accent/10',
  },
  {
    mode: 'secretary',
    icon: '🗓️',
    label: 'Secretary',
    desc: 'Email, scheduling, task triage, briefings',
    border: 'border-violet-500/20 hover:border-violet-400/50',
    glow: 'hover:shadow-violet-500/10',
  },
  {
    mode: 'writer',
    icon: '✍️',
    label: 'Writing',
    desc: 'Draft, edit, shape anything worth keeping',
    border: 'border-emerald-500/20 hover:border-emerald-400/50',
    glow: 'hover:shadow-emerald-500/10',
  },
  {
    mode: 'developer',
    icon: '⚡',
    label: 'Code',
    desc: 'Debug, build, review — working code only',
    border: 'border-amber-500/20 hover:border-amber-400/50',
    glow: 'hover:shadow-amber-500/10',
  },
  {
    mode: 'design3d',
    icon: '🖨️',
    label: '3D / Design',
    desc: 'Spatial layouts, 3D printing, photo-to-3D',
    border: 'border-rose-500/20 hover:border-rose-400/50',
    glow: 'hover:shadow-rose-500/10',
  },
  {
    mode: 'biblical',
    icon: '📖',
    label: 'Bible Study',
    desc: 'Scripture-first, Ethiopian Orthodox aware',
    border: 'border-sky-500/20 hover:border-sky-400/50',
    glow: 'hover:shadow-sky-500/10',
  },
  {
    mode: 'computer',
    icon: '🖥️',
    label: 'Computer',
    desc: 'Run commands, control apps, automate tasks',
    border: 'border-cyan-500/20 hover:border-cyan-400/50',
    glow: 'hover:shadow-cyan-500/10',
  },
];

function getGreeting(): { line1: string; line2: string } {
  const h = new Date().getHours();
  if (h < 5) return { line1: "Still at it.", line2: "What needs doing?" };
  if (h < 12) return { line1: "Good morning.", line2: "Let's see what today looks like." };
  if (h < 17) return { line1: "Good afternoon.", line2: "What's on your mind?" };
  if (h < 21) return { line1: "Good evening.", line2: "What still needs handling?" };
  return { line1: "Late night.", line2: "I'm here." };
}

function getTodayLabel(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function getTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export default function TodayPanel() {
  const { setCurrentView, conversations, messages: _msgs } = useStore();
  const [isNewDay, setIsNewDay] = useState(false);
  const greeting = getGreeting();

  useEffect(() => {
    const last = localStorage.getItem(HENRY_LAST_GREETING_KEY);
    const today = getTodayKey();
    if (last !== today) {
      setIsNewDay(true);
      localStorage.setItem(HENRY_LAST_GREETING_KEY, today);
    }
  }, []);

  function launchMode(mode: string, prompt?: string) {
    try {
      localStorage.setItem(HENRY_OPERATING_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
    if (prompt) {
      window.dispatchEvent(
        new CustomEvent('henry_secretary_prompt', { detail: { prompt } })
      );
    } else {
      window.dispatchEvent(
        new CustomEvent('henry_secretary_prompt', { detail: { prompt: '' } })
      );
    }
    setCurrentView('chat');
  }

  function openMorningBriefing() {
    launchMode(
      'secretary',
      `Give me my morning briefing for ${getTodayLabel()}. I'll share context — for now, start with a warm-up: what kind of day is ${new Date().toLocaleDateString('en-US', { weekday: 'long' })} usually good for, and what should I keep in mind to make it count?`
    );
  }

  const recentConvos = conversations.slice(0, 5);

  return (
    <div className="h-full flex flex-col bg-henry-bg overflow-hidden">
      {/* Hero greeting */}
      <div className="shrink-0 px-8 pt-10 pb-6">
        <div className="max-w-3xl">
          <p className="text-xs text-henry-text-muted mb-1 font-medium tracking-wide uppercase">
            {getTodayLabel()}
          </p>
          <h1 className="text-2xl font-semibold text-henry-text mb-1">
            {greeting.line1}
          </h1>
          <p className="text-henry-text-dim text-base">{greeting.line2}</p>

          {isNewDay && (
            <button
              onClick={openMorningBriefing}
              className="mt-4 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-henry-accent/10 text-henry-accent text-sm font-medium hover:bg-henry-accent/20 transition-colors border border-henry-accent/20"
            >
              <span>🌅</span>
              Morning briefing
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <div className="max-w-3xl space-y-8">

          {/* Mode launcher */}
          <div>
            <p className="text-[11px] font-medium text-henry-text-muted uppercase tracking-wider mb-3">
              Start a conversation
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              {MODE_CARDS.map((card) => (
                <button
                  key={card.mode}
                  onClick={() => launchMode(card.mode)}
                  className={`group text-left p-4 rounded-xl border bg-henry-surface/30 ${card.border} hover:bg-henry-surface/60 hover:shadow-lg ${card.glow} transition-all duration-150`}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-lg leading-none mt-0.5">{card.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-henry-text">{card.label}</div>
                      <div className="text-xs text-henry-text-dim mt-0.5 leading-relaxed">
                        {card.desc}
                      </div>
                    </div>
                    <svg
                      className="ml-auto w-3.5 h-3.5 text-henry-text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5"
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
          </div>

          {/* Recent conversations */}
          {recentConvos.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-henry-text-muted uppercase tracking-wider mb-3">
                Recent conversations
              </p>
              <div className="space-y-1.5">
                {recentConvos.map((convo) => (
                  <button
                    key={convo.id}
                    onClick={() => {
                      useStore.getState().setActiveConversation(convo.id);
                      window.henryAPI.getMessages(convo.id).then((msgs) => {
                        useStore.getState().setMessages(msgs);
                      }).catch(() => {});
                      setCurrentView('chat');
                    }}
                    className="w-full text-left flex items-center gap-3 px-4 py-2.5 rounded-xl border border-henry-border/20 bg-henry-surface/20 hover:bg-henry-surface/50 hover:border-henry-border/40 transition-all group"
                  >
                    <span className="text-base">💬</span>
                    <span className="flex-1 text-sm text-henry-text-dim truncate group-hover:text-henry-text transition-colors">
                      {convo.title || 'New Chat'}
                    </span>
                    <svg
                      className="w-3.5 h-3.5 text-henry-text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quick asks */}
          <div>
            <p className="text-[11px] font-medium text-henry-text-muted uppercase tracking-wider mb-3">
              Quick asks
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { label: "What should I focus on today?", mode: 'companion' },
                { label: "Draft a quick email", mode: 'secretary' },
                { label: "Review my tasks", mode: 'secretary' },
                { label: "I need to write something", mode: 'writer' },
                { label: "Help me debug this", mode: 'developer' },
                { label: "Plan a 3D print", mode: 'design3d' },
              ].map(({ label, mode }) => (
                <button
                  key={label}
                  onClick={() => launchMode(mode, label)}
                  className="text-xs px-3 py-1.5 rounded-full border border-henry-border/30 bg-henry-surface/30 text-henry-text-dim hover:text-henry-text hover:border-henry-border/60 hover:bg-henry-surface/60 transition-all"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
