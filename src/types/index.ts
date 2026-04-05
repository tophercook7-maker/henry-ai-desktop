// Provider & Model types
export interface AIProvider {
  id: string;
  name: string;
  apiKey: string;
  enabled: boolean;
  models: AIModel[];
}

export interface AIModel {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  inputPricePer1M: number;
  outputPricePer1M: number;
  capabilities: ('chat' | 'code' | 'reasoning' | 'vision')[];
  recommended?: 'companion' | 'worker' | 'both';
  local?: boolean;
}

// Conversation types
export interface Conversation {
  id: string;
  title: string;
  model?: string;
  provider?: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  provider?: string;
  tokens_used?: number;
  cost?: number;
  engine?: 'companion' | 'worker';
  created_at: string;
  isStreaming?: boolean;
}

// Task Queue types
export interface Task {
  id: string;
  type: string;
  description: string;
  status: 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  priority: number;
  payload: string;
  result?: string;
  engine: 'companion' | 'worker';
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

// Engine types
export interface EngineConfig {
  provider: string;
  model: string;
  apiKey: string;
  temperature: number;
  systemPrompt: string;
}

export interface EngineStatus {
  engine: 'companion' | 'worker';
  status: 'idle' | 'thinking' | 'working' | 'error';
  currentTask?: string;
  queueLength: number;
}

// Settings
export interface Settings {
  setup_complete: string;
  theme: string;
  companion_model: string;
  companion_provider: string;
  worker_model: string;
  worker_provider: string;
  default_temperature: string;
  workspace_path: string;
  [key: string]: string;
}

// File system
export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modified?: string;
  extension?: string;
}

// Preload API
export interface HenryAPI {
  getPaths: () => Promise<{
    data: string;
    workspace: string;
    home: string;
    documents: string;
  }>;
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  getSettings: () => Promise<Settings>;
  saveSetting: (key: string, value: string) => Promise<boolean>;
  getProviders: () => Promise<any[]>;
  saveProvider: (provider: {
    id: string;
    name: string;
    apiKey: string;
    enabled: boolean;
    models: string;
  }) => Promise<boolean>;
  deleteProvider: (id: string) => Promise<boolean>;
  getConversations: () => Promise<Conversation[]>;
  getConversation: (id: string) => Promise<Conversation>;
  createConversation: (title: string) => Promise<{ id: string; title: string }>;
  deleteConversation: (id: string) => Promise<boolean>;
  getMessages: (conversationId: string) => Promise<Message[]>;
  saveMessage: (message: any) => Promise<boolean>;
  sendMessage: (params: any) => Promise<{ content: string; usage?: any }>;
  streamMessage: (params: any) => {
    streamId: string;
    onChunk: (callback: (chunk: string) => void) => void;
    onDone: (callback: (fullText: string, usage?: any) => void) => void;
    onError: (callback: (error: string) => void) => void;
    cancel: () => void;
  };
  getTasks: () => Promise<Task[]>;
  createTask: (task: any) => Promise<boolean>;
  updateTask: (id: string, status: string, result?: string) => Promise<boolean>;
  readWorkspace: (subpath?: string) => Promise<FileEntry[]>;
  readFile: (filepath: string) => Promise<string>;
  writeFile: (filepath: string, content: string) => Promise<boolean>;
  openFolder: () => Promise<string | null>;
  onWorkerStatus: (callback: (status: any) => void) => () => void;
}

declare global {
  interface Window {
    henryAPI: HenryAPI;
  }
}
