/**
 * Henry AI — Service Integrations
 * Stores connection tokens for dev & productivity services.
 * All data lives in localStorage.
 */

const PREFIX = 'henry:int:';

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
export const REPLIT_CONNECTED_SERVICES = new Set(['slack']);

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
    proxyBase: '/proxy/github',
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
    proxyBase: '/proxy/linear',
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
    proxyBase: '/proxy/notion',
  },
  {
    id: 'slack',
    name: 'Slack',
    icon: '💬',
    description: 'Read channels and send messages.',
    unlocks: 'Read your Slack channels and send messages without leaving Henry.',
    connectionType: 'replit-oauth',
    keyLabel: 'Paste your Slack bot token',
    keyPlaceholder: 'xoxb-…',
    docsUrl: 'https://api.slack.com/apps',
    docsLabel: 'Set up Slack app',
    tokenLabel: 'Bot Token',
    tokenHint: 'Create a Slack App and install it. Copy the Bot User OAuth Token (xoxb-).',
    category: 'productivity',
    proxyBase: '/proxy/slack',
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
    proxyBase: '/proxy/stripe',
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
    proxyBase: '/proxy/gcal',
  },
  {
    id: 'gmail',
    name: 'Gmail',
    icon: '📧',
    description: 'Read and compose emails.',
    unlocks: 'Let Henry read and draft emails so you can move faster in your inbox.',
    connectionType: 'api-key',
    keyLabel: 'Paste your Google access token',
    keyPlaceholder: 'ya29.…',
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
    docsLabel: 'Get access token',
    tokenLabel: 'OAuth Access Token',
    tokenHint: 'Requires Google OAuth. Use a service account or OAuth 2.0 token with gmail.readonly scope.',
    category: 'productivity',
    proxyBase: '/proxy/gmail',
  },
];

// ── Token storage ────────────────────────────────────────────────────────────

export function getToken(serviceId: string): string {
  try { return localStorage.getItem(`${PREFIX}token:${serviceId}`) || ''; } catch { return ''; }
}

export function setToken(serviceId: string, token: string): void {
  try {
    if (token.trim()) {
      localStorage.setItem(`${PREFIX}token:${serviceId}`, token.trim());
    } else {
      localStorage.removeItem(`${PREFIX}token:${serviceId}`);
    }
  } catch { /* ignore */ }
}

export function removeToken(serviceId: string): void {
  try { localStorage.removeItem(`${PREFIX}token:${serviceId}`); } catch { /* ignore */ }
}

export function isConnected(serviceId: string): boolean {
  // Replit OAuth services are always connected (token managed by Replit)
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
  return fetch(`/proxy/github${path}`, { headers: ghHeaders() });
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
  const r = await fetch(`/proxy/github/repos/${repo}/issues`, {
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
  const r = await fetch('/proxy/linear/graphql', {
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
  const r = await fetch('/proxy/notion/v1/search', {
    method: 'POST',
    headers: notionHeaders(),
    body: JSON.stringify({ query, sort: { direction: 'descending', timestamp: 'last_edited_time' }, page_size: 20 }),
  });
  if (!r.ok) throw new Error(`Notion ${r.status}`);
  const data = await r.json();
  return data.results || [];
}

// ── Slack API helpers ────────────────────────────────────────────────────────
// Uses Replit connector proxy — OAuth token injected server-side automatically.
// Routes: /connector/slack/api/{endpoint}

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

export async function slackListChannels(): Promise<SlackChannel[]> {
  const r = await fetch('/connector/slack/conversations.list?exclude_archived=true&limit=50');
  if (!r.ok) throw new Error(`Slack ${r.status}`);
  const data = await r.json();
  if (!data.ok) throw new Error(data.error || 'Slack error');
  return data.channels || [];
}

export async function slackGetHistory(channelId: string, limit = 20): Promise<SlackMessage[]> {
  const r = await fetch(`/connector/slack/conversations.history?channel=${channelId}&limit=${limit}`);
  if (!r.ok) throw new Error(`Slack ${r.status}`);
  const data = await r.json();
  if (!data.ok) throw new Error(data.error || 'Slack error');
  return data.messages || [];
}

export async function slackPostMessage(channelId: string, text: string): Promise<void> {
  const r = await fetch('/connector/slack/chat.postMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: channelId, text }),
  });
  if (!r.ok) throw new Error(`Slack ${r.status}`);
  const data = await r.json();
  if (!data.ok) throw new Error(data.error || 'Slack error');
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
  const r = await fetch('/proxy/stripe/v1/balance', { headers: stripeHeaders() });
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
  const r = await fetch(`/proxy/stripe/v1/charges?limit=${limit}`, { headers: stripeHeaders() });
  if (!r.ok) throw new Error(`Stripe ${r.status}`);
  const data = await r.json();
  return data.data || [];
}

// ── Henry context block ──────────────────────────────────────────────────────

export function buildIntegrationsContextBlock(): string {
  const connected = connectedServices();
  if (connected.length === 0) return '';
  return `\n\n## Connected Services\nYou have access to these external services. When the user asks about them, you can describe their data or suggest navigating to the panel.\n${connected.map((s) => `- **${s.name}**: ${s.description}`).join('\n')}`;
}
