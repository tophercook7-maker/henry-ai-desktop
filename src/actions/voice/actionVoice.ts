/**
 * Henry AI — Action Voice
 *
 * Single source of truth for how Henry speaks during every stage of an action:
 * suggesting, confirming, running, completing, failing, or reconnecting.
 *
 * Rules:
 *  - Plain language. No "invoking", "executing", "API", "token", "endpoint".
 *  - First person, calm, capable, specific. Not cheerful. Not robotic.
 *  - Per-action definitions first; category fallbacks second.
 *  - Success messages always say what happened AND what the user can do next.
 *  - Error messages never expose internals — only what the user needs to know.
 */

import type { ActionId, ActionCategory } from '../types/actionTypes';

// ── Service display names ─────────────────────────────────────────────────────

export const SERVICE_DISPLAY_NAMES: Record<string, string> = {
  gmail:   'Gmail',
  gcal:    'Google Calendar',
  gdrive:  'Google Drive',
  slack:   'Slack',
  github:  'GitHub',
  notion:  'Notion',
  stripe:  'Stripe',
  linear:  'Linear',
  google:  'Google',
};

export function serviceDisplayName(serviceId: string): string {
  return SERVICE_DISPLAY_NAMES[serviceId] ?? serviceId;
}

// ── Voice definition per action ───────────────────────────────────────────────

interface ActionVoiceDef {
  /** What Henry says as he begins (optional — use category fallback if absent). */
  start?: string;
  /** What Henry asks before a confirmed write. */
  confirm?: string;
  /** What Henry says on success. Should include what happened + what to do next. */
  success?: string;
  /** What Henry says on failure. No internals. */
  error?: string;
  /** What Henry says when offering this action proactively. */
  suggest?: string;
}

