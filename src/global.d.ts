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
    /** Ollama / local proxy base URL (renderer passes through to main). */
    apiUrl?: string;
    /**
     * Agent mode. When present and non-empty, the main process routes this turn
     * through the agent ToolRunner (calendar, messages, quotes, QuickBooks, web)
     * instead of a plain completion. The array is only a flag — the real tool
     * schemas come from the main-process registry — so passing the lightweight
     * `listTools()` catalogue (or any non-empty array) is sufficient.
     */
    tools?: unknown[];
    /** Session id the agent run logs its tool-call audit trail against. */
    sessionId?: string;
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

  // Uniform envelope returned by every session:* IPC handler. `result` holds
  // the SessionStore command output (shape varies by command); on failure
  // `ok` is false and `error` carries the Python-side message.
  interface HenrySessionResult<T = unknown> {
    ok: boolean;
    result?: T;
    error?: string;
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

  // ── Agent: confirm-tier tool gate ───────────────────────────
  interface HenryConfirmRequest {
    id: string;
    toolName: string;
    args: Record<string, unknown>;
    description: string;
    safetyLevel: 'confirm';
  }

  // ── Scheduler: Henry's Routines ─────────────────────────────
  interface HenryRoutine {
    id: string;
    name: string;
    description: string | null;
    cronExpression: string;
    prompt: string;
    enabled: number; // 1 | 0
    lastRunAt: string | null;
    nextRunAt: string | null;
    createdAt: string;
  }

  interface HenryRoutineInput {
    name: string;
    description?: string;
    cronExpression: string;
    prompt: string;
    enabled?: boolean;
  }

  /** A 3D printer found on the local network. */
  interface HenryDiscoveredPrinter {
    ip: string;
    port?: number;
    kind: string;
    name?: string;
    url?: string;
    via: 'http' | 'ssdp';
  }

  /** Connection details for talking to a network printer's API. */
  interface HenryPrinterConn {
    ip: string;
    port?: number;
    kind: string;
    apiKey?: string;
  }

  /** Normalized live status from a network printer. */
  interface HenryPrinterStatus {
    state?: string;
    nozzle?: { actual: number; target: number };
    bed?: { actual: number; target: number };
    progress?: number;
    job?: string;
  }

  /** A captured piece of book material (book_entries table). */
  interface HenryBookEntry {
    id: string;
    kind: 'story' | 'lesson' | 'letter' | 'faith' | 'health' | 'fatherhood' | 'business' | 'money' | 'other';
    title?: string | null;
    content: string;
    created_at?: string;
    updated_at?: string;
  }

  /** A row from the Money Engine lead pipeline (leads table). */
  interface HenryLead {
    id: string;
    business: string;
    contact_name?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    source?: string | null;
    status: 'new' | 'audited' | 'contacted' | 'follow_up' | 'proposal' | 'won' | 'lost';
    audit_notes?: string | null;
    notes?: string | null;
    proposal_amount?: number | null;
    next_follow_up?: string | null;
    created_at?: string;
    updated_at?: string;
    last_touch_at?: string | null;
  }

  /** Lightweight crew summary (Agent Crews, Phase 2). */
  interface HenryCrewSummary {
    id: string;
    name: string;
    description: string;
    goal: string;
    agents: Array<{ id: string; name: string; role: string; goal: string }>;
  }

  interface HenryCrewRunStep {
    agent: string;
    output: string;
    rounds: number;
    usage: { input: number; output: number };
  }

  interface HenryCrewRunResult {
    crew: string;
    steps: HenryCrewRunStep[];
    final: string;
    usage: { input: number; output: number };
  }

  /** A row from the Project Vault (projects table). */
  interface HenryProject {
    id: string;
    name: string;
    type?: string | null;
    status: 'active' | 'paused' | 'completed' | 'archived';
    description?: string | null;
    summary?: string | null;
    next_action?: string | null;
    money_angle?: string | null;
    domain?: string | null;
    repo_url?: string | null;
    notes?: string | null;
    last_worked_at?: string | null;
    last_active_at?: string | null;
    updated_at?: string | null;
  }

  interface HenryAPI {
    getSettings: () => Promise<Record<string, string>>;
    saveSetting: (key: string, value: string) => Promise<boolean>;

    getProviders: () => Promise<HenryProviderRecord[]>;
    saveProvider: (provider: Omit<AIProvider, 'models'> & { models: string }) => Promise<boolean>;
    resyncProvidersToLocalStorage: () => Promise<{ ok: boolean; count?: number }>;

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
    memoryGetAllFacts: () => Promise<unknown[]>;
    memoryDeleteFact: (id: string) => Promise<void>;
    memorySaveFact: (fact: Record<string,unknown>) => Promise<unknown>;
    memoryGetPersonalMemory: () => Promise<unknown[]>;
    recordingsList: () => Promise<unknown[]>;
    recordingsGet: (id: string) => Promise<unknown>;
    recordingsSave: (r: Record<string,unknown>) => Promise<unknown>;
    recordingsDelete: (id: string) => Promise<unknown>;
    exportBackup: () => Promise<{ok: boolean; path?: string; error?: string}>;
    captureList: (limit?: number) => Promise<unknown[]>;
    captureSave: (c: Record<string,unknown>) => Promise<{ id: string }>;
    scriptureCount: () => Promise<number>;
    scriptureDownloadKJV: (books?: string[]) => Promise<{ imported: number; errors: string[]; books: number }>;
    scriptureSearch: (q: string) => Promise<unknown[]>;
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
    computerNewFolder: (params: { path: string }) => Promise<{ ok: boolean; path?: string; error?: string }>;
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

    // ── Session History (persistent conversation store + FTS search) ──
    // Each call resolves to { ok: true, result } or { ok: false, error }.
    sessionCheckDeps: () => Promise<{ available: boolean; ftsEnabled?: boolean; journalMode?: string; error?: string; installHint?: string }>;
    sessionCreate: (params: Record<string, unknown>) => Promise<HenrySessionResult>;
    sessionEnd: (params: Record<string, unknown>) => Promise<HenrySessionResult>;
    sessionResume: (params: Record<string, unknown>) => Promise<HenrySessionResult>;
    sessionBranch: (params: Record<string, unknown>) => Promise<HenrySessionResult>;
    sessionList: (params: Record<string, unknown>) => Promise<HenrySessionResult>;
    sessionSearch: (params: Record<string, unknown>) => Promise<HenrySessionResult>;
    sessionAddMessage: (params: Record<string, unknown>) => Promise<HenrySessionResult>;
    sessionGetMessages: (params: Record<string, unknown>) => Promise<HenrySessionResult>;
    // Agent audit log (Sprint 4): every tool-call message, newest first.
    listToolCalls?: (limit?: number) => Promise<HenrySessionResult>;
    clearToolCalls?: () => Promise<HenrySessionResult>;
    sessionGet: (params: Record<string, unknown>) => Promise<HenrySessionResult>;
    sessionSetTitle: (params: Record<string, unknown>) => Promise<HenrySessionResult>;
    sessionArchive: (params: Record<string, unknown>) => Promise<HenrySessionResult>;
    sessionUpdateTokens: (params: Record<string, unknown>) => Promise<HenrySessionResult>;
    sessionDelete: (params: Record<string, unknown>) => Promise<HenrySessionResult>;
    sessionExport: (params: Record<string, unknown>) => Promise<HenrySessionResult>;
    sessionStats: () => Promise<HenrySessionResult>;

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

    // ── Agent (tool layer) ────────────────────────────────────
    listTools?: () => Promise<Array<{ name: string; description: string; safetyLevel: string; category: string }>>;
    confirmTool?: (id: string, approved: boolean, editedArgs?: Record<string, unknown>) => Promise<{ ok: boolean }>;
    onAgentConfirmRequired?: (cb: (req: HenryConfirmRequest) => void) => () => void;
    onAgentToolNotify?: (cb: (data: { tool: string; message: string; ok: boolean }) => void) => () => void;

    // ── 3D printer network discovery + monitor ────────────────
    discoverPrinters?: () => Promise<{ ok: boolean; result?: HenryDiscoveredPrinter[]; error?: string }>;
    printerNetStatus?: (conn: HenryPrinterConn) => Promise<{ ok: boolean; result?: HenryPrinterStatus; error?: string }>;
    printerNetCommand?: (conn: HenryPrinterConn, action: string, gcode?: string) => Promise<{ ok: boolean; error?: string }>;

    // ── Book Engine (life material) ───────────────────────────
    listBookEntries?: (filter?: { kind?: string; limit?: number }) => Promise<{ ok: boolean; result?: HenryBookEntry[]; error?: string }>;
    createBookEntry?: (entry: Partial<HenryBookEntry>) => Promise<{ ok: boolean; result?: HenryBookEntry; error?: string }>;
    updateBookEntry?: (id: string, patch: Partial<HenryBookEntry>) => Promise<{ ok: boolean; result?: HenryBookEntry; error?: string }>;
    deleteBookEntry?: (id: string) => Promise<{ ok: boolean; result?: { deleted: boolean }; error?: string }>;

    // ── Money Engine (lead pipeline) ──────────────────────────
    listLeads?: (filter?: { status?: string; limit?: number }) => Promise<{ ok: boolean; result?: HenryLead[]; error?: string }>;
    createLead?: (lead: Partial<HenryLead>) => Promise<{ ok: boolean; result?: HenryLead; error?: string }>;
    updateLead?: (id: string, patch: Partial<HenryLead>) => Promise<{ ok: boolean; result?: HenryLead; error?: string }>;
    deleteLead?: (id: string) => Promise<{ ok: boolean; result?: { deleted: boolean }; error?: string }>;

    // ── Agent Crews ───────────────────────────────────────────
    listCrews?: () => Promise<{ ok: boolean; result?: HenryCrewSummary[]; error?: string }>;
    runCrew?: (crewId: string, input: string) => Promise<{ ok: boolean; result?: HenryCrewRunResult; error?: string }>;
    onCrewStep?: (cb: (data: { crewId: string; step: HenryCrewRunStep }) => void) => () => void;

    // ── Project Vault ─────────────────────────────────────────
    vaultListProjects?: (filter?: { status?: string; limit?: number }) => Promise<{ ok: boolean; result?: HenryProject[]; error?: string }>;
    vaultGetProject?: (id: string) => Promise<{ ok: boolean; result?: HenryProject | null; error?: string }>;
    vaultUpdateProject?: (id: string, patch: Partial<HenryProject>) => Promise<{ ok: boolean; result?: HenryProject; error?: string }>;

    // ── Scheduler (Henry's Routines) ──────────────────────────
    listRoutines?: () => Promise<{ ok: boolean; result?: HenryRoutine[]; error?: string }>;
    addRoutine?: (task: HenryRoutineInput) => Promise<{ ok: boolean; result?: HenryRoutine; error?: string }>;
    toggleRoutine?: (id: string, enabled: boolean) => Promise<{ ok: boolean; result?: HenryRoutine | null; error?: string }>;
    runRoutineNow?: (id: string) => Promise<{ ok: boolean; result?: { ok: boolean; content?: string; error?: string }; error?: string }>;
    deleteRoutine?: (id: string) => Promise<{ ok: boolean; result?: boolean; error?: string }>;
    onSchedulerTaskStarted?: (cb: (data: { id: string; name: string }) => void) => () => void;
    onSchedulerTaskCompleted?: (cb: (data: { id: string; name: string; ok: boolean; sessionId?: string; content?: string; error?: string }) => void) => () => void;

    // ── Companion Sync Bridge ─────────────────────────────────────────────
    getLocalGatewayStatus?: () => Promise<{ active: boolean; url?: string } | null>;
    syncStart?: (port?: number) => Promise<import('./sync/types').SyncServerState>;
    syncStop?: () => Promise<{ ok: boolean }>;
    syncGetState?: () => Promise<import('./sync/types').SyncServerState>;
    syncGeneratePairToken?: (ttlMs?: number) => Promise<string>;
    syncRevokePairToken?: () => Promise<{ ok: boolean }>;
    syncUnlinkDevice?: (deviceId: string) => Promise<{ ok: boolean }>;
    syncPushEvent?: (event: unknown) => Promise<{ ok: boolean }>;
    syncAddPendingAction?: (action: unknown) => Promise<{ ok: boolean }>;
    syncUpdateNotes?: (notes: unknown[]) => Promise<{ ok: boolean }>;
    syncUpdateSettings?: (settings: Record<string, unknown>) => Promise<{ ok: boolean }>;
    onQuickExtractResult?: (cb: (result: unknown) => void) => () => void;
    requestAccessibility?: () => Promise<{ granted: boolean }>;
    checkAccessibility?: () => Promise<{ granted: boolean }>;
    openPermissions?: () => Promise<{ ok: boolean }>;
    openScreenRecording?: () => Promise<{ ok: boolean }>;
    onPermissionsStatus?: (cb: (status: { accessibility: boolean; screenRecording: boolean }) => void) => () => void;
    onCompanionCapture?: (cb: (capture: unknown) => void) => () => void;
    onCompanionPrompt?: (cb: (data: unknown) => void) => () => void;
    onCompanionActionDecision?: (cb: (decision: unknown) => void) => () => void;
    isFirstLaunch?: () => Promise<{isFirst: boolean}>;
    onCompanionDeviceLinked?: (cb: (device: unknown) => void) => () => void;
    onSyncRequestStatus?: (cb: (replyChannel: string) => void) => () => void;
    replySyncStatus?: (channel: string, status: unknown) => void;
  }

  interface Window {
    henryAPI: HenryAPI;
  }
}

export {};
