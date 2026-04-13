import { useState, useEffect } from 'react';
import { isConnected, getToken } from '../../henry/integrations';
import { useStore } from '../../store';
import ConnectPrompt from './ConnectPrompt';

interface GmailThread {
  id: string;
  snippet: string;
  historyId: string;
}

interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  payload: {
    headers: { name: string; value: string }[];
    body?: { data?: string };
    parts?: { mimeType: string; body: { data?: string } }[];
  };
  internalDate: string;
}

function getHeader(msg: GmailMessage, name: string): string {
  return msg.payload.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function decodeBase64(data: string): string {
  try {
    return atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  } catch { return ''; }
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
  const [connected, setConnected] = useState(isConnected('gmail'));
  const [messages, setMessages] = useState<GmailMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<GmailMessage | null>(null);

  useEffect(() => {
    if (connected) load();
  }, [connected]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const token = getToken('gmail');
      // List inbox messages
      const listR = await fetch('/proxy/gmail/gmail/v1/users/me/messages?labelIds=INBOX&maxResults=20', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!listR.ok) {
        if (listR.status === 401 || listR.status === 403) throw new Error('Token expired or invalid. Please reconnect.');
        throw new Error(`Gmail ${listR.status}`);
      }
      const listData = await listR.json();
      const ids: string[] = (listData.messages || []).map((m: any) => m.id);

      // Fetch each message (parallel, limited)
      const fetched = await Promise.allSettled(
        ids.slice(0, 15).map((id) =>
          fetch(`/proxy/gmail/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, {
            headers: { Authorization: `Bearer ${token}` },
          }).then((r) => r.json())
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

  if (!connected) {
    return (
      <ConnectPrompt
        serviceId="gmail"
        icon="📧"
        name="Gmail"
        unlocks="Read your inbox, get Henry to summarize threads, and draft replies without leaving the app."
        steps={[
          'Go to the Google OAuth Playground at developers.google.com/oauthplayground',
          'Select the Gmail API — gmail.readonly scope',
          'Click Authorize, then Exchange for a token',
          'Copy the Access Token and paste it below',
        ]}
        tokenLabel="Google OAuth Access Token"
        tokenPlaceholder="ya29.…"
        docsUrl="https://developers.google.com/oauthplayground/"
        docsLabel="Open OAuth Playground →"
        onConnected={() => setConnected(true)}
      />
    );
  }

  return (
    <div className="h-full flex flex-col bg-henry-bg overflow-hidden">
      <div className="shrink-0 px-6 pt-5 pb-3 border-b border-henry-border/30">
        <div className="flex items-center gap-3">
          <div className="text-2xl">📧</div>
          <div className="flex-1">
            <h1 className="text-base font-semibold text-henry-text">Gmail</h1>
            <p className="text-xs text-henry-text-muted">
              {loading ? 'Loading inbox…' : `${messages.length} recent messages`}
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
                {(error.includes('expired') || error.includes('invalid')) && (
                  <button onClick={() => setConnected(false)} className="block mt-1 underline">Reconnect</button>
                )}
              </div>
            )}

            {loading && (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 rounded-full border-2 border-henry-accent/30 border-t-henry-accent animate-spin" />
              </div>
            )}

            {!loading && messages.length === 0 && !error && (
              <div className="text-center py-12 text-henry-text-muted text-sm">
                No messages in inbox.
              </div>
            )}

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

          {/* OAuth note */}
          <div className="shrink-0 px-3 pb-3">
            <div className="rounded-xl bg-henry-surface/20 border border-henry-border/20 px-3 py-2">
              <p className="text-[10px] text-henry-text-muted leading-relaxed">
                Access tokens expire in ~1 hour.{' '}
                <a href="https://developers.google.com/oauthplayground/" target="_blank" rel="noreferrer" className="text-henry-accent hover:underline">
                  Refresh token →
                </a>
              </p>
            </div>
          </div>
        </div>

        {/* Selected message detail */}
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
              <p className="text-[11px] text-henry-text-muted/60 mt-4 italic">
                Full message body not loaded — Gmail metadata mode only shows a snippet. A full OAuth flow with message access is needed for complete content.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
