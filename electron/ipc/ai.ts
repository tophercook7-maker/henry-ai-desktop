/**
 * AI — Multi-provider AI with streaming support.
 *
 * IPC channels (match preload.ts):
 *   ai:send   — Non-streaming request (ipcMain.handle)
 *   ai:stream — Streaming request (ipcMain.handle, sends chunks via webContents)
 *   ai:cancel — Cancel a stream
 *
 * Also exports callAI() for use by the taskBroker Worker engine.
 */

import { ipcMain, BrowserWindow } from 'electron';
import type Database from 'better-sqlite3';

type WindowGetter = () => BrowserWindow | null;

/** Safely send to renderer — skips if window is destroyed (Vite HMR). */
function safeSend(getWin: WindowGetter, channel: string, data: unknown) {
  const win = getWin();
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

// ── Types ─────────────────────────────────────────────────────

interface AiMessage {
  role: string;
  content: string;
}

interface AiRequest {
  provider: string;
  model: string;
  apiKey: string;
  messages: AiMessage[];
  temperature?: number;
  maxTokens?: number;
  channelId?: string;
  signal?: AbortSignal;
  /**
   * Optional base URL override. Used by Ollama to pass the configured
   * endpoint from settings instead of defaulting to localhost:11434.
   */
  apiUrl?: string;
}

// ── Pricing ───────────────────────────────────────────────────

export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI — prices per 1M tokens (USD)
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'o1': { input: 15.0, output: 60.0 },
  'o1-mini': { input: 3.0, output: 12.0 },
  'o3-mini': { input: 1.1, output: 4.4 },
  'o4-mini': { input: 1.1, output: 4.4 },
  // Anthropic
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4.0 },
  'claude-opus-4-20250514': { input: 15.0, output: 75.0 },
  'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
  // Google
  'gemini-1.5-pro': { input: 1.25, output: 5.0 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  'gemini-2.5-pro': { input: 1.25, output: 10.0 },
  'gemini-2.5-flash': { input: 0.15, output: 0.6 },
  // Groq
  'llama-3.1-8b-instant': { input: 0.05, output: 0.08 },
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  'llama-3.1-70b-versatile': { input: 0.59, output: 0.79 },
  'llama-4-scout-17b-16e-instruct': { input: 0.11, output: 0.34 },
  'llama-4-maverick-17b-128e-instruct': { input: 0.2, output: 0.6 },
  'mixtral-8x7b-32768': { input: 0.24, output: 0.24 },
  'gemma2-9b-it': { input: 0.20, output: 0.20 },
  'llama3-groq-70b-8192-tool-use-preview': { input: 0.89, output: 0.89 },
  'deepseek-r1-distill-llama-70b': { input: 0.75, output: 0.99 },
  // Local (free)
  'llama3.1:70b': { input: 0, output: 0 },
  'llama3.1:8b': { input: 0, output: 0 },
  'llama3.2:3b': { input: 0, output: 0 },
  'mistral-large': { input: 0, output: 0 },
  'codellama:34b': { input: 0, output: 0 },
  'phi4': { input: 0, output: 0 },
  'qwen2.5:72b': { input: 0, output: 0 },
};

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  // Add 5% buffer for retries / overhead
  const base = (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
  return Math.round(base * 1.05 * 1_000_000) / 1_000_000;
}

/** Returns true for transient errors that are safe to retry (5xx, network timeouts). */
function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('fetch failed') || msg.includes('network') || msg.includes('econnreset') || msg.includes('etimedout')) return true;
  }
  return false;
}

/** Retry an async operation up to maxRetries times with exponential backoff. */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 2, baseDelayMs = 500): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries && isRetryableError(err)) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// ── Provider Call Functions ────────────────────────────────────

async function callOpenAI(params: AiRequest): Promise<{
  content: string;
  usage?: { input: number; output: number };
}> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 4096,
    }),
    signal: params.signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  return {
    content: data.choices[0]?.message?.content || '',
    usage: data.usage
      ? { input: data.usage.prompt_tokens, output: data.usage.completion_tokens }
      : undefined,
  };
}

