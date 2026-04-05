import { contextBridge, ipcRenderer } from 'electron';

// Expose secure API to renderer process
contextBridge.exposeInMainWorld('henryAPI', {
  // Paths
  getPaths: () => ipcRenderer.invoke('get-paths'),

  // Window controls
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),

  // Settings
  getSettings: () => ipcRenderer.invoke('settings-get'),
  saveSetting: (key: string, value: string) =>
    ipcRenderer.invoke('settings-save', key, value),
  getProviders: () => ipcRenderer.invoke('settings-get-providers'),
  saveProvider: (provider: {
    id: string;
    name: string;
    apiKey: string;
    enabled: boolean;
    models: string;
  }) => ipcRenderer.invoke('settings-save-provider', provider),
  deleteProvider: (id: string) =>
    ipcRenderer.invoke('settings-delete-provider', id),

  // Conversations
  getConversations: () => ipcRenderer.invoke('conversations-list'),
  getConversation: (id: string) => ipcRenderer.invoke('conversation-get', id),
  createConversation: (title: string) =>
    ipcRenderer.invoke('conversation-create', title),
  deleteConversation: (id: string) =>
    ipcRenderer.invoke('conversation-delete', id),
  getMessages: (conversationId: string) =>
    ipcRenderer.invoke('messages-get', conversationId),
  saveMessage: (message: {
    id: string;
    conversationId: string;
    role: string;
    content: string;
    model?: string;
    provider?: string;
    tokensUsed?: number;
    cost?: number;
    engine?: string;
  }) => ipcRenderer.invoke('message-save', message),

  // AI
  sendMessage: (params: {
    provider: string;
    model: string;
    apiKey: string;
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    maxTokens?: number;
  }) => ipcRenderer.invoke('ai-send-message', params),
  streamMessage: (params: {
    provider: string;
    model: string;
    apiKey: string;
    messages: Array<{ role: string; content: string }>;
    temperature?: number;
    maxTokens?: number;
  }) => {
    // Set up stream listener
    const streamId = Date.now().toString();
    ipcRenderer.send('ai-stream-start', { ...params, streamId });
    return {
      streamId,
      onChunk: (callback: (chunk: string) => void) => {
        ipcRenderer.on(`ai-stream-chunk-${streamId}`, (_, chunk) =>
          callback(chunk)
        );
      },
      onDone: (callback: (fullText: string, usage?: any) => void) => {
        ipcRenderer.on(`ai-stream-done-${streamId}`, (_, fullText, usage) =>
          callback(fullText, usage)
        );
      },
      onError: (callback: (error: string) => void) => {
        ipcRenderer.on(`ai-stream-error-${streamId}`, (_, error) =>
          callback(error)
        );
      },
      cancel: () => {
        ipcRenderer.send(`ai-stream-cancel-${streamId}`);
      },
    };
  },

  // Task Queue
  getTasks: () => ipcRenderer.invoke('tasks-list'),
  createTask: (task: {
    id: string;
    type: string;
    description: string;
    priority: number;
    payload: string;
  }) => ipcRenderer.invoke('task-create', task),
  updateTask: (id: string, status: string, result?: string) =>
    ipcRenderer.invoke('task-update', id, status, result),

  // File system
  readWorkspace: (subpath?: string) =>
    ipcRenderer.invoke('fs-read-workspace', subpath),
  readFile: (filepath: string) => ipcRenderer.invoke('fs-read-file', filepath),
  writeFile: (filepath: string, content: string) =>
    ipcRenderer.invoke('fs-write-file', filepath, content),
  openFolder: () => ipcRenderer.invoke('dialog-open-folder'),

  // Events
  onWorkerStatus: (callback: (status: any) => void) => {
    ipcRenderer.on('worker-status', (_, status) => callback(status));
    return () => ipcRenderer.removeAllListeners('worker-status');
  },
});
