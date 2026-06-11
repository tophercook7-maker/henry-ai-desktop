import { useState, useEffect, type ComponentType } from 'react';
import { Shield, FolderKanban, Users, TrendingUp, BookOpen, Search } from 'lucide-react';
import { useStore } from '../../store';

// R2-Fix 9: keep this in sync with src/types/index.ts ViewType.
type ViewType = 'today' | 'chat' | 'companion' | 'secretary' | 'contacts' | 'tasks' | 'files' | 'workspace' | 'terminal' | 'computer' | 'printer' | 'costs' | 'settings' | 'journal' | 'focus' | 'recorder' | 'memos' | 'queue' | 'modes' | 'reminders' | 'crm' | 'finance' | 'lists' | 'printstudio' | 'machines' | 'materials' | 'production' | 'waste' | 'maintenance' | 'imagegen' | 'videogen' | 'integrations' | 'github' | 'linear' | 'notion' | 'slack' | 'captures' | 'weekly' | 'health' | 'goals' | 'hq' | 'setup' | 'memory' | 'prayer' | 'quoting'
  | 'scripture' | 'routines' | 'audit' | 'vault' | 'crews' | 'money' | 'book' | 'slicer';

// A nav item renders either a glyph (`icon`) or a lucide component (`lucideIcon`).
type NavItem = { id: ViewType; icon?: string; lucideIcon?: ComponentType<{ size?: number }>; label: string; desc?: string };

// Core nav — the things you actually use daily
// Everything else is accessible but not cluttering the rail
const CORE_NAV: NavItem[] = [
  { id: 'hq',         icon: '◈',  label: 'HQ',          desc: 'Command hub — control your Mac and automate workflows' },
  { id: 'today',      icon: '⌂',  label: 'Today',       desc: "Today's plan and what needs you" },
  { id: 'chat',       icon: '◉',  label: 'Chat',        desc: 'Talk to Henry' },
  { id: 'computer',   icon: '⌘',  label: 'Computer',    desc: 'Let Henry run apps and commands on your Mac' },
  { id: 'journal',    icon: '✦',  label: 'Journal',     desc: 'Private journal entries' },
  { id: 'book',       lucideIcon: BookOpen, label: 'Book', desc: 'Capture your life story — the Book Crew turns it into chapters' },
  { id: 'scripture',  icon: '✝',  label: 'Scripture',   desc: 'Bible study and scripture tools' },
  { id: 'reminders',  icon: '◎',  label: 'Reminders',   desc: 'Time-based reminders' },
  { id: 'captures',   icon: '⊕',  label: 'Captures',    desc: 'Quick voice/text notes Henry files for you' },
  { id: 'memory',     icon: '🧠', label: 'Memory',      desc: 'What Henry remembers about you and your work' },
  { id: 'recorder',   icon: '🎙', label: 'Recorder',    desc: 'Record and transcribe meetings' },
  // R2-Fix 9: SQLite-backed voice memos (was unreachable — see Layout.tsx).
  { id: 'memos',      icon: '🗂', label: 'Voice Memos', desc: 'Saved voice memos' },
  { id: 'focus',      icon: '◈',  label: 'Focus',       desc: 'Focus sessions' },
];

