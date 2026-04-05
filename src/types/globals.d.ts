interface StreamHandle {
  onChunk: (cb: (chunk: string) => void) => void;
  onDone: (cb: (fullText: string, usage?: any) => void) => void;
  onError: (cb: (error: string) => void) => void;
  cancel: () => void;
}

interface HenryAPI {
  // Settings
  getSettings: () => Promise<Record<string, string>>;
  saveSetting: (key: string, value: string) => Promise<void>;

  // Providers
  getProviders: () => Promise<any[]>;
  saveProvider: (provider: any) => Promise<void>;

  // Conversations
  getConversations: () => Promise<any[]>;
  createConversation: (title: string) => Promise<any>;
  updateConversation: (id: string, title: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;

  // Messages
  getMessages: (conversationId: string) => Promise<any[]>;
  saveMessage: (message: any) => Promise<void>;

  // AI
  sendMessage: (params: any) => Promise<any>;
  streamMessage: (params: any) => StreamHandle;

  // Tasks
  getTasks: (filter?: any) => Promise<any[]>;
  submitTask: (task: any) => Promise<{ id: string; status: string }>;
  getTaskStatus: (id: string) => Promise<any>;
  cancelTask: (id: string) => Promise<any>;
  retryTask: (id: string) => Promise<any>;
  getTaskStats: () => Promise<any>;

  // Memory
  saveFact: (fact: any) => Promise<{ id: string }>;
  searchFacts: (query: any) => Promise<any[]>;
  getAllFacts: (limit?: number) => Promise<any[]>;
  buildContext: (params: any) => Promise<any>;
  saveSummary: (summary: any) => Promise<{ id: string }>;
  getSummary: (conversationId: string) => Promise<any>;

  // File System
  readDirectory: (path?: string) => Promise<any>;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;

  // Ollama
  ollamaStatus: (baseUrl?: string) => Promise<{ running: boolean; version?: string; url: string; error?: string }>;
  ollamaModels: (baseUrl?: string) => Promise<{ models: any[]; error?: string }>;
  ollamaPull: (model: string, baseUrl?: string) => Promise<{ success: boolean; error?: string }>;
  ollamaDelete: (model: string, baseUrl?: string) => Promise<{ success: boolean; error?: string }>;
  onOllamaPullProgress: (cb: (data: any) => void) => () => void;

  // Terminal
  execTerminal: (params: { command: string; cwd?: string; timeout?: number; channelId?: string }) => Promise<{
    success: boolean; exitCode: number; stdout: string; stderr: string; execId?: string;
  }>;
  killTerminal: (execId: string) => Promise<{ killed: boolean }>;

  // Events
  onTaskUpdate: (cb: (data: any) => void) => () => void;
  onTaskResult: (cb: (data: any) => void) => () => void;
  onEngineStatus: (cb: (data: any) => void) => () => void;
}

declare global {
  interface Window {
    henryAPI: HenryAPI;
  }
}

export {};
