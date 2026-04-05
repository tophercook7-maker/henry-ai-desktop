import { create } from 'zustand';
import type {
  Conversation,
  Message,
  Task,
  Settings,
  EngineStatus,
  AIProvider,
} from '../types';

interface HenryStore {
  // App state
  initialized: boolean;
  setupComplete: boolean;
  currentView: 'chat' | 'files' | 'tasks' | 'settings' | 'wizard';

  // Settings
  settings: Settings;

  // Providers
  providers: AIProvider[];

  // Conversations
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: Message[];

  // Engine status
  companionStatus: EngineStatus;
  workerStatus: EngineStatus;

  // Tasks
  tasks: Task[];

  // Streaming state
  isStreaming: boolean;
  streamingContent: string;

  // Actions
  setInitialized: (v: boolean) => void;
  setSetupComplete: (v: boolean) => void;
  setCurrentView: (view: HenryStore['currentView']) => void;
  setSettings: (settings: Settings) => void;
  updateSetting: (key: string, value: string) => void;
  setProviders: (providers: AIProvider[]) => void;
  setConversations: (conversations: Conversation[]) => void;
  setActiveConversation: (id: string | null) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  setCompanionStatus: (status: Partial<EngineStatus>) => void;
  setWorkerStatus: (status: Partial<EngineStatus>) => void;
  setTasks: (tasks: Task[]) => void;
  addTask: (task: Task) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  setIsStreaming: (v: boolean) => void;
  setStreamingContent: (content: string) => void;
  appendStreamingContent: (chunk: string) => void;
}

export const useStore = create<HenryStore>((set) => ({
  // Initial state
  initialized: false,
  setupComplete: false,
  currentView: 'chat',
  settings: {
    setup_complete: 'false',
    theme: 'dark',
    companion_model: '',
    companion_provider: '',
    worker_model: '',
    worker_provider: '',
    default_temperature: '0.7',
    workspace_path: '',
  },
  providers: [],
  conversations: [],
  activeConversationId: null,
  messages: [],
  companionStatus: {
    engine: 'companion',
    status: 'idle',
    queueLength: 0,
  },
  workerStatus: {
    engine: 'worker',
    status: 'idle',
    queueLength: 0,
  },
  tasks: [],
  isStreaming: false,
  streamingContent: '',

  // Actions
  setInitialized: (v) => set({ initialized: v }),
  setSetupComplete: (v) => set({ setupComplete: v }),
  setCurrentView: (view) => set({ currentView: view }),
  setSettings: (settings) =>
    set({
      settings,
      setupComplete: settings.setup_complete === 'true',
    }),
  updateSetting: (key, value) =>
    set((state) => ({
      settings: { ...state.settings, [key]: value },
      ...(key === 'setup_complete' ? { setupComplete: value === 'true' } : {}),
    })),
  setProviders: (providers) => set({ providers }),
  setConversations: (conversations) => set({ conversations }),
  setActiveConversation: (id) => set({ activeConversationId: id }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  updateMessage: (id, updates) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, ...updates } : m
      ),
    })),
  setCompanionStatus: (status) =>
    set((state) => ({
      companionStatus: { ...state.companionStatus, ...status },
    })),
  setWorkerStatus: (status) =>
    set((state) => ({
      workerStatus: { ...state.workerStatus, ...status },
    })),
  setTasks: (tasks) => set({ tasks }),
  addTask: (task) => set((state) => ({ tasks: [...state.tasks, task] })),
  updateTask: (id, updates) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),
  setIsStreaming: (v) => set({ isStreaming: v }),
  setStreamingContent: (content) => set({ streamingContent: content }),
  appendStreamingContent: (chunk) =>
    set((state) => ({
      streamingContent: state.streamingContent + chunk,
    })),
}));
