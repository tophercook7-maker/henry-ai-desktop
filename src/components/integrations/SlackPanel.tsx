import { useState, useEffect } from 'react';
import {
  slackListChannels, slackGetHistory, slackPostMessage,
  type SlackChannel, type SlackMessage,
} from '../../henry/integrations';
import { useStore } from '../../store';
import { useConnectionStore, selectStatus } from '../../henry/connectionStore';
import ConnectScreen from './ConnectScreen';

function buildSlackPrompt(channel: SlackChannel, messages: SlackMessage[]): string {
  const recent = [...messages].reverse().slice(-30);
  const transcript = recent.map((m) => `${m.username || m.user || 'Unknown'}: ${m.text}`).join('\n');
  return [
    `I need you to summarize and surface what matters from my Slack channel #${channel.name}.`,
    ``,
    `Here are the most recent messages:`,
    `---`,
    transcript,
    `---`,
    `Give me:`,
    `1. A 2-sentence summary of what's being discussed`,
    `2. Any decisions made or action items I should be aware of`,
    `3. Anything that requires my response or attention`,
    `Keep it tight — I'm scanning, not reading.`,
  ].join('\n');
}

export default function SlackPanel() {
  const setCurrentView = useStore((s) => s.setCurrentView);
  const status = useConnectionStore(selectStatus('slack'));
  const { markExpired } = useConnectionStore();
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [selected, setSelected] = useState<SlackChannel | null>(null);
  const [messages, setMessages] = useState<SlackMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [channelSearch, setChannelSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (status === 'connected') loadChannels();
  }, [status]);

  useEffect(() => {
    if (selected) loadMessages(selected.id);
  }, [selected]);

  async function loadChannels() {
    setLoading(true);
    setError('');
    try {
      const ch = await slackListChannels();
      setChannels(ch);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadMessages(channelId: string) {
    setLoading(true);
    setError('');
    try {
      const msgs = await slackGetHistory(channelId, 30);
      setMessages(msgs);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage() {
    if (!selected || !draft.trim()) return;
    setSending(true);
    try {
      await slackPostMessage(selected.id, draft.trim());
      setDraft('');
      loadMessages(selected.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  if (status !== 'connected') return <ConnectScreen serviceId="slack" />;

  const filteredChannels = channels.filter((c) =>
    !channelSearch || c.name.toLowerCase().includes(channelSearch.toLowerCase())
  );

  function tsToTime(ts: string): string {
    const d = new Date(parseFloat(ts) * 1000);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div className="h-full flex bg-henry-bg overflow-hidden">
      {/* Channels sidebar */}
      <div className="w-56 shrink-0 border-r border-henry-border/30 flex flex-col">
        <div className="p-3 border-b border-henry-border/20">
          <h2 className="text-xs font-semibold text-henry-text mb-2 flex items-center gap-2">
            <span>💬</span> Slack
          </h2>
          <input
            value={channelSearch}
            onChange={(e) => setChannelSearch(e.target.value)}
            placeholder="Filter channels…"
            className="w-full bg-henry-surface/50 border border-henry-border/40 rounded-lg px-2.5 py-1.5 text-xs text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/50"
          />
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {loading && !selected && (
            <div className="flex justify-center py-6">
              <div className="w-5 h-5 rounded-full border-2 border-henry-accent/30 border-t-henry-accent animate-spin" />
            </div>
          )}
          {error && !selected && (
            <div className="px-3 py-2 mx-2 mt-2 bg-henry-error/10 border border-henry-error/30 rounded-xl text-xs text-henry-error">
              {error}
              <button onClick={() => markExpired('slack')} className="block mt-1 text-henry-accent underline">Reconnect</button>
            </div>
          )}
          {filteredChannels.map((ch) => (
            <button
              key={ch.id}
              onClick={() => setSelected(ch)}
              className={`w-full text-left flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                selected?.id === ch.id
                  ? 'bg-henry-accent/10 text-henry-accent'
                  : 'text-henry-text-dim hover:bg-henry-hover/50 hover:text-henry-text'
              }`}
            >
              <span className="text-sm">#</span>
              <span className="flex-1 truncate">{ch.name}</span>
              {ch.num_members > 0 && (
                <span className="text-[10px] text-henry-text-muted">{ch.num_members}</span>
              )}
            </button>
          ))}
          {!loading && filteredChannels.length === 0 && !error && (
            <p className="text-xs text-henry-text-muted text-center py-6">No channels found.</p>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-henry-text-muted text-sm">
            Select a channel to view messages.
          </div>
        ) : (
          <>
            <div className="shrink-0 px-4 py-3 border-b border-henry-border/30 flex items-center gap-2">
              <span className="text-sm text-henry-text-muted">#</span>
              <h2 className="text-sm font-semibold text-henry-text">{selected.name}</h2>
              {messages.length > 0 && (
                <button
                  onClick={() => {
                    const prompt = buildSlackPrompt(selected, messages);
                    window.dispatchEvent(new CustomEvent('henry_mode_launch', { detail: { mode: 'secretary', prompt } }));
                    setCurrentView('chat');
                  }}
                  className="ml-auto mr-1 px-3 py-1 text-[11px] font-medium bg-henry-accent/10 text-henry-accent border border-henry-accent/20 rounded-lg hover:bg-henry-accent/20 transition-colors"
                >
                  Ask Henry
                </button>
              )}
              <button
                onClick={() => loadMessages(selected.id)}
                className={`${messages.length > 0 ? '' : 'ml-auto'} p-1.5 rounded-lg text-henry-text-muted hover:text-henry-text hover:bg-henry-hover/50 transition-colors`}
                title="Refresh"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {loading && (
                <div className="flex justify-center py-6">
                  <div className="w-5 h-5 rounded-full border-2 border-henry-accent/30 border-t-henry-accent animate-spin" />
                </div>
              )}
              {!loading && error && (
                <div className="px-3 py-2 bg-henry-error/10 border border-henry-error/30 rounded-xl text-xs text-henry-error">
                  {error}
                </div>
              )}
              {!loading && messages.length === 0 && (
                <div className="text-center text-henry-text-muted text-sm py-8">No messages found.</div>
              )}
              {!loading && [...messages].reverse().map((msg) => (
                <div key={msg.ts} className="flex gap-3 items-start">
                  <div className="w-7 h-7 rounded-full bg-henry-surface/50 flex items-center justify-center text-xs shrink-0 font-semibold text-henry-text-dim">
                    {(msg.username || msg.user || '?')[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-semibold text-henry-text">{msg.username || msg.user}</span>
                      <span className="text-[10px] text-henry-text-muted">{tsToTime(msg.ts)}</span>
                    </div>
                    <p className="text-sm text-henry-text-dim mt-0.5 leading-relaxed break-words whitespace-pre-wrap">{msg.text}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="shrink-0 p-3 border-t border-henry-border/20">
              <div className="flex gap-2 items-end">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                  }}
                  placeholder={`Message #${selected?.name || ''}…`}
                  rows={1}
                  className="flex-1 bg-henry-surface/50 border border-henry-border/40 rounded-xl px-3 py-2 text-sm text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/50 resize-none min-h-[38px] max-h-[120px]"
                  style={{ height: 'auto' }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = 'auto';
                    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
                  }}
                />
                <button
                  onClick={sendMessage}
                  disabled={!draft.trim() || sending}
                  className="shrink-0 p-2.5 bg-henry-accent text-white rounded-xl hover:bg-henry-accent/90 transition-colors disabled:opacity-40"
                >
                  {sending ? (
                    <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
