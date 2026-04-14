/**
 * Google Calendar action handlers.
 *
 * Fully implemented:
 *   gcal.summarize_upcoming  — fetches real events, summarizes in Henry chat
 *   gcal.send_event_to_chat  — preps meeting notes for an event in Henry chat
 *   gcal.create_event        — POSTs to Calendar API, confirmation-gated
 */

import { registerHandler } from '../../registry/actionRegistry';
import { sendToHenry } from '../../store/chatBridgeStore';
import { gcalCreateEvent, gcalListEvents } from '../../../henry/integrations';
import { actionSuccessMessage, actionErrorMessage } from '../../voice/actionVoice';
import type { CalEventPayload } from '../../../henry/integrations';
import type { ActionInput, ActionResult } from '../../types/actionTypes';

interface CalEventInput {
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
  description?: string;
  attendees?: { email: string; displayName?: string }[];
  hangoutLink?: string;
}

function formatEventTime(e: CalEventInput): string {
  const iso = e.start?.dateTime;
  if (!iso) return e.start?.date ?? '';
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

async function summarizeUpcoming(_input: ActionInput): Promise<ActionResult> {
  let events: CalEventInput[];
  try {
    events = (await gcalListEvents(7)) as CalEventInput[];
  } catch {
    return { success: false, message: actionErrorMessage('gcal.summarize_upcoming', 'chat') };
  }

  if (events.length === 0) {
    sendToHenry('I have no upcoming calendar events this week. What should I be planning for?');
    return { success: true };
  }

  const lines = events.slice(0, 10).map((e) => {
    const time = formatEventTime(e);
    const attendeeList = (e.attendees ?? []).map((a) => a.displayName || a.email).join(', ');
    return `- ${e.summary ?? 'Untitled'}${time ? ` at ${time}` : ''}${attendeeList ? ` with ${attendeeList}` : ''}`;
  });

  const prompt = [
    `Here are my upcoming calendar events. Give me a quick briefing:`,
    '',
    ...lines,
    '',
    '1. What meetings need prep?',
    '2. Is there anything I should be aware of or ready for?',
    '3. Any conflicts or things I should reschedule?',
  ].join('\n');

  sendToHenry(prompt);
  return { success: true, message: 'Opened in Henry chat' };
}

function sendEventToChat(input: ActionInput): Promise<ActionResult> {
  const e = input as CalEventInput;
  const time = formatEventTime(e);
  const attendeeList = (e.attendees ?? []).map((a) => a.displayName || a.email).join(', ');

  const lines = [
    `Help me prepare for this meeting:`,
    '',
    `Event: ${e.summary ?? 'Untitled'}`,
    time ? `Time: ${time}` : null,
    e.location ? `Location: ${e.location}` : null,
    attendeeList ? `With: ${attendeeList}` : null,
    e.hangoutLink ? `Video call: ${e.hangoutLink}` : null,
    e.description ? `\nDescription:\n${e.description}` : null,
    '',
    'Please give me: (1) what this meeting is likely about, (2) key things to prepare or research, (3) suggested agenda or talking points.',
  ].filter(Boolean);

  sendToHenry(lines.join('\n'));
  return Promise.resolve({ success: true, message: 'Opened in Henry chat' });
}

async function createEvent(input: ActionInput): Promise<ActionResult> {
  const summary     = (input.summary as string) ?? '';
  const startTime   = (input.startDateTime as string) ?? '';
  const endTime     = (input.endDateTime as string) ?? '';
  const description = (input.description as string) ?? undefined;
  const location    = (input.location as string) ?? undefined;
  const timeZone    = (input.timeZone as string) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (!summary || !startTime || !endTime) {
    return { success: false, message: 'summary, startDateTime, and endDateTime are required.' };
  }

  const payload: CalEventPayload = {
    summary,
    start: { dateTime: startTime, timeZone },
    end: { dateTime: endTime, timeZone },
    ...(description ? { description } : {}),
    ...(location ? { location } : {}),
  };

  try {
    const created = await gcalCreateEvent(payload);
    return {
      success: true,
      message: actionSuccessMessage('gcal.create_event', 'create'),
      data: { summary: created.summary, htmlLink: created.htmlLink, id: created.id },
    };
  } catch {
    return { success: false, message: actionErrorMessage('gcal.create_event', 'create') };
  }
}

export function registerCalendarHandlers() {
  registerHandler('gcal.summarize_upcoming', summarizeUpcoming);
  registerHandler('gcal.send_event_to_chat', sendEventToChat);
  registerHandler('gcal.create_event',       createEvent);
}
