/**
 * Henry AI — Service Integrations
 * Stores connection tokens for dev & productivity services.
 * All data lives in localStorage.
 */

const PREFIX = 'henry:int:';

// ── Shared Google auth ────────────────────────────────────────────────────────
// All Google services (Gmail, Calendar, Drive) share one OAuth token.
// Store once, read everywhere.

const GOOGLE_SERVICES = new Set(['gmail', 'gcal', 'gdrive']);

export function getGoogleToken(): string {
  try { return localStorage.getItem(`${PREFIX}token:google`) || ''; } catch { return ''; }
}

export function setGoogleToken(token: string): void {
  try {
    if (token.trim()) localStorage.setItem(`${PREFIX}token:google`, token.trim());
    else localStorage.removeItem(`${PREFIX}token:google`);
  } catch { /* ignore */ }
}

export function removeGoogleToken(): void {
  try { localStorage.removeItem(`${PREFIX}token:google`); } catch { /* ignore */ }
}

export function isGoogleConnected(): boolean {
  return !!getGoogleToken();
}

export interface ServiceConfig {
  id: string;
  name: string;
  icon: string;
  description: string;
  unlocks: string;
  connectionType: 'replit-oauth' | 'api-key';
  keyLabel: string;
  keyPlaceholder: string;
  docsUrl: string;
  docsLabel: string;
  tokenLabel: string;
  tokenHint: string;
  category: 'dev' | 'productivity' | 'finance';
  proxyBase: string;
}

// Services that are auto-connected via Replit OAuth (no manual token needed)
// Slack was previously here but now uses a user-provided bot token (xoxb-)
export const REPLIT_CONNECTED_SERVICES = new Set<string>();

