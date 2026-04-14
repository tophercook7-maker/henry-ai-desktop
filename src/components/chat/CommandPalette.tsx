import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../../store';
import { HENRY_OPERATING_MODES, type HenryOperatingMode, isHenryOperatingMode } from '../../henry/charter';
import type { ViewType } from '../../types';

interface PaletteItem {
  id: string;
  icon: string;
  label: string;
  sublabel?: string;
  action: () => void;
  category: 'mode' | 'nav' | 'action' | 'conversation' | 'contact';
  keywords?: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSetMode: (mode: HenryOperatingMode) => void;
  onNewChat: () => void;
  onInjectPrompt: (mode: HenryOperatingMode, text: string) => void;
}

const MODE_ICONS: Record<HenryOperatingMode, string> = {
  companion: '💬',
  writer: '✍️',
  developer: '⚡',
  builder: '🌐',
  biblical: '📖',
  design3d: '🖨️',
  secretary: '🗓️',
  computer: '🖥️',
  coach: '🎯',
  strategic: '♟️',
  business: '🚀',
  negotiator: '🤝',
  health: '💪',
  research: '🔬',
  meal: '🍽️',
  shopping: '🛒',
};

const MODE_LABELS: Record<HenryOperatingMode, string> = {
  companion: 'Chat — Companion mode',
  writer: 'Writer mode',
  developer: 'Code mode',
  builder: 'App Builder mode',
  biblical: 'Bible Study mode',
  design3d: '3D / Design mode',
  secretary: 'Secretary mode',
  computer: 'Computer Control mode',
  coach: 'Coach mode',
  strategic: 'Strategic mode',
  business: 'Business Builder mode',
  negotiator: 'Negotiator mode',
  health: 'Health & Fitness mode',
  research: 'Research mode',
  meal: 'Meal Planning mode',
  shopping: 'Shopping mode',
};

const QUICK_ACTIONS: Array<{ icon: string; label: string; mode: HenryOperatingMode; prompt: string }> = [
  { icon: '🌅', label: 'Daily briefing', mode: 'secretary', prompt: 'Give me my daily briefing — schedule, priority tasks, replies needed, and one heads-up.' },
  { icon: '✉️', label: 'Draft an email', mode: 'secretary', prompt: 'I need to draft an email. BLUF format, concise and ready to send.' },
  { icon: '🌐', label: 'Build a landing page', mode: 'builder', prompt: 'Build me a professional landing page. Ask me what it\'s for.' },
  { icon: '🌐', label: 'Build a web app', mode: 'builder', prompt: 'Build me a web app. Ask me what I need.' },
  { icon: '⚡', label: 'Debug my code', mode: 'developer', prompt: 'Help me debug this. I\'ll paste the code and error.' },
  { icon: '✍️', label: 'Start a draft', mode: 'writer', prompt: 'Help me draft something. I\'ll tell you what I need to write.' },
  { icon: '📖', label: 'Study a passage', mode: 'biblical', prompt: 'Walk me through a scripture passage. Tell me the reference.' },
  { icon: '💡', label: 'Think through a decision', mode: 'companion', prompt: 'I need to think through a decision. Let me walk you through it.' },
  { icon: '🎯', label: 'Coach session', mode: 'coach', prompt: 'I want to work through something I\'ve been stuck on. Help me get clear.' },
  { icon: '♟️', label: 'Strategic review', mode: 'strategic', prompt: 'Help me think strategically about what I\'m working on. I\'ll give you the context.' },
  { icon: '🚀', label: 'Build a business', mode: 'business', prompt: 'I have a business idea I want to develop. Let\'s work through the offer and plan.' },
  { icon: '🤝', label: 'Negotiate something', mode: 'negotiator', prompt: 'I have a negotiation coming up. Help me prepare — I\'ll give you the context.' },
  { icon: '💪', label: 'Health check-in', mode: 'health', prompt: 'Let\'s talk about my health, fitness, or energy. I\'ll tell you what\'s going on.' },
  { icon: '🔬', label: 'Research a topic', mode: 'research', prompt: 'I need to research something thoroughly. Here\'s the topic:' },
  { icon: '🍽️', label: 'Plan my meals', mode: 'meal', prompt: 'Help me plan my meals for the week. I\'ll tell you my preferences and goals.' },
  { icon: '🛒', label: 'Find the best product', mode: 'shopping', prompt: 'I\'m looking to buy something. Help me find the best option. Here\'s what I need:' },
];

