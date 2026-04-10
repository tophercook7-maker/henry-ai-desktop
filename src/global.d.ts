import type {
  AIProvider,
  Conversation,
  Message,
  Task,
  MemoryFact,
  MemoryContext,
  DirectoryResult,
  ScriptureLookupResult,
  ScriptureImportRow,
  ScriptureImportResult,
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
    payload?: unknown;
    sourceEngine?: string;
    conversationId?: string;
    createdFromMode?: string;
    relatedFilePath?: string;
    createdFromMessageId?: string;
  }

  interface HenryTaskResultPayload {
    taskId: string;
    conversationId?: string;
    error?: string;
    result?: {
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
    /** Optional: rows to read before renderer-side dedupe (default 40) */
    maxFactsFetch?: number;
  }

  /** Matches `memory:saveSummary` IPC (camelCase). */
  interface HenrySummaryInput {
    conversationId: string;
    summary: string;
    messageCount?: number;
    tokenCount?: number;
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

  // ── Computer Control Types ─────────────────────────────────────────
  interface HenryScreenshotResult {
    success: boolean;
    base64: string | null;
    mimeType?: string;
    error?: string;
  }

  interface HenryPermissionsResult {
    platform: string;
    accessibility: boolean;
    screenRecording: boolean;
    accessibilityInstructions?: string | null;
    screenRecordingInstructions?: string | null;
    message?: string;
  }

  interface HenryComputerShellResult {
    success: boolean;
    output: string;
    error?: string;
    exitCode?: number;
  }

  interface HenrySystemInfo {
    platform: string;
    arch: string;
    hostname: string;
    homeDir: string;
    appVersion: string;
    totalMemoryGB: string;
    freeMemoryGB: string;
    macOS?: string;
  }

  // ── 3D Printer Types ───────────────────────────────────────────────
  interface HenryPrinterPort {
    device: string;
    description: string;
    hwid: string;
  }

  interface HenryPrinterData {
    type: 'response' | 'sent' | 'error' | 'disconnected';
    data?: string;
  }

  interface HenryAPI {
    getSettings: () => Promise<Record<string, string>>;
    saveSetting: (key: string, value: string) => Promise<boolean>;

    getProviders: () => Promise<HenryProviderRecord[]>;
    saveProvider: (provider: Omit<AIProvider, 'models'> & { models: string }) => Promise<boolean>;

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
    saveSummary: (summary: HenrySummaryInput) => Promise<{ id: string | null; error?: string }>;
    getSummary: (conversationId: string) => Promise<string | null>;

    scriptureLookup: (reference: string) => Promise<ScriptureLookupResult>;
    scriptureImport: (entries: ScriptureImportRow[]) => Promise<ScriptureImportResult>;
    scriptureCount: () => Promise<number>;
    pickScriptureImportJson: () => Promise<
      | { canceled: true; content: null }
      | { canceled: false; content: string | null; error?: string }
    >;

    readDirectory: (path?: string) => Promise<DirectoryResult>;
    readFile: (path: string) => Promise<string>;
    pathExists: (path: string) => Promise<boolean>;
    writeFile: (path: string, content: string) => Promise<boolean>;

    ollamaStatus: (baseUrl?: string) => Promise<{ running: boolean; version?: string; url: string; error?: string }>;
    ollamaModels: (baseUrl?: string) => Promise<{ models: Array<{ name: string; [k: string]: any }>; error?: string }>;
    ollamaPull: (model: string, baseUrl?: string) => Promise<{ success: boolean; error?: string }>;
    ollamaDelete: (model: string, baseUrl?: string) => Promise<{ success: boolean; error?: string }>;
    onOllamaPullProgress: (cb: (data: any) => void) => () => void;

    // Ollama Lifecycle — Electron-only (undefined in web/browser mode)
    ollamaIsInstalled?: () => Promise<{ installed: boolean; running: boolean; binPath?: string }>;
    ollamaLaunch?: (binPath?: string) => Promise<{ success: boolean; error?: string }>;
    ollamaInstall?: () => Promise<{ success: boolean; binPath?: string; running?: boolean; error?: string }>;
    onOllamaInstallProgress?: (cb: (data: { phase: string; downloaded: number; total: number; message: string }) => void) => () => void;

    execTerminal: (params: HenryTerminalRequest) => Promise<HenryTerminalResponse>;
    killTerminal: (execId: string) => Promise<{ killed: boolean; error?: string }>;

    // ── Computer Control ─────────────────────────────────────
    computerScreenshot: (params?: { region?: { x: number; y: number; w: number; h: number } }) => Promise<HenryScreenshotResult>;
    computerOpenApp: (appName: string) => Promise<HenryComputerShellResult>;
    computerOpenUrl: (url: string) => Promise<HenryComputerShellResult>;
    computerOsascript: (script: string) => Promise<HenryComputerShellResult>;
    computerRunShell: (params: { command: string; timeout?: number }) => Promise<HenryComputerShellResult>;
    computerListApps: () => Promise<{ apps: string[]; platform: string }>;
    computerListProcesses: () => Promise<{ processes: string[] }>;
    computerCheckPermissions: () => Promise<HenryPermissionsResult>;
    computerTypeText: (text: string) => Promise<HenryComputerShellResult>;
    computerClick: (params: { x: number; y: number; button?: string }) => Promise<HenryComputerShellResult>;
    computerSystemInfo: () => Promise<HenrySystemInfo>;

    // ── 3D Printer ───────────────────────────────────────────
    printerCheckDeps: () => Promise<{ available: boolean; version?: string; installCommand?: string; error?: string }>;
    printerListPorts: () => Promise<{ ports: HenryPrinterPort[]; method?: string; error?: string }>;
    printerConnect: (params: { port: string; baudRate?: number }) => Promise<{ success: boolean; port?: string; baudRate?: number; error?: string }>;
    printerDisconnect: () => Promise<{ success: boolean; error?: string }>;
    printerSendGcode: (command: string) => Promise<{ success: boolean; sent?: string; error?: string }>;
    printerStatus: () => Promise<{ connected: boolean; port?: string; baudRate?: number }>;
    printerPrintGcode: (gcode: string) => Promise<{ success: boolean; sent?: number; total?: number; error?: string }>;
    onPrinterData: (cb: (data: HenryPrinterData) => void) => () => void;

    getCostLog: (period?: string) => Promise<unknown[]>;

    onTaskUpdate: (cb: (data: Partial<Task> & { id: string }) => void) => () => void;
    onTaskResult: (cb: (data: HenryTaskResultPayload) => void) => () => void;
    onEngineStatus: (cb: (data: HenryEngineStatusPayload) => void) => () => void;
    onWorkerMessage: (cb: (data: Message) => void) => () => void;

    checkForUpdates: () => Promise<unknown>;
    installUpdate: () => Promise<void>;
    onUpdateAvailable: (cb: () => void) => () => void;
    onUpdateDownloaded: (cb: () => void) => () => void;

    whisperTranscribe?: (audioBlob: Blob, apiKey: string) => Promise<string>;
    createTask?: (params: { description: string; type: string; priority?: number; payload?: unknown }) => Promise<{ id: string }>;
  }

  interface Window {
    henryAPI: HenryAPI;
  }
}

export {};