async function callAnthropic(params: AiRequest): Promise<{
  content: string;
  usage?: { input: number; output: number };
}> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': params.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      messages: params.messages.filter((m) => m.role !== 'system'),
      system: params.messages.find((m) => m.role === 'system')?.content,
      temperature: params.temperature ?? 0.7,
    }),
    signal: params.signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  return {
    content: data.content?.[0]?.text || '',
    usage: data.usage
      ? { input: data.usage.input_tokens, output: data.usage.output_tokens }
      : undefined,
  };
}

async function callGoogle(params: AiRequest): Promise<{
  content: string;
  usage?: { input: number; output: number };
}> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent?key=${params.apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: params.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
      systemInstruction: params.messages.find((m) => m.role === 'system')
        ? { parts: [{ text: params.messages.find((m) => m.role === 'system')!.content }] }
        : undefined,
      generationConfig: {
        temperature: params.temperature ?? 0.7,
        maxOutputTokens: params.maxTokens ?? 4096,
      },
    }),
    signal: params.signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `Google API error: ${response.status}`);
  }

  const data = await response.json();
  return {
    content: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
    usage: data.usageMetadata
      ? { input: data.usageMetadata.promptTokenCount || 0, output: data.usageMetadata.candidatesTokenCount || 0 }
      : undefined,
  };
}

/**
 * Quick liveness check for Ollama — hits /api/version with a short timeout.
 * Returns true if Ollama responded OK, false if unreachable or timed out.
 */
async function pingOllama(baseUrl: string, timeoutMs = 5_000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${baseUrl}/api/version`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

async function callOllamaProvider(params: AiRequest): Promise<{
  content: string;
  usage?: { input: number; output: number };
}> {
  const base = (params.apiUrl || 'http://localhost:11434').replace(/\/$/, '');

  // Pre-flight: confirm Ollama is reachable before attempting the actual call.
  const running = await pingOllama(base);
  if (!running) {
    throw new Error(
      `Ollama isn't running. Start it in Terminal:\n\n  ollama serve\n\nIf Ollama is on a different machine, update the URL in Settings → Engines.`
    );
  }

  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      stream: false,
      options: {
        temperature: params.temperature ?? 0.7,
        num_predict: params.maxTokens ?? 4096,
      },
    }),
    signal: params.signal,
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        `Model "${params.model}" isn't loaded in Ollama.\n\nRun this in Terminal:\n\n  ollama pull ${params.model}`
      );
    }
    const errText = await response.text().catch(() => '');
    throw new Error(
      `Ollama returned an error (${response.status}${errText ? ': ' + errText.slice(0, 120) : ''}). Check the model name in Settings → Engines.`
    );
  }

  const data = await response.json();
  return {
    content: data.message?.content || '',
    usage: { input: data.prompt_eval_count || 0, output: data.eval_count || 0 },
  };
}

