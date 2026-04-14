import { useState, useEffect } from 'react';
import { getGoogleToken } from '../../henry/integrations';
import { useConnectionStore, selectStatus } from '../../henry/connectionStore';
import { useStore } from '../../store';
import ConnectScreen from './ConnectScreen';

interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  payload: { headers: { name: string; value: string }[] };
  internalDate: string;
}

function getHeader(msg: GmailMessage, name: string): string {
  return msg.payload.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function GmailPanel() {
  const status = useConnectionStore(selectStatus('gmail'));
  const profile = useConnectionStore((s) => s.getGoogleProfile());
  const { markExpired } = useConnectionStore();

  const [messages, setMessages] = useState<GmailMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<GmailMessage | null>(null);

  useEffect(() => {
    if (status === 'connected') load();
    else setMessages([]);
  }, [status]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const token = getGoogleToken();
      const listR = await fetch('/proxy/gmail/gmail/v1/users/me/messages?labelIds=INBOX&maxResults=20', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!listR.ok) {
        if (listR.status === 401 || listR.status === 403) { markExpired('gmail'); return; }
        throw new Error(`Gmail ${listR.status}`);
      }
      const listData = await listR.json();
      const ids: string[] = (listData.messages || []).map((m: any) => m.id);

      const fetched = await Promise.allSettled(
        ids.slice(0, 15).map((id) =>
          fetch(
            `/proxy/gmail/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
            { headers: { Authorization: `Bearer ${token}` } }
          ).then((r) => r.json())
        )
      );
      const msgs = fetched
        .filter((r): r is PromiseFulfilledResult<GmailMessage> => r.status === 'fulfilled')
        .map((r) => r.value)
        .filter((m) => m?.id);
      setMessages(msgs);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (status !== 'connected') return <ConnectScreen serviceId="gmail" />;

  return (
    <div className="h-full flex flex-col bg-henry-bg overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 pt-5 pb-3 border-b border-henry-border/30">
        <div className="flex items-center gap-3">
          <div className="text-2xl">📧</div>
          <div className="flex-1">
            <h1 className="text-base font-semibold text-henry-text">Gmail</h1>
            <p className="text-xs text-henry-text-muted">
              {loading ? 'Loading inbox…' : `${messages.length} recent messages`}
              {profile?.email && <span className="ml-2 opacity-60">· {profile.email}</span>}
            </p>
          </div>
          <button onClick={load} disabled={loading} className="p-1.5 rounded-lg text-henry-text-muted hover:text-henry-text hover:bg-henry-hover/50 transition-colors" title="Refresh">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Thread list */}
        <div className={`${selected ? 'w-64 shrink-0 border-r border-henry-border/30' : 'flex-1'} flex flex-col overflow-hidden`}>
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {error && (
              <div className="mx-1 px-3 py-2 bg-henry-error/10 border border-henry-error/30 rounded-xl text-xs text-henry-error mb-3">
                {error}
                <button onClick={load} className="block mt-1 text-henry-accent underline">Try again</button>
              </div>
            )}
            {loading && <div className="flex items-center justify-center py-12"><div className="w-6 h-6 rounded-full border-2 border-henry-accent/30 border-t-henry-accent animate-spin" /></div>}
            {!loading && messages.length === 0 && !error && <div className="text-center py-12 text-henry-text-muted text-sm">No messages in inbox.</div>}
            {messages.map((msg) => {
              const subject = getHeader(msg, 'Subject') || '(no subject)';
              const from = getHeader(msg, 'From');
              const fromName = from.replace(/<.*>/, '').trim() || from;
              const ts = parseInt(msg.internalDate, 10);
              return (
                <button
                  key={msg.id}
                  onClick={() => setSelected(selected?.id === msg.id ? null : msg)}
                  className={`w-full text-left p-3 rounded-xl border transition-colors ${
                    selected?.id === msg.id
                      ? 'bg-henry-accent/8 border-henry-accent/25'
                      : 'bg-henry-surface/30 border-henry-border/20 hover:border-henry-border/40 hover:bg-henry-surface/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <p className="text-xs font-semibold text-henry-text truncate">{fromName}</p>
                    <p className="text-[10px] text-henry-text-muted shrink-0">{timeAgo(ts)}</p>
                  </div>
                  <p className="text-xs font-medium text-henry-text-dim truncate">{subject}</p>
                  <p className="text-[11px] text-henry-text-muted/70 truncate mt-0.5">{msg.snippet}</p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Message detail */}
        {selected && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="shrink-0 px-4 py-3 border-b border-henry-border/30 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-henry-text truncate">{getHeader(selected, 'Subject') || '(no subject)'}</p>
                <p className="text-[11px] text-henry-text-muted">{getHeader(selected, 'From')}</p>
              </div>
              <button
                onClick={() => {
                  const subject = getHeader(selected, 'Subject') || '(no subject)';
                  const from = getHeader(selected, 'From');
                  const prompt = `Help me draft a reply to this email:\n\nFrom: ${from}\nSubject: ${subject}\n\nPreview: ${selected.snippet}`;
                  window.dispatchEvent(new CustomEvent('henry_mode_launch', { detail: { mode: 'secretary', prompt } }));
                  useStore.getState().setCurrentView('chat');
                }}
                className="shrink-0 px-3 py-1.5 text-xs font-medium bg-henry-accent/10 text-henry-accent border border-henry-accent/20 rounded-lg hover:bg-henry-accent/20 transition-colors"
              >
                Draft reply
              </button>
              <button onClick={() => setSelected(null)} className="shrink-0 p-1.5 text-henry-text-muted hover:text-henry-text">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <p className="text-sm text-henry-text-dim leading-relaxed whitespace-pre-wrap">{selected.snippet}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
