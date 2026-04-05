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

type WindowGetter = () => BrowserWindow | null;

/** Safely send to renderer — skips if window is destroyed (Vite HMR). */
function safeSend(getWin: WindowGetter, channel: string, data: any) {
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
}

// ── Pricing ───────────────────────────────────────────────────

export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'o1': { input: 15.0, output: 60.0 },
  'o1-mini': { input: 3.0, output: 12.0 },
  // Anthropic
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-3-5-haiku-20241022': { input: 0.25, output: 1.25 },
  'claude-opus-4-20250514': { input: 15.0, output: 75.0 },
  // Google
  'gemini-1.5-pro': { input: 1.25, output: 5.0 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'gemini-2.0-flash': { input: 0.1, output: 0.4 },
  // Local
  'llama3.1:70b': { input: 0, output: 0 },
  'llama3.1:8b': { input: 0, output: 0 },
  'mistral-large': { input: 0, output: 0 },
  'codellama:34b': { input: 0, output: 0 },
};

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
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

async function callOllamaProvider(params: AiRequest): Promise<{
  content: string;
  usage?: { input: number; output: number };
}> {
  const response = await fetch('http://localhost:11434/api/chat', {
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
    throw new Error(`Ollama error: ${response.status}. Is Ollama running?`);
  }

  const data = await response.json();
  return {
    content: data.message?.content || '',
    usage: { input: data.prompt_eval_count || 0, output: data.eval_count || 0 },
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
  let result;
  switch (params.provider) {
    case 'openai':
      result = await callOpenAI(params);
      break;
    case 'anthropic':
      result = await callAnthropic(params);
      break;
    case 'google':
      result = await callGoogle(params);
      break;
    case 'ollama':
      result = await callOllamaProvider(params);
      break;
    default:
      throw new Error(`Unknown provider: ${params.provider}`);
  }

  const cost = result.usage
    ? calculateCost(params.model, result.usage.input, result.usage.output)
    : 0;

  return { ...result, cost };
}

// ── Streaming Helpers ─────────────────────────────────────────

async function streamOpenAI(
  params: AiRequest,
  onChunk: (text: string) => void,
  onDone: (fullText: string, usage?: any) => void,
  onError: (error: string) => void
) {
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
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      onError(error.error?.message || `OpenAI API error: ${response.status}`);
      return;
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let usage: any = null;

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter((l) => l.startsWith('data: '));

      for (const line of lines) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            fullText += content;
            onChunk(content);
          }
          if (parsed.usage) {
            usage = { input: parsed.usage.prompt_tokens, output: parsed.usage.completion_tokens };
          }
        } catch {
          // Skip malformed chunks
        }
      }
    }

    onDone(fullText, usage);
  } catch (err: any) {
    onError(err.message || 'Stream error');
  }
}

async function streamAnthropic(
  params: AiRequest,
  onChunk: (text: string) => void,
  onDone: (fullText: string, usage?: any) => void,
  onError: (error: string) => void
) {
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
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      onError(error.error?.message || `Anthropic API error: ${response.status}`);
      return;
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let usage: any = null;

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter((l) => l.startsWith('data: '));

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line.slice(6));
          if (parsed.type === 'content_block_delta') {
            const text = parsed.delta?.text;
            if (text) {
              fullText += text;
              onChunk(text);
            }
          }
          if (parsed.type === 'message_start' && parsed.message?.usage) {
            usage = { input: parsed.message.usage.input_tokens, output: 0 };
          }
          if (parsed.type === 'message_delta' && parsed.usage) {
            usage = { ...usage, output: parsed.usage.output_tokens };
          }
        } catch {
          // Skip
        }
      }
    }

    onDone(fullText, usage);
  } catch (err: any) {
    onError(err.message || 'Stream error');
  }
}

// ── Active Streams (for cancellation) ─────────────────────────

const activeStreams = new Map<string, AbortController>();

// ── Register IPC Handlers ─────────────────────────────────────

export function registerAIHandlers(db: any, getWindow: WindowGetter) {
  // Non-streaming request
  ipcMain.handle('ai:send', async (_, params: AiRequest) => {
    return callAI(params);
  });

  // Streaming request — preload sends { ...params, channelId }
  // Uses ipcMain.handle (preload calls ipcRenderer.invoke)
  ipcMain.handle('ai:stream', async (_, params: AiRequest & { channelId: string }) => {
    const { channelId } = params;

    const onChunk = (text: string) => {
      safeSend(getWindow, 'ai:stream:chunk', { channelId, chunk: text });
    };
    const onDone = (fullText: string, usage?: any) => {
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
      activeStreams.delete(channelId);
    };
    const onError = (error: string) => {
      safeSend(getWindow, 'ai:stream:error', { channelId, error });
      activeStreams.delete(channelId);
    };

    switch (params.provider) {
      case 'openai':
        await streamOpenAI(params, onChunk, onDone, onError);
        break;
      case 'anthropic':
        await streamAnthropic(params, onChunk, onDone, onError);
        break;
      default:
        // For providers without streaming, fall back to non-streaming
        try {
          const result = await callAI(params);
          onChunk(result.content);
          onDone(result.content, result.usage);
        } catch (err: any) {
          onError(err.message);
        }
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