export const SERVICES: ServiceConfig[] = [
  {
    id: 'github',
    name: 'GitHub',
    icon: '🐙',
    description: 'Repos, issues, pull requests, and code review.',
    unlocks: 'Browse your repos, triage issues, and review pull requests — all from Henry.',
    connectionType: 'api-key',
    keyLabel: 'Paste your GitHub API key',
    keyPlaceholder: 'ghp_…',
    docsUrl: 'https://github.com/settings/tokens/new',
    docsLabel: 'Get API key',
    tokenLabel: 'Personal Access Token',
    tokenHint: 'Create at github.com/settings/tokens — needs repo, issues scopes.',
    category: 'dev',
    proxyBase: 'https://api.github.com',
  },
  {
    id: 'linear',
    name: 'Linear',
    icon: '🔷',
    description: 'Issues, projects, and engineering cycles.',
    unlocks: 'See your issues and cycles, and get Henry to help you prioritize.',
    connectionType: 'api-key',
    keyLabel: 'Paste your Linear API key',
    keyPlaceholder: 'lin_api_…',
    docsUrl: 'https://linear.app/settings/api',
    docsLabel: 'Get API key',
    tokenLabel: 'API Key',
    tokenHint: 'Create at linear.app/settings/api.',
    category: 'dev',
    proxyBase: 'https://api.linear.app',
  },
  {
    id: 'notion',
    name: 'Notion',
    icon: '📄',
    description: 'Pages, databases, and wikis.',
    unlocks: 'Search and read your Notion pages directly from Henry.',
    connectionType: 'api-key',
    keyLabel: 'Paste your Notion API key',
    keyPlaceholder: 'secret_…',
    docsUrl: 'https://www.notion.so/my-integrations',
    docsLabel: 'Get API key',
    tokenLabel: 'Integration Token',
    tokenHint: 'Create an internal integration at notion.so/my-integrations.',
    category: 'productivity',
    proxyBase: 'https://api.notion.com',
  },
  {
    id: 'slack',
    name: 'Slack',
    icon: '💬',
    description: 'Read channels and send messages.',
    unlocks: 'Read your Slack channels and send messages without leaving Henry.',
    connectionType: 'api-key',
    keyLabel: 'Paste your Slack bot token',
    keyPlaceholder: 'xoxb-…',
    docsUrl: 'https://api.slack.com/apps',
    docsLabel: 'Create a Slack App →',
    tokenLabel: 'Bot Token',
    tokenHint: 'Create a Slack App at api.slack.com/apps, add OAuth scopes channels:read + chat:write + channels:history, install it, and copy the Bot User OAuth Token (starts with xoxb-).',
    category: 'productivity',
    proxyBase: 'https://slack.com',
  },
  {
    id: 'stripe',
    name: 'Stripe',
    icon: '💳',
    description: 'Revenue, customers, and subscriptions.',
    unlocks: 'See your revenue, customers, and subscription activity at a glance.',
    connectionType: 'api-key',
    keyLabel: 'Paste your Stripe API key',
    keyPlaceholder: 'sk_…',
    docsUrl: 'https://dashboard.stripe.com/apikeys',
    docsLabel: 'Get API key',
    tokenLabel: 'Secret Key',
    tokenHint: 'Find at dashboard.stripe.com/apikeys — use a Restricted Key with read-only access.',
    category: 'finance',
    proxyBase: 'https://api.stripe.com',
  },
  {
    id: 'gcal',
    name: 'Google Calendar',
    icon: '📅',
    description: 'Events, schedules, and meeting links.',
    unlocks: 'Let Henry see your calendar so it can help you plan and prep for meetings.',
    connectionType: 'api-key',
    keyLabel: 'Paste your Google API key',
    keyPlaceholder: 'AIza…',
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
    docsLabel: 'Get API key',
    tokenLabel: 'API Key or OAuth Token',
    tokenHint: 'Create credentials at console.cloud.google.com → APIs & Services.',
    category: 'productivity',
    proxyBase: 'https://www.googleapis.com',
  },
  {
    id: 'gmail',
    name: 'Gmail',
    icon: '📧',
    description: 'Read and compose emails.',
    unlocks: 'Let Henry read and draft emails so you can move faster in your inbox.',
    connectionType: 'replit-oauth',
    keyLabel: 'Google account',
    keyPlaceholder: 'ya29.…',
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
    docsLabel: 'Get access token',
    tokenLabel: 'OAuth Access Token',
    tokenHint: 'Sign in with Google to connect Gmail.',
    category: 'productivity',
    proxyBase: 'https://gmail.googleapis.com',
  },
  {
    id: 'gdrive',
    name: 'Google Drive',
    icon: '📁',
    description: 'Browse and access files and documents.',
    unlocks: 'Access recent Drive files and let Henry help you find what you need.',
    connectionType: 'replit-oauth',
    keyLabel: 'Google account',
    keyPlaceholder: 'ya29.…',
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
    docsLabel: 'Get access token',
    tokenLabel: 'OAuth Access Token',
    tokenHint: 'Sign in with Google to connect Drive.',
    category: 'productivity',
    proxyBase: 'https://www.googleapis.com',
  },
];

// ── Token storage ────────────────────────────────────────────────────────────

export function getToken(serviceId: string): string {
  if (GOOGLE_SERVICES.has(serviceId)) return getGoogleToken();
  try { return localStorage.getItem(`${PREFIX}token:${serviceId}`) || ''; } catch { return ''; }
}

export function setToken(serviceId: string, token: string): void {
  if (GOOGLE_SERVICES.has(serviceId)) { setGoogleToken(token); return; }
  try {
    if (token.trim()) {
      localStorage.setItem(`${PREFIX}token:${serviceId}`, token.trim());
    } else {
      localStorage.removeItem(`${PREFIX}token:${serviceId}`);
    }
  } catch { /* ignore */ }
}

export function removeToken(serviceId: string): void {
  if (GOOGLE_SERVICES.has(serviceId)) { removeGoogleToken(); return; }
  try { localStorage.removeItem(`${PREFIX}token:${serviceId}`); } catch { /* ignore */ }
}

export function isConnected(serviceId: string): boolean {
  if (GOOGLE_SERVICES.has(serviceId)) return isGoogleConnected();
  if (REPLIT_CONNECTED_SERVICES.has(serviceId)) return true;
  return !!getToken(serviceId);
}

export function connectedServices(): ServiceConfig[] {
  return SERVICES.filter((s) => isConnected(s.id));
}

