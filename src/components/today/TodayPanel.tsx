import { useEffect, useState, useRef } from 'react';
import { useStore } from '../../store';
import { getTodayBriefing, getTodayKey, saveBriefing, setGenerating, isGenerating, buildBriefingPrompt } from '../../henry/proactiveBriefing';
import { getDueMacros, markMacroRun } from '../../henry/recurringMacros';
import { loadProjects, type HenryProject } from '../../henry/richMemory';
import type { DailyBriefing } from '../../henry/proactiveBriefing';

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
  { mode: 'companion', icon: '💬', label: 'Chat', desc: 'Think out loud, ask anything, get unstuck', border: 'border-henry-accent/20 hover:border-henry-accent/50', glow: 'hover:shadow-henry-accent/10' },
  { mode: 'builder', icon: '🌐', label: 'App Builder', desc: 'Describe an app or site — Henry builds it live', border: 'border-indigo-500/20 hover:border-indigo-400/50', glow: 'hover:shadow-indigo-500/10' },
  { mode: 'secretary', icon: '🗓️', label: 'Secretary', desc: 'Email, scheduling, task triage, briefings', border: 'border-violet-500/20 hover:border-violet-400/50', glow: 'hover:shadow-violet-500/10' },
  { mode: 'writer', icon: '✍️', label: 'Writing', desc: 'Draft, edit, shape anything worth keeping', border: 'border-emerald-500/20 hover:border-emerald-400/50', glow: 'hover:shadow-emerald-500/10' },
  { mode: 'developer', icon: '⚡', label: 'Code', desc: 'Debug, build, review — working code only', border: 'border-amber-500/20 hover:border-amber-400/50', glow: 'hover:shadow-amber-500/10' },
  { mode: 'design3d', icon: '🖨️', label: '3D / Design', desc: 'Spatial layouts, 3D printing, photo-to-3D', border: 'border-rose-500/20 hover:border-rose-400/50', glow: 'hover:shadow-rose-500/10' },
  { mode: 'biblical', icon: '📖', label: 'Bible Study', desc: 'Scripture-first, Ethiopian Orthodox aware', border: 'border-sky-500/20 hover:border-sky-400/50', glow: 'hover:shadow-sky-500/10' },
  { mode: 'computer', icon: '🖥️', label: 'Computer', desc: 'Run commands, control apps, automate tasks', border: 'border-cyan-500/20 hover:border-cyan-400/50', glow: 'hover:shadow-cyan-500/10' },
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
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export default function TodayPanel() {
  const { setCurrentView, conversations, settings } = useStore();
  const [isNewDay, setIsNewDay] = useState(false);
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [generatingBriefing, setGeneratingBriefing] = useState(false);
  const [briefingExpanded, setBriefingExpanded] = useState(true);
  const [dueMacros, setDueMacros] = useState<ReturnType<typeof getDueMacros>>([]);
  const [activeProjects, setActiveProjects] = useState<HenryProject[]>([]);
  const [quickAsk, setQuickAsk] = useState('');
  const quickAskRef = useRef<HTMLInputElement>(null);
  const greeting = getGreeting();
  const briefingStreamRef = useRef<any>(null);

  useEffect(() => {
    const last = localStorage.getItem(HENRY_LAST_GREETING_KEY);
    const today = getTodayKey();
    const isNew = last !== today;
    if (isNew) {
      setIsNewDay(true);
      localStorage.setItem(HENRY_LAST_GREETING_KEY, today);
    }

    // Load existing briefing
    const existing = getTodayBriefing();
    if (existing) {
      setBriefing(existing);
    } else if (isNew) {
      // Auto-generate briefing on new day if model configured
      setTimeout(() => tryGenerateBriefing(), 1500);
    }

    // Check due macros
    setDueMacros(getDueMacros());

    // Load active projects for the sidebar
    setActiveProjects(loadProjects().filter((p) => p.status === 'active').slice(0, 3));

    return () => {
      // Cancel any in-flight briefing stream so it doesn't update dead state
      if (briefingStreamRef.current?.cancel) {
        briefingStreamRef.current.cancel();
      }
    };
  }, []);

  async function tryGenerateBriefing() {
    if (generatingBriefing || isGenerating()) return;
    const s = useStore.getState().settings;
    if (!s.companion_model || !s.companion_provider) return;

    setGeneratingBriefing(true);
    setGenerating(true);

    try {
      const providers = await window.henryAPI.getProviders();
      const provider = providers.find((p: any) => p.id === s.companion_provider);
      if (!provider) return;

      let facts = '';
      try {
        const allFacts = await window.henryAPI.getAllFacts(20);
        facts = allFacts.slice(0, 10).map((f: any) => f.fact).join('\n');
      } catch { /* no facts */ }

      const prompt = buildBriefingPrompt(facts);
      let full = '';

      const stream = window.henryAPI.streamMessage({
        provider: s.companion_provider,
        model: s.companion_model,
        apiKey: provider.api_key || provider.apiKey || '',
        messages: [
          { role: 'system', content: 'You are Henry. Generate a concise, warm morning briefing. No greetings like "Good morning Topher" — start with the substance. Under 200 words. Use simple formatting.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
      });

      briefingStreamRef.current = stream;

      stream.onChunk((chunk: string) => {
        full += chunk;
        setBriefing({ date: getTodayKey(), content: full, generatedAt: new Date().toISOString() });
      });
      stream.onDone((fullText: string) => {
        const saved = saveBriefing(fullText, s.companion_model);
        setBriefing(saved);
        setGeneratingBriefing(false);
        setGenerating(false);
      });
      stream.onError(() => {
        setGeneratingBriefing(false);
        setGenerating(false);
      });
    } catch {
      setGeneratingBriefing(false);
      setGenerating(false);
    }
  }

  function launchMode(mode: string, prompt?: string) {
    try { localStorage.setItem(HENRY_OPERATING_MODE_KEY, mode); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('henry_mode_launch', { detail: { mode, prompt: prompt || '' } }));
    setCurrentView('chat');
  }

  function runMacro(macro: { id: string; prompt: string; mode: string; name: string }) {
    markMacroRun(macro.id);
    setDueMacros((prev) => prev.filter((m) => m.id !== macro.id));
    launchMode(macro.mode, macro.prompt);
  }

  const recentConvos = conversations.slice(0, 5);

  return (
    <div className="h-full flex flex-col bg-henry-bg overflow-hidden">
      {/* Hero greeting */}
      <div className="shrink-0 px-8 pt-10 pb-4">
        <div className="max-w-3xl">
          <p className="text-xs text-henry-text-muted mb-1 font-medium tracking-wide uppercase">
            {getTodayLabel()}
          </p>
          <h1 className="text-2xl font-semibold text-henry-text mb-1">{greeting.line1}</h1>
          <p className="text-henry-text-dim text-base mb-5">{greeting.line2}</p>

          {/* Quick-ask input */}
          <div className="relative">
            <input
              ref={quickAskRef}
              type="text"
              value={quickAsk}
              onChange={(e) => setQuickAsk(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && quickAsk.trim()) {
                  launchMode('companion', quickAsk.trim());
                  setQuickAsk('');
                }
              }}
              placeholder="Ask Henry anything…"
              className="w-full bg-henry-surface/60 border border-henry-border/40 rounded-xl px-4 py-3.5 pr-12 text-sm text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/60 focus:bg-henry-surface/80 focus:shadow-[0_0_0_3px_rgba(107,92,246,0.12)] transition-all"
            />
            <button
              onClick={() => {
                if (quickAsk.trim()) {
                  launchMode('companion', quickAsk.trim());
                  setQuickAsk('');
                }
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-lg bg-henry-accent/20 text-henry-accent hover:bg-henry-accent/35 transition-colors disabled:opacity-30"
              disabled={!quickAsk.trim()}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <div className="max-w-3xl space-y-8">

          {/* Proactive Briefing */}
          {(briefing || generatingBriefing || isNewDay) && (
            <div className="rounded-xl border border-henry-accent/20 bg-henry-accent/5 overflow-hidden">
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-henry-accent/5 transition-colors"
                onClick={() => setBriefingExpanded((v) => !v)}
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-base">🌅</span>
                  <div>
                    <span className="text-sm font-medium text-henry-text">Morning Briefing</span>
                    {briefing && (
                      <span className="ml-2 text-[10px] text-henry-text-muted">
                        {new Date(briefing.generatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                    {generatingBriefing && (
                      <span className="ml-2 text-[10px] text-henry-accent animate-pulse">generating...</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!briefing && !generatingBriefing && (
                    <button
                      onClick={(e) => { e.stopPropagation(); tryGenerateBriefing(); }}
                      className="text-[11px] px-3 py-1 rounded-lg bg-henry-accent/20 text-henry-accent hover:bg-henry-accent/30 transition-all"
                    >
                      Generate
                    </button>
                  )}
                  {briefing && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setBriefing(null); tryGenerateBriefing(); }}
                      disabled={generatingBriefing}
                      className="text-[10px] text-henry-text-muted hover:text-henry-text transition-colors disabled:opacity-40"
                      title="Regenerate briefing"
                    >
                      ↺
                    </button>
                  )}
                  <svg
                    className={`w-3.5 h-3.5 text-henry-text-muted transition-transform ${briefingExpanded ? 'rotate-180' : ''}`}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </div>
              </div>

              {briefingExpanded && briefing && (
                <div className="px-5 pb-4 border-t border-henry-accent/10">
                  <p className="text-sm text-henry-text-dim leading-relaxed whitespace-pre-wrap pt-3">
                    {briefing.content}
                    {generatingBriefing && (
                      <span className="inline-block w-[2px] h-[14px] bg-henry-accent ml-0.5 animate-pulse align-middle" />
                    )}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => launchMode('secretary', 'Continue my morning briefing. What are my top priorities for today and what should I tackle first?')}
                      className="text-[11px] px-3 py-1.5 rounded-lg bg-henry-surface border border-henry-border/30 text-henry-text-dim hover:text-henry-text hover:border-henry-border/60 transition-all"
                    >
                      Continue in chat →
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Due Macros */}
          {dueMacros.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-henry-text-muted uppercase tracking-wider mb-3">
                Scheduled tasks ready
              </p>
              <div className="space-y-2">
                {dueMacros.map((macro) => (
                  <div key={macro.id} className="flex items-center justify-between px-4 py-3 rounded-xl border border-henry-border/20 bg-henry-surface/20">
                    <div>
                      <p className="text-sm font-medium text-henry-text">{macro.name}</p>
                      <p className="text-xs text-henry-text-muted">{macro.description}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => runMacro(macro)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-henry-accent/15 text-henry-accent hover:bg-henry-accent/25 transition-all border border-henry-accent/20"
                      >
                        Run now
                      </button>
                      <button
                        onClick={() => { markMacroRun(macro.id); setDueMacros((p) => p.filter((m) => m.id !== macro.id)); }}
                        className="text-xs px-3 py-1.5 rounded-lg bg-henry-surface text-henry-text-muted hover:text-henry-text transition-all border border-henry-border/30"
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active Projects */}
          {activeProjects.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-medium text-henry-text-muted uppercase tracking-wider">
                  In progress
                </p>
                <button
                  onClick={() => useStore.getState().setCurrentView('settings')}
                  className="text-[10px] text-henry-text-muted hover:text-henry-accent transition-colors"
                >
                  Manage →
                </button>
              </div>
              <div className="space-y-2">
                {activeProjects.map((p) => (
                  <div key={p.id} className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-henry-surface/30 border border-henry-border/20">
                    <div className="w-1.5 h-1.5 rounded-full bg-henry-success mt-1.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-henry-text truncate">{p.name}</p>
                      {p.nextStep && (
                        <p className="text-[11px] text-henry-text-muted truncate">→ {p.nextStep}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
                      <div className="text-xs text-henry-text-dim mt-0.5 leading-relaxed">{card.desc}</div>
                    </div>
                    <svg className="ml-auto w-3.5 h-3.5 text-henry-text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
                    <svg className="w-3.5 h-3.5 text-henry-text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
                { label: "Build me a landing page", mode: 'builder' },
                { label: "Draft a quick email", mode: 'secretary' },
                { label: "I need to write something", mode: 'writer' },
                { label: "Help me debug this", mode: 'developer' },
                { label: "Build a dashboard app", mode: 'builder' },
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
