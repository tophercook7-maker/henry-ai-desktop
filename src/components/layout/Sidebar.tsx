import { useState } from 'react';
import { useStore } from '../../store';

type ViewType = 'today' | 'chat' | 'companion' | 'secretary' | 'contacts' | 'tasks' | 'files' | 'workspace' | 'terminal' | 'computer' | 'printer' | 'costs' | 'settings' | 'journal' | 'focus' | 'recorder' | 'modes' | 'reminders' | 'crm' | 'finance' | 'lists' | 'printstudio' | 'imagegen' | 'videogen' | 'integrations' | 'github' | 'linear' | 'notion' | 'slack' | 'captures' | 'weekly' | 'health';

// Core nav — the things you actually use daily
// Everything else is accessible but not cluttering the rail
const CORE_NAV: { id: ViewType; icon: string; label: string }[] = [
  { id: 'today',      icon: '⌂',  label: 'Today' },
  { id: 'chat',       icon: '◉',  label: 'Chat' },
  { id: 'computer',   icon: '⌘',  label: 'Computer' },
  { id: 'journal',    icon: '✦',  label: 'Journal' },
  { id: 'reminders',  icon: '◎',  label: 'Reminders' },
  { id: 'captures',   icon: '⊕',  label: 'Captures' },
  { id: 'focus',      icon: '◈',  label: 'Focus' },
];

const BUSINESS_NAV: { id: ViewType; icon: string; label: string }[] = [
  { id: 'secretary',  icon: '◻',  label: 'Secretary' },
  { id: 'crm',        icon: '◇',  label: 'Clients' },
  { id: 'finance',    icon: '◆',  label: 'Finance' },
  { id: 'tasks',      icon: '☐',  label: 'Tasks' },
];

const MORE_NAV: { id: ViewType; icon: string; label: string }[] = [
  { id: 'weekly',     icon: '▦',  label: 'Weekly' },
  { id: 'lists',      icon: '≡',  label: 'Lists' },
  { id: 'printstudio',icon: '▣',  label: 'Print Studio' },
  { id: 'imagegen',   icon: '◐',  label: 'Image Gen' },
  { id: 'videogen',   icon: '▶',  label: 'Video Gen' },
  { id: 'files',      icon: '◳',  label: 'Files' },
  { id: 'workspace',  icon: '◰',  label: 'Workspace' },
  { id: 'costs',      icon: '◌',  label: 'Costs' },
];

const BOTTOM_NAV: { id: ViewType; icon: string; label: string }[] = [
  { id: 'companion',  icon: '⊚',  label: 'Companion' },
  { id: 'settings',   icon: '⊙',  label: 'Settings' },
];

function NavIcon({
  item,
  active,
  onClick,
}: {
  item: { id: ViewType; icon: string; label: string };
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={item.label}
      className={`
        group relative w-10 h-10 flex items-center justify-center rounded-xl
        text-[18px] transition-all duration-150 select-none
        ${active
          ? 'bg-henry-accent/15 text-henry-accent'
          : 'text-henry-text-muted hover:text-henry-text hover:bg-henry-surface/60'}
      `}
    >
      <span className="font-light">{item.icon}</span>
      {/* Tooltip */}
      <span className="
        absolute left-full ml-2 px-2 py-1 rounded-md text-[11px] font-medium
        bg-henry-surface border border-henry-border/40 text-henry-text
        whitespace-nowrap opacity-0 group-hover:opacity-100
        pointer-events-none transition-opacity duration-100 z-50
      ">
        {item.label}
      </span>
    </button>
  );
}

function Divider() {
  return <div className="w-6 h-px bg-henry-border/20 mx-auto my-1" />;
}

export default function Sidebar() {
  const { currentView, setCurrentView } = useStore();
  const [showMore, setShowMore] = useState(false);

  const go = (id: ViewType) => setCurrentView(id as any);

  return (
    <div className="henry-sidebar shrink-0 flex flex-col h-full bg-henry-surface/30 border-r border-henry-border/20 py-3 px-1.5 w-[56px]">

      {/* Core navigation */}
      <div className="flex flex-col items-center gap-1">
        {CORE_NAV.map(item => (
          <NavIcon
            key={item.id}
            item={item}
            active={currentView === item.id}
            onClick={() => go(item.id)}
          />
        ))}
      </div>

      <Divider />

      {/* Business */}
      <div className="flex flex-col items-center gap-1">
        {BUSINESS_NAV.map(item => (
          <NavIcon
            key={item.id}
            item={item}
            active={currentView === item.id}
            onClick={() => go(item.id)}
          />
        ))}
      </div>

      <Divider />

      {/* More toggle */}
      <button
        onClick={() => setShowMore(v => !v)}
        title={showMore ? 'Show less' : 'More'}
        className="w-10 h-7 mx-auto flex items-center justify-center rounded-lg text-henry-text-muted hover:text-henry-text hover:bg-henry-surface/60 transition-all text-[11px] tracking-widest"
      >
        {showMore ? '▲' : '···'}
      </button>

      {/* More items */}
      {showMore && (
        <div className="flex flex-col items-center gap-1 mt-1">
          {MORE_NAV.map(item => (
            <NavIcon
              key={item.id}
              item={item}
              active={currentView === item.id}
              onClick={() => go(item.id)}
            />
          ))}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom — Settings only */}
      <div className="flex flex-col items-center gap-1">
        {BOTTOM_NAV.map(item => (
          <NavIcon
            key={item.id}
            item={item}
            active={currentView === item.id}
            onClick={() => go(item.id)}
          />
        ))}
      </div>

    </div>
  );
}
