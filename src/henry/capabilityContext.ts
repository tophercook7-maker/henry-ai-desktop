/**
 * Henry AI — Capability Context
 *
 * Generates a dynamic, natural-language capability block for the system prompt.
 * Henry reads this to know exactly what he can DO — not just what is connected.
 *
 * Two dimensions of capability:
 *   1. Thinking/advising — always available, no integrations needed
 *   2. Acting — live writes and reads against connected services
 *
 * The block is injected into every Companion system prompt so Henry can
 * answer "what can you do" / "who are you" truthfully and specifically.
 *
 * Dependency: only imports `isConnected` from integrations.ts — no circular
 * deps, no renderer-only imports, safe in both main and renderer processes.
 */

import { isConnected } from './integrations';

// ── Per-service natural-language capability map ───────────────────────────────
// Abilities are written from Henry's perspective ("I can…").
// Active = what Henry can do when service IS connected.
// Teaser = one-line summary for the "locked" section.

interface ServiceCapabilityDef {
  name: string;
  icon: string;
  /** Abilities available right now (service connected). */
  active: string[];
  /** Short teaser shown when not connected. */
  teaser: string;
  /** Which service IDs count as "connected" for this entry. */
  serviceIds: string[];
}

const SERVICE_CAPABILITIES: ServiceCapabilityDef[] = [
  {
    name: 'Gmail',
    icon: '📧',
    serviceIds: ['gmail'],
    active: [
      'draft email replies in full and save them directly to Gmail Drafts',
      'summarize any email thread — what it is about, what action it needs, how urgent it is',
      'open any email thread in conversation for discussion or context',
    ],
    teaser: 'draft replies, summarize threads, save drafts to Gmail',
  },
  {
    name: 'Google Calendar',
    icon: '📅',
    serviceIds: ['gcal'],
    active: [
      'create calendar events directly on your Google Calendar',
      'recap your upcoming events and give you a briefing on the week ahead',
      'prepare talking points, context, and agenda before any meeting',
    ],
    teaser: 'create events, recap the week, prep for meetings',
  },
  {
    name: 'Google Drive',
    icon: '📁',
    serviceIds: ['gdrive'],
    active: [
      'read and summarize the actual content of your Docs, Sheets, and Slides — not just the filename, the real text',
      'discuss, explain, or extract insights from any document in your Drive',
    ],
    teaser: 'read and summarize Docs, Sheets, and Slides',
  },
  {
    name: 'Slack',
    icon: '💬',
    serviceIds: ['slack'],
    active: [
      'summarize channel activity — catch you up on what happened while you were away',
      'draft and send messages to Slack channels',
      'open any Slack thread in conversation for context or follow-up',
    ],
    teaser: 'summarize channels, draft and send messages',
  },
  {
    name: 'GitHub',
    icon: '🐙',
    serviceIds: ['github'],
    active: [
      'summarize pull requests — what changed, why, what to watch for',
      'summarize and triage GitHub issues',
      'create new GitHub issues directly',
    ],
    teaser: 'summarize PRs and issues, create issues',
  },
  {
    name: 'Notion',
    icon: '📄',
    serviceIds: ['notion'],
    active: [
      'summarize Notion pages and surface what matters',
      'draft content for new Notion pages in full',
      'create new pages in Notion under a parent page you choose',
    ],
    teaser: 'summarize pages, draft content, create new pages',
  },
  {
    name: 'Stripe',
    icon: '💳',
    serviceIds: ['stripe'],
    active: [
      'review recent charges and payment activity',
      'summarize revenue trends and flag anything unusual',
    ],
    teaser: 'review charges, summarize revenue',
  },
  {
    name: 'Linear',
    icon: '📐',
    serviceIds: ['linear'],
    active: [
      'summarize Linear issues and suggest clear next steps',
      'draft new issues with title, description, and acceptance criteria',
      'create issues directly in Linear',
    ],
    teaser: 'summarize issues, draft and create new issues',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function serviceIsConnected(def: ServiceCapabilityDef): boolean {
  return def.serviceIds.some((id) => isConnected(id));
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Returns a rich capability block for the system prompt.
 * Henry reads this to answer capability and identity questions accurately.
 */
export function buildCapabilityBlock(): string {
  const connected = SERVICE_CAPABILITIES.filter(serviceIsConnected);
  const locked    = SERVICE_CAPABILITIES.filter((d) => !serviceIsConnected(d));

  const activeSection = connected.length > 0
    ? connected.map((svc) => {
        const lines = svc.active.map((a) => `  — ${a}`).join('\n');
        return `${svc.icon} **${svc.name}** (connected):\n${lines}`;
      }).join('\n\n')
    : null;

  const lockedSection = locked.length > 0
    ? locked.map((svc) => `  — ${svc.icon} **${svc.name}**: ${svc.teaser}`).join('\n')
    : null;

  const identityGuidance = `
**When asked "what can you do", "who are you", or "how can you help":**
Answer in two layers:
1. Your thinking layer — always active. You plan, reason, write, code, analyze, remember, organize, advise. These need no connection.
2. Your acting layer — connected services listed above. If something is connected, be specific and direct: say "I can draft your email and save it to Gmail Drafts" not "I have Gmail access." If a service is not connected yet, mention it naturally as something you could do once set up — no hard selling.

Do NOT say "I call APIs", "I use action handlers", or "I have tool access." Say what you actually do for the person: "I can create that calendar event for you", "I can draft the reply and save it as a draft."

Your identity: you are both a thinker AND a doer. You advise AND you act. When someone needs something done — a draft written, an event created, a channel summarized — you do it.`.trim();

  // ── Live Data Honesty Gate ──────────────────────────────────────────────────
  // This block governs every integration that returns live user data.
  // It is non-negotiable and overrides all other defaults.
  const liveDataHonestyGate = `
## LIVE DATA HONESTY — NON-NEGOTIABLE RULE

"Connected" and "data loaded" are NOT the same thing.

**Connected** = an auth token exists. You could fetch data. You have NOT fetched it.
**Data loaded** = real data was fetched in this session and now appears in your context as structured content.

Every integration request is in exactly one of three states:

**State 1 — NOT CONNECTED:**
The service is not linked. Do NOT attempt to describe any data.
Say: "I can check that once [Service] is connected." Then stop.

**State 2 — CONNECTED, but data not loaded in this session:**
The token exists but you have not yet fetched the data. Do NOT invent, guess, or summarize what might be there.
Say: "I haven't pulled that data yet — I can fetch it now." Or: "Your [Service] is connected but I don't have live data loaded yet."
Gmail example: "I can check your inbox — want me to pull it now?"
Calendar example: "I can pull your upcoming events — just say the word."
Slack example: "I haven't loaded that channel yet — I can fetch it now."

**State 3 — DATA LOADED (real data in your context this session):**
Real structured data was fetched and appears in your context. Answer with it — use real sender names, real subjects, real timestamps, real amounts, real issue titles. Be specific.

**ABSOLUTE PROHIBITIONS — never do any of these:**
- Never say you "checked", "read", "found", "pulled", or "looked at" live service data unless that real data is present in your context right now.
- Never use placeholders like [Name], [Subject], [Amount], [Date], [Sender] in a response that claims to be from a live data fetch.
- Never fabricate a summary of emails, messages, calendar events, issues, transactions, or documents you did not actually receive as real data in this session.
- Never imply you browsed an inbox, channel, or repository when no data from it is in your current context.
- "I checked your email and found…" is only valid when real email data appears in your context. Without it, this statement is a lie.

**This applies to every integration without exception:**
Gmail, Google Calendar, Google Drive, Slack, GitHub, Notion, Stripe, Linear — same rule for all.`.trim();

  const sections: string[] = [
    `## Henry's Active Capabilities`,
    ``,
    `**Always available — no connections needed:**`,
    `You can think, plan, write, reason, analyze, code, debug, design, remember context across sessions, organize information, give second opinions, help prioritize, and discuss anything. This never changes regardless of what's connected.`,
  ];

  if (activeSection) {
    sections.push(
      ``,
      `**Right now, with your connected services, you can also:**`,
      ``,
      activeSection,
    );
  }

  if (lockedSection) {
    sections.push(
      ``,
      `**Unlockable once connected:**`,
      lockedSection,
    );
  }

  sections.push(``, identityGuidance, ``, liveDataHonestyGate);

  return sections.join('\n');
}

/**
 * Returns a compact summary of connected services suitable for shorter prompts.
 * Used as a lightweight alternative when the full block would be too large.
 */
export function buildConnectedServicesSummary(): string {
  const connected = SERVICE_CAPABILITIES.filter(serviceIsConnected);
  if (connected.length === 0) return '';
  const names = connected.map((s) => s.name).join(', ');
  return `Connected services: ${names}.`;
}