const ACTION_VOICE: Partial<Record<ActionId, ActionVoiceDef>> = {

  // ── Gmail ──────────────────────────────────────────────────────────────────

  'gmail.draft_reply': {
    start:   "I'll draft a reply for this thread.",
    suggest: "I can draft a reply to that — want me to write it?",
    success: "Here's the draft. Read it over and let me know if you want anything changed before saving.",
    error:   "I ran into an issue reading this thread. Try selecting it again.",
  },

  'gmail.summarize_thread': {
    start:   "I'm reading through this thread now.",
    suggest: "I can summarize this thread for you.",
    success: "Here's the summary.",
    error:   "I had trouble reading this thread. It may have been moved or the connection needs a refresh.",
  },

  'gmail.send_thread_to_chat': {
    start:   "I'm pulling this thread into our conversation.",
    success: "I've loaded the thread. What would you like to do with it?",
    error:   "I couldn't load the thread. Try opening it again.",
  },

  'gmail.save_draft': {
    start:   "I'm saving the draft to Gmail now.",
    confirm: "Ready to save this as a Gmail draft — want me to go ahead?",
    success: "Done — the draft is saved in Gmail. You can review and send it from there whenever you're ready.",
    error:   "Gmail didn't accept the draft. The content is still here — try saving again.",
  },

  // ── Google Calendar ────────────────────────────────────────────────────────

  'gcal.create_event': {
    start:   "I'm creating the event on your calendar now.",
    confirm: "Ready to add this event to your Google Calendar — want me to go ahead?",
    success: "The event is on your calendar. I've included the title, time, and any details you gave me.",
    error:   "The event couldn't be created. Check the date and time, then try again.",
    suggest: "I can put that on your calendar.",
  },

  'gcal.summarize_upcoming': {
    start:   "Let me check what's coming up for you.",
    suggest: "I can pull up your upcoming schedule.",
    success: "Here's what's on your calendar.",
    error:   "I couldn't load your calendar right now. Try again in a moment.",
  },

  'gcal.send_event_to_chat': {
    start:   "I'm pulling in this event.",
    success: "I've loaded the event. What do you want to work through — prep notes, agenda, questions?",
    error:   "I couldn't load that event. It may have been moved or deleted.",
  },

  // ── Google Drive ───────────────────────────────────────────────────────────

  'drive.summarize_file': {
    start:   "I'm reading through the file now.",
    suggest: "I can summarize this file for you.",
    success: "Here's what I found in the document.",
    error:   "I couldn't read that file. It may be restricted or the format is not supported.",
  },

  'drive.send_file_to_chat': {
    start:   "I'm pulling in the file content now.",
    success: "I've loaded the file. What would you like to do with it?",
    error:   "I couldn't load that file. Try opening it again or check if it's still accessible.",
  },

  // ── Slack ──────────────────────────────────────────────────────────────────

  'slack.summarize_channel': {
    start:   "I'm catching up on this channel.",
    suggest: "I can catch you up on what happened in this channel.",
    success: "Here's what's been going on.",
    error:   "I had trouble reading this channel. Your Slack connection may need a refresh.",
  },

  'slack.send_thread_to_chat': {
    start:   "I'm pulling this thread into our conversation.",
    success: "I've loaded the thread. What do you want to do with it?",
    error:   "I couldn't load that thread. Try selecting it again.",
  },

  'slack.compose_message': {
    start:   "I'll draft a message for this channel.",
    suggest: "I can draft a message for that channel — want me to write one?",
    success: "Here's a draft. Read it over before sending.",
    error:   "I ran into an issue drafting the message. Try again.",
  },

  'slack.send_message': {
    start:   "I'm sending the message now.",
    confirm: "Ready to send this to Slack — want me to go ahead?",
    success: "Sent. The message is in the channel.",
    error:   "The message didn't go through. Check that Slack is connected and try again.",
    suggest: "I can send a message to that channel.",
  },

  // ── GitHub ─────────────────────────────────────────────────────────────────

  'github.summarize_pr': {
    start:   "I'm reading through this pull request.",
    suggest: "I can summarize this PR for you.",
    success: "Here's the summary.",
    error:   "I couldn't read this pull request. It may have been closed or the connection needs a refresh.",
  },

  'github.summarize_issue': {
    start:   "I'm reading through this issue.",
    suggest: "I can summarize this issue and give you a read on next steps.",
    success: "Here's the summary.",
    error:   "I couldn't read this issue. It may have been closed or the connection needs a refresh.",
  },

  'github.create_issue': {
    start:   "I'm creating the issue on GitHub now.",
    confirm: "Ready to create this issue on GitHub — want me to go ahead?",
    success: "The issue is live on GitHub. I've included the title and description you gave me.",
    error:   "GitHub didn't accept the issue. Check your connection and try again.",
    suggest: "I can open that as a GitHub issue.",
  },

  // ── Notion ─────────────────────────────────────────────────────────────────

  'notion.summarize_page': {
    start:   "I'm reading through this page.",
    suggest: "I can summarize this Notion page for you.",
    success: "Here's what's on the page.",
    error:   "I couldn't read this page. It may be restricted or the connection needs a refresh.",
  },

  'notion.create_page_draft': {
    start:   "I'll draft the content for this page.",
    suggest: "I can draft the content for a new Notion page — want me to write it?",
    success: "Here's the draft. Review it and let me know if you want changes before creating the page.",
    error:   "I ran into an issue drafting the page content. Try again.",
  },

  'notion.create_page': {
    start:   "I'm creating the page in Notion now.",
    confirm: "Ready to create this page in Notion — want me to go ahead?",
    success: "The page is in Notion. You can open it there to review or continue editing.",
    error:   "Notion didn't accept the page. Check the connection and try again.",
    suggest: "I can create that as a Notion page.",
  },

  // ── Stripe ─────────────────────────────────────────────────────────────────

  'stripe.view_charge_details': {
    start:   "I'm pulling in the charge details.",
    suggest: "I can pull up the details on this charge.",
    success: "Here are the details. What would you like to know about it?",
    error:   "I couldn't load this charge. It may have been refunded or the connection needs a refresh.",
  },

  'stripe.summarize_recent': {
    start:   "I'm pulling in your recent activity.",
    suggest: "I can give you a read on your recent Stripe activity.",
    success: "Here's a summary of your recent charges.",
    error:   "I couldn't load Stripe data right now. Try again in a moment.",
  },

  // ── Linear ─────────────────────────────────────────────────────────────────

  'linear.summarize_issue': {
    start:   "I'm reading through this issue.",
    suggest: "I can summarize this issue and give you a read on next steps.",
    success: "Here's the summary.",
    error:   "I couldn't read this issue. It may have been archived or the connection needs a refresh.",
  },

  'linear.create_issue_draft': {
    start:   "I'll draft the issue for you.",
    suggest: "I can draft that as a Linear issue — title, description, and acceptance criteria.",
    success: "Here's the draft. Review it and let me know if you want to adjust anything before creating.",
    error:   "I ran into an issue drafting the ticket. Try again.",
  },

  'linear.send_issue_to_chat': {
    start:   "I'm pulling this issue into our conversation.",
    success: "I've loaded the issue. What do you want to work through?",
    error:   "I couldn't load this issue. Try selecting it again.",
  },

  'linear.create_issue': {
    start:   "I'm creating the issue in Linear now.",
    confirm: "Ready to create this issue in Linear — want me to go ahead?",
    success: "The issue is in Linear. I've included the title and description.",
    error:   "Linear didn't accept the issue. Check your connection and try again.",
    suggest: "I can create that as a Linear issue.",
  },
};

// ── Category-level fallbacks ──────────────────────────────────────────────────

