/**
 * Action Layer — central registry.
 *
 * Maps ActionId → definition and → handler.
 * Call registerAllHandlers() once at app init to wire up all handlers.
 *
 * To add a new action:
 *   1. Add its ID to ActionId in actionTypes.ts
 *   2. Add its capability requirements in actionCapabilities.ts
 *   3. Add its definition in REGISTRY below
 *   4. Implement its handler and add the import + registerHandler call
 *      inside registerAllHandlers()
 */

import type { HenryAction, ActionId, ActionHandler, ActionResult } from '../types/actionTypes';

// ── Registry ──────────────────────────────────────────────────────────────────

export const REGISTRY: Record<ActionId, HenryAction> = {
  // Gmail
  'gmail.draft_reply':         { id: 'gmail.draft_reply',         service: 'gmail',  action: 'draftReply',           label: 'Draft reply',           description: 'Henry writes a reply for this thread.',               category: 'compose', requiresConnection: true,  requiresConfirmation: false, enabled: true,  readonly: false },
  'gmail.summarize_thread':    { id: 'gmail.summarize_thread',    service: 'gmail',  action: 'summarizeThread',      label: 'Summarize thread',      description: 'Ask Henry to summarize this email thread.',           category: 'chat',    requiresConnection: true,  requiresConfirmation: false, enabled: true,  readonly: true  },
  'gmail.send_thread_to_chat': { id: 'gmail.send_thread_to_chat', service: 'gmail',  action: 'sendThreadToChat',     label: 'Send to Henry',         description: 'Open this thread in Henry chat.',                     category: 'chat',    requiresConnection: true,  requiresConfirmation: false, enabled: true,  readonly: true  },

  // Calendar
  'gcal.create_event':         { id: 'gcal.create_event',         service: 'gcal',   action: 'createEvent',          label: 'Create event',          description: 'Schedule a new calendar event.',                      category: 'create',  requiresConnection: true,  requiresConfirmation: true,  enabled: true,  readonly: false, confirmationPrompt: 'Create this event on your Google Calendar?' },
  'gcal.summarize_upcoming':   { id: 'gcal.summarize_upcoming',   service: 'gcal',   action: 'summarizeUpcoming',    label: 'Summarize schedule',    description: 'Ask Henry to recap your upcoming events.',            category: 'chat',    requiresConnection: true,  requiresConfirmation: false, enabled: true,  readonly: true  },
  'gcal.send_event_to_chat':   { id: 'gcal.send_event_to_chat',   service: 'gcal',   action: 'sendEventToChat',      label: 'Prep this event',       description: 'Ask Henry to prepare notes for this meeting.',        category: 'chat',    requiresConnection: true,  requiresConfirmation: false, enabled: true,  readonly: true  },

  // Drive
  'drive.summarize_file':      { id: 'drive.summarize_file',      service: 'gdrive', action: 'summarizeFile',        label: 'Summarize file',        description: 'Ask Henry to summarize this document.',               category: 'chat',    requiresConnection: true,  requiresConfirmation: false, enabled: true,  readonly: true  },
  'drive.send_file_to_chat':   { id: 'drive.send_file_to_chat',   service: 'gdrive', action: 'sendFileToChat',       label: 'Send to Henry',         description: 'Open this file in Henry chat.',                       category: 'chat',    requiresConnection: true,  requiresConfirmation: false, enabled: true,  readonly: true  },

  // Slack
  'slack.summarize_channel':   { id: 'slack.summarize_channel',   service: 'slack',  action: 'summarizeChannel',     label: 'Summarize channel',     description: 'Ask Henry to summarize recent channel activity.',     category: 'chat',    requiresConnection: true,  requiresConfirmation: false, enabled: true,  readonly: true  },
  'slack.send_thread_to_chat': { id: 'slack.send_thread_to_chat', service: 'slack',  action: 'sendThreadToChat',     label: 'Send to Henry',         description: 'Send this Slack thread to Henry chat.',               category: 'chat',    requiresConnection: true,  requiresConfirmation: false, enabled: true,  readonly: true  },
  'slack.compose_message':     { id: 'slack.compose_message',     service: 'slack',  action: 'composeMessage',       label: 'Prepare message',       description: 'Henry drafts a message for this channel.',            category: 'compose', requiresConnection: true,  requiresConfirmation: false, enabled: true,  readonly: false },
  'slack.send_message':        { id: 'slack.send_message',        service: 'slack',  action: 'sendMessage',          label: 'Send message',          description: 'Send a message to a Slack channel.',                  category: 'send',    requiresConnection: true,  requiresConfirmation: true,  enabled: true,  readonly: false,  confirmationPrompt: 'Send this message to Slack?' },

  // GitHub
  'github.summarize_pr':       { id: 'github.summarize_pr',       service: 'github', action: 'summarizePR',          label: 'Summarize PR',          description: 'Ask Henry to summarize this pull request.',           category: 'chat',    requiresConnection: true,  requiresConfirmation: false, enabled: true,  readonly: true  },
  'github.summarize_issue':    { id: 'github.summarize_issue',    service: 'github', action: 'summarizeIssue',       label: 'Summarize issue',       description: 'Ask Henry to summarize and triage this issue.',       category: 'chat',    requiresConnection: true,  requiresConfirmation: false, enabled: true,  readonly: true  },
  'github.create_issue':       { id: 'github.create_issue',       service: 'github', action: 'createIssue',          label: 'Create issue',          description: 'Open a new GitHub issue.',                            category: 'create',  requiresConnection: true,  requiresConfirmation: true,  enabled: true,  readonly: false,  confirmationPrompt: 'Create this issue on GitHub?' },

  // Notion
  'notion.summarize_page':     { id: 'notion.summarize_page',     service: 'notion', action: 'summarizePage',        label: 'Summarize page',        description: 'Ask Henry to summarize this Notion page.',            category: 'chat',    requiresConnection: true,  requiresConfirmation: false, enabled: true,  readonly: true  },
  'notion.create_page_draft':  { id: 'notion.create_page_draft',  service: 'notion', action: 'createPageDraft',      label: 'Draft new page',        description: 'Henry drafts content for a new Notion page.',         category: 'compose', requiresConnection: true,  requiresConfirmation: false, enabled: true,  readonly: false },

  // Stripe
  'stripe.view_charge_details':{ id: 'stripe.view_charge_details',service: 'stripe', action: 'viewChargeDetails',    label: 'View in Henry',         description: 'See charge details and ask Henry about it.',          category: 'chat',    requiresConnection: true,  requiresConfirmation: false, enabled: true,  readonly: true  },
  'stripe.summarize_recent':   { id: 'stripe.summarize_recent',   service: 'stripe', action: 'summarizeRecent',      label: 'Summarize revenue',     description: 'Ask Henry to recap recent charges and revenue.',      category: 'chat',    requiresConnection: true,  requiresConfirmation: false, enabled: true,  readonly: true  },

  // Linear
  'linear.summarize_issue':    { id: 'linear.summarize_issue',    service: 'linear', action: 'summarizeIssue',       label: 'Summarize issue',       description: 'Ask Henry to summarize and give next steps.',         category: 'chat',    requiresConnection: true,  requiresConfirmation: false, enabled: true,  readonly: true  },
  'linear.create_issue_draft': { id: 'linear.create_issue_draft', service: 'linear', action: 'createIssueDraft',     label: 'Draft new issue',       description: 'Henry helps you write a new issue.',                  category: 'compose', requiresConnection: true,  requiresConfirmation: false, enabled: true,  readonly: false },
  'linear.send_issue_to_chat': { id: 'linear.send_issue_to_chat', service: 'linear', action: 'sendIssueToChat',      label: 'Send to Henry',         description: 'Open this issue in Henry chat.',                      category: 'chat',    requiresConnection: true,  requiresConfirmation: false, enabled: true,  readonly: true  },
  'linear.create_issue':       { id: 'linear.create_issue',       service: 'linear', action: 'createIssue',          label: 'Create issue',          description: 'Create a new Linear issue directly.',                 category: 'create',  requiresConnection: true,  requiresConfirmation: true,  enabled: true,  readonly: false, confirmationPrompt: 'Create this issue in Linear?' },

  // Notion write
  'notion.create_page':        { id: 'notion.create_page',        service: 'notion', action: 'createPage',           label: 'Create page',           description: 'Create a new page in Notion under a parent page.',    category: 'create',  requiresConnection: true,  requiresConfirmation: true,  enabled: true,  readonly: false, confirmationPrompt: 'Create this page in Notion?' },

  // Gmail save draft
  'gmail.save_draft':          { id: 'gmail.save_draft',          service: 'gmail',  action: 'saveDraft',            label: 'Save as Gmail draft',   description: 'Save a ready draft to Gmail Drafts.',                 category: 'send',    requiresConnection: true,  requiresConfirmation: true,  enabled: true,  readonly: false, confirmationPrompt: 'Save this reply as a Gmail draft?' },
};

