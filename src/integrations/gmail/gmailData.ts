/**
 * Gmail — data layer.
 *
 * All API calls for the Gmail panel live here.
 * The panel imports from this file; it does not touch auth or tokens directly.
 *
 * Dependencies:
 *   - getGoogleToken() from integrations (token is managed by connectionStore)
 *   - /proxy/gmail/* (server-side proxy must be configured)
 */

import { getGoogleToken } from '../../henry/integrations';

export interface GmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  snippet: string;
  date: number;
  body?: string;
}

const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

function authHeader() {
  return { Authorization: `Bearer ${getGoogleToken()}` };
}

/** Fetch the 20 most recent inbox messages with full metadata. */
export async function fetchInbox(): Promise<GmailMessage[]> {
  const listR = await fetch(`${BASE}/messages?labelIds=INBOX&maxResults=20`, {
    headers: authHeader(),
  });
  if (!listR.ok) {
    const err: any = new Error(`Gmail ${listR.status}`);
    err.status = listR.status;
    throw err;
  }
  const listData = await listR.json();
  const ids: string[] = (listData.messages || []).map((m: any) => m.id);

  const messages = await Promise.all(
    ids.map(async (id) => {
      const r = await fetch(`${BASE}/messages/${id}?format=full`, {
        headers: authHeader(),
      });
      if (!r.ok) return null;
      const m = await r.json();
      const headers: Record<string, string> = {};
      for (const h of m.payload?.headers || []) {
        headers[h.name.toLowerCase()] = h.value;
      }
      const date = parseInt(m.internalDate ?? '0');
      return {
        id: m.id,
        threadId: m.threadId,
        subject: headers['subject'] ?? '(no subject)',
        from: headers['from'] ?? '',
        snippet: m.snippet ?? '',
        date,
        body: extractPlainText(m.payload),
      } satisfies GmailMessage;
    })
  );

  return messages.filter(Boolean) as GmailMessage[];
}

function extractPlainText(payload: any): string | undefined {
  if (!payload) return undefined;
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return atob(payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
  }
  for (const part of payload.parts || []) {
    const text = extractPlainText(part);
    if (text) return text;
  }
  return undefined;
}
