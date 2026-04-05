import type {
  AIProvider,
  Conversation,
  Message,
  Task,
  MemoryFact,
  MemoryContext,
  DirectoryResult,
} from './types';

declare global {
  interface HenryProviderRecord {
    id: string;
    name: string;
    api_key?: string;
    apiKey?: string;
    enabled: number | boolean;
    models: string | string[];
    created_at?: string;
    updated_at?: string;
  }

  interface HenryTaskFilter {
    status?: string;
    limit?: number;
  }

  interface HenryTaskSubmission {
    description: string;
    type: string;
    priority?: number;
    payload?: string;
    sourceEngine?: string;
    conversationId?: string;
  }

  interface HenryTaskResultPayload {
    taskId: string;
    conversationId?: string;
    result: {
      type?: string;
      content?: string;
      model?: string;
      cost?: number;
      [key: string]: unknown;
    } | string;
  }

  interface HenryEngineStatusPayload {
    engine: 'companion' | 'worker';
    status: 'idle' | 'thinking' | 'working' | 'streaming' | 'error';
    taskId?: string;
    taskDescription?: string;
    message?: string;
  }

  interface HenryAIMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
  }

  interface HenryAIRequest {
    provider: string;
    model: string;
    apiKey: string;
    messages: HenryAIMessage[];
    temperature?: number;
    maxTokens?: number;
  }

  interface HenryAIUsage {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
    input?: number;
    output?: number;
  }

  interface HenryAIResponse {
    content: string;
    usage?: HenryAIUsage;
    cost?: number;
  }

  interface HenryAIStreamController {
    onChunk: (cb: (chunk: string) => void) => void;
    onDone: (cb: (fullText: string, usage?: HenryAIUsage) => void) => void;
    onError: (cb: (error: string) => void) => void;
    cancel: () => Promise<unknown> | void;
  }

  interface HenrySaveFactInput {
    id?: string;
    conversation_id?: string;
    fact: string;
    category?: string;
    importance?: number;
    created_at?: string;
  }

  interface HenrySearchFactsInput {
    query: string;
    category?: string;
    limit?: number;
  }

  interface HenryBuildContextInput {
    conversationId?: string;
    query?: string;
    maxFacts?: number;
  }

  interface HenrySummaryInput {
    conversation_id: string;
    summary: string;
    message_count?: number;
    token_count?: number;
    created_at?: string;
  }

  interface HenryTerminalRequest {
    command: string;
    cwd?: string;
    timeout?: number;
    channelId?: string;
  }

  interface HenryTerminalResponse {
    success: boolean;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    execId?: string;
  }

  interface HenryAPI {
    getSettings: () => Promise<Record<string, string>>;
    saveSetting: (key: string, value: string) => Promise<boolean>;

    getProviders: () => Promise<HenryProviderRecord[]>;
    saveProvider: (provider: AIProvider) => Promise<boolean>;

    getConversations: () => Promise<Conversation[]>;
    createConversation: (title: string) => Promise<Conversation>;
    updateConversation: (id: string, title: string) => Promise<boolean>;
    deleteConversation: (id: string) => Promise<boolean>;

    getMessages: (conversationId: string) => Promise<Message[]>;
    saveMessage: (message: Message) => Promise<boolean>;

    sendMessage: (params: HenryAIRequest) => Promise<HenryAIResponse>;
    streamMessage: (params: HenryAIRequest) => HenryAIStreamController;

    getTasks: (filter?: HenryTaskFilter) => Promise<Task[]>;
    submitTask: (task: HenryTaskSubmission) => Promise<{ id: string; status: string }>;
    getTaskStatus: (id: string) => Promise<Task | null>;
    cancelTask: (id: string) => Promise<{ id?: string; status?: string; error?: string }>;
    retryTask: (id: string) => Promise<{ id?: string; status?: string; error?: string }>;
    getTaskStats: () => Promise<{
      byStatus: Array<{ status: string; count: number }>;
      totalCost: number;
      activeCount: number;
    }>;

    saveFact: (fact: HenrySaveFactInput) => Promise<boolean | MemoryFact>;
    searchFacts: (query: HenrySearchFactsInput) => Promise<MemoryFact[]>;
    getAllFacts: (limit?: number) => Promise<MemoryFact[]>;
    buildContext: (params: HenryBuildContextInput) => Promise<MemoryContext>;
    saveSummary: (summary: HenrySummaryInput) => Promise<boolean>;
    getSummary: (conversationId: string) => Promise<string | null>;

    readDirectory: (path?: string) => Promise<DirectoryResult>;
    readFile: (path: string) => Promise<string>;
    writeFile: (path: string, content: string) => Promise<boolean>;

    ollamaStatus: (baseUrl?: string) => Promise<unknown>;
    ollamaModels: (baseUrl?: string) => Promise<unknown>;
    ollamaPull: (model: string, baseUrl?: string) => Promise<unknown>;
    ollamaDelete: (model: string, baseUrl?: string) => Promise<unknown>;
    onOllamaPullProgress: (cb: (data: unknown) => void) => () => void;

    execTerminal: (params: HenryTerminalRequest) => Promise<HenryTerminalResponse>;
    killTerminal: (execId: string) => Promise<{ killed: boolean; error?: string }>;

    getCostLog: (period?: string) => Promise<unknown[]>;

    onTaskUpdate: (cb: (data: Partial<Task> & { id: string }) => void) => () => void;
    onTaskResult: (cb: (data: HenryTaskResultPayload) => void) => () => void;
    onEngineStatus: (cb: (data: HenryEngineStatusPayload) => void) => () => void;
  }

  interface Window {
    henryAPI: HenryAPI;
  }
}

export {};
