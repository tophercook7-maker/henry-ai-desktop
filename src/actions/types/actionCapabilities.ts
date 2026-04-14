/**
 * Action Layer — capability definitions.
 *
 * Maps each action to the minimum scopes/capabilities it requires
 * from the connected service. The resolver checks these before
 * allowing an action to run.
 *
 * Capability strings are informal and human-readable — they are
 * matched against what each service provider declares it supports.
 */

import type { ActionId } from './actionTypes';

export interface CapabilityRequirement {
  service: string;
  capabilities: string[];
  /** True = this action writes to the external service */
  isWrite: boolean;
  /** True = requires explicit user confirmation before execution */
  needsConfirmation: boolean;
}

export const ACTION_CAPABILITIES: Record<ActionId, CapabilityRequirement> = {
  // ── Gmail ─────────────────────────────────────────────────────────────────
  'gmail.draft_reply':        { service: 'gmail',  capabilities: ['gmail.readonly'],   isWrite: false, needsConfirmation: false },
  'gmail.summarize_thread':   { service: 'gmail',  capabilities: ['gmail.readonly'],   isWrite: false, needsConfirmation: false },
  'gmail.send_thread_to_chat':{ service: 'gmail',  capabilities: ['gmail.readonly'],   isWrite: false, needsConfirmation: false },

  // ── Calendar ──────────────────────────────────────────────────────────────
  'gcal.create_event':        { service: 'gcal',   capabilities: ['calendar.events'],  isWrite: true,  needsConfirmation: true  },
  'gcal.summarize_upcoming':  { service: 'gcal',   capabilities: ['calendar.readonly'],isWrite: false, needsConfirmation: false },
  'gcal.send_event_to_chat':  { service: 'gcal',   capabilities: ['calendar.readonly'],isWrite: false, needsConfirmation: false },

  // ── Drive ─────────────────────────────────────────────────────────────────
  'drive.summarize_file':     { service: 'gdrive', capabilities: ['drive.readonly'],   isWrite: false, needsConfirmation: false },
  'drive.send_file_to_chat':  { service: 'gdrive', capabilities: ['drive.readonly'],   isWrite: false, needsConfirmation: false },

  // ── Slack ─────────────────────────────────────────────────────────────────
  'slack.summarize_channel':  { service: 'slack',  capabilities: ['channels:history'], isWrite: false, needsConfirmation: false },
  'slack.send_thread_to_chat':{ service: 'slack',  capabilities: ['channels:history'], isWrite: false, needsConfirmation: false },
  'slack.compose_message':    { service: 'slack',  capabilities: ['chat:write'],        isWrite: true,  needsConfirmation: false },
  'slack.send_message':       { service: 'slack',  capabilities: ['chat:write'],        isWrite: true,  needsConfirmation: true  },

  // ── GitHub ────────────────────────────────────────────────────────────────
  'github.summarize_pr':      { service: 'github', capabilities: ['repo'],              isWrite: false, needsConfirmation: false },
  'github.summarize_issue':   { service: 'github', capabilities: ['repo'],              isWrite: false, needsConfirmation: false },
  'github.create_issue':      { service: 'github', capabilities: ['repo'],              isWrite: true,  needsConfirmation: true  },

  // ── Notion ────────────────────────────────────────────────────────────────
  'notion.summarize_page':    { service: 'notion', capabilities: ['read_content'],      isWrite: false, needsConfirmation: false },
  'notion.create_page_draft': { service: 'notion', capabilities: ['read_content'],      isWrite: false, needsConfirmation: false },

  // ── Stripe ────────────────────────────────────────────────────────────────
  'stripe.view_charge_details':{ service: 'stripe', capabilities: ['charges.read'],     isWrite: false, needsConfirmation: false },
  'stripe.summarize_recent':   { service: 'stripe', capabilities: ['charges.read'],     isWrite: false, needsConfirmation: false },

  // ── Linear ────────────────────────────────────────────────────────────────
  'linear.summarize_issue':    { service: 'linear', capabilities: ['issues.read'],      isWrite: false, needsConfirmation: false },
  'linear.create_issue_draft': { service: 'linear', capabilities: ['issues.read'],      isWrite: false, needsConfirmation: false },
  'linear.send_issue_to_chat': { service: 'linear', capabilities: ['issues.read'],      isWrite: false, needsConfirmation: false },
  'linear.create_issue':       { service: 'linear', capabilities: ['issues.write'],     isWrite: true,  needsConfirmation: true  },

  // ── Notion write ──────────────────────────────────────────────────────────
  'notion.create_page':        { service: 'notion', capabilities: ['read_content'],     isWrite: true,  needsConfirmation: true  },

  // ── Gmail save draft ──────────────────────────────────────────────────────
  'gmail.save_draft':          { service: 'gmail',  capabilities: ['gmail.compose'],    isWrite: true,  needsConfirmation: true  },
};
