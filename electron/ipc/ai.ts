import { ipcMain, BrowserWindow } from 'electron';

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
  streamId?: string;
}

// Provider pricing per 1M tokens (input/output)
export const MODEL_PRICING: Record<string, { input: number; output: number }> =
  {
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
    // Local (free)
    'llama3.1:70b': { input: 0, output: 0 },
    'llama3.1:8b': { input: 0, output: 0 },
    'mistral-large': { input: 0, output: 0 },
    'codellama:34b': { input: 0, output: 0 },
  };

function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output
  );
}

async function callOpenAI(params: AiRequest): Promise<{
  content: string;
  usage?: { input: number; output: number };
}> {
  const response = await fetch(
    'https://api.openai.com/v1/chat/completions',
    {
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
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  return {
    content: data.choices[0]?.message?.content || '',
    usage: data.usage
      ? {
          input: data.usage.prompt_tokens,
          output: data.usage.completion_tokens,
        }
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
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      error.error?.message || `Anthropic API error: ${response.status}`
    );
  }

  const data = await response.json();
  return {
    content:
      data.content?.[0]?.text || '',
    usage: data.usage
      ? {
          input: data.usage.input_tokens,
          output: data.usage.output_tokens,
        }
      : undefined,
  };
}

async function callGoogle(params: AiRequest): Promise<{
  content: string;
  usage?: { input: number; output: number };
}> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${params.model}:generateContent?key=${params.apiKey}`,
    {
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
          ? {
              parts: [
                {
                  text: params.messages.find((m) => m.role === 'system')!
                    .content,
                },
              ],
            }
          : undefined,
        generationConfig: {
          temperature: params.temperature ?? 0.7,
          maxOutputTokens: params.maxTokens ?? 4096,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      error.error?.message || `Google API error: ${response.status}`
    );
  }

  const data = await response.json();
  return {
    content: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
    usage: data.usageMetadata
      ? {
          input: data.usageMetadata.promptTokenCount || 0,
          output: data.usageMetadata.candidatesTokenCount || 0,
        }
      : undefined,
  };
}

async function callOllama(params: AiRequest): Promise<{
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
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status}. Is Ollama running?`);
  }

  const data = await response.json();
  return {
    content: data.message?.content || '',
    usage: {
      input: data.prompt_eval_count || 0,
      output: data.eval_count || 0,
    },
  };
}

// Streaming version for OpenAI
async function streamOpenAI(
  params: AiRequest,
  onChunk: (text: string) => void,
  onDone: (fullText: string, usage?: any) => void,
  onError: (error: string) => void
) {
  try {
    const response = await fetch(
      'https://api.openai.com/v1/chat/completions',
      {
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
      }
    );

    if (!response.ok) {
      const error = await response.json();
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
            usage = {
              input: parsed.usage.prompt_tokens,
              output: parsed.usage.completion_tokens,
            };
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

// Streaming version for Anthropic
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
      const error = await response.json();
      onError(
        error.error?.message || `Anthropic API error: ${response.status}`
      );
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
          if (parsed.type === 'message_delta' && parsed.usage) {
            usage = {
              input: 0,
              output: parsed.usage.output_tokens,
            };
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

export function registerAiHandlers() {
  // Non-streaming request
  ipcMain.handle('ai-send-message', async (_, params: AiRequest) => {
    switch (params.provider) {
      case 'openai':
        return callOpenAI(params);
      case 'anthropic':
        return callAnthropic(params);
      case 'google':
        return callGoogle(params);
      case 'ollama':
        return callOllama(params);
      default:
        throw new Error(`Unknown provider: ${params.provider}`);
    }
  });

  // Streaming request
  ipcMain.on('ai-stream-start', async (event, params: AiRequest) => {
    const { streamId } = params;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;

    const onChunk = (text: string) => {
      win.webContents.send(`ai-stream-chunk-${streamId}`, text);
    };
    const onDone = (fullText: string, usage?: any) => {
      win.webContents.send(`ai-stream-done-${streamId}`, fullText, usage);
    };
    const onError = (error: string) => {
      win.webContents.send(`ai-stream-error-${streamId}`, error);
    };

    switch (params.provider) {
      case 'openai':
        streamOpenAI(params, onChunk, onDone, onError);
        break;
      case 'anthropic':
        streamAnthropic(params, onChunk, onDone, onError);
        break;
      default:
        // Fall back to non-streaming
        try {
          let result;
          switch (params.provider) {
            case 'google':
              result = await callGoogle(params);
              break;
            case 'ollama':
              result = await callOllama(params);
              break;
            default:
              onError(`Unknown provider: ${params.provider}`);
              return;
          }
          onChunk(result.content);
          onDone(result.content, result.usage);
        } catch (err: any) {
          onError(err.message);
        }
    }
  });
}