const BUSINESS_NAV: NavItem[] = [
  // Build plan Phase 1: the Project Vault — your projects at a glance.
  { id: 'vault',      lucideIcon: FolderKanban, label: 'Projects', desc: 'Your projects — status, next action, money angle' },
  // Build plan Phase 2: Agent Crews — role-based teams.
  { id: 'crews',      lucideIcon: Users, label: 'Crews', desc: 'Role-based agent teams that work a problem step by step' },
  // Build plan Phase 3: Money Engine — the lead pipeline.
  { id: 'money',      lucideIcon: TrendingUp, label: 'Money', desc: 'Lead pipeline — find, audit, and close website work' },
  { id: 'secretary',  icon: '◻',  label: 'Secretary', desc: 'Henry as your organized personal assistant' },
  { id: 'crm',        icon: '◇',  label: 'Clients',   desc: 'Clients and contacts' },
  { id: 'finance',    icon: '◆',  label: 'Finance',   desc: 'Income, expenses, and money overview' },
  { id: 'tasks',      icon: '☐',  label: 'Tasks',     desc: 'Your task list' },
  // R2-Fix 9: TaskQueueView was imported in Layout.tsx but unreachable.
  { id: 'queue',      icon: '⊟',  label: 'Queue',     desc: 'Background jobs Henry is running' },
  // Sprint 3: Henry's Routines — scheduled autonomous runs.
  { id: 'routines',   icon: '🕐', label: 'Routines',  desc: 'Scheduled autonomous runs, like a morning briefing' },
  // Sprint 4: Audit Log — "What Henry Did" feed of every tool call.
  { id: 'audit',      lucideIcon: Shield, label: 'Audit Log', desc: 'Every action Henry took — and your approvals' },
];

const MORE_NAV: NavItem[] = [
  { id: 'goals',      icon: '◎',  label: 'Goals',       desc: 'Longer-term goals and progress' },
  { id: 'weekly',     icon: '▦',  label: 'Weekly',      desc: 'Weekly review' },
  { id: 'lists',      icon: '≡',  label: 'Lists',       desc: 'Custom lists' },
  { id: 'machines',   icon: '⚙',  label: 'Machines',    desc: '3D printers and machines' },
  { id: 'materials',  icon: '⬢',  label: 'Materials',   desc: 'Filament and material stock' },
  { id: 'production', icon: '▶',  label: 'Runs',        desc: 'Print and production runs' },
  { id: 'waste',      icon: '◌',  label: 'Waste',       desc: 'Material waste tracking' },
  { id: 'maintenance',icon: '⚒',  label: 'Service',     desc: 'Machine service and maintenance' },
  { id: 'printstudio',icon: '▣',  label: 'Print Studio',desc: '3D print job studio' },
  { id: 'slicer',     icon: '◈',  label: 'Slice',       desc: 'Slice a 3D model into printer-ready G-code' },
  { id: 'imagegen',   icon: '◐',  label: 'Image Gen',   desc: 'Generate images with AI' },
  { id: 'videogen',   icon: '▶',  label: 'Video Gen',   desc: 'Generate videos with AI' },
  { id: 'files',      icon: '◳',  label: 'Files',       desc: 'Browse your files' },
  { id: 'workspace',  icon: '◰',  label: 'Workspace',   desc: 'Henry workspace files' },
  { id: 'costs',      icon: '◌',  label: 'Costs',       desc: 'AI usage and cost dashboard' },
];

const BOTTOM_NAV: NavItem[] = [
  { id: 'setup',      icon: '⚙',  label: 'Setup',     desc: 'First-time setup and provider auto-detect' },
  { id: 'companion',  icon: '⊚',  label: 'Companion', desc: 'Pair your phone to control Henry remotely' },
  { id: 'settings',   icon: '⊙',  label: 'Settings',  desc: 'Profile, AI providers, engines, and pairing' },
];

/** Every navigable surface — one source of truth for the sidebar and the ⌘K launcher. */
export const ALL_NAV: NavItem[] = [...CORE_NAV, ...BUSINESS_NAV, ...MORE_NAV, ...BOTTOM_NAV];

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
      title={item.desc ? `${item.label} — ${item.desc}` : item.label}
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

      {/* Do-anything launcher — opens the ⌘K command palette */}
      <button
        onClick={() => window.dispatchEvent(new CustomEvent('henry:open-palette'))}
        title="Search — jump to anything or run a command (⌘K)"
        aria-label="Search and run anything"
        className="mb-2 w-9 h-9 mx-auto flex items-center justify-center rounded-xl bg-henry-accent/15 text-henry-accent hover:bg-henry-accent/25 transition-colors"
      >
        <Search size={18} />
      </button>

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