// ── GitHub API helpers ───────────────────────────────────────────────────────

export interface GHRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string | null;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  open_issues_count: number;
  pushed_at: string;
  default_branch: string;
}

export interface GHIssue {
  id: number;
  number: number;
  title: string;
  state: 'open' | 'closed';
  html_url: string;
  user: { login: string; avatar_url: string };
  labels: { name: string; color: string }[];
  created_at: string;
  updated_at: string;
  pull_request?: { url: string };
  assignee: { login: string } | null;
  body: string | null;
}

export interface GHPR {
  id: number;
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  html_url: string;
  user: { login: string; avatar_url: string };
  head: { ref: string };
  base: { ref: string };
  draft: boolean;
  created_at: string;
  merged_at: string | null;
}

export interface GHUser {
  login: string;
  name: string | null;
  avatar_url: string;
  public_repos: number;
  followers: number;
}

function ghHeaders(): Record<string, string> {
  const token = getToken('github');
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function ghFetch(path: string): Promise<Response> {
  return fetch(`https://api.github.com${path}`, { headers: ghHeaders() });
}

export async function ghGetUser(): Promise<GHUser> {
  const r = await ghFetch('/user');
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return r.json();
}

export async function ghListRepos(per_page = 30): Promise<GHRepo[]> {
  const r = await ghFetch(`/user/repos?sort=pushed&per_page=${per_page}`);
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return r.json();
}

export async function ghListIssues(repo: string, state: 'open' | 'closed' | 'all' = 'open', per_page = 30): Promise<GHIssue[]> {
  const r = await ghFetch(`/repos/${repo}/issues?state=${state}&per_page=${per_page}&sort=updated`);
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return r.json();
}

export async function ghListPRs(repo: string, state: 'open' | 'closed' | 'all' = 'open'): Promise<GHPR[]> {
  const r = await ghFetch(`/repos/${repo}/pulls?state=${state}&sort=updated&per_page=20`);
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return r.json();
}

export async function ghCreateIssue(repo: string, title: string, body: string, labels: string[] = []): Promise<GHIssue> {
  const r = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: 'POST',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, labels }),
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return r.json();
}

// ── Linear API helpers ───────────────────────────────────────────────────────

export interface LinearIssue {
  id: string;
  title: string;
  description: string | null;
  state: { name: string; color: string; type: string };
  priority: number;
  url: string;
  createdAt: string;
  updatedAt: string;
  assignee: { name: string; displayName: string } | null;
  team: { name: string };
  labels: { nodes: { name: string; color: string }[] };
}

function linearHeaders(): Record<string, string> {
  return {
    'Authorization': getToken('linear'),
    'Content-Type': 'application/json',
  };
}

export async function linearQuery<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: linearHeaders(),
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) throw new Error(`Linear ${r.status}`);
  const data = await r.json();
  if (data.errors) throw new Error(data.errors[0].message);
  return data.data as T;
}

export async function linearGetMyIssues(): Promise<LinearIssue[]> {
  const data = await linearQuery<{ viewer: { assignedIssues: { nodes: LinearIssue[] } } }>(`
    query {
      viewer {
        assignedIssues(filter: { state: { type: { nin: ["completed", "cancelled"] } } }) {
          nodes {
            id title description url createdAt updatedAt priority
            state { name color type }
            assignee { name displayName }
            team { name }
            labels { nodes { name color } }
          }
        }
      }
    }
  `);
  return data.viewer.assignedIssues.nodes;
}

// ── Notion API helpers ───────────────────────────────────────────────────────

