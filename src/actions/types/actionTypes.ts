/**
 * Action Layer — shared type definitions.
 *
 * Three categories:
 *   1. HenryAction  — what an action IS (registry definition)
 *   2. ActionExecution — what happens when it RUNS (runtime state)
 *   3. ActionHandler  — the function that implements it
 */

// ── Status ────────────────────────────────────────────────────────────────────

export type ActionStatus =
  | 'idle'
  | 'running'
  | 'success'
  | 'error'
  | 'needs_confirmation';

// ── Categories ────────────────────────────────────────────────────────────────

export type ActionCategory =
  | 'compose'    // draft / write content
  | 'send'       // send to external service
  | 'create'     // create a new record
  | 'modify'     // update or delete an existing record
  | 'query'      // read-only lookup or search
  | 'chat';      // send context into Henry chat

// ── Action IDs ────────────────────────────────────────────────────────────────

export type ActionId =
  // Gmail
  | 'gmail.draft_reply'
  | 'gmail.summarize_thread'
  | 'gmail.send_thread_to_chat'
  // Calendar
  | 'gcal.create_event'
  | 'gcal.summarize_upcoming'
  | 'gcal.send_event_to_chat'
  // Drive
  | 'drive.summarize_file'
  | 'drive.send_file_to_chat'
  // Slack
  | 'slack.summarize_channel'
  | 'slack.send_thread_to_chat'
  | 'slack.compose_message'
  | 'slack.send_message'
  // GitHub
  | 'github.summarize_pr'
  | 'github.summarize_issue'
  | 'github.create_issue'
  // Notion
  | 'notion.summarize_page'
  | 'notion.create_page_draft'
  // Stripe
  | 'stripe.view_charge_details'
  | 'stripe.summarize_recent'
  // Linear
  | 'linear.summarize_issue'
  | 'linear.create_issue_draft'
  | 'linear.send_issue_to_chat'
  | 'linear.create_issue'
  // Notion write
  | 'notion.create_page'
  // Gmail save
  | 'gmail.save_draft';

// ── Core action model ─────────────────────────────────────────────────────────

/**
 * What an action IS — the registry definition.
 * Human-readable, capability-aware, confirmation-aware.
 */
export interface HenryAction {
  id: ActionId;
  service: string;
  action: string;
  label: string;
  description?: string;
  category: ActionCategory;
  requiresConnection: boolean;
  requiresConfirmation?: boolean;
  confirmationPrompt?: string;
  capability?: string;
  /** True = implemented. False = planned/stubbed. */
  enabled: boolean;
  /** Read-only actions never write to external services. */
  readonly?: boolean;
}

/** Kept for compatibility with the existing registry API */
export type ActionDefinition = HenryAction;

// ── Runtime ───────────────────────────────────────────────────────────────────

export interface ActionExecutionResult {
  success: boolean;
  status: ActionStatus;
  message?: string;
  data?: unknown;
  error?: string;
}

/** Backward compat */
export interface ActionResult {
  success: boolean;
  message?: string;
  data?: unknown;
}

/** Input passed to a handler. Typed per-action by the handler itself. */
export type ActionInput = Record<string, unknown>;

/** Every action handler implements this signature. */
export type ActionHandler = (input: ActionInput) => Promise<ActionResult>;
