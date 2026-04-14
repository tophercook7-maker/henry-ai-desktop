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
    queueLength?: number;
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
    /** Memory bandwidth mode (shallow/normal/deep/maximum) */
    bandwidth?: string;
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

    // ── Memory — Legacy ───────────────────────────────────────
    saveFact: (fact: HenrySaveFactInput) => Promise<boolean | MemoryFact>;
    searchFacts: (query: HenrySearchFactsInput) => Promise<MemoryFact[]>;
    getAllFacts: (limit?: number) => Promise<MemoryFact[]>;
    buildContext: (params: HenryBuildContextInput) => Promise<MemoryContext>;
    saveSummary: (summary: HenrySummaryInput) => Promise<{ id: string | null; error?: string }>;
    getSummary: (conversationId: string) => Promise<string | null>;

    // ── Memory — Layer 2: Session ─────────────────────────────
    saveSessionMemory: (session: Record<string, unknown>) => Promise<{ id: string; created?: boolean; updated?: boolean }>;
    getSessionMemory: (conversationId: string) => Promise<Record<string, unknown> | null>;
    compressSession: (opts: Record<string, unknown>) => Promise<{ compressed: boolean; summaryId: string }>;

    // ── Memory — Layer 3: Working Memory ─────────────────────
    getWorkingMemory: (userId?: string) => Promise<Record<string, unknown> | null>;
    updateWorkingMemory: (updates: Record<string, unknown>) => Promise<{ updated: boolean }>;

    // ── Memory — Layer 4: Personal Memory (scored) ────────────
    savePersonalMemory: (item: Record<string, unknown>) => Promise<{ id: string }>;
    getPersonalMemory: (opts?: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
    updatePersonalMemory: (id: string, updates: Record<string, unknown>) => Promise<{ updated: boolean }>;
    deletePersonalMemory: (id: string) => Promise<{ deleted: boolean }>;
    recallPersonalMemory: (id: string) => Promise<void>;

    // ── Memory — Layer 5: Projects ────────────────────────────
    saveProject: (project: Record<string, unknown>) => Promise<{ id: string }>;
    getProjects: (opts?: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
    updateProject: (id: string, updates: Record<string, unknown>) => Promise<{ updated: boolean }>;
    saveProjectMemory: (item: Record<string, unknown>) => Promise<{ id: string }>;
    getProjectMemory: (projectId: string) => Promise<Array<Record<string, unknown>>>;

    // ── Memory — Goals ────────────────────────────────────────
    saveGoal: (goal: Record<string, unknown>) => Promise<{ id: string }>;
    getGoals: (opts?: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
    updateGoal: (id: string, updates: Record<string, unknown>) => Promise<{ updated: boolean }>;

    // ── Memory — Commitments ──────────────────────────────────
    saveCommitment: (c: Record<string, unknown>) => Promise<{ id: string }>;
    getCommitments: (opts?: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
    resolveCommitment: (id: string) => Promise<{ resolved: boolean }>;
    updateCommitment: (id: string, updates: Record<string, unknown>) => Promise<{ updated: boolean }>;

    // ── Memory — Milestones ───────────────────────────────────
    saveMilestone: (m: Record<string, unknown>) => Promise<{ id: string }>;
    getMilestones: (opts?: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;

    // ── Memory — Layer 6: Relationship Memory ─────────────────
    saveRelationshipMemory: (item: Record<string, unknown>) => Promise<{ id: string; skipped?: boolean }>;
    getRelationshipMemory: (opts?: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;

    // ── Memory — Layer 7: Narrative Memory ───────────────────
    saveNarrativeMemory: (arc: Record<string, unknown>) => Promise<{ id: string; created?: boolean; updated?: boolean }>;
    getNarrativeMemory: (opts?: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;

    // ── Memory — Summaries + Graph ────────────────────────────
    saveMemorySummary: (s: Record<string, unknown>) => Promise<{ id: string }>;
    getMemorySummaries: (opts?: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
    saveGraphEdge: (edge: Record<string, unknown>) => Promise<{ id: string }>;
    getGraphEdges: (opts?: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;

    // ── Memory — Deep Context + Where-We-Left-Off ─────────────
    buildDeepContext: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
    getWhereWeLeftOff: () => Promise<Record<string, unknown>>;
    saveWhereWeLeftOff: (summary: string) => Promise<{ id: string }>;

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
