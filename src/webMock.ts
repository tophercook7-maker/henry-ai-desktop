import { v4 as uuidv4 } from 'uuid';

function getStore<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

function setStore<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

type Listener<T> = (data: T) => void;
const listeners: Record<string, Listener<unknown>[]> = {};

function emit(event: string, data: unknown) {
  (listeners[event] || []).forEach((cb) => cb(data));
}

function on<T>(event: string, cb: Listener<T>): () => void {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(cb as Listener<unknown>);
  return () => {
    listeners[event] = listeners[event].filter((l) => l !== cb);
  };
}

const now = () => new Date().toISOString();

// ── Worker Brain: actual AI execution in web mode ──────────────────────────
// Runs in the background after submitTask; injects result back into the thread.
async function runWorkerAI(params: {
  taskId: string;
  description: string;
  contextMessages: HenryAIMessage[];
  workerProvider: string;
  workerModel: string;
  apiKey: string;
  ollamaBaseUrl: string;
  conversationId?: string;
  currentMode: string;
}): Promise<void> {
  const { taskId, description, contextMessages, workerProvider, workerModel, apiKey, ollamaBaseUrl, conversationId, currentMode } = params;

  function updateTask(patch: Partial<import('./types').Task>) {
    const tasks = getStore<import('./types').Task[]>('henry:tasks', []);
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx < 0) return;
    tasks[idx] = { ...tasks[idx], ...patch };
    setStore('henry:tasks', tasks);
    emit('task:update', tasks[idx]);
  }

  updateTask({ status: 'running', started_at: now() });

  const modeName = (['companion','writer','developer','biblical','design3d','computer','secretary'] as const).includes(currentMode as any)
    ? (currentMode as import('./henry/charter').HenryOperatingMode)
    : 'developer';

  let systemPrompt: string;
  try {
    const { buildWorkerAITaskSystemPrompt } = await import('./henry/charter');
    const contextSummary = contextMessages
      .filter((m) => m.role !== 'system')
      .slice(-6)
      .map((m) => `${m.role === 'user' ? 'Topher' : 'Henry'}: ${m.content.slice(0, 400)}`)
      .join('\n');
    systemPrompt = buildWorkerAITaskSystemPrompt(contextSummary || undefined, modeName);
  } catch {
    systemPrompt = `You are Henry's Worker Brain — a background AI engine running a delegated task. Be thorough and complete. Task: ${description}`;
  }

  const messages: HenryAIMessage[] = [
    { role: 'system', content: systemPrompt },
    ...contextMessages.filter((m) => m.role !== 'system').slice(-8),
    { role: 'user', content: description },
  ];

  try {
    let resultText = '';

    if (workerProvider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: workerModel, messages, temperature: 0.7, max_tokens: 4000 }),
      });
      const data = await res.json() as any;
      resultText = data.choices?.[0]?.message?.content ?? '';
    } else if (workerProvider === 'anthropic') {
      const sysMsg = messages.find((m) => m.role === 'system');
      const convMsgs = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: workerModel, max_tokens: 4000, system: sysMsg?.content ?? '', messages: convMsgs }),
      });
      const data = await res.json() as any;
      resultText = data.content?.[0]?.text ?? '';
    } else if (workerProvider === 'google') {
      const convMsgs = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${workerModel}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: convMsgs }),
        }
      );
      const data = await res.json() as any;
      resultText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    } else if (workerProvider === 'ollama') {
      const base = (ollamaBaseUrl || 'http://localhost:11434').replace(/\/$/, '');
      const res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: workerModel, messages, stream: false }),
      });
      const data = await res.json() as any;
      resultText = data.message?.content ?? '';
    }

    if (!resultText.trim()) throw new Error('Worker returned empty response');

    updateTask({ status: 'completed', result: resultText, completed_at: now() });

    if (conversationId) {
      const { v4: uuidv4 } = await import('uuid');
      const workerMsg: import('./types').Message = {
        id: uuidv4(),
        conversation_id: conversationId,
        role: 'assistant',
        content: `*— Worker Brain*\n\n${resultText}`,
        engine: 'worker',
        model: workerModel,
        provider: workerProvider,
        created_at: now(),
      };
      const allMsgs = getStore<import('./types').Message[]>('henry:messages', []);
      allMsgs.push(workerMsg);
      setStore('henry:messages', allMsgs);
      emit('worker:message', workerMsg);
    }
  } catch (err) {
    updateTask({ status: 'failed', error: String(err), completed_at: now() });
  }
}

