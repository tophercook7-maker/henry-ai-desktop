import { useEffect, useState, useRef } from 'react';
import { useStore } from '../../store';
import { getDailyCost } from '../../henry/gateway';
import { getTodayBriefing, getTodayKey, saveBriefing, setGenerating, isGenerating, buildBriefingPrompt } from '../../henry/proactiveBriefing';
import type { DailyBriefing } from '../../henry/proactiveBriefing';
import { getDailyIntention, setDailyIntention, clearDailyIntention } from '../../henry/dailyIntention';
import { PANEL_QUICK_ASK } from '../../henry/henryQuickAsk';

const HENRY_LAST_GREETING_KEY = 'henry:last_greeting_date';
const HENRY_OPERATING_MODE_KEY = 'henry_operating_mode';

function getGreeting(): { line1: string; line2: string } {
  const h = new Date().getHours();
  const name = localStorage.getItem('henry:owner_name')?.trim() || '';
  const n = name ? `, ${name}` : '';
  if (h < 12) return { line1: `Good morning${n}.`, line2: "Let's see what today looks like." };
  if (h < 17) return { line1: `Good afternoon${n}.`, line2: "How's the day going?" };
  return { line1: `Good evening${n}.`, line2: "Wrapping things up?" };
}

export default function TodayPanel() {
  const { setCurrentView } = useStore();
  const [quickAsk, setQuickAsk] = useState('');
  const [intention, setIntentionState] = useState(() => getDailyIntention()?.text ?? '');
  const [intentionDraft, setIntentionDraft] = useState(() => getDailyIntention()?.text ?? '');
  const [briefing, setBriefing] = useState<DailyBriefing | null>(() => getTodayBriefing());
  const [generatingBriefing, setGeneratingBriefing] = useState(false);
  const [briefingExpanded, setBriefingExpanded] = useState(true);
  const [dailyCost] = useState(() => getDailyCost());
  const [henryReply, setHenryReply] = useState('');
  const [henryStreaming, setHenryStreaming] = useState(false);
  const [lastQuestion, setLastQuestion] = useState('');
  const quickAskRef = useRef<HTMLInputElement>(null);
  const briefingStreamRef = useRef<any>(null);
  const replyStreamRef = useRef<any>(null);
  const greeting = getGreeting();

  useEffect(() => {
    const last = localStorage.getItem(HENRY_LAST_GREETING_KEY);
    const today = getTodayKey();
    if (last !== today) {
      localStorage.setItem(HENRY_LAST_GREETING_KEY, today);
      if (!isGenerating()) tryGenerateBriefing();
    }
  }, []);

  async function tryGenerateBriefing() {
    if (generatingBriefing || isGenerating()) return;
    const existing = getTodayBriefing();
    if (existing) { setBriefing(existing); return; }
    setGeneratingBriefing(true);
    setGenerating(true);
    try {
      const s = useStore.getState().settings;
      const providers = useStore.getState().providers;
      const provider = s.companion_provider || localStorage.getItem('henry:settings') && JSON.parse(localStorage.getItem('henry:settings')!).companion_provider;
      const model = s.companion_model;
      const prov = providers.find((p) => p.id === provider);
      const apiKey = prov?.apiKey || '';
      if (!provider || !model || !apiKey) return;
      const facts = (() => {
        try {
          const f = JSON.parse(localStorage.getItem('henry:facts') || '[]') as any[];
          return f.slice(0, 20).map((x: any) => x.content || x.fact || '').filter(Boolean).join(', ');
        } catch { return ''; }
      })();
      const prompt = buildBriefingPrompt(facts);
      let full = '';
      const stream = window.henryAPI.streamMessage({ provider, model, apiKey, messages: [{ role: 'user', content: prompt }], temperature: 0.7 });
      briefingStreamRef.current = stream;
      stream.onChunk((c: string) => { full += c; });
      stream.onDone(() => {
        const b = saveBriefing(full);
        setBriefing(b);
        setGeneratingBriefing(false);
        setGenerating(false);
      });
      stream.onError(() => { setGeneratingBriefing(false); setGenerating(false); });
    } catch { setGeneratingBriefing(false); setGenerating(false); }
  }

  async function askHenryInline(text: string) {
    if (!text.trim() || henryStreaming) return;
    setLastQuestion(text);
    setHenryReply('');
    setHenryStreaming(true);

    try {
      const s = useStore.getState().settings;
      const providers = useStore.getState().providers;
      const provider = s.companion_provider || 'groq';
      const model = s.companion_model || 'llama-3.3-70b-versatile';
      const prov = providers.find((p) => p.id === provider);
      const apiKey = prov?.apiKey || '';
      if (!apiKey) {
        setHenryReply('No API key found. Add one in Settings.');
        setHenryStreaming(false);
        return;
      }

      const stream = window.henryAPI.streamMessage({
        provider, model, apiKey,
        messages: [{ role: 'user', content: text }],
        temperature: 0.7,
        maxTokens: 1500,
      });
      replyStreamRef.current = stream;

      let full = '';
      stream.onChunk((c: string) => {
        full += c;
        setHenryReply(full);
      });
      stream.onDone(() => { setHenryStreaming(false); });
      stream.onError((e: string) => {
        setHenryReply('Something went wrong: ' + e);
        setHenryStreaming(false);
      });
    } catch (e) {
      setHenryReply('Error: ' + String(e));
      setHenryStreaming(false);
    }
  }

  function goToChat(text?: string) {
    if (text) {
      try { localStorage.setItem('henry:pending_inject', text); } catch { /* ignore */ }
    }
    setCurrentView('chat');
    if (text) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('henry_inject_draft', { detail: { text } }));
      }, 150);
    }
  }

  function launchMode(mode: string, prompt?: string) {
    try { localStorage.setItem(HENRY_OPERATING_MODE_KEY, mode); } catch { /* ignore */ }
    if (prompt && prompt.trim()) {
      try { localStorage.setItem('henry:pending_inject', prompt.trim()); } catch { /* ignore */ }
    }
    setCurrentView('chat');
    if (prompt && prompt.trim()) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('henry_mode_launch', { detail: { mode, prompt: prompt.trim() } }));
        window.dispatchEvent(new CustomEvent('henry_inject_draft', { detail: { text: prompt.trim() } }));
      }, 150);
    } else {
      window.dispatchEvent(new CustomEvent('henry_mode_launch', { detail: { mode, prompt: '' } }));
    }
  }

  return (
    <div className="h-full flex flex-col bg-henry-bg overflow-y-auto">
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-8 max-w-2xl mx-auto w-full">

        {/* Greeting */}
        <div className="w-full mb-8 text-center">
          <h1 className="text-3xl font-semibold text-henry-text tracking-tight mb-1">{greeting.line1}</h1>
          <p className="text-henry-text-muted text-base">{greeting.line2}</p>
        </div>

        {/* Main ask input */}
        <div className="w-full mb-6">
          <div className="relative">
            <input
              ref={quickAskRef}
              type="text"
              value={quickAsk}
              onChange={(e) => setQuickAsk(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && quickAsk.trim()) {
                  const q = quickAsk.trim();
                  setQuickAsk('');
                  askHenryInline(q);
                }
              }}
              placeholder="Ask Henry anything…"
              className="w-full bg-henry-surface/60 border border-henry-border/40 rounded-2xl px-5 py-4 text-base text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/50 focus:bg-henry-surface/80 transition-all"
              autoComplete="off"
            />
            {quickAsk.trim() && (
              <button
                onClick={() => { const q = quickAsk.trim(); setQuickAsk(''); askHenryInline(q); }}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-xl bg-henry-accent text-henry-bg hover:bg-henry-accent/90 transition-colors"
              >↑</button>
            )}
          </div>
        </div>

        {/* Henry's inline reply — no navigation needed */}
        {(henryReply || henryStreaming) && (
          <div className="w-full mb-6">
            {lastQuestion && (
              <p className="text-[11px] text-henry-text-muted mb-2 italic">"{lastQuestion}"</p>
            )}
            <div className="rounded-2xl bg-henry-surface/40 border border-henry-border/25 px-5 py-4">
              {henryReply ? (
                <p className="text-sm text-henry-text leading-relaxed whitespace-pre-wrap">{henryReply}</p>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 border-2 border-henry-accent/30 border-t-henry-accent rounded-full animate-spin" />
                  <p className="text-sm text-henry-text-muted">Henry is thinking…</p>
                </div>
              )}
              {henryReply && !henryStreaming && (
                <div className="flex gap-3 mt-3 pt-3 border-t border-henry-border/15">
                  <button
                    onClick={() => goToChat(henryReply ? `${lastQuestion}\n\n${henryReply}` : lastQuestion)}
                    className="text-[11px] text-henry-accent hover:underline"
                  >Continue in chat →</button>
                  <button
                    onClick={() => { setHenryReply(''); setLastQuestion(''); quickAskRef.current?.focus(); }}
                    className="text-[11px] text-henry-text-muted hover:text-henry-text"
                  >Clear</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Cost dashboard — shows today's AI spending vs GPT-4 */}
        {dailyCost.tokens > 0 && (
          <div className="w-full mb-4 px-4 py-3 rounded-xl bg-henry-surface/30 border border-henry-border/20">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[11px] font-medium text-henry-text-muted uppercase tracking-wide">Today's AI Cost</p>
              <p className="text-[11px] text-green-400 font-medium">
                Saved ${dailyCost.savedVsGpt4.toFixed(4)} vs GPT-4
              </p>
            </div>
            <div className="flex items-baseline gap-2">
              <p className="text-lg font-bold text-henry-text">
                ${dailyCost.costUsd < 0.0001 ? '< $0.0001' : `$${dailyCost.costUsd.toFixed(4)}`}
              </p>
              <p className="text-[11px] text-henry-text-muted">{dailyCost.tokens.toLocaleString()} tokens · {dailyCost.topModel.replace('llama-','').replace('-versatile','').replace('-instant','')}</p>
            </div>
          </div>
        )}

        {/* Quick chips — minimal, subtle */}
        <div className="w-full flex flex-wrap gap-2 mb-8 justify-center">
          {[
            { label: 'What to focus on?', fn: () => PANEL_QUICK_ASK.focus() },
            { label: 'Bible study', fn: () => PANEL_QUICK_ASK.bible() },
            { label: 'Catch me up', fn: () => PANEL_QUICK_ASK.today() },
            { label: 'Finance check', fn: () => PANEL_QUICK_ASK.finance() },
          ].map(chip => (
            <button
              key={chip.label}
              onClick={chip.fn}
              className="text-[12px] px-4 py-2 rounded-full border border-henry-border/25 text-henry-text-muted hover:text-henry-text hover:border-henry-accent/30 hover:bg-henry-accent/5 transition-all"
            >{chip.label}</button>
          ))}
        </div>

        {/* Intention — only if set, subtle */}
        {intention && (
          <div className="w-full mb-6 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-henry-accent/5 border border-henry-accent/15">
            <span className="text-henry-accent text-sm">🎯</span>
            <p className="text-sm text-henry-text-muted flex-1 italic">"{intention}"</p>
            <button onClick={() => { clearDailyIntention(); setIntentionState(''); setIntentionDraft(''); }} className="text-henry-text-muted hover:text-henry-text text-xs transition-colors">✕</button>
          </div>
        )}

        {/* Set intention — only shown when not set */}
        {!intention && (
          <div className="w-full mb-6">
            <div className="flex gap-2">
              <input
                type="text"
                value={intentionDraft}
                onChange={(e) => setIntentionDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && intentionDraft.trim()) {
                    setDailyIntention(intentionDraft.trim());
                    setIntentionState(intentionDraft.trim());
                  }
                }}
                placeholder="Set today's intention…"
                className="flex-1 bg-transparent border border-henry-border/20 rounded-xl px-4 py-2.5 text-sm text-henry-text-muted placeholder-henry-text-muted/50 outline-none focus:border-henry-border/40 transition-all"
              />
              {intentionDraft.trim() && (
                <button
                  onClick={() => { setDailyIntention(intentionDraft.trim()); setIntentionState(intentionDraft.trim()); }}
                  className="px-4 py-2 rounded-xl bg-henry-surface border border-henry-border/30 text-henry-text-muted text-sm hover:text-henry-text transition-all"
                >Set</button>
              )}
            </div>
          </div>
        )}

        {/* Briefing — collapsed by default, expandable */}
        {(briefing || generatingBriefing) && (
          <div className="w-full rounded-xl border border-henry-border/20 bg-henry-surface/20 overflow-hidden">
            <button
              onClick={() => setBriefingExpanded(!briefingExpanded)}
              className="w-full flex items-center justify-between px-4 py-3 text-left"
            >
              <div className="flex items-center gap-2">
                <span className="text-base">📋</span>
                <span className="text-sm font-medium text-henry-text">Morning Briefing</span>
                {generatingBriefing && <span className="text-[10px] text-henry-text-muted animate-pulse">generating…</span>}
              </div>
              <div className="flex items-center gap-2">
                {briefing && (
                  <button
                    onClick={(e) => { e.stopPropagation(); localStorage.removeItem('henry:briefing:' + getTodayKey()); setBriefing(null); tryGenerateBriefing(); }}
                    className="text-henry-text-muted hover:text-henry-text text-xs px-2 py-0.5 rounded transition-colors"
                  >↺</button>
                )}
                <svg className={`w-4 h-4 text-henry-text-muted transition-transform ${briefingExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <polyline points="6,9 12,15 18,9" />
                </svg>
              </div>
            </button>
            {briefingExpanded && briefing && (
              <div className="px-4 pb-4 border-t border-henry-border/15">
                <p className="text-sm text-henry-text-dim leading-relaxed mt-3 whitespace-pre-wrap">{briefing.content}</p>
                <button
                  onClick={() => { setCurrentView('chat'); }}
                  className="mt-3 text-[11px] text-henry-accent hover:underline"
                >Continue in chat →</button>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
