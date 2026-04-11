import { useState, useEffect } from 'react';
import { slackListChannels, slackGetHistory, isConnected, type SlackChannel, type SlackMessage } from '../../henry/integrations';
import { useStore } from '../../store';

export default function SlackPanel() {
  const setCurrentView = useStore((s) => s.setCurrentView);
  const connected = isConnected('slack');

  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [selected, setSelected] = useState<SlackChannel | null>(null);
  const [messages, setMessages] = useState<SlackMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [channelSearch, setChannelSearch] = useState('');

  useEffect(() => {
    if (connected) loadChannels();
  }, [connected]);

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

  if (!connected) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="text-5xl">💬</div>
        <div>
          <h2 className="text-lg font-semibold text-henry-text mb-1">Slack not connected</h2>
          <p className="text-sm text-henry-text-muted">Add your Slack Bot Token to read channels.</p>
          <p className="text-xs text-henry-text-muted mt-2">
            Create a Slack App at api.slack.com/apps and install it to your workspace.
            Copy the Bot User OAuth Token (starts with xoxb-).
          </p>
        </div>
        <button
          onClick={() => setCurrentView('integrations' as any)}
          className="px-4 py-2 bg-henry-accent text-white rounded-xl text-sm font-semibold hover:bg-henry-accent/90 transition-colors"
        >
          Go to Integrations
        </button>
      </div>
    );
  }

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
          {!loading && filteredChannels.length === 0 && (
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
              <button
                onClick={() => loadMessages(selected.id)}
                className="ml-auto p-1.5 rounded-lg text-henry-text-muted hover:text-henry-text hover:bg-henry-hover/50 transition-colors"
                title="Refresh"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 flex flex-col-reverse">
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
              {!loading && messages.map((msg) => (
                <div key={msg.ts} className="flex gap-3 items-start">
                  <div className="w-7 h-7 rounded-full bg-henry-surface/50 flex items-center justify-center text-xs shrink-0">
                    {(msg.username || msg.user || '?')[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-semibold text-henry-text">
                        {msg.username || msg.user}
                      </span>
                      <span className="text-[10px] text-henry-text-muted">{tsToTime(msg.ts)}</span>
                    </div>
                    <p className="text-sm text-henry-text-dim mt-0.5 leading-relaxed break-words whitespace-pre-wrap">
                      {msg.text}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