function notionHeaders(): Record<string, string> {
  return {
    'Authorization': `Bearer ${getToken('notion')}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };
}

export interface NotionPage {
  id: string;
  url: string;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, {
    type: string;
    title?: { plain_text: string }[];
    rich_text?: { plain_text: string }[];
  }>;
}

export async function notionSearch(query = ''): Promise<NotionPage[]> {
  const r = await fetch('https://api.notion.com/v1/search', {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify({ query, sort: { direction: 'descending', timestamp: 'last_edited_time' }, page_size: 20 }),
  });
  if (!r.ok) throw new Error(`Notion ${r.status}`);
  const data = await r.json();
  return data.results || [];
}

// ── Slack API helpers ────────────────────────────────────────────────────────
// Uses user-provided bot token (xoxb-) via /proxy/slack → slack.com
// Required OAuth scopes: channels:read, channels:history, chat:write

export interface SlackChannel {
  id: string;
  name: string;
  is_member: boolean;
  num_members: number;
}

export interface SlackMessage {
  ts: string;
  text: string;
  user: string;
  username?: string;
}

function slackHeaders(): Record<string, string> {
  return {
    'Authorization': `Bearer ${getToken('slack')}`,
    'Content-Type': 'application/json',
  };
}

export async function slackListChannels(): Promise<SlackChannel[]> {
  const token = getToken('slack');
  if (!token) throw new Error('No Slack token configured. Add your bot token in Integrations.');
  const r = await fetch('https://slack.com/api/conversations.list?exclude_archived=true&limit=100&types=public_channel,private_channel', {
    headers: slackHeaders(),
  });
  if (!r.ok) throw new Error(`Slack HTTP ${r.status}`);
  const data = await r.json();
  if (!data.ok) {
    if (data.error === 'invalid_auth' || data.error === 'not_authed') {
      throw new Error('Invalid Slack token. Check your bot token in Integrations.');
    }
    throw new Error(`Slack API error: ${data.error}`);
  }
  return (data.channels || []) as SlackChannel[];
}

export async function slackGetHistory(channelId: string, limit = 30): Promise<SlackMessage[]> {
  const token = getToken('slack');
  if (!token) throw new Error('No Slack token configured.');
  const r = await fetch(`https://slack.com/api/conversations.history?channel=${channelId}&limit=${limit}`, {
    headers: slackHeaders(),
  });
  if (!r.ok) throw new Error(`Slack HTTP ${r.status}`);
  const data = await r.json();
  if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
  const messages = (data.messages || []) as SlackMessage[];
  // Resolve user display names
  const userIds = [...new Set(messages.map((m) => m.user).filter(Boolean))];
  if (userIds.length > 0) {
    try {
      const names = await slackResolveUserNames(userIds);
      return messages.map((m) => ({ ...m, username: names[m.user] || m.user }));
    } catch {
      return messages;
    }
  }
  return messages;
}

async function slackResolveUserNames(userIds: string[]): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  await Promise.allSettled(
    userIds.slice(0, 10).map(async (uid) => {
      try {
        const r = await fetch(`https://slack.com/api/users.info?user=${uid}`, { headers: slackHeaders() });
        if (!r.ok) return;
        const data = await r.json();
        if (data.ok && data.user) {
          names[uid] = data.user.profile?.display_name || data.user.real_name || data.user.name || uid;
        }
      } catch { /* ignore */ }
    })
  );
  return names;
}

export async function slackPostMessage(channelId: string, text: string): Promise<void> {
  const token = getToken('slack');
  if (!token) throw new Error('No Slack token configured.');
  const r = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: slackHeaders(),
    body: JSON.stringify({ channel: channelId, text }),
  });
  if (!r.ok) throw new Error(`Slack HTTP ${r.status}`);
  const data = await r.json();
  if (!data.ok) throw new Error(`Slack API error: ${data.error}`);
}

// ── Stripe API helpers ───────────────────────────────────────────────────────

function stripeHeaders(): Record<string, string> {
  return { 'Authorization': `Bearer ${getToken('stripe')}` };
}

export interface StripeBalance {
  available: { amount: number; currency: string }[];
  pending: { amount: number; currency: string }[];
}

export async function stripeGetBalance(): Promise<StripeBalance> {
  const r = await fetch('https://api.stripe.com/v1/balance', { headers: stripeHeaders() });
  if (!r.ok) throw new Error(`Stripe ${r.status}`);
  return r.json();
}

export interface StripeCharge {
  id: string;
  amount: number;
  currency: string;
  description: string | null;
  created: number;
  status: string;
  customer: string | null;
}