const CATEGORY_VOICE: Record<ActionCategory, ActionVoiceDef> = {
  compose: {
    start:   "I'll put that together for you.",
    confirm: "Here's what I've got — ready to save it?",
    success: "Here's the draft.",
    error:   "I ran into an issue while drafting. Try again.",
    suggest: "I can draft that for you.",
  },
  send: {
    start:   "I'm sending that now.",
    confirm: "Ready to send this — want me to go ahead?",
    success: "Sent.",
    error:   "That did not go through. Try again.",
    suggest: "I can send that.",
  },
  create: {
    start:   "I'm creating that now.",
    confirm: "Ready to create this — want me to go ahead?",
    success: "Done — it has been created.",
    error:   "That could not be created. Try again.",
    suggest: "I can create that for you.",
  },
  modify: {
    start:   "I'm making that change now.",
    confirm: "Ready to make this change — want me to go ahead?",
    success: "Done.",
    error:   "That change did not go through. Try again.",
    suggest: "I can make that change.",
  },
  query: {
    start:   "I'm pulling that in now.",
    success: "Here's what I found.",
    error:   "I couldn't load that right now. Try again.",
    suggest: "I can look that up.",
  },
  chat: {
    start:   "I'm loading that into our conversation.",
    success: "I've loaded it. What would you like to do?",
    error:   "I couldn't load that. Try again.",
    suggest: "I can bring that into our conversation.",
  },
};

// ── Registry accessor (lazy import to avoid circular deps) ────────────────────

let _registry: Record<string, { category: ActionCategory }> | null = null;

async function getCategory(id: ActionId): Promise<ActionCategory> {
  if (!_registry) {
    const { REGISTRY } = await import('../registry/actionRegistry');
    _registry = REGISTRY as Record<string, { category: ActionCategory }>;
  }
  return _registry[id]?.category ?? 'chat';
}

// ── Private resolver ──────────────────────────────────────────────────────────

function voiceFor(id: ActionId): ActionVoiceDef {
  return ACTION_VOICE[id] ?? {};
}

function fallback(category: ActionCategory): ActionVoiceDef {
  return CATEGORY_VOICE[category];
}

function pick(id: ActionId, category: ActionCategory, key: keyof ActionVoiceDef): string {
  return voiceFor(id)[key] ?? fallback(category)[key] ?? '';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * What Henry says as he begins the action.
 * e.g. "I'll draft that for you."
 */
export function actionStartMessage(id: ActionId, category: ActionCategory): string {
  return pick(id, category, 'start');
}

/**
 * What Henry says when asking permission before a write.
 * e.g. "Ready to add this event to your Google Calendar — want me to go ahead?"
 */
export function actionConfirmMessage(id: ActionId, category: ActionCategory): string {
  return pick(id, category, 'confirm');
}

/**
 * What Henry says when the action succeeds.
 * Includes what happened and what the user can do next.
 */
export function actionSuccessMessage(id: ActionId, category: ActionCategory): string {
  return pick(id, category, 'success');
}

/**
 * What Henry says when the action fails.
 * Never exposes internals — only what the user needs to know.
 */
export function actionErrorMessage(id: ActionId, category: ActionCategory): string {
  return pick(id, category, 'error');
}

/**
 * What Henry says when offering an action proactively.
 * e.g. "I can draft a reply to that — want me to write it?"
 */
export function actionSuggestMessage(id: ActionId, category: ActionCategory): string {
  return pick(id, category, 'suggest');
}

/**
 * What Henry says when a service needs to be reconnected.
 * e.g. "Your Google connection needs to be refreshed before I can finish that."
 */
export function actionReconnectMessage(service: string): string {
  const name = serviceDisplayName(service);
  return `Your ${name} connection needs to be refreshed before I can do that. Head to the integrations panel to reconnect.`;
}

/**
 * What Henry says when a service is not connected at all.
 * e.g. "I can do that once Google is connected."
 */
export function actionNotConnectedMessage(service: string): string {
  const name = serviceDisplayName(service);
  return `I can do that once ${name} is connected. You can set it up in the integrations panel.`;
}

/**
 * Async variant — resolves action category from the registry automatically.
 * Use this when you only have an ActionId and no category at hand.
 */
export async function resolveActionStartMessage(id: ActionId): Promise<string> {
  return actionStartMessage(id, await getCategory(id));
}

export async function resolveActionConfirmMessage(id: ActionId): Promise<string> {
  return actionConfirmMessage(id, await getCategory(id));
}

export async function resolveActionSuccessMessage(id: ActionId): Promise<string> {
  return actionSuccessMessage(id, await getCategory(id));
}

export async function resolveActionErrorMessage(id: ActionId): Promise<string> {
  return actionErrorMessage(id, await getCategory(id));
}

export async function resolveActionSuggestMessage(id: ActionId): Promise<string> {
  return actionSuggestMessage(id, await getCategory(id));
}
