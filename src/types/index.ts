// ── AI Provider Types ─────────────────────────────────────────

export interface AIProvider {
  id: string;
  name: string;
  apiKey: string;
  enabled: boolean;
  models: string[];
}

export interface AIModel {
  id: string;
  name: string;
  provider: string;
  inputPricePer1M: number;
  outputPricePer1M: number;
  contextWindow: number;
  capabilities?: string[];
  recommended?: 'companion' | 'worker' | 'both';
  local?: boolean;
}

// ── Conversation Types ────────────────────────────────────────

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  provider?: string;
  engine?: 'companion' | 'worker';
  tokens_used?: number;
  cost?: number;
  created_at: string;
  isStreaming?: boolean;
}

// ── Task Types ────────────────────────────────────────────────

export type TaskStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type TaskType = 'ai_generate' | 'file_operation' | 'code_generate' | 'research' | 'custom';

export interface Task {
  id: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  priority: number;
  payload?: string;
  result?: string;
  error?: string;
  source_engine?: string;
  conversation_id?: string;
  cost?: number;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  /** Operating mode when task was created from chat (follow-up bridge). */
  created_from_mode?: string;
  /** Workspace-relative path linked at creation (draft / Design3D ref). */
  related_file_path?: string;
  /** Source assistant message id when created from “Create task”. */
  created_from_message_id?: string;
}

export interface TaskSubmission {
  description: string;
  type: TaskType;
  priority?: number;
  payload?: unknown;
  sourceEngine?: string;
  conversationId?: string;
  createdFromMode?: string;
  relatedFilePath?: string;
  createdFromMessageId?: string;
}

// ── Engine Types ──────────────────────────────────────────────

export interface EngineStatus {
  status: 'idle' | 'thinking' | 'planning' | 'acting' | 'working' | 'streaming' | 'error' | 'done';
  taskId?: string;
  taskDescription?: string;
  message?: string;
}

export interface EngineConfig {
  provider: string;
  model: string;
  apiKey: string;
  temperature?: number;
}

// ── Memory Types ──────────────────────────────────────────────

export interface MemoryFact {
  id: string;
  conversation_id?: string;
  fact: string;
  category: string;
  importance: number;
  created_at: string;
}

export interface ConversationSummary {
  id: string;
  conversation_id: string;
  summary: string;
  message_count: number;
  token_count: number;
  created_at: string;
}

export interface WorkspaceFile {
  id: string;
  file_path: string;
  file_type: string;
  summary: string;
  last_indexed: string;
  size_bytes: number;
}

/** Raw slices from SQLite for the lean memory builder (see `henry/memoryContext.ts`). */
export interface HenryLeanMemoryParts {
  conversationSummary: string | null;
  facts: ReadonlyArray<{ fact: string; category: string }>;
  workspaceHints: ReadonlyArray<{ file_path: string; summary: string }>;
}

export interface MemoryContext {
  lean: HenryLeanMemoryParts;
  estimatedTokens: number;
  factCount: number;
}

// ── Scripture (re-export from henry for API / global typings) ─
export type { ScriptureEntry } from '../henry/scriptureStore';
export type { ScriptureLookupResult } from '../henry/scriptureLookup';
export type { ScriptureImportRow, ScriptureImportResult } from '../henry/scriptureImport';
export type { ParsedScriptureReference, ParseScriptureResult } from '../henry/scriptureReference';

// ── File System Types ─────────────────────────────────────────

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modified?: string;
}

export interface DirectoryResult {
  path: string;
  entries: FileEntry[];
}

// ── Store Types ───────────────────────────────────────────────

export type ViewType = 'today' | 'chat' | 'secretary' | 'contacts' | 'tasks' | 'files' | 'workspace' | 'terminal' | 'computer' | 'printer' | 'costs' | 'settings' | 'journal' | 'focus' | 'recorder' | 'modes' | 'reminders' | 'crm' | 'finance' | 'lists' | 'printstudio' | 'imagegen' | 'integrations' | 'github' | 'linear' | 'notion' | 'slack';

export interface AppSettings {
  [key: string]: string;
}

export interface AppState {
  // UI
  currentView: ViewType;
  setupComplete: boolean;

  // Conversations
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: Message[];

  // AI
  providers: AIProvider[];
  settings: AppSettings;
  isStreaming: boolean;
  streamingContent: string;

  // Engines
  companionStatus: EngineStatus;
  workerStatus: EngineStatus;

  // Tasks
  tasks: Task[];

  // Memory
  facts: MemoryFact[];

  // Actions
  setCurrentView: (view: ViewType) => void;
  setSetupComplete: (complete: boolean) => void;
  setConversations: (convos: Conversation[]) => void;
  setActiveConversation: (id: string | null) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  setProviders: (providers: AIProvider[]) => void;
  updateSetting: (key: string, value: string) => void;
  setIsStreaming: (streaming: boolean) => void;
  setStreamingContent: (content: string) => void;
  appendStreamingContent: (chunk: string) => void;
  setCompanionStatus: (status: Partial<EngineStatus>) => void;
  setWorkerStatus: (status: Partial<EngineStatus>) => void;
  setTasks: (tasks: Task[]) => void;
  addTask: (task: Task) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  setFacts: (facts: MemoryFact[]) => void;
  addFact: (fact: MemoryFact) => void;
}