// ── Handler map ───────────────────────────────────────────────────────────────

const HANDLERS = new Map<ActionId, ActionHandler>();

export function getActions(serviceId?: string): HenryAction[] {
  const all = Object.values(REGISTRY);
  return serviceId ? all.filter((a) => a.service === serviceId) : all;
}

export function getAction(id: ActionId): HenryAction | undefined {
  return REGISTRY[id];
}

export function registerHandler(id: ActionId, handler: ActionHandler): void {
  HANDLERS.set(id, handler);
}

export async function runAction(
  id: ActionId,
  input: Record<string, unknown>
): Promise<ActionResult> {
  const handler = HANDLERS.get(id);
  if (!handler) {
    throw new Error(`Action "${id}" has no registered handler.`);
  }
  return handler(input);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

let _registered = false;

/**
 * Call once at app init. Imports and registers all action handlers.
 * Safe to call multiple times — only registers once.
 */
export async function registerAllHandlers(): Promise<void> {
  if (_registered) return;
  _registered = true;

  const [
    gmail, gcal, drive, slack, github, notion, stripe, linear,
  ] = await Promise.all([
    import('../handlers/gmail/gmailActions'),
    import('../handlers/gcal/calendarActions'),
    import('../handlers/drive/driveActions'),
    import('../handlers/slack/slackActions'),
    import('../handlers/github/githubActions'),
    import('../handlers/notion/notionActions'),
    import('../handlers/stripe/stripeActions'),
    import('../handlers/linear/linearActions'),
  ]);

  gmail.registerGmailHandlers();
  gcal.registerCalendarHandlers();
  drive.registerDriveHandlers();
  slack.registerSlackHandlers();
  github.registerGithubHandlers();
  notion.registerNotionHandlers();
  stripe.registerStripeHandlers();
  linear.registerLinearHandlers();
}
