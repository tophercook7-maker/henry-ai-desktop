/**
 * Ollama — Local model management.
 * 
 * Connects to Ollama running on the user's machine.
 * Supports model listing, pulling, and generation.
 * M1 Max 64GB can comfortably run Llama 3.1 70B, Codestral, Mistral, etc.
 */

import { ipcMain, BrowserWindow } from 'electron';

let mainWindow: BrowserWindow | null = null;

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
  details?: {
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
}

export function registerOllamaHandlers(win: BrowserWindow) {
  mainWindow = win;

  // Check if Ollama is running
  ipcMain.handle('ollama:status', async (_event, baseUrl?: string) => {
    const url = baseUrl || DEFAULT_OLLAMA_URL;
    try {
      const response = await fetch(`${url}/api/version`);
      if (response.ok) {
        const data = await response.json();
        return { running: true, version: data.version, url };
      }
      return { running: false, url };
    } catch {
      return { running: false, url, error: 'Ollama not reachable. Make sure it\'s installed and running.' };
    }
  });

  // List installed models
  ipcMain.handle('ollama:models', async (_event, baseUrl?: string) => {
    const url = baseUrl || DEFAULT_OLLAMA_URL;
    try {
      const response = await fetch(`${url}/api/tags`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return {
        models: (data.models || []).map((m: any) => ({
          name: m.name,
          size: m.size,
          sizeGB: (m.size / 1e9).toFixed(1),
          digest: m.digest?.slice(0, 12),
          modified_at: m.modified_at,
          family: m.details?.family || 'unknown',
          parameterSize: m.details?.parameter_size || 'unknown',
          quantization: m.details?.quantization_level || 'unknown',
        })),
      };
    } catch (err: any) {
      return { models: [], error: err.message };
    }
  });

  // Pull a model (with progress)
  ipcMain.handle('ollama:pull', async (_event, modelName: string, baseUrl?: string) => {
    const url = baseUrl || DEFAULT_OLLAMA_URL;
    try {
      const response = await fetch(`${url}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName, stream: true }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n').filter(Boolean);

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            mainWindow?.webContents.send('ollama:pull:progress', {
              model: modelName,
              status: data.status,
              completed: data.completed,
              total: data.total,
              digest: data.digest,
            });
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      return { success: true, model: modelName };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Delete a model
  ipcMain.handle('ollama:delete', async (_event, modelName: string, baseUrl?: string) => {
    const url = baseUrl || DEFAULT_OLLAMA_URL;
    try {
      const response = await fetch(`${url}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName }),
      });
      return { success: response.ok };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Generate (chat) with local model — streaming
  ipcMain.handle('ollama:chat', async (_event, params: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    channelId: string;
    baseUrl?: string;
    temperature?: number;
  }) => {
    const url = params.baseUrl || DEFAULT_OLLAMA_URL;
    try {
      const response = await fetch(`${url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: params.model,
          messages: params.messages,
          stream: true,
          options: {
            temperature: params.temperature ?? 0.7,
          },
        }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const lines = text.split('\n').filter(Boolean);

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.message?.content) {
              fullText += data.message.content;
              mainWindow?.webContents.send('ai:stream:chunk', {
                channelId: params.channelId,
                chunk: data.message.content,
              });
            }

            if (data.done) {
              mainWindow?.webContents.send('ai:stream:done', {
                channelId: params.channelId,
                fullText,
                usage: {
                  prompt_tokens: data.prompt_eval_count || 0,
                  completion_tokens: data.eval_count || 0,
                  total_tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
                  cost: 0, // Local models = free
                },
              });
            }
          } catch {
            // Skip malformed lines
          }
        }
      }

      return { success: true };
    } catch (err: any) {
      mainWindow?.webContents.send('ai:stream:error', {
        channelId: params.channelId,
        error: err.message,
      });
      return { success: false, error: err.message };
    }
  });
}