const henryAPI: Window['henryAPI'] = {
  getSettings: async () => {
    return getStore<Record<string, string>>('henry:settings', {});
  },
  saveSetting: async (key, value) => {
    const s = getStore<Record<string, string>>('henry:settings', {});
    s[key] = value;
    setStore('henry:settings', s);
    return true;
  },

  getProviders: async () => {
    return getStore('henry:providers', []);
  },
  saveProvider: async (provider) => {
    const providers = getStore<HenryProviderRecord[]>('henry:providers', []);
    const idx = providers.findIndex((p) => p.id === provider.id);
    const record: HenryProviderRecord = {
      ...provider,
      enabled: provider.enabled ? 1 : 0,
    };
    if (idx >= 0) {
      providers[idx] = record;
    } else {
      providers.push(record);
    }
    setStore('henry:providers', providers);
    return true;
  },

  getConversations: async () => {
    return getStore('henry:conversations', []);
  },
  createConversation: async (title) => {
    const convos = getStore<import('./types').Conversation[]>('henry:conversations', []);
    const convo = { id: uuidv4(), title, created_at: now(), updated_at: now(), message_count: 0 };
    convos.unshift(convo);
    setStore('henry:conversations', convos);
    return convo;
  },
  updateConversation: async (id, title) => {
    const convos = getStore<import('./types').Conversation[]>('henry:conversations', []);
    const idx = convos.findIndex((c) => c.id === id);
    if (idx >= 0) {
      convos[idx] = { ...convos[idx], title, updated_at: now() };
      setStore('henry:conversations', convos);
    }
    return true;
  },
  deleteConversation: async (id) => {
    const convos = getStore<import('./types').Conversation[]>('henry:conversations', []);
    setStore('henry:conversations', convos.filter((c) => c.id !== id));
    const allMsgs = getStore<import('./types').Message[]>('henry:messages', []);
    setStore('henry:messages', allMsgs.filter((m) => m.conversation_id !== id));
    return true;
  },

  getMessages: async (conversationId) => {
    const allMsgs = getStore<import('./types').Message[]>('henry:messages', []);
    return allMsgs.filter((m) => m.conversation_id === conversationId);
  },
  saveMessage: async (message) => {
    const allMsgs = getStore<import('./types').Message[]>('henry:messages', []);
    const idx = allMsgs.findIndex((m) => m.id === message.id);
    if (idx >= 0) {
      allMsgs[idx] = message;
    } else {
      allMsgs.push(message);
    }
    setStore('henry:messages', allMsgs);
    return true;
  },

  sendMessage: async (params) => {
    const { provider, model, apiKey, messages, temperature, maxTokens } = params;

    if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, temperature: temperature ?? 0.7, max_tokens: maxTokens }),
      });
      const data = await res.json() as { choices: Array<{ message: { content: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
      return { content: data.choices[0].message.content, usage: data.usage };
    }

    if (provider === 'anthropic') {
      const systemMsg = messages.find((m) => m.role === 'system');
      const userMsgs = messages.filter((m) => m.role !== 'system');
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model,
          messages: userMsgs,
          system: systemMsg?.content,
          max_tokens: maxTokens ?? 4096,
          temperature: temperature ?? 0.7,
        }),
      });
      const data = await res.json() as { content: Array<{ text: string }>; usage?: unknown };
      return { content: data.content[0].text, usage: data.usage as HenryAIUsage };
    }

    if (provider === 'google') {
      const contents = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents }),
        }
      );
      const data = await res.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
      return { content: data.candidates[0].content.parts[0].text };
    }

    if (provider === 'ollama') {
      const settings = getStore<Record<string, string>>('henry:settings', {});
      const baseUrl = settings.ollama_base_url || 'http://localhost:11434';
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, stream: false }),
      });
      const data = await res.json() as { message: { content: string } };
      return { content: data.message.content };
    }

    throw new Error(`Unsupported provider: ${provider}`);
  },

  streamMessage: (params) => {
    const { provider, model, apiKey, messages, temperature, maxTokens } = params;
    let chunkCb: ((chunk: string) => void) | null = null;
    let doneCb: ((fullText: string, usage?: HenryAIUsage) => void) | null = null;
    let errorCb: ((error: string) => void) | null = null;
    let aborted = false;
    const controller = new AbortController();

    const run = async () => {
      try {
        let fullText = '';

        if (provider === 'openai') {
          const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model, messages, temperature: temperature ?? 0.7, max_tokens: maxTokens, stream: true }),
            signal: controller.signal,
          });
          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          while (!aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            const lines = text.split('\n').filter((l) => l.startsWith('data: '));
            for (const line of lines) {
              const json = line.slice(6).trim();
              if (json === '[DONE]') break;
              try {
                const parsed = JSON.parse(json) as { choices: Array<{ delta: { content?: string } }> };
                const chunk = parsed.choices[0]?.delta?.content || '';
                if (chunk) {
                  fullText += chunk;
                  chunkCb?.(chunk);
                }
              } catch { /* skip bad JSON */ }
            }
          }
          doneCb?.(fullText);
        } else if (provider === 'anthropic') {
          const systemMsg = messages.find((m) => m.role === 'system');
          const userMsgs = messages.filter((m) => m.role !== 'system');
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify({
              model,
              messages: userMsgs,
              system: systemMsg?.content,
              max_tokens: maxTokens ?? 4096,
              temperature: temperature ?? 0.7,
              stream: true,
            }),
            signal: controller.signal,
          });
          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          while (!aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            const lines = text.split('\n').filter((l) => l.startsWith('data: '));
            for (const line of lines) {
              const json = line.slice(6).trim();
              try {
                const parsed = JSON.parse(json) as { type: string; delta?: { text?: string } };
                if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                  fullText += parsed.delta.text;
                  chunkCb?.(parsed.delta.text);
                }
              } catch { /* skip */ }
            }
          }
          doneCb?.(fullText);
        } else if (provider === 'google') {
          const contents = messages
            .filter((m) => m.role !== 'system')
            .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contents }),
              signal: controller.signal,
            }
          );
          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          while (!aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            const lines = text.split('\n').filter((l) => l.startsWith('data: '));
            for (const line of lines) {
              const json = line.slice(6).trim();
              try {
                const parsed = JSON.parse(json) as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
                const chunk = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
                if (chunk) {
                  fullText += chunk;
                  chunkCb?.(chunk);
                }
              } catch { /* skip */ }
            }
          }
          doneCb?.(fullText);
        } else if (provider === 'ollama') {
          const settings = getStore<Record<string, string>>('henry:settings', {});
          const baseUrl = (settings.ollama_base_url || 'http://localhost:11434').replace(/\/$/, '');
          const systemMsg = messages.find((m) => m.role === 'system');
          const chatMessages = messages.filter((m) => m.role !== 'system');
          const res = await fetch(`${baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              messages: chatMessages,
              ...(systemMsg ? { system: systemMsg.content } : {}),
              stream: true,
              options: { temperature: temperature ?? 0.7 },
            }),
            signal: controller.signal,
          });
          if (!res.ok) {
            const errText = await res.text().catch(() => `HTTP ${res.status}`);
            throw new Error(`Ollama error ${res.status}: ${errText}`);
          }
          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let lineBuffer = '';
          while (!aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            lineBuffer += decoder.decode(value, { stream: true });
            const lines = lineBuffer.split('\n');
            lineBuffer = lines.pop() ?? '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try {
                const parsed = JSON.parse(trimmed) as {
                  message?: { content?: string };
                  response?: string;
                  done?: boolean;
                  error?: string;
                };
                if (parsed.error) throw new Error(parsed.error);
                if (parsed.done) continue;
                const chunk = parsed.message?.content ?? parsed.response ?? '';
                if (chunk) {
                  fullText += chunk;
                  chunkCb?.(chunk);
                }
              } catch (e) {
                if ((e as Error).message && !((e as Error) instanceof SyntaxError)) throw e;
              }
            }
          }
          if (lineBuffer.trim()) {
            try {
              const parsed = JSON.parse(lineBuffer.trim()) as { message?: { content?: string }; response?: string; done?: boolean };
              if (!parsed.done) {
                const chunk = parsed.message?.content ?? parsed.response ?? '';
                if (chunk) { fullText += chunk; chunkCb?.(chunk); }
              }
            } catch { /* ignore trailing partial line */ }
          }
          doneCb?.(fullText);
        } else {
          errorCb?.(`Unsupported provider: ${provider}`);
        }
      } catch (err: unknown) {
        if (!aborted) {
          errorCb?.(err instanceof Error ? err.message : String(err));
        }
      }
    };

    void run();

    return {
      onChunk: (cb) => { chunkCb = cb; },
      onDone: (cb) => { doneCb = cb; },
      onError: (cb) => { errorCb = cb; },
      cancel: () => {
        aborted = true;
        controller.abort();
      },
    };
  },

  getTasks: async (filter) => {
    let tasks = getStore<import('./types').Task[]>('henry:tasks', []);
    if (filter?.status) tasks = tasks.filter((t) => t.status === filter.status);
    if (filter?.limit) tasks = tasks.slice(0, filter.limit);
    return tasks;
  },
  submitTask: async (task) => {
    const tasks = getStore<import('./types').Task[]>('henry:tasks', []);
    const newTask: import('./types').Task = {
      id: uuidv4(),
      description: task.description,
      type: task.type as import('./types').TaskType,
      status: 'pending',
      priority: task.priority ?? 5,
      payload: task.payload ? JSON.stringify(task.payload) : undefined,
      source_engine: task.sourceEngine,
      conversation_id: task.conversationId,
      created_from_mode: task.createdFromMode,
      related_file_path: task.relatedFilePath,
      created_from_message_id: task.createdFromMessageId,
      created_at: now(),
    };
    tasks.unshift(newTask);
    setStore('henry:tasks', tasks);
    emit('task:update', newTask);

    // Auto-execute with Worker AI if provider is configured
    const settings = getStore<Record<string, string>>('henry:settings', {});
    const workerProvider = settings['worker_provider'];
    const workerModel = settings['worker_model'];

    if (workerProvider && workerModel) {
      let parsedPayload: Record<string, unknown> = {};
      try {
        parsedPayload = task.payload
          ? (typeof task.payload === 'string' ? JSON.parse(task.payload) : (task.payload as Record<string, unknown>))
          : {};
      } catch { /* ignore */ }

      const contextMessages: HenryAIMessage[] = Array.isArray(parsedPayload['context_messages'])
        ? (parsedPayload['context_messages'] as HenryAIMessage[])
        : [];
      const prompt = typeof parsedPayload['prompt'] === 'string' ? parsedPayload['prompt'] : task.description;
      const currentMode = typeof parsedPayload['current_mode'] === 'string' ? parsedPayload['current_mode'] : 'developer';

      const providers = getStore<HenryProviderRecord[]>('henry:providers', []);
      const providerRecord = providers.find((p) => p.id === workerProvider);
      const apiKey = providerRecord?.api_key ?? providerRecord?.apiKey ?? '';
      const ollamaBaseUrl = settings['ollama_base_url'] || 'http://localhost:11434';

      // Schedule async — does not block task submission
      setTimeout(() => {
        void runWorkerAI({
          taskId: newTask.id,
          description: prompt,
          contextMessages,
          workerProvider,
          workerModel,
          apiKey,
          ollamaBaseUrl,
          conversationId: task.conversationId,
          currentMode,
        });
      }, 200);
    }

    return { id: newTask.id, status: newTask.status };
  },
  getTaskStatus: async (id) => {
    const tasks = getStore<import('./types').Task[]>('henry:tasks', []);
    return tasks.find((t) => t.id === id) ?? null;
  },
  cancelTask: async (id) => {
    const tasks = getStore<import('./types').Task[]>('henry:tasks', []);
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx >= 0) {
      tasks[idx] = { ...tasks[idx], status: 'cancelled' };
      setStore('henry:tasks', tasks);
      emit('task:update', tasks[idx]);
      return { id, status: 'cancelled' };
    }
    return { error: 'Task not found' };
  },
  retryTask: async (id) => {
    const tasks = getStore<import('./types').Task[]>('henry:tasks', []);
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx >= 0) {
      tasks[idx] = { ...tasks[idx], status: 'pending', error: undefined };
      setStore('henry:tasks', tasks);
      emit('task:update', tasks[idx]);
      return { id, status: 'pending' };
    }
    return { error: 'Task not found' };
  },
  getTaskStats: async () => {
    const tasks = getStore<import('./types').Task[]>('henry:tasks', []);
    const byStatus: Record<string, number> = {};
    let totalCost = 0;
    for (const t of tasks) {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      if (t.cost) totalCost += t.cost;
    }
    const activeCount = (byStatus['running'] || 0) + (byStatus['queued'] || 0);
    return {
      byStatus: Object.entries(byStatus).map(([status, count]) => ({ status, count })),
      totalCost,
      activeCount,
    };
  },

  saveFact: async (fact) => {
    const facts = getStore<import('./types').MemoryFact[]>('henry:facts', []);
    const newFact: import('./types').MemoryFact = {
      id: fact.id || uuidv4(),
      conversation_id: fact.conversation_id,
      fact: fact.fact,
      category: fact.category || 'general',
      importance: fact.importance ?? 5,
      created_at: fact.created_at || now(),
    };
    const idx = facts.findIndex((f) => f.id === newFact.id);
    if (idx >= 0) {
      facts[idx] = newFact;
    } else {
      facts.unshift(newFact);
    }
    setStore('henry:facts', facts);
    return newFact;
  },
  searchFacts: async (query) => {
    const facts = getStore<import('./types').MemoryFact[]>('henry:facts', []);
    const q = query.query.toLowerCase();
    return facts.filter((f) => f.fact.toLowerCase().includes(q) || f.category.toLowerCase().includes(q))
      .slice(0, query.limit || 20);
  },
  getAllFacts: async (limit) => {
    const facts = getStore<import('./types').MemoryFact[]>('henry:facts', []);
    return limit ? facts.slice(0, limit) : facts;
  },
  buildContext: async (params) => {
    const facts = getStore<import('./types').MemoryFact[]>('henry:facts', []);
    const summaries = getStore<Record<string, string>>('henry:summaries', {});
    const conversationSummary = params.conversationId ? (summaries[params.conversationId] || null) : null;
    const relevantFacts = facts.slice(0, params.maxFactsFetch || 40);
    return {
      lean: {
        conversationSummary,
        facts: relevantFacts.map((f) => ({ fact: f.fact, category: f.category })),
        workspaceHints: [],
      },
      estimatedTokens: relevantFacts.reduce((acc, f) => acc + Math.ceil(f.fact.length / 4), 0),
      factCount: relevantFacts.length,
    };
  },
  saveSummary: async (summary) => {
    const summaries = getStore<Record<string, string>>('henry:summaries', {});
    summaries[summary.conversationId] = summary.summary;
    setStore('henry:summaries', summaries);
    return { id: summary.conversationId };
  },
  getSummary: async (conversationId) => {
    const summaries = getStore<Record<string, string>>('henry:summaries', {});
    return summaries[conversationId] || null;
  },

  scriptureLookup: async (reference) => {
    const scriptureStore = getStore<Record<string, import('./henry/scriptureStore').ScriptureEntry>>('henry:scripture', {});
    const key = reference.toLowerCase().trim();
    const entry = scriptureStore[key];
    const { parseScriptureReference } = await import('./henry/scriptureReference');
    const parseResult = parseScriptureReference(reference);
    if (entry) {
      return {
        found: true,
        parsed: parseResult.ok ? parseResult.value : null,
        normalizedReference: parseResult.ok ? parseResult.value.normalizedReference : undefined,
        text: entry.text,
        sourceProfileId: entry.sourceProfileId,
        sourceLabel: entry.sourceLabel,
        notes: entry.notes,
        entry,
      };
    }
    return {
      found: false,
      parsed: parseResult.ok ? parseResult.value : null,
      parseError: parseResult.ok ? undefined : parseResult.error,
    };
  },
  scriptureImport: async (entries) => {
    const scriptureStore = getStore<Record<string, import('./henry/scriptureStore').ScriptureEntry>>('henry:scripture', {});
    let imported = 0;
    for (const entry of entries) {
      const key = entry.reference.toLowerCase().trim();
      scriptureStore[key] = {
        id: uuidv4(),
        reference: entry.reference,
        normalizedReference: entry.reference,
        book: '',
        bookSlug: '',
        chapter: 0,
        verseStart: 0,
        verseEnd: 0,
        text: entry.text,
        sourceProfileId: entry.sourceProfileId ?? null,
        sourceLabel: entry.sourceLabel ?? null,
        notes: entry.notes ?? null,
        createdAt: now(),
      };
      imported++;
    }
    setStore('henry:scripture', scriptureStore);
    return { imported, skipped: 0, errors: [] };
  },
  scriptureCount: async () => {
    const scriptureStore = getStore<Record<string, unknown>>('henry:scripture', {});
    return Object.keys(scriptureStore).length;
  },
  pickScriptureImportJson: async () => {
    return { canceled: true, content: null };
  },

  readDirectory: async (dirPath) => {
    const path = dirPath || '/workspace';
    const files = getStore<Record<string, string>>('henry:files', {});
    const prefix = path.endsWith('/') ? path : path + '/';
    const entries = Object.keys(files)
      .filter((k) => k.startsWith(prefix))
      .map((k) => {
        const rel = k.slice(prefix.length);
        const name = rel.split('/')[0];
        return { name, path: prefix + name, isDirectory: rel.includes('/') };
      })
      .filter((v, i, arr) => arr.findIndex((a) => a.name === v.name) === i);
    return { path, entries };
  },
  readFile: async (filePath) => {
    const files = getStore<Record<string, string>>('henry:files', {});
    return files[filePath] || '';
  },
  pathExists: async (filePath) => {
    const files = getStore<Record<string, string>>('henry:files', {});
    return filePath in files;
  },
  writeFile: async (filePath, content) => {
    const files = getStore<Record<string, string>>('henry:files', {});
    files[filePath] = content;
    setStore('henry:files', files);
    return true;
  },

  ollamaStatus: async (baseUrl) => {
    try {
      const url = baseUrl || 'http://localhost:11434';
      const res = await fetch(`${url}/api/version`);
      const data = await res.json();
      return data;
    } catch {
      return { error: 'Ollama not available' };
    }
  },
  ollamaModels: async (baseUrl) => {
    try {
      const url = baseUrl || 'http://localhost:11434';
      const res = await fetch(`${url}/api/tags`);
      const data = await res.json();
      return data;
    } catch {
      return { models: [] };
    }
  },
  ollamaPull: async (model, baseUrl) => {
    try {
      const url = baseUrl || 'http://localhost:11434';
      const res = await fetch(`${url}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model }),
      });
      const data = await res.json();
      return data;
    } catch (err) {
      return { error: String(err) };
    }
  },
  ollamaDelete: async (model, baseUrl) => {
    try {
      const url = baseUrl || 'http://localhost:11434';
      const res = await fetch(`${url}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model }),
      });
      const data = await res.json();
      return data;
    } catch (err) {
      return { error: String(err) };
    }
  },
  onOllamaPullProgress: (cb) => on('ollama:pull:progress', cb),

  execTerminal: async () => {
    return { success: false, exitCode: null, stdout: '', stderr: 'Terminal not available in web mode. Use the desktop app.' };
  },
  killTerminal: async () => {
    return { killed: false, error: 'Terminal not available in web mode.' };
  },

  // ── Computer Control (web stubs — real capabilities in desktop app) ──
  computerScreenshot: async () => ({
    success: false,
    base64: null,
    error: 'Screen capture requires the Henry desktop app. Download it to get computer control.',
  }),
  computerOpenApp: async (appName: string) => ({
    success: false,
    output: `Opening apps (like "${appName}") requires the Henry desktop app.`,
  }),
  computerOpenUrl: async (url: string) => {
    window.open(url, '_blank');
    return { success: true, output: `Opened ${url} in browser.` };
  },
  computerOsascript: async () => ({
    success: false,
    output: 'AppleScript execution requires the Henry desktop app.',
  }),
  computerRunShell: async (params: { command: string }) => ({
    success: false,
    output: `Shell commands require the Henry desktop app. Would have run: ${params.command}`,
  }),
  computerListApps: async () => ({
    apps: ['Safari', 'Chrome', 'Terminal', 'Xcode', 'VS Code', 'Finder', 'Mail', 'Calendar', 'Notes', 'Preview'],
    platform: 'web-preview',
  }),
  computerListProcesses: async () => ({
    processes: ['This is a preview — real process list requires the desktop app.'],
  }),
  computerCheckPermissions: async () => ({
    platform: 'web',
    accessibility: false,
    screenRecording: false,
    message: 'Computer permissions apply to the Henry desktop app. Download it to unlock full computer control.',
  }),
  computerTypeText: async () => ({
    success: false,
    output: 'Keyboard control requires the Henry desktop app.',
  }),
  computerClick: async () => ({
    success: false,
    output: 'Mouse control requires the Henry desktop app.',
  }),
  computerSystemInfo: async () => ({
    platform: navigator.platform || 'web',
    arch: 'unknown',
    hostname: 'web-browser',
    homeDir: '/',
    appVersion: '0.1.0',
    totalMemoryGB: ((navigator as any).deviceMemory ?? '?').toString(),
    freeMemoryGB: '?',
  }),

  // ── 3D Printer (web stubs) ────────────────────────────────────────────
  printerCheckDeps: async () => ({
    available: false,
    installCommand: 'pip3 install pyserial',
    error: 'Printer control requires the Henry desktop app.',
  }),
  printerListPorts: async () => ({
    ports: [],
    error: 'Serial port access requires the Henry desktop app.',
    method: 'none',
  }),
  printerConnect: async () => ({
    success: false,
    error: 'Printer connection requires the Henry desktop app.',
  }),
  printerDisconnect: async () => ({
    success: false,
    error: 'Not connected.',
  }),
  printerSendGcode: async () => ({
    success: false,
    error: 'G-code requires the Henry desktop app.',
  }),
  printerStatus: async () => ({
    connected: false,
  }),
  printerPrintGcode: async () => ({
    success: false,
    error: 'Printing requires the Henry desktop app.',
  }),
  onPrinterData: (cb) => on('printer:data', cb),

  getCostLog: async () => {
    return getStore('henry:costlog', []);
  },

  onTaskUpdate: (cb) => on('task:update', cb),
  onTaskResult: (cb) => on('task:result', cb),
  onEngineStatus: (cb) => on('engine:status', cb),
  onWorkerMessage: (cb) => on('worker:message', cb),
};

window.henryAPI = henryAPI;
