import { useState } from 'react';
import { useStore } from '../../store';

// Simple SVG icons (avoiding dependency issues)
function ChatIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function TaskIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function SettingsIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function PlusIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function TrashIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export default function Sidebar() {
  const {
    currentView,
    setCurrentView,
    conversations,
    activeConversationId,
    setActiveConversation,
    setMessages,
    setConversations,
    workerStatus,
  } = useStore();
  const [hoveredConvo, setHoveredConvo] = useState<string | null>(null);

  const navItems = [
    { id: 'chat' as const, label: 'Chat', icon: ChatIcon },
    { id: 'tasks' as const, label: 'Tasks', icon: TaskIcon, badge: workerStatus.queueLength || undefined },
    { id: 'settings' as const, label: 'Settings', icon: SettingsIcon },
  ];

  async function handleNewChat() {
    try {
      const convo = await window.henryAPI.createConversation('New Chat');
      const convos = await window.henryAPI.getConversations();
      setConversations(convos);
      setActiveConversation(convo.id);
      setMessages([]);
      setCurrentView('chat');
    } catch (err) {
      console.error('Failed to create conversation:', err);
    }
  }

  async function handleSelectConvo(id: string) {
    setActiveConversation(id);
    setCurrentView('chat');
    try {
      const messages = await window.henryAPI.getMessages(id);
      setMessages(messages);
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  }

  async function handleDeleteConvo(id: string) {
    try {
      await window.henryAPI.deleteConversation(id);
      const convos = await window.henryAPI.getConversations();
      setConversations(convos);
      if (activeConversationId === id) {
        setActiveConversation(null);
        setMessages([]);
      }
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  }

  return (
    <div className="w-64 h-full flex flex-col bg-henry-surface/30 border-r border-henry-border/50 shrink-0">
      {/* Navigation */}
      <nav className="p-3 space-y-1">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setCurrentView(item.id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
              currentView === item.id
                ? 'bg-henry-accent/10 text-henry-accent'
                : 'text-henry-text-dim hover:text-henry-text hover:bg-henry-hover/50'
            }`}
          >
            <item.icon className="w-4 h-4" />
            <span className="flex-1 text-left">{item.label}</span>
            {item.badge && (
              <span className="px-1.5 py-0.5 text-[10px] font-medium bg-henry-worker/20 text-henry-worker rounded-full">
                {item.badge}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="h-px bg-henry-border/50 mx-3" />

      {/* Conversations */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-xs font-medium text-henry-text-muted uppercase tracking-wider">
            Conversations
          </span>
          <button
            onClick={handleNewChat}
            className="p-1 rounded-md hover:bg-henry-hover text-henry-text-dim hover:text-henry-text transition-colors"
            title="New Chat"
          >
            <PlusIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
          {conversations.length === 0 ? (
            <p className="text-xs text-henry-text-muted px-3 py-2">
              No conversations yet
            </p>
          ) : (
            conversations.map((convo) => (
              <div
                key={convo.id}
                onMouseEnter={() => setHoveredConvo(convo.id)}
                onMouseLeave={() => setHoveredConvo(null)}
                className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all ${
                  activeConversationId === convo.id
                    ? 'bg-henry-hover text-henry-text'
                    : 'text-henry-text-dim hover:bg-henry-hover/50 hover:text-henry-text'
                }`}
              >
                <button
                  onClick={() => handleSelectConvo(convo.id)}
                  className="flex-1 text-left text-sm truncate"
                >
                  {convo.title}
                </button>
                {hoveredConvo === convo.id && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteConvo(convo.id);
                    }}
                    className="p-1 rounded hover:bg-henry-error/20 text-henry-text-muted hover:text-henry-error transition-colors"
                  >
                    <TrashIcon className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Engine Status Footer */}
      <div className="p-3 border-t border-henry-border/50">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-henry-bg/50">
          <div className="text-xs">🧠</div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-medium text-henry-text truncate">
              Henry AI
            </div>
            <div className="text-[10px] text-henry-text-muted">v0.1.0</div>
          </div>
        </div>
      </div>
    </div>
  );
}
