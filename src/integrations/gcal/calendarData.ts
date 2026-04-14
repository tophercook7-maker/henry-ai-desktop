/**
 * Google Calendar — data layer.
 *
 * All API calls for the Calendar panel live here.
 * Depends on the shared Google token via getGoogleToken().
 */

import { getGoogleToken } from '../../henry/integrations';

export interface CalEvent {
  id: string;
  summary: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  location?: string;
  description?: string;
  attendees?: { email: string; displayName?: string; responseStatus?: string }[];
  hangoutLink?: string;
}

const BASE = 'https://www.googleapis.com/calendar/v3';

function authHeader() {
  return { Authorization: `Bearer ${getGoogleToken()}` };
}

/** Fetch events for the next N days (default: 7). */
export async function fetchUpcomingEvents(days = 7): Promise<CalEvent[]> {
  const now = new Date().toISOString();
  const end = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const url =
    `${BASE}/calendars/primary/events` +
    `?orderBy=startTime&singleEvents=true` +
    `&timeMin=${encodeURIComponent(now)}&timeMax=${encodeURIComponent(end)}` +
    `&maxResults=20`;

  const r = await fetch(url, { headers: authHeader() });
  if (!r.ok) {
    const err: any = new Error(`Google Calendar ${r.status}`);
    err.status = r.status;
    throw err;
  }
  const data = await r.json();
  return data.items || [];
}

/** True if an event starts today in local time. */
export function isToday(event: CalEvent): boolean {
  const iso = event.start.dateTime || event.start.date || '';
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/** Format event time for display. */
export function formatEventTime(event: CalEvent): string {
  const iso = event.start.dateTime;
  if (!iso) return event.start.date ?? '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
