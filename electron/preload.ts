import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AIProvider, Message, Task, TaskSubmission } from '../src/types';

type ProviderSavePayload = Omit<AIProvider, 'models'> & { models: string };

type TaskListFilter = { status?: string; limit?: number };

type AIInvokeParams = {
  provider: string;
  model: string;
  apiKey: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
};

type TaskUpdatePayload = Partial<Task> & { id: string };

type TaskResultEventPayload = {
  taskId: string;
  conversationId?: string;
  error?: string;
  result?: unknown;
};

type EngineStatusEventPayload = {
  engine: 'companion' | 'worker';
  status: string;
  taskId?: string;
  taskDescription?: string;
  message?: string;
};

contextBridge.exposeInMainWorld('henryAPI', {
  // ── Settings ──────────────────────────────────────────────
  getSettings: () => ipcRenderer.invoke('settings:getAll'),
  saveSetting: (key: string, value: string) => ipcRenderer.invoke('settings:save', { key, value }),

  // ── Providers ─────────────────────────────────────────────
  getProviders: () => ipcRenderer.invoke('providers:getAll'),
  saveProvider: (provider: ProviderSavePayload) => ipcRenderer.invoke('providers:save', provider),

  // ── Conversations ─────────────────────────────────────────
  getConversations: () => ipcRenderer.invoke('conversations:getAll'),
  createConversation: (title: string) => ipcRenderer.invoke('conversations:create', title),
  updateConversation: (id: string, title: string) => ipcRenderer.invoke('conversations:update', { id, title }),
  deleteConversation: (id: string) => ipcRenderer.invoke('conversations:delete', id),

  // ── Messages ──────────────────────────────────────────────
  getMessages: (conversationId: string) => ipcRenderer.invoke('messages:getAll', conversationId),
  saveMessage: (message: Message) => ipcRenderer.invoke('messages:save', message),

  // ── AI ────────────────────────────────────────────────────
  sendMessage: (params: AIInvokeParams) => ipcRenderer.invoke('ai:send', params),
  streamMessage: (params: AIInvokeParams) => {
    const channelId = `ai-stream-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let onChunkCb: ((chunk: string) => void) | null = null;
    let onDoneCb: ((fullText: string, usage?: Record<string, unknown>) => void) | null = null;
    let onErrorCb: ((error: string) => void) | null = null;

    const chunkHandler = (_: IpcRendererEvent, data: { channelId: string; chunk: string }) => {
      if (data.channelId === channelId && onChunkCb) onChunkCb(data.chunk);
    };
    const doneHandler = (_: IpcRendererEvent, data: { channelId: string; fullText: string; usage?: Record<string, unknown> }) => {
      if (data.channelId === channelId && onDoneCb) {
        onDoneCb(data.fullText, data.usage);
        cleanup();
      }
    };
    const errorHandler = (_: IpcRendererEvent, data: { channelId: string; error: string }) => {
      if (data.channelId === channelId && onErrorCb) {
        onErrorCb(data.error);
        cleanup();
      }
    };

    // Register listeners before starting IPC so ultra-fast streams (local) never miss events.
    ipcRenderer.on('ai:stream:chunk', chunkHandler);
    ipcRenderer.on('ai:stream:done', doneHandler);
    ipcRenderer.on('ai:stream:error', errorHandler);

    void ipcRenderer.invoke('ai:stream', { ...params, channelId });

    function cleanup() {
      ipcRenderer.removeListener('ai:stream:chunk', chunkHandler);
      ipcRenderer.removeListener('ai:stream:done', doneHandler);
      ipcRenderer.removeListener('ai:stream:error', errorHandler);
    }

    return {
      onChunk: (cb: (chunk: string) => void) => {
        onChunkCb = cb;
      },
      onDone: (cb: (fullText: string, usage?: Record<string, unknown>) => void) => {
        onDoneCb = cb;
      },
      onError: (cb: (error: string) => void) => {
        onErrorCb = cb;
      },
      cancel: () => {
        ipcRenderer.invoke('ai:cancel', channelId);
        cleanup();
      },
    };
  },

  // ── Tasks ─────────────────────────────────────────────────
  getTasks: (filter?: TaskListFilter) => ipcRenderer.invoke('task:list', filter),
  submitTask: (task: TaskSubmission) => ipcRenderer.invoke('task:submit', task),
  getTaskStatus: (id: string) => ipcRenderer.invoke('task:status', id),
  cancelTask: (id: string) => ipcRenderer.invoke('task:cancel', id),
  retryTask: (id: string) => ipcRenderer.invoke('task:retry', id),
  getTaskStats: () => ipcRenderer.invoke('task:stats'),

  // ── Memory ────────────────────────────────────────────────
  saveFact: (fact: Record<string, unknown>) => ipcRenderer.invoke('memory:saveFact', fact),
  searchFacts: (query: Record<string, unknown>) => ipcRenderer.invoke('memory:searchFacts', query),
  getAllFacts: (limit?: number) => ipcRenderer.invoke('memory:getAllFacts', limit),
  buildContext: (params: Record<string, unknown>) => ipcRenderer.invoke('memory:buildContext', params),
  saveSummary: (summary: Record<string, unknown>) => ipcRenderer.invoke('memory:saveSummary', summary),
  getSummary: (conversationId: string) => ipcRenderer.invoke('memory:getSummary', conversationId),

  // ── Scripture (local store) ───────────────────────────────
  scriptureLookup: (reference: string) => ipcRenderer.invoke('scripture:lookup', reference),
  scriptureImport: (entries: Array<Record<string, unknown>>) =>
    ipcRenderer.invoke('scripture:import', { entries }),
  scriptureCount: () => ipcRenderer.invoke('scripture:count'),
  pickScriptureImportJson: () => ipcRenderer.invoke('scripture:pickImportJson'),

  // ── File System ───────────────────────────────────────────
  readDirectory: (dirPath?: string) => ipcRenderer.invoke('fs:readDirectory', dirPath),
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  pathExists: (filePath: string) => ipcRenderer.invoke('fs:pathExists', filePath) as Promise<boolean>,
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', { path: filePath, content }),

  // ── Ollama ────────────────────────────────────────────────
  ollamaStatus: (baseUrl?: string) => ipcRenderer.invoke('ollama:status', baseUrl),
  ollamaModels: (baseUrl?: string) => ipcRenderer.invoke('ollama:models', baseUrl),
  ollamaPull: (model: string, baseUrl?: string) => ipcRenderer.invoke('ollama:pull', model, baseUrl),
  ollamaDelete: (model: string, baseUrl?: string) => ipcRenderer.invoke('ollama:delete', model, baseUrl),
  onOllamaPullProgress: (cb: (data: unknown) => void) => {
    const handler = (_: IpcRendererEvent, data: unknown) => cb(data);
    ipcRenderer.on('ollama:pull:progress', handler);
    return () => ipcRenderer.removeListener('ollama:pull:progress', handler);
  },

  // ── Ollama Lifecycle (Electron-only — Henry manages Ollama automatically) ──
  ollamaIsInstalled: () => ipcRenderer.invoke('ollama:isInstalled') as Promise<{ installed: boolean; running: boolean; binPath?: string }>,
  ollamaLaunch: (binPath?: string) => ipcRenderer.invoke('ollama:launch', binPath) as Promise<{ success: boolean; error?: string }>,
  ollamaInstall: () => ipcRenderer.invoke('ollama:install') as Promise<{ success: boolean; binPath?: string; running?: boolean; error?: string }>,
  onOllamaInstallProgress: (cb: (data: { phase: string; downloaded: number; total: number; message: string }) => void) => {
    const handler = (_: IpcRendererEvent, data: unknown) => cb(data as { phase: string; downloaded: number; total: number; message: string });
    ipcRenderer.on('ollama:install:progress', handler);
    return () => ipcRenderer.removeListener('ollama:install:progress', handler);
  },

  // ── Terminal ──────────────────────────────────────────────
  execTerminal: (params: Record<string, unknown>) => ipcRenderer.invoke('terminal:exec', params),
  killTerminal: (execId: string) => ipcRenderer.invoke('terminal:kill', execId),

  // ── Computer Control ──────────────────────────────────────
  computerScreenshot: (params?: Record<string, unknown>) => ipcRenderer.invoke('computer:screenshot', params ?? {}),
  computerOpenApp: (appName: string) => ipcRenderer.invoke('computer:openApp', appName),
  computerOpenUrl: (url: string) => ipcRenderer.invoke('computer:openUrl', url),
  computerOsascript: (script: string) => ipcRenderer.invoke('computer:osascript', script),
  computerRunShell: (params: Record<string, unknown>) => ipcRenderer.invoke('computer:runShell', params),
  computerListApps: () => ipcRenderer.invoke('computer:listApps'),
  computerListProcesses: () => ipcRenderer.invoke('computer:listProcesses'),
  computerCheckPermissions: () => ipcRenderer.invoke('computer:checkPermissions'),
  computerTypeText: (text: string) => ipcRenderer.invoke('computer:typeText', text),
  computerClick: (params: Record<string, unknown>) => ipcRenderer.invoke('computer:click', params),
  computerSystemInfo: () => ipcRenderer.invoke('computer:systemInfo'),

  // ── 3D Printer ────────────────────────────────────────────
  printerCheckDeps: () => ipcRenderer.invoke('printer:checkDeps'),
  printerListPorts: () => ipcRenderer.invoke('printer:listPorts'),
  printerConnect: (params: Record<string, unknown>) => ipcRenderer.invoke('printer:connect', params),
  printerDisconnect: () => ipcRenderer.invoke('printer:disconnect'),
  printerSendGcode: (command: string) => ipcRenderer.invoke('printer:sendGcode', command),
  printerStatus: () => ipcRenderer.invoke('printer:status'),
  printerPrintGcode: (gcode: string) => ipcRenderer.invoke('printer:printGcode', gcode),
  onPrinterData: (cb: (data: unknown) => void) => {
    const handler = (_: IpcRendererEvent, data: unknown) => cb(data);
    ipcRenderer.on('printer:data', handler);
    return () => ipcRenderer.removeListener('printer:data', handler);
  },

  // ── Cost Tracking ─────────────────────────────────────────
  getCostLog: (period?: string) => ipcRenderer.invoke('cost:getAll', period),

  // ── Events ────────────────────────────────────────────────
  onTaskUpdate: (cb: (data: TaskUpdatePayload) => void) => {
    const handler = (_: IpcRendererEvent, data: TaskUpdatePayload) => cb(data);
    ipcRenderer.on('task:update', handler);
    return () => ipcRenderer.removeListener('task:update', handler);
  },
  onTaskResult: (cb: (data: TaskResultEventPayload) => void) => {
    const handler = (_: IpcRendererEvent, data: TaskResultEventPayload) => cb(data);
    ipcRenderer.on('task:result', handler);
    return () => ipcRenderer.removeListener('task:result', handler);
  },
  onEngineStatus: (cb: (data: EngineStatusEventPayload) => void) => {
    const handler = (_: IpcRendererEvent, data: EngineStatusEventPayload) => cb(data);
    ipcRenderer.on('engine:status', handler);
    return () => ipcRenderer.removeListener('engine:status', handler);
  },
  onWorkerMessage: (cb: (data: unknown) => void) => {
    const handler = (_: IpcRendererEvent, data: unknown) => cb(data);
    ipcRenderer.on('worker:message', handler);
    return () => ipcRenderer.removeListener('worker:message', handler);
  },
});
