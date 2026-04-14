/**
 * Henry AI — Context Tier System
 *
 * Classifies message intent and selects the appropriate context tier before
 * every AI call. Keeps Groq (and all providers) well within TPM limits.
 *
 * THREE TIERS:
 *   LIGHT  — default for most conversational turns.
 *            Core identity + mode + up to 8 recent messages (~1,500 sys tokens).
 *   MEDIUM — multi-turn reasoning, project work, follow-up threads.
 *            Adds top facts + short summary + 16 messages (~3,000 sys tokens).
 *   FULL   — rare: deep research, biblical study, workspace-heavy tasks.
 *            Full existing system prompt (capped at existing OPTIONAL_BUDGET).
 *
 * TOKEN GUARD:
 *   Before sending, estimate total tokens. If over TOKEN_HARD_LIMIT, trim
 *   history automatically until the payload fits.
 */

// ── Token estimation ──────────────────────────────────────────────────────────

/** 1 token ≈ 4 chars (matches OpenAI's rough tokenizer average). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate total tokens for a messages array.
 * Adds 4 tokens per message for role/structure overhead.
 */
export function estimatePayloadTokens(
  messages: Array<{ role: string; content: string }>
): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
}

/** Hard cap: never send more than this many tokens to any provider. */
export const TOKEN_HARD_LIMIT = 8_000;

// ── Context tiers ─────────────────────────────────────────────────────────────

export type ContextTier = 'light' | 'medium' | 'full';

/** Per-tier history caps (message count, chars per message). */
export const TIER_HISTORY_CAPS: Record<
  ContextTier,
  { maxMessages: number; maxCharsEach: number }
> = {
  light:  { maxMessages: 8,  maxCharsEach: 2_000 },
  medium: { maxMessages: 16, maxCharsEach: 4_000 },
  full:   { maxMessages: 40, maxCharsEach: 8_000 },
};

/** Per-tier memory block caps (facts, summary chars, workspace hints). */
export const TIER_MEMORY_CAPS: Record<
  ContextTier,
  { maxFacts: number; maxSummaryChars: number; maxWorkspaceHints: number }
> = {
  light:  { maxFacts: 0,  maxSummaryChars: 0,      maxWorkspaceHints: 0  },
  medium: { maxFacts: 5,  maxSummaryChars: 1_000,  maxWorkspaceHints: 3  },
  full:   { maxFacts: 50, maxSummaryChars: 12_000, maxWorkspaceHints: 20 },
};

// ── Intent classification ─────────────────────────────────────────────────────

export type MessageIntent =
  | 'awareness'
  | 'integration_gmail'
  | 'integration_gcal'
  | 'integration_slack'
  | 'integration_github'
  | 'integration_notion'
  | 'integration_stripe'
  | 'integration_linear'
  | 'normal';

const AWARENESS_RE = /what can you do|are you aware|how can you help|who are you|what('?s| is) connected|what services|what (are|do) you (know|have access|see|track)|what('?s| is) (your|henry'?s?) capabilit/i;
const GMAIL_RE     = /\bemail\b|\bgmail\b|\binbox\b|\bmail\b/i;
const GCAL_RE      = /\bcalendar\b|\bschedule\b|\bevent\b|\bmeeting\b|\bappointment\b/i;
const SLACK_RE     = /\bslack\b|\bchannel\b/i;
const GITHUB_RE    = /\bgithub\b|\brepo\b|\bpull request\b|\bpr\b|\bgit issue\b/i;
const NOTION_RE    = /\bnotion\b/i;
const STRIPE_RE    = /\bstripe\b|\bpayment\b|\bcharge\b|\brevenue\b/i;
const LINEAR_RE    = /\blinear\b|\bticket\b|\bsprint\b/i;

export function classifyMessageIntent(message: string): MessageIntent {
  if (AWARENESS_RE.test(message))  return 'awareness';
  if (GMAIL_RE.test(message))      return 'integration_gmail';
  if (GCAL_RE.test(message))       return 'integration_gcal';
  if (SLACK_RE.test(message))      return 'integration_slack';
  if (GITHUB_RE.test(message))     return 'integration_github';
  if (NOTION_RE.test(message))     return 'integration_notion';
  if (STRIPE_RE.test(message))     return 'integration_stripe';
  if (LINEAR_RE.test(message))     return 'integration_linear';
  return 'normal';
}

/**
 * Pick the appropriate context tier given message intent and conversation depth.
 *
 * @param intent - Classified message intent.
 * @param historyLength - Number of messages in the current thread.
 * @param hasWorkspaceContext - True when a workspace file/folder is attached.
 * @param isBiblicalMode - True when mode is 'biblical' (always needs FULL for corpus).
 */
export function selectContextTier(
  intent: MessageIntent,
  historyLength: number,
  hasWorkspaceContext: boolean,
  isBiblicalMode: boolean
): ContextTier {
  if (isBiblicalMode) return 'full';
  if (hasWorkspaceContext) return 'medium';

  switch (intent) {
    case 'awareness':
      return 'light';
    case 'integration_gmail':
    case 'integration_gcal':
    case 'integration_slack':
    case 'integration_github':
    case 'integration_notion':
    case 'integration_stripe':
    case 'integration_linear':
      return 'light';
    case 'normal':
    default:
      if (historyLength > 20) return 'medium';
      return 'light';
  }
}

// ── History trimmer ───────────────────────────────────────────────────────────

/**
 * Trim message history so the full payload stays within `hardLimit` tokens.
 * Always preserves the most recent messages. Returns empty array if the system
 * prompt alone already exceeds the limit.
 */
export function trimHistoryToTokenBudget(
  history: Array<{ role: string; content: string }>,
  systemPromptTokens: number,
  hardLimit: number = TOKEN_HARD_LIMIT
): Array<{ role: string; content: string }> {
  const historyBudget = hardLimit - systemPromptTokens - 400;
  if (historyBudget <= 0) return [];

  const result: Array<{ role: string; content: string }> = [];
  let used = 0;

  for (let i = history.length - 1; i >= 0; i--) {
    const cost = estimateTokens(history[i].content) + 4;
    if (used + cost > historyBudget) break;
    result.unshift(history[i]);
    used += cost;
  }

  return result;
}

// ── Logging ───────────────────────────────────────────────────────────────────

export interface ContextLog {
  tier: ContextTier;
  intent: MessageIntent;
  systemTokens: number;
  historyTokensBefore: number;
  historyTokensAfter: number;
  totalTokens: number;
  historyCountBefore: number;
  historyCountAfter: number;
  trimmed: boolean;
}

export function logContextDecision(log: ContextLog): void {
  const trimNote = log.trimmed
    ? ` [TRIMMED ${log.historyCountBefore - log.historyCountAfter} msgs, saved ${log.historyTokensBefore - log.historyTokensAfter} tokens]`
    : '';
  console.log(
    `[Henry:ctx] tier=${log.tier} intent=${log.intent} ` +
    `sys=${log.systemTokens}t hist=${log.historyTokensAfter}t ` +
    `total=${log.totalTokens}t${trimNote}`
  );
}