export async function stripeListCharges(limit = 20): Promise<StripeCharge[]> {
  const r = await fetch(`https://api.stripe.com/v1/charges?limit=${limit}`, { headers: stripeHeaders() });
  if (!r.ok) throw new Error(`Stripe ${r.status}`);
  const data = await r.json();
  return data.data || [];
}

// ── Google Drive API helpers ─────────────────────────────────────────────────

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink: string;
  iconLink?: string;
  size?: string;
  owners?: { displayName: string }[];
}

function driveHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${getGoogleToken()}` };
}

export async function driveListFiles(pageSize = 20): Promise<DriveFile[]> {
  const fields = 'files(id,name,mimeType,modifiedTime,webViewLink,iconLink,size,owners)';
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files?orderBy=modifiedTime+desc&pageSize=${pageSize}&fields=${encodeURIComponent(fields)}`,
    { headers: driveHeaders() }
  );
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) throw new Error('Your Google account needs to be reconnected.');
    throw new Error(`Google Drive ${r.status}`);
  }
  const data = await r.json();
  return data.files || [];
}

// ── Google Calendar write helpers ────────────────────────────────────────────

export interface CalEventPayload {
  summary: string;
  start: { dateTime: string; timeZone?: string };
  end: { dateTime: string; timeZone?: string };
  description?: string;
  location?: string;
  attendees?: { email: string }[];
}

export interface CalEventCreated {
  id: string;
  htmlLink: string;
  summary: string;
  start: { dateTime: string };
}

export async function gcalCreateEvent(payload: CalEventPayload): Promise<CalEventCreated> {
  const token = getGoogleToken();
  if (!token) throw new Error('Google account is not connected.');
  const r = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => '');
    if (r.status === 401 || r.status === 403) throw new Error('Your Google account needs to be reconnected.');
    throw new Error(`Google Calendar ${r.status}: ${msg}`);
  }
  return r.json();
}

// ── Google Drive export (get file text content) ───────────────────────────────

const DRIVE_EXPORTABLE = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
]);

/**
 * Returns the text content of a Drive file.
 * Google Docs/Sheets/Slides are exported as plain text.
 * Other file types download raw (capped at 200 KB to keep prompts reasonable).
 */
export async function driveExportFileContent(fileId: string, mimeType: string): Promise<string> {
  const token = getGoogleToken();
  if (!token) throw new Error('Google account is not connected.');

  let url: string;
  if (DRIVE_EXPORTABLE.has(mimeType)) {
    url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text%2Fplain`;
  } else {
    url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  }

  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) throw new Error('Your Google account needs to be reconnected.');
    if (r.status === 403) throw new Error('This file cannot be exported as plain text.');
    throw new Error(`Google Drive export ${r.status}`);
  }

  // Guard: when fetching raw media (alt=media), the response may be binary.
  // Only proceed if the server confirms a text content-type.
  if (!DRIVE_EXPORTABLE.has(mimeType)) {
    const ct = r.headers.get('content-type') ?? '';
    if (!ct.startsWith('text/') && !ct.includes('json') && !ct.includes('xml')) {
      throw new Error(`This file type can't be read as text (${ct || mimeType}).`);
    }
  }

  const text = await r.text();

  // Null-byte guard: if the decoded string is garbage binary, refuse to return it.
  for (let i = 0; i < Math.min(text.length, 4000); i++) {
    if (text.charCodeAt(i) === 0) {
      throw new Error(`This file contains binary content and can't be displayed as text.`);
    }
  }

  // Cap at ~200K chars so prompts stay manageable
  return text.length > 200_000 ? text.slice(0, 200_000) + '\n\n[content truncated]' : text;
}

// ── Gmail draft creation ──────────────────────────────────────────────────────

