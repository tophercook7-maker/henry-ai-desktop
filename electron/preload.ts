import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('henryAPI', {
  // ── Settings ──────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke('settings:getAll'),
  saveSetting: (key: string, value: string) => ipcRenderer.invoke('settings:save', { key, value }),

  // ── Providers ─────────────────────────────────────────────
  getProviders: () => ipcRenderer.invoke('providers:getAll'),
  saveProvider: (provider: any) => ipcRenderer.invoke('providers:save', provider),

  // ── Conversations ─────────────────────────────────────────
  getConversations: () => ipcRenderer.invoke('conversations:getAll'),
  createConversation: (title: string) => ipcRenderer.invoke('conversations:create', title),
  updateConversation: (id: string, title: string) => ipcRenderer.invoke('conversations:update', { id, title }),
  deleteConversation: (id: string) => ipcRenderer.invoke('conversations:delete', id),

  // ── Messages ──────────────────────────────────────────────
  getMessages: (conversationId: string) => ipcRenderer.invoke('messages:getAll', conversationId),
  saveMessage: (message: any) => ipcRenderer.invoke('messages:save', message),

  // ── AI ────────────────────────────────────────────────────
  sendMessage: (params: any) => ipcRenderer.invoke('ai:send', params),
  streamMessage: (params: any) => {
    const channelId = `ai-stream-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    ipcRenderer.invoke('ai:stream', { ...params, channelId });
    let onChunkCb: ((chunk: string) => void) | null = null;
    let onDoneCb: ((fullText: string, usage?: any) => void) | null = null;
    let onErrorCb: ((error: string) => void) | null = null;

    const chunkHandler = (_: any, data: any) => { if (data.channelId === channelId && onChunkCb) onChunkCb(data.chunk); };
    const doneHandler = (_: any, data: any) => { if (data.channelId === channelId && onDoneCb) { onDoneCb(data.fullText, data.usage); cleanup(); } };
    const errorHandler = (_: any, data: any) => { if (data.channelId === channelId && onErrorCb) { onErrorCb(data.error); cleanup(); } };

    ipcRenderer.on('ai:stream:chunk', chunkHandler);
    ipcRenderer.on('ai:stream:done', doneHandler);
    ipcRenderer.on('ai:stream:error', errorHandler);

    function cleanup() {
      ipcRenderer.removeListener('ai:stream:chunk', chunkHandler);
      ipcRenderer.removeListener('ai:stream:done', doneHandler);
      ipcRenderer.removeListener('ai:stream:error', errorHandler);
    }

    return {
      onChunk: (cb: (chunk: string) => void) => { onChunkCb = cb; },
      onDone: (cb: (fullText: string, usage?: any) => void) => { onDoneCb = cb; },
      onError: (cb: (error: string) => void) => { onErrorCb = cb; },
      cancel: () => { ipcRenderer.invoke('ai:cancel', channelId); cleanup(); },
    };
  },

  // ── Tasks ─────────────────────────────────────────────────
  getTasks: (filter?: any) => ipcRenderer.invoke('task:list', filter),
  submitTask: (task: any) => ipcRenderer.invoke('task:submit', task),
  getTaskStatus: (id: string) => ipcRenderer.invoke('task:status', id),
  cancelTask: (id: string) => ipcRenderer.invoke('task:cancel', id),
  retryTask: (id: string) => ipcRenderer.invoke('task:retry', id),
  getTaskStats: () => ipcRenderer.invoke('task:stats'),

  // ── Memory ────────────────────────────────────────────────
  saveFact: (fact: any) => ipcRenderer.invoke('memory:saveFact', fact),
  searchFacts: (query: any) => ipcRenderer.invoke('memory:searchFacts', query),
  getAllFacts: (limit?: number) => ipcRenderer.invoke('memory:getAllFacts', limit),
  buildContext: (params: any) => ipcRenderer.invoke('memory:buildContext', params),
  saveSummary: (summary: any) => ipcRenderer.invoke('memory:saveSummary', summary),
  getSummary: (conversationId: string) => ipcRenderer.invoke('memory:getSummary', conversationId),

  // ── File System ───────────────────────────────────────────
  readDirectory: (path?: string) => ipcRenderer.invoke('fs:readDirectory', path),
  readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path: string, content: string) => ipcRenderer.invoke('fs:writeFile', { path, content }),

  // ── Ollama ────────────────────────────────────────────────
  ollamaStatus: (baseUrl?: string) => ipcRenderer.invoke('ollama:status', baseUrl),
  ollamaModels: (baseUrl?: string) => ipcRenderer.invoke('ollama:models', baseUrl),
  ollamaPull: (model: string, baseUrl?: string) => ipcRenderer.invoke('ollama:pull', model, baseUrl),
  ollamaDelete: (model: string, baseUrl?: string) => ipcRenderer.invoke('ollama:delete', model, baseUrl),
  onOllamaPullProgress: (cb: (data: any) => void) => {
    const handler = (_: any, data: any) => cb(data);
    ipcRenderer.on('ollama:pull:progress', handler);
    return () => ipcRenderer.removeListener('ollama:pull:progress', handler);
  },

  // ── Terminal ──────────────────────────────────────────────
  execTerminal: (params: any) => ipcRenderer.invoke('terminal:exec', params),
  killTerminal: (execId: string) => ipcRenderer.invoke('terminal:kill', execId),

  // ── Cost Tracking ─────────────────────────────────────────
  getCostLog: (period?: string) => ipcRenderer.invoke('cost:getAll', period),

  // ── Events ────────────────────────────────────────────────
  onTaskUpdate: (cb: (data: any) => void) => {
    const handler = (_: any, data: any) => cb(data);
    ipcRenderer.on('task:update', handler);
    return () => ipcRenderer.removeListener('task:update', handler);
  },
  onTaskResult: (cb: (data: any) => void) => {
    const handler = (_: any, data: any) => cb(data);
    ipcRenderer.on('task:result', handler);
    return () => ipcRenderer.removeListener('task:result', handler);
  },
  onEngineStatus: (cb: (data: any) => void) => {
    const handler = (_: any, data: any) => cb(data);
    ipcRenderer.on('engine:status', handler);
    return () => ipcRenderer.removeListener('engine:status', handler);
  },
});