interface StoredContact {
  id: string;
  name: string;
  role?: string;
  company?: string;
}

function loadContactsFromStorage(): StoredContact[] {
  try {
    const raw = localStorage.getItem('henry_contacts');
    if (!raw) return [];
    return JSON.parse(raw) as StoredContact[];
  } catch {
    return [];
  }
}

export default function CommandPalette({ open, onClose, onSetMode, onNewChat, onInjectPrompt }: Props) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [allContacts, setAllContacts] = useState<StoredContact[]>([]);
  const { conversations, setActiveConversation, setMessages, setCurrentView } = useStore();

  useEffect(() => {
    if (open) setAllContacts(loadContactsFromStorage());
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const buildItems = useCallback((q: string): PaletteItem[] => {
    const items: PaletteItem[] = [];

    // New chat
    items.push({
      id: 'new-chat',
      icon: '✦',
      label: 'New chat',
      sublabel: 'Start a fresh conversation',
      category: 'action',
      keywords: ['new', 'fresh', 'clear', 'start'],
      action: () => { onNewChat(); onClose(); },
    });

    // Modes
    for (const mode of HENRY_OPERATING_MODES) {
      items.push({
        id: `mode-${mode}`,
        icon: MODE_ICONS[mode],
        label: `Switch to ${MODE_LABELS[mode]}`,
        sublabel: `/mode ${mode}`,
        category: 'mode',
        keywords: [mode, 'mode', 'switch'],
        action: () => { onSetMode(mode); onClose(); },
      });
    }

    // Quick actions
    for (const qa of QUICK_ACTIONS) {
      items.push({
        id: `qa-${qa.label}`,
        icon: qa.icon,
        label: qa.label,
        sublabel: `Launches in ${MODE_LABELS[qa.mode].split(' ')[0]} mode`,
        category: 'action',
        keywords: [qa.label.toLowerCase(), qa.mode],
        action: () => { onInjectPrompt(qa.mode, qa.prompt); onClose(); },
      });
    }

    // Nav
    const navItems: Array<{ id: string; icon: string; label: string; view: ViewType }> = [
      { id: 'nav-today', icon: '🏠', label: 'Go to Today', view: 'today' },
      { id: 'nav-settings', icon: '⚙️', label: 'Open Settings', view: 'settings' },
      { id: 'nav-tasks', icon: '📋', label: 'Open Tasks', view: 'tasks' },
      { id: 'nav-contacts', icon: '👥', label: 'Open Contacts', view: 'contacts' },
      { id: 'nav-files', icon: '📁', label: 'Open Files', view: 'files' },
      { id: 'nav-secretary', icon: '🗓️', label: 'Open Secretary', view: 'secretary' },
      { id: 'nav-goals', icon: '🎯', label: 'Open Goals', view: 'goals' },
      { id: 'nav-journal', icon: '📔', label: 'Open Journal', view: 'journal' },
      { id: 'nav-integrations', icon: '🔌', label: 'Open Integrations', view: 'integrations' },
      { id: 'nav-terminal', icon: '💻', label: 'Open Terminal', view: 'terminal' },
      { id: 'nav-ide', icon: '✦', label: 'Open IDE', view: 'ide' },
    ];
    for (const nav of navItems) {
      items.push({
        id: nav.id,
        icon: nav.icon,
        label: nav.label,
        category: 'nav',
        keywords: [nav.label.toLowerCase(), nav.view],
        action: () => { setCurrentView(nav.view); onClose(); },
      });
    }

    // Contacts (only when there's a query so they don't flood the default view)
    if (q.trim()) {
      const qLow = q.toLowerCase();
      for (const contact of allContacts) {
        const matches =
          contact.name.toLowerCase().includes(qLow) ||
          (contact.role ?? '').toLowerCase().includes(qLow) ||
          (contact.company ?? '').toLowerCase().includes(qLow);
        if (matches) {
          items.push({
            id: `contact-${contact.id}`,
            icon: '👤',
            label: contact.name,
            sublabel: [contact.role, contact.company].filter(Boolean).join(' · ') || 'Contact',
            category: 'contact',
            keywords: [contact.name.toLowerCase(), (contact.role ?? '').toLowerCase(), (contact.company ?? '').toLowerCase()],
            action: () => {
              setCurrentView('contacts');
              window.dispatchEvent(new CustomEvent('henry_contact_select', { detail: { id: contact.id } }));
              onClose();
            },
          });
        }
      }
    }

    // Recent conversations
    for (const convo of conversations.slice(0, 5)) {
      items.push({
        id: `convo-${convo.id}`,
        icon: '💬',
        label: convo.title || 'Untitled chat',
        sublabel: 'Recent conversation',
        category: 'conversation',
        keywords: [(convo.title || '').toLowerCase()],
        action: async () => {
          setActiveConversation(convo.id);
          try {
            const msgs = await window.henryAPI.getMessages(convo.id);
            setMessages(msgs);
            setCurrentView('chat');
          } catch { /* ignore */ }
          onClose();
        },
      });
    }

    return items;
  }, [conversations, allContacts, onNewChat, onClose, onSetMode, onInjectPrompt, setActiveConversation, setMessages, setCurrentView]);

  const allItems = buildItems(query);

  const filtered = query.trim()
    ? allItems.filter((item) => {
        const q = query.toLowerCase();
        return (
          item.label.toLowerCase().includes(q) ||
          item.sublabel?.toLowerCase().includes(q) ||
          item.keywords?.some((k) => k.includes(q))
        );
      })
    : allItems;

  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      filtered[selectedIdx]?.action();
    } else if (e.key === 'Escape') {
      onClose();
    }
  }

  if (!open) return null;

  const categoryLabels: Record<string, string> = {
    action: 'Actions',
    mode: 'Switch Mode',
    nav: 'Navigate',
    contact: 'Contacts',
    conversation: 'Recent Chats',
  };

  let lastCategory = '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-henry-surface border border-henry-border/50 rounded-2xl shadow-2xl overflow-hidden animate-fade-in"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-henry-border/30">
          <svg className="w-4 h-4 text-henry-text-muted shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands, modes, chats…"
            className="flex-1 bg-transparent text-sm text-henry-text placeholder-henry-text-muted outline-none"
          />
          <kbd className="text-[10px] text-henry-text-muted bg-henry-bg/60 border border-henry-border/40 rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <p className="text-center text-xs text-henry-text-muted py-8">No results for "{query}"</p>
          ) : (
            filtered.map((item, idx) => {
              const showHeader = item.category !== lastCategory;
              lastCategory = item.category;
              return (
                <div key={item.id}>
                  {showHeader && (
                    <p className="px-4 pt-3 pb-1 text-[10px] font-semibold text-henry-text-muted uppercase tracking-wider">
                      {categoryLabels[item.category] || item.category}
                    </p>
                  )}
                  <button
                    onClick={item.action}
                    onMouseEnter={() => setSelectedIdx(idx)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      idx === selectedIdx ? 'bg-henry-accent/10' : 'hover:bg-henry-hover/30'
                    }`}
                  >
                    <span className="text-base shrink-0">{item.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm truncate ${idx === selectedIdx ? 'text-henry-accent' : 'text-henry-text'}`}>
                        {item.label}
                      </p>
                      {item.sublabel && (
                        <p className="text-[10px] text-henry-text-muted truncate">{item.sublabel}</p>
                      )}
                    </div>
                    {idx === selectedIdx && (
                      <kbd className="text-[10px] text-henry-accent/70 bg-henry-accent/10 border border-henry-accent/20 rounded px-1.5 py-0.5 shrink-0">
                        ↵
                      </kbd>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="px-4 py-2 border-t border-henry-border/20 flex items-center gap-4 text-[10px] text-henry-text-muted">
          <span><kbd className="bg-henry-bg/60 border border-henry-border/40 rounded px-1">↑↓</kbd> navigate</span>
          <span><kbd className="bg-henry-bg/60 border border-henry-border/40 rounded px-1">↵</kbd> select</span>
          <span><kbd className="bg-henry-bg/60 border border-henry-border/40 rounded px-1">Esc</kbd> close</span>
          <span className="ml-auto">⌘K to open</span>
        </div>
      </div>
    </div>
  );
}