/** Create a Gmail draft. Returns the draft ID. */
export async function gmailCreateDraft(
  to: string,
  subject: string,
  bodyText: string,
  fromEmail?: string
): Promise<{ draftId: string; threadId?: string }> {
  const token = getGoogleToken();
  if (!token) throw new Error('Google account is not connected.');

  const headers = [
    `To: ${to}`,
    fromEmail ? `From: ${fromEmail}` : null,
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    btoa(unescape(encodeURIComponent(bodyText))),
  ].filter(Boolean).join('\r\n');

  const raw = headers
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: { raw } }),
  });

  if (!r.ok) {
    const msg = await r.text().catch(() => '');
    if (r.status === 401 || r.status === 403) throw new Error('Your Google account needs to be reconnected.');
    throw new Error(`Gmail draft ${r.status}: ${msg}`);
  }

  const data = await r.json();
  return { draftId: data.id, threadId: data.message?.threadId };
}

// ── Notion write helpers ──────────────────────────────────────────────────────

export interface NotionCreatedPage {
  id: string;
  url: string;
  object: 'page';
}

/**
 * Create a new Notion page as a child of an existing page.
 * `parentPageId` is the page's 32-char UUID (dashes removed or with).
 * `blocks` is an array of Notion block objects.
 */
export async function notionCreatePage(
  parentPageId: string,
  title: string,
  markdownLines: string[] = []
): Promise<NotionCreatedPage> {
  const token = getToken('notion');
  if (!token) throw new Error('Notion is not connected.');

  // Build simple paragraph blocks from lines
  const children = markdownLines
    .filter((line) => line.trim())
    .map((line) => ({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', text: { content: line.slice(0, 2000) } }],
      },
    }));

  const body: Record<string, unknown> = {
    parent: { type: 'page_id', page_id: parentPageId },
    properties: {
      title: { title: [{ type: 'text', text: { content: title } }] },
    },
  };
  if (children.length > 0) {
    body.children = children.slice(0, 100); // Notion API max 100 blocks per request
  }

  const r = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const msg = await r.text().catch(() => '');
    if (r.status === 401 || r.status === 403) throw new Error('Notion token is invalid. Reconnect in Integrations.');
    throw new Error(`Notion create page ${r.status}: ${msg}`);
  }

  const data = await r.json();
  return { id: data.id, url: data.url, object: 'page' };
}

// ── Linear write helpers ──────────────────────────────────────────────────────

export interface LinearCreatedIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
}

export async function linearCreateIssue(
  teamId: string,
  title: string,
  description?: string,
  priority?: number
): Promise<LinearCreatedIssue> {
  const query = `
    mutation IssueCreate($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue {
          id
          identifier
          title
          url
        }
      }
    }
  `;
  const variables = {
    input: {
      teamId,
      title,
      ...(description ? { description } : {}),
      ...(priority !== undefined ? { priority } : {}),
    },
  };

  const r = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: linearHeaders(),
    body: JSON.stringify({ query, variables }),
  });

  if (!r.ok) {
    const msg = await r.text().catch(() => '');
    throw new Error(`Linear ${r.status}: ${msg}`);
  }

  const data = await r.json();
  if (data.errors?.length) throw new Error(data.errors[0].message);
  const issue = data.data?.issueCreate?.issue;
  if (!issue) throw new Error('Linear did not return the created issue.');
  return issue as LinearCreatedIssue;
}

// ── Google Calendar read helper (used by summary action) ─────────────────────

export async function gcalListEvents(days = 7): Promise<object[]> {
  const token = getGoogleToken();
  if (!token) throw new Error('Google account is not connected.');
  const now = new Date().toISOString();
  const end = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const url =
    `https://www.googleapis.com/calendar/v3/calendars/primary/events` +
    `?orderBy=startTime&singleEvents=true` +
    `&timeMin=${encodeURIComponent(now)}&timeMax=${encodeURIComponent(end)}` +
    `&maxResults=20`;

  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) throw new Error('Your Google account needs to be reconnected.');
    throw new Error(`Google Calendar ${r.status}`);
  }
  const data = await r.json();
  return data.items || [];
}

// ── Henry context block ──────────────────────────────────────────────────────

export function buildIntegrationsContextBlock(): string {
  const connected = connectedServices();
  if (connected.length === 0) return '';
  return `\n\n## Connected Services\nYou have access to these external services. When the user asks about them, you can describe their data or suggest navigating to the panel.\n${connected.map((s) => `- **${s.name}**: ${s.description}`).join('\n')}`;
}
