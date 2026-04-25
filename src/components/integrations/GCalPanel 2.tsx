import { useState, useEffect } from 'react';
import { getGoogleToken } from '../../henry/integrations';
import { useConnectionStore, selectStatus } from '../../henry/connectionStore';
import ConnectScreen from './ConnectScreen';
import { henryQuickAsk } from '../../henry/henryQuickAsk';

interface CalEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  location?: string;
  htmlLink?: string;
  attendees?: { email: string; displayName?: string; responseStatus: string }[];
  description?: string;
}

function formatEventTime(event: CalEvent): string {
  const start = event.start.dateTime || event.start.date;
  if (!start) return '';
  const d = new Date(start);
  if (event.start.date && !event.start.dateTime) {
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function isToday(event: CalEvent): boolean {
  const start = event.start.dateTime || event.start.date;
  if (!start) return false;
  const d = new Date(start);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export default function GCalPanel() {
  const status = useConnectionStore(selectStatus('gcal'));
  const profile = useConnectionStore((s) => s.getGoogleProfile());
  const { markExpired } = useConnectionStore();

  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (status === 'connected') load();
    else setEvents([]);
  }, [status]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const token = getGoogleToken();
      const now = new Date().toISOString();
      const end = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const r = await fetch(
        `/proxy/gcal/calendar/v3/calendars/primary/events?orderBy=startTime&singleEvents=true&timeMin=${encodeURIComponent(now)}&timeMax=${encodeURIComponent(end)}&maxResults=20`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!r.ok) {
        if (r.status === 401 || r.status === 403) { markExpired('gcal'); return; }
        throw new Error(`Google Calendar ${r.status}`);
      }
      const data = await r.json();
      setEvents(data.items || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (status !== 'connected') return <ConnectScreen serviceId="gcal" />;

  const todayEvents = events.filter(isToday);
  const upcomingEvents = events.filter((e) => !isToday(e));

  return (
    <div className="h-full flex flex-col bg-henry-bg overflow-hidden">
      <div className="shrink-0 px-6 pt-5 pb-3 border-b border-henry-border/30">
        <div className="flex items-center gap-3">
          <div className="text-2xl">📅</div>
          <div className="flex-1">
            <div className="flex items-center justify-between w-full">
                <h1 className="text-base font-semibold text-henry-text">Google Calendar</h1>
                <button
                  onClick={() => henryQuickAsk({ prompt: 'Review my calendar. What do I need to prepare for? Any conflicts, back-to-backs, or things I should know before tomorrow?' })}
                  className="text-[11px] px-3 py-1.5 rounded-lg bg-henry-accent/10 text-henry-accent hover:bg-henry-accent/20 transition-all"
                >🧠 Ask Henry</button>
              </div>
            <p className="text-xs text-henry-text-muted">
              {loading ? 'Loading…' : `Next 7 days · ${events.length} events`}
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

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {error && (
          <div className="px-4 py-3 bg-henry-error/10 border border-henry-error/30 rounded-xl text-xs text-henry-error">
            {error}
            <button onClick={load} className="block mt-1 text-henry-accent underline">Try again</button>
          </div>
        )}
        {loading && <div className="flex items-center justify-center py-12"><div className="w-6 h-6 rounded-full border-2 border-henry-accent/30 border-t-henry-accent animate-spin" /></div>}

        {!loading && todayEvents.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-henry-text-muted mb-2">Today</p>
            <div className="space-y-2">
              {todayEvents.map((event) => <EventCard key={event.id} event={event} highlight />)}
            </div>
          </div>
        )}

        {!loading && upcomingEvents.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-henry-text-muted mb-2">Upcoming</p>
            <div className="space-y-2">
              {upcomingEvents.map((event) => <EventCard key={event.id} event={event} />)}
            </div>
          </div>
        )}

        {!loading && !error && events.length === 0 && (
          <div className="text-center py-12 text-henry-text-muted text-sm">No events in the next 7 days.</div>
        )}
      </div>
    </div>
  );
}

function EventCard({ event, highlight = false }: { event: CalEvent; highlight?: boolean }) {
  return (
    <a
      href={event.htmlLink || '#'}
      target="_blank"
      rel="noreferrer"
      className={`flex items-start gap-3 p-3 rounded-2xl border transition-colors ${
        highlight
          ? 'bg-henry-accent/5 border-henry-accent/20 hover:bg-henry-accent/10'
          : 'bg-henry-surface/40 border-henry-border/20 hover:bg-henry-surface/70'
      }`}
    >
      <div className={`shrink-0 w-1 self-stretch rounded-full ${highlight ? 'bg-henry-accent' : 'bg-henry-border/50'}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-henry-text truncate">{event.summary || 'Untitled event'}</p>
        <p className="text-[11px] text-henry-text-muted mt-0.5">{formatEventTime(event)}</p>
        {event.location && <p className="text-[11px] text-henry-text-muted/70 mt-0.5 truncate">📍 {event.location}</p>}
        {event.attendees && event.attendees.length > 1 && (
          <p className="text-[10px] text-henry-text-muted/60 mt-0.5">
            {event.attendees.length} attendees
          </p>
        )}
      </div>
    </a>
  );
}
