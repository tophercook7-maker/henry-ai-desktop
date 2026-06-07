/**
 * ToolRunner — wraps a single-round model `complete` call in a tool-calling
 * loop and enforces the safety model (design §5, §7).
 *
 * The runner is provider-agnostic: `ai.ts` supplies a `complete` callback that
 * runs one model round (with the registry's tools attached) and returns the
 * assistant's text plus any tool calls. The runner then, per tool:
 *   - silent : execute immediately, log it, continue
 *   - notify : execute, fire a renderer toast, continue
 *   - confirm: emit `agent:confirm-required`, await `agent:confirm-response`,
 *              and only execute if approved (using edited args if provided)
 * Every call + result is written to the session store as a `tool` message.
 *
 * Loops at most `maxRounds` (default 10) to prevent runaway tool use.
 */

import { randomUUID } from 'crypto';
import type { AgentContext, ModelTool, ToolResult } from './types';
import type { ToolRegistry } from './toolRegistry';

// ── Conversation shape passed to / from the model ──────────────────────────

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface RunnerMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Present on an assistant turn that requested tools. */
  toolCalls?: ModelToolCall[];
  /** Present on a tool-result turn. */
  toolCallId?: string;
  /** Tool name on a tool-result turn. */
  name?: string;
}

export interface ModelCompletion {
  content: string;
  toolCalls: ModelToolCall[];
  usage?: { input: number; output: number };
}

/** Runs one model round with the given tools. Supplied by `ai.ts`. */
export type CompleteFn = (
  messages: RunnerMessage[],
  modelTools: ModelTool[],
) => Promise<ModelCompletion>;

// ── Confirmation bus (confirm-tier tools) ──────────────────────────────────

interface PendingConfirm {
  resolve: (r: { approved: boolean; editedArgs?: Record<string, unknown> }) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingConfirms = new Map<string, PendingConfirm>();
const CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Resolve a pending confirm-tier tool call. Called by the
 * `agent:confirm-response` IPC handler when the renderer replies. Returns true
 * if a matching pending request was found.
 */
export function resolveConfirmation(
  id: string,
  approved: boolean,
  editedArgs?: Record<string, unknown>,
): boolean {
  const pending = pendingConfirms.get(id);
  if (!pending) return false;
  clearTimeout(pending.timer);
  pendingConfirms.delete(id);
  pending.resolve({ approved, editedArgs });
  return true;
}

function requestConfirmation(
  context: AgentContext,
  payload: { id: string; toolName: string; args: Record<string, unknown>; description: string },
): Promise<{ approved: boolean; editedArgs?: Record<string, unknown> }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingConfirms.delete(payload.id);
      resolve({ approved: false }); // timeout → treat as rejection
    }, CONFIRM_TIMEOUT_MS);
    pendingConfirms.set(payload.id, { resolve, timer });

    const win = context.getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('agent:confirm-required', { ...payload, safetyLevel: 'confirm' });
    } else {
      // No renderer to confirm — fail safe.
      clearTimeout(timer);
      pendingConfirms.delete(payload.id);
      resolve({ approved: false });
    }
  });
}

// ── Renderer signalling ────────────────────────────────────────────────────

function send(context: AgentContext, channel: string, data: unknown): void {
  const win = context.getWindow();
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

// ── Session-store audit log ────────────────────────────────────────────────
// SessionStore lives at electron/ipc/sessionStore.ts (committed); we log each
// tool call there as a `tool` message via its exported helper. The import is
// resolved lazily so the runner stays usable even if the store is unavailable.
async function logToolCall(
  context: AgentContext,
  call: ModelToolCall,
  result: ToolResult,
): Promise<void> {
  if (!context.sessionId) return;
  try {
    const { recordSessionMessage } = await import('../ipc/sessionStore');
    await recordSessionMessage({
      session_id: context.sessionId,
      role: 'tool',
      content: JSON.stringify({ args: call.arguments, result }),
      tool_name: call.name,
      tool_call_id: call.id,
    });
  } catch (e) {
    // TODO(Sprint 3): surface audit-log failures in the "What Henry Did" panel.
    console.error('[agent:toolRunner] session log failed:', e instanceof Error ? e.message : e);
  }
}

// ── Single tool call: gate → execute → signal ──────────────────────────────

async function executeToolCall(
  registry: ToolRegistry,
  context: AgentContext,
  call: ModelToolCall,
): Promise<ToolResult> {
  const tool = registry.getTool(call.name);
  if (!tool) return { ok: false, error: `Unknown tool: ${call.name}` };

  let args: Record<string, unknown> = call.arguments ?? {};
  const describe = tool.confirmPrompt ? tool.confirmPrompt(args) : `Run ${tool.name}`;

  // confirm tier — pause for the user before doing anything.
  if (tool.safetyLevel === 'confirm') {
    const decision = await requestConfirmation(context, {
      id: randomUUID(),
      toolName: tool.name,
      args,
      description: describe,
    });
    if (!decision.approved) {
      return { ok: false, error: 'User declined the action.' };
    }
    if (decision.editedArgs) args = decision.editedArgs;
  }

  send(context, 'agent:tool-started', { tool: tool.name, args });

  let result: ToolResult;
  try {
    result = await tool.execute(args, context);
  } catch (e) {
    result = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  send(context, 'agent:tool-completed', { tool: tool.name, result });

  // notify tier — non-blocking toast describing what just happened.
  if (tool.safetyLevel === 'notify') {
    send(context, 'agent:tool-notify', {
      tool: tool.name,
      message: describe,
      ok: result.ok,
    });
  }

  if (tool.safetyLevel === 'silent') {
    console.log(`[agent:tool] ${tool.name} ok=${result.ok}`);
  }

  return result;
}

// ── Main loop ──────────────────────────────────────────────────────────────

export interface RunToolConversationOpts {
  registry: ToolRegistry;
  context: AgentContext;
  messages: RunnerMessage[];
  complete: CompleteFn;
  maxRounds?: number;
}

export interface RunToolConversationResult {
  content: string;
  rounds: number;
  usage: { input: number; output: number };
}

export async function runToolConversation(
  opts: RunToolConversationOpts,
): Promise<RunToolConversationResult> {
  const { registry, context, complete } = opts;
  const maxRounds = opts.maxRounds ?? 10;
  const messages: RunnerMessage[] = [...opts.messages];
  const modelTools = registry.toModelTools();
  const usage = { input: 0, output: 0 };

  let rounds = 0;
  while (rounds < maxRounds) {
    rounds++;
    const completion = await complete(messages, modelTools);
    if (completion.usage) {
      usage.input += completion.usage.input;
      usage.output += completion.usage.output;
    }

    // No tool calls → the model is done; return its answer.
    if (!completion.toolCalls || completion.toolCalls.length === 0) {
      return { content: completion.content ?? '', rounds, usage };
    }

    // Record the assistant's tool-call turn, then run each call.
    messages.push({
      role: 'assistant',
      content: completion.content ?? '',
      toolCalls: completion.toolCalls,
    });

    for (const call of completion.toolCalls) {
      const result = await executeToolCall(registry, context, call);
      messages.push({
        role: 'tool',
        name: call.name,
        toolCallId: call.id,
        content: JSON.stringify(result),
      });
      await logToolCall(context, call, result);
    }
  }

  return {
    content: 'I reached my action limit for this task (10 tool calls).',
    rounds,
    usage,
  };
}
