import { useState, useEffect, type ComponentType } from 'react';
import { Shield } from 'lucide-react';
import { useStore } from '../../store';

// R2-Fix 9: keep this in sync with src/types/index.ts ViewType.
type ViewType = 'today' | 'chat' | 'companion' | 'secretary' | 'contacts' | 'tasks' | 'files' | 'workspace' | 'terminal' | 'computer' | 'printer' | 'costs' | 'settings' | 'journal' | 'focus' | 'recorder' | 'memos' | 'queue' | 'modes' | 'reminders' | 'crm' | 'finance' | 'lists' | 'printstudio' | 'machines' | 'materials' | 'production' | 'waste' | 'maintenance' | 'imagegen' | 'videogen' | 'integrations' | 'github' | 'linear' | 'notion' | 'slack' | 'captures' | 'weekly' | 'health' | 'goals' | 'hq' | 'setup' | 'memory' | 'prayer' | 'quoting'
  | 'scripture' | 'routines' | 'audit';

// A nav item renders either a glyph (`icon`) or a lucide component (`lucideIcon`).
type NavItem = { id: ViewType; icon?: string; lucideIcon?: ComponentType<{ size?: number }>; label: string };

// Core nav — the things you actually use daily
// Everything else is accessible but not cluttering the rail
const CORE_NAV: NavItem[] = [
  { id: 'hq',         icon: '◈',  label: 'HQ' },
  { id: 'today',      icon: '⌂',  label: 'Today' },
  { id: 'chat',       icon: '◉',  label: 'Chat' },
  { id: 'computer',   icon: '⌘',  label: 'Computer' },
  { id: 'journal',    icon: '✦',  label: 'Journal' },
  { id: 'scripture',  icon: '✝',  label: 'Scripture' },
  { id: 'reminders',  icon: '◎',  label: 'Reminders' },
  { id: 'captures',   icon: '⊕',  label: 'Captures' },
  { id: 'memory',     icon: '🧠', label: 'Memory' },
  { id: 'recorder',   icon: '🎙', label: 'Recorder' },
  // R2-Fix 9: SQLite-backed voice memos (was unreachable — see Layout.tsx).
  { id: 'memos',      icon: '🗂', label: 'Voice Memos' },
  { id: 'focus',      icon: '◈',  label: 'Focus' },
];

const BUSINESS_NAV: NavItem[] = [
  { id: 'secretary',  icon: '◻',  label: 'Secretary' },
  { id: 'crm',        icon: '◇',  label: 'Clients' },
  { id: 'finance',    icon: '◆',  label: 'Finance' },
  { id: 'tasks',      icon: '☐',  label: 'Tasks' },
  // R2-Fix 9: TaskQueueView was imported in Layout.tsx but unreachable.
  { id: 'queue',      icon: '⊟',  label: 'Queue' },
  // Sprint 3: Henry's Routines — scheduled autonomous runs.
  { id: 'routines',   icon: '🕐', label: 'Routines' },
  // Sprint 4: Audit Log — "What Henry Did" feed of every tool call.
  { id: 'audit',      lucideIcon: Shield, label: 'Audit Log' },
];

const MORE_NAV: NavItem[] = [
  { id: 'goals',      icon: '◎',  label: 'Goals' },
  { id: 'weekly',     icon: '▦',  label: 'Weekly' },
  { id: 'lists',      icon: '≡',  label: 'Lists' },
  { id: 'machines',   icon: '⚙',  label: 'Machines' },
  { id: 'materials',  icon: '⬢',  label: 'Materials' },
  { id: 'production', icon: '▶',  label: 'Runs' },
  { id: 'waste',      icon: '◌',  label: 'Waste' },
  { id: 'maintenance',icon: '⚒',  label: 'Service' },
  { id: 'printstudio',icon: '▣',  label: 'Print Studio' },
  { id: 'imagegen',   icon: '◐',  label: 'Image Gen' },
  { id: 'videogen',   icon: '▶',  label: 'Video Gen' },
  { id: 'files',      icon: '◳',  label: 'Files' },
  { id: 'workspace',  icon: '◰',  label: 'Workspace' },
  { id: 'costs',      icon: '◌',  label: 'Costs' },
];

const BOTTOM_NAV: NavItem[] = [
  { id: 'setup',      icon: '⚙',  label: 'Setup' },
  { id: 'companion',  icon: '⊚',  label: 'Companion' },
  { id: 'settings',   icon: '⊙',  label: 'Settings' },
];

function NavIcon({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  const LucideIcon = item.lucideIcon;
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
      {LucideIcon ? <LucideIcon size={18} /> : <span className="font-light">{item.icon}</span>}
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
  const [dueCount, setDueCount] = useState(0);
  const [overdueGoals, setOverdueGoals] = useState(0);

  useEffect(() => {
    const check = () => {
      const api2 = (window as any).henryAPI;
      api2?.remindersDue?.().then((r: any[]) => setDueCount((r||[]).length)).catch(() => {});
      // Count overdue goals (target_date in the past)
      api2?.getGoals?.({status:'active'}).then((res: any) => {
        const goals = Array.isArray(res) ? res : (res?.goals || []);
        const now = new Date();
        const overdue = goals.filter((g: any) =>
          g.status === 'active' && g.target_date && new Date(g.target_date) < now
        ).length;
        setOverdueGoals(overdue);
      }).catch(() => {});
    };
    check();
    const t = setInterval(check, 120000);
    return () => clearInterval(t);
  }, []);

  const go = (id: ViewType) => setCurrentView(id as any);

  return (
    <div className="henry-sidebar shrink-0 flex flex-col h-full bg-henry-surface/30 border-r border-henry-border/20 py-3 px-1.5 w-[56px]">

      {/* Core navigation */}
      <div className="flex flex-col items-center gap-1">
        {CORE_NAV.map(item => (
          <div key={item.id} className="relative">
            <NavIcon
              item={item}
              active={currentView === item.id}
              onClick={() => go(item.id)}
            />
            {item.id === 'reminders' && dueCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold leading-none pointer-events-none">
                {dueCount > 9 ? '9+' : dueCount}
              </span>
            )}
            {item.id === 'goals' && overdueGoals > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 flex items-center justify-center rounded-full bg-orange-500 text-white text-[9px] font-bold leading-none pointer-events-none">
                {overdueGoals}
              </span>
            )}
          </div>
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