async function callGroq(params: AiRequest): Promise<{
  content: string;
  usage?: { input: number; output: number };
}> {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 4096,
    }),
    signal: params.signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error((error as { error?: { message?: string } }).error?.message || `Groq API error: ${response.status}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    content: data.choices?.[0]?.message?.content || '',
    usage: data.usage
      ? { input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0 }
      : undefined,
  };
}

// ── Exported callAI (used by taskBroker) ──────────────────────

/**
 * Non-streaming AI call for any provider. Returns content + usage + cost.
 * Used by the Worker engine in taskBroker for background tasks.
 * Accepts an optional AbortSignal for task cancellation.
 */
export async function callAI(params: {
  provider: string;
  model: string;
  apiKey: string;
  messages: AiMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}): Promise<{ content: string; usage?: { input: number; output: number }; cost: number }> {
  // Validate messages before sending
  for (const m of params.messages) {
    if (!m.role || !['user', 'assistant', 'system'].includes(m.role)) {
      throw new Error(`Invalid message role: "${m.role}". Must be user, assistant, or system.`);
    }
    if (typeof m.content !== 'string') {
      throw new Error(`Message content must be a string (got ${typeof m.content}).`);
    }
  }

  let result;
  const call = () => {
    switch (params.provider) {
      case 'openai':    return callOpenAI(params);
      case 'anthropic': return callAnthropic(params);
      case 'google':    return callGoogle(params);
      case 'ollama':    return callOllamaProvider(params);
      case 'groq':      return callGroq(params);
      default:          throw new Error(`Unknown provider: ${params.provider}`);
    }
  };
  // Ollama is local — no retries needed (ping already guards it)
  result = params.provider === 'ollama'
    ? await call()
    : await withRetry(call);

  const cost = result.usage
    ? calculateCost(params.model, result.usage.input, result.usage.output)
    : 0;

  return { ...result, cost };
}

// ── Streaming Helpers ─────────────────────────────────────────

type StreamTokenUsage = { input: number; output: number };

/**
 * Accumulates SSE bytes, splits on blank lines, joins multi-line `data:` payloads.
 * Handles chunks split mid-event across TCP reads.
 */
async function readSSEStream(response: Response, onEvent: (payload: string) => void): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  const processEventBlock = (block: string) => {
    const lines = block.split(/\r?\n/);
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^\s/, ''));
      }
    }
    if (dataLines.length === 0) return;
    const payload = dataLines.join('\n');
    if (payload) onEvent(payload);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? '';
      for (const block of parts) {
        if (block.trim()) processEventBlock(block);
      }
    }

    const tailParts = buffer.split(/\r?\n\r?\n/);
    buffer = tailParts.pop() ?? '';
    for (const block of tailParts) {
      if (block.trim()) processEventBlock(block);
    }
    if (buffer.trim()) {
      processEventBlock(buffer);
    }
  } finally {
    reader.releaseLock();
  }
}

/** Normalize streamed `choices[0].delta.content` (string or structured parts). */
function extractOpenAIChatDeltaContent(delta: unknown): string {
  if (delta == null || typeof delta !== 'object') return '';
  const d = delta as Record<string, unknown>;
  const c = d.content;
  if (typeof c === 'string' && c.length > 0) return c;
  if (Array.isArray(c)) {
    let out = '';
    for (const part of c) {
      if (typeof part === 'string') out += part;
      else if (part && typeof part === 'object') {
        const p = part as Record<string, unknown>;
        if (typeof p.text === 'string') out += p.text;
      }
    }
    return out;
  }
  return '';
}

async function streamOpenAI(
  params: AiRequest,
  onChunk: (text: string) => void,
  onDone: (fullText: string, usage?: StreamTokenUsage) => void,
  onError: (error: string) => void
) {
  let fullText = '';
  let usage: StreamTokenUsage | undefined;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 4096,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: params.signal,
    });

    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      onError(error.error?.message || `OpenAI API error: ${response.status}`);
      return;
    }

    await readSSEStream(response, (data) => {
      if (data === '[DONE]') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== 'object') return;
      const p = parsed as {
        choices?: Array<{ delta?: unknown }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const delta = p.choices?.[0]?.delta;
      const piece = extractOpenAIChatDeltaContent(delta);
      if (piece.length > 0) {
        fullText += piece;
        onChunk(piece);
      }
      if (p.usage) {
        usage = {
          input: p.usage.prompt_tokens ?? 0,
          output: p.usage.completion_tokens ?? 0,
        };
      }
    });

    onDone(fullText, usage);
  } catch (err: unknown) {
    onError(err instanceof Error ? err.message : 'Stream error');
  }
}

async function streamAnthropic(
  params: AiRequest,
  onChunk: (text: string) => void,
  onDone: (fullText: string, usage?: StreamTokenUsage) => void,
  onError: (error: string) => void
) {
  let fullText = '';
  let usage: StreamTokenUsage | undefined;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': params.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: params.model,
        max_tokens: params.maxTokens ?? 4096,
        messages: params.messages.filter((m) => m.role !== 'system'),
        system: params.messages.find((m) => m.role === 'system')?.content,
        temperature: params.temperature ?? 0.7,
        stream: true,
      }),
      signal: params.signal,
    });

    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      onError(error.error?.message || `Anthropic API error: ${response.status}`);
      return;
    }

    await readSSEStream(response, (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== 'object') return;
      const p = parsed as {
        type?: string;
        delta?: { text?: string };
        message?: { usage?: { input_tokens?: number } };
        usage?: { output_tokens?: number };
      };
      if (p.type === 'content_block_delta') {
        const text = p.delta?.text;
        if (typeof text === 'string' && text.length > 0) {
          fullText += text;
          onChunk(text);
        }
      }
      if (p.type === 'message_start' && p.message?.usage) {
        usage = { input: p.message.usage.input_tokens ?? 0, output: usage?.output ?? 0 };
      }
      if (p.type === 'message_delta' && p.usage) {
        usage = {
          input: usage?.input ?? 0,
          output: p.usage.output_tokens ?? 0,
        };
      }
    });

    onDone(fullText, usage);
  } catch (err: unknown) {
    onError(err instanceof Error ? err.message : 'Stream error');
  }
}

async function streamGroq(
  params: AiRequest,
  onChunk: (text: string) => void,
  onDone: (fullText: string, usage?: StreamTokenUsage) => void,
  onError: (error: string) => void
) {
  let fullText = '';
  let usage: StreamTokenUsage | undefined;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 4096,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: params.signal,
    });

    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      onError(error.error?.message || `Groq API error: ${response.status}`);
      return;
    }

    await readSSEStream(response, (data) => {
      if (data === '[DONE]') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== 'object') return;
      const p = parsed as {
        choices?: Array<{ delta?: unknown }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const delta = p.choices?.[0]?.delta;
      const piece = extractOpenAIChatDeltaContent(delta);
      if (piece.length > 0) {
        fullText += piece;
        onChunk(piece);
      }
      if (p.usage) {
        usage = {
          input: p.usage.prompt_tokens ?? 0,
          output: p.usage.completion_tokens ?? 0,
        };
      }
    });

    onDone(fullText, usage);
  } catch (err: unknown) {
    onError(err instanceof Error ? err.message : 'Stream error');
  }
}

// ── Active Streams (for cancellation) ─────────────────────────

const activeStreams = new Map<string, AbortController>();

// ── Register IPC Handlers ─────────────────────────────────────

export function registerAIHandlers(_db: Database.Database, getWindow: WindowGetter) {
  // Non-streaming request
  ipcMain.handle('ai:send', async (_, params: AiRequest) => {
    return callAI(params);
  });

  // Streaming request — preload sends { ...params, channelId }
  // Uses ipcMain.handle (preload calls ipcRenderer.invoke)
  ipcMain.handle('ai:stream', async (_, params: AiRequest & { channelId: string }) => {
    const { channelId, ...aiBase } = params;
    const controller = new AbortController();
    activeStreams.set(channelId, controller);

    const paramsWithSignal: AiRequest = { ...aiBase, signal: controller.signal };

    const onChunk = (text: string) => {
      safeSend(getWindow, 'ai:stream:chunk', { channelId, chunk: text });
    };
    const onDone = (fullText: string, usage?: StreamTokenUsage) => {
      const cost = usage ? calculateCost(params.model, usage.input || 0, usage.output || 0) : 0;
      safeSend(getWindow, 'ai:stream:done', {
        channelId,
        fullText,
        usage: {
          prompt_tokens: usage?.input || 0,
          completion_tokens: usage?.output || 0,
          total_tokens: (usage?.input || 0) + (usage?.output || 0),
          cost,
        },
      });
    };
    const onError = (error: string) => {
      safeSend(getWindow, 'ai:stream:error', { channelId, error });
    };

    try {
      switch (params.provider) {
        case 'openai':
          await streamOpenAI(paramsWithSignal, onChunk, onDone, onError);
          break;
        case 'anthropic':
          await streamAnthropic(paramsWithSignal, onChunk, onDone, onError);
          break;
        case 'groq':
          await streamGroq(paramsWithSignal, onChunk, onDone, onError);
          break;
        default:
          try {
            const result = await callAI({ ...aiBase, signal: controller.signal });
            onChunk(result.content);
            onDone(result.content, result.usage);
          } catch (err: unknown) {
            onError(err instanceof Error ? err.message : 'Stream error');
          }
      }
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Stream error');
    } finally {
      activeStreams.delete(channelId);
    }

    return { started: true, channelId };
  });

  // Cancel a stream
  ipcMain.handle('ai:cancel', async (_, channelId: string) => {
    const controller = activeStreams.get(channelId);
    if (controller) {
      controller.abort();
      activeStreams.delete(channelId);
      return { cancelled: true };
    }
    return { cancelled: false };
  });
}
