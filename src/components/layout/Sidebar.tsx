import { useState, useEffect } from 'react';
import { useStore } from '../../store';
import type { Conversation } from '../../types';

type ViewType = 'chat' | 'tasks' | 'files' | 'workspace' | 'terminal' | 'computer' | 'printer' | 'costs' | 'settings';

const NAV_ITEMS: { id: ViewType; label: string; icon: string; badge?: string }[] = [
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'tasks', label: 'Tasks', icon: '📋' },
  { id: 'files', label: 'Files', icon: '📁' },
  { id: 'workspace', label: 'Workspace', icon: '🗂️' },
  { id: 'terminal', label: 'Terminal', icon: '💻' },
  { id: 'computer', label: 'Computer', icon: '🖥️', badge: 'NEW' },
  { id: 'printer', label: '3D Printer', icon: '🖨️', badge: 'NEW' },
  { id: 'costs', label: 'Costs', icon: '💰' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

export default function Sidebar() {
  const {
    currentView,
    setCurrentView,
    conversations,
    activeConversationId,
    setActiveConversation,
    setConversations,
    setMessages,
    workerStatus,
    companionStatus,
  } = useStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  useEffect(() => {
    loadConversations();
  }, []);

  async function loadConversations() {
    try {
      const convos = await window.henryAPI.getConversations();
      setConversations(convos);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }

  async function selectConversation(id: string) {
    setActiveConversation(id);
    setCurrentView('chat');
    try {
      const msgs = await window.henryAPI.getMessages(id);
      setMessages(msgs);
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  }

  function newConversation() {
    setActiveConversation(null);
    setMessages([]);
    setCurrentView('chat');
  }

  async function deleteConversation(id: string) {
    try {
      await window.henryAPI.deleteConversation(id);
      if (activeConversationId === id) {
        setActiveConversation(null);
        setMessages([]);
      }
      const convos = await window.henryAPI.getConversations();
      setConversations(convos);
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  }

  async function renameConversation(id: string) {
    if (!editTitle.trim()) {
      setEditingId(null);
      return;
    }
    try {
      await window.henryAPI.updateConversation(id, editTitle.trim());
      const convos = await window.henryAPI.getConversations();
      setConversations(convos);
    } catch (err) {
      console.error('Failed to rename:', err);
    }
    setEditingId(null);
  }

  return (
    <div className="w-56 shrink-0 bg-henry-surface/50 border-r border-henry-border/50 flex flex-col">
      {/* New chat button */}
      <div className="p-3">
        <button
          onClick={newConversation}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-henry-accent/10 text-henry-accent rounded-xl text-xs font-medium hover:bg-henry-accent/20 transition-colors border border-henry-accent/20"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Chat
        </button>
      </div>

      {/* Navigation */}
      <nav className="px-2 space-y-0.5">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => setCurrentView(item.id)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-all ${
              currentView === item.id
                ? 'bg-henry-accent/10 text-henry-accent font-medium'
                : 'text-henry-text-dim hover:text-henry-text hover:bg-henry-hover/50'
            }`}
          >
            <span className="text-sm">{item.icon}</span>
            <span className="flex-1 text-left">{item.label}</span>
            {item.badge && currentView !== item.id && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-henry-accent/20 text-henry-accent font-semibold leading-none">
                {item.badge}
              </span>
            )}
            {item.id === 'tasks' && workerStatus.status === 'working' && (
              <span className="ml-auto w-2 h-2 rounded-full bg-henry-worker animate-pulse" />
            )}
          </button>
        ))}
      </nav>

      {/* Divider */}
      <div className="mx-3 my-3 border-t border-henry-border/30" />

      {/* Conversations list */}
      <div className="flex-1 overflow-y-auto px-2">
        <div className="flex items-center justify-between px-3 mb-2">
          <span className="text-[10px] font-medium text-henry-text-muted uppercase tracking-wider">
            Recent Chats
          </span>
          <span className="text-[10px] text-henry-text-muted">
            {conversations.length}
          </span>
        </div>

        <div className="space-y-0.5">
          {conversations.map((convo: Conversation) => (
            <div
              key={convo.id}
              className={`group relative flex items-center rounded-lg transition-all ${
                activeConversationId === convo.id
                  ? 'bg-henry-accent/10'
                  : 'hover:bg-henry-hover/50'
              }`}
            >
              {editingId === convo.id ? (
                <input
                  autoFocus
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={() => renameConversation(convo.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') renameConversation(convo.id);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  className="flex-1 bg-henry-bg border border-henry-accent/30 rounded px-2 py-1.5 text-xs text-henry-text outline-none mx-1 my-0.5"
                />
              ) : (
                <>
                  <button
                    onClick={() => selectConversation(convo.id)}
                    className={`flex-1 text-left px-3 py-2 text-xs truncate ${
                      activeConversationId === convo.id
                        ? 'text-henry-accent'
                        : 'text-henry-text-dim'
                    }`}
                  >
                    {convo.title || 'New Chat'}
                  </button>

                  <div className="hidden group-hover:flex items-center gap-0.5 pr-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(convo.id);
                        setEditTitle(convo.title || '');
                      }}
                      className="p-1 rounded text-henry-text-muted hover:text-henry-text transition-colors"
                      title="Rename"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm('Delete this conversation?')) {
                          deleteConversation(convo.id);
                        }
                      }}
                      className="p-1 rounded text-henry-text-muted hover:text-henry-error transition-colors"
                      title="Delete"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3,6 5,6 21,6" />
                        <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2V6" />
                      </svg>
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Engine status footer */}
      <div className="shrink-0 p-3 border-t border-henry-border/30">
        <div className="space-y-2">
          <EngineStatusBadge icon="🧠" label="Companion" status={companionStatus.status} color="companion" />
          <EngineStatusBadge icon="⚡" label="Worker" status={workerStatus.status} color="worker" />
        </div>
      </div>
    </div>
  );
}

function EngineStatusBadge({ icon, label, status, color }: {
  icon: string; label: string; status: string; color: 'companion' | 'worker';
}) {
  const statusLabels: Record<string, string> = {
    idle: 'Ready', thinking: 'Thinking...', working: 'Working...',
    streaming: 'Streaming...', error: 'Error',
  };
  const dotColor = status === 'idle' ? 'bg-henry-success'
    : status === 'error' ? 'bg-henry-error'
    : `bg-henry-${color} animate-pulse`;

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-henry-bg/30">
      <span className="text-xs">{icon}</span>
      <span className="text-[10px] text-henry-text-dim flex-1">{label}</span>
      <div className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      <span className="text-[10px] text-henry-text-muted">{statusLabels[status] || status}</span>
    </div>
  );
}
