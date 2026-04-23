import { useState, useCallback } from 'react';
import TitleBar from './TitleBar';
import PresenceBar from './PresenceBar';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import ChatView from '../chat/ChatView';
import TaskQueueView from '../queue/TaskQueueView';
import SettingsView from '../settings/SettingsView';
import FileBrowser from '../files/FileBrowser';
import WorkspaceView from '../workspace/WorkspaceView';
import TerminalView from '../terminal/TerminalView';
import CostDashboard from '../costs/CostDashboard';
import ComputerPanel from '../computer/ComputerPanel';
import PrinterPanel from '../computer/PrinterPanel';
import SecretaryPanel from '../secretary/SecretaryPanel';
import TodayPanel from '../today/TodayPanel';
import ContactsPanel from '../contacts/ContactsPanel';
import CommandPalette from '../chat/CommandPalette';
import JournalPanel from '../journal/JournalPanel';
import FocusPanel from '../focus/FocusPanel';
import MeetingRecorderPanel from '../recorder/MeetingRecorderPanel';
import ModesPanel from '../modes/ModesPanel';
import RemindersPanel from '../reminders/RemindersPanel';
import CRMPanel from '../crm/CRMPanel';
import FinancePanel from '../finance/FinancePanel';
import ListsPanel from '../lists/ListsPanel';
import PrintStudioPanel from '../printstudio/PrintStudioPanel';
import ImageGenPanel from '../imagegen/ImageGenPanel';
import IntegrationsPanel from '../integrations/IntegrationsPanel';
import GitHubPanel from '../integrations/GitHubPanel';
import LinearPanel from '../integrations/LinearPanel';
import NotionPanel from '../integrations/NotionPanel';
import SlackPanel from '../integrations/SlackPanel';
import CapturesPanel from '../ambient/CapturesPanel';
import WeeklyReviewPanel from '../weekly/WeeklyReviewPanel';
import StripePanel from '../integrations/StripePanel';
import GCalPanel from '../integrations/GCalPanel';
import GmailPanel from '../integrations/GmailPanel';
import GDrivePanel from '../integrations/GDrivePanel';
import { useStore } from '../../store';
import { isHenryOperatingMode, type HenryOperatingMode } from '../../henry/charter';
import { useEffect } from 'react';

export default function Layout() {
  const currentView = useStore((s) => s.currentView);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handlePaletteSetMode = useCallback((mode: HenryOperatingMode) => {
    try { localStorage.setItem('henry_operating_mode', mode); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('henry_mode_launch', { detail: { mode, prompt: '' } }));
    useStore.getState().setCurrentView('chat');
  }, []);

  const handlePaletteNewChat = useCallback(() => {
    window.dispatchEvent(new CustomEvent('henry_new_chat', {}));
    useStore.getState().setCurrentView('chat');
  }, []);

  const handlePaletteInject = useCallback((mode: HenryOperatingMode, text: string) => {
    if (isHenryOperatingMode(mode)) {
      try { localStorage.setItem('henry_operating_mode', mode); } catch { /* ignore */ }
    }
    window.dispatchEvent(new CustomEvent('henry_mode_launch', { detail: { mode, prompt: text } }));
    useStore.getState().setCurrentView('chat');
  }, []);

  return (
    <div className="h-full w-full flex flex-col bg-henry-bg overflow-hidden">
      <TitleBar />
      <PresenceBar />

      {/* Main body: sidebar (desktop) + content */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Sidebar: only visible on md+ */}
        <div className="hidden md:block">
          <Sidebar />
        </div>

        {/* Content — panel transition on view change */}
        <main key={currentView} className="flex-1 overflow-hidden min-h-0 henry-panel-enter">
          {currentView === 'today' && <TodayPanel />}
          {currentView === 'chat' && <ChatView />}
          {currentView === 'journal' && <JournalPanel />}
          {currentView === 'focus' && <FocusPanel />}
          {currentView === 'recorder' && <MeetingRecorderPanel />}
          {currentView === 'modes' && <ModesPanel />}
          {currentView === 'secretary' && <SecretaryPanel />}
          {currentView === 'contacts' && <ContactsPanel />}
          {currentView === 'tasks' && <TaskQueueView />}
          {currentView === 'files' && <FileBrowser />}
          {currentView === 'workspace' && <WorkspaceView />}
          {currentView === 'terminal' && <TerminalView />}
          {currentView === 'computer' && <ComputerPanel />}
          {currentView === 'printer' && <PrinterPanel />}
          {currentView === 'costs' && <CostDashboard />}
          {currentView === 'settings' && <SettingsView />}
          {currentView === 'reminders' && <RemindersPanel />}
          {currentView === 'crm' && <CRMPanel />}
          {currentView === 'finance' && <FinancePanel />}
          {currentView === 'lists' && <ListsPanel />}
          {currentView === 'printstudio' && <PrintStudioPanel />}
          {currentView === 'imagegen' && <ImageGenPanel />}
          {currentView === 'integrations' && <IntegrationsPanel />}
          {currentView === 'github' && <GitHubPanel />}
          {currentView === 'linear' && <LinearPanel />}
          {currentView === 'notion' && <NotionPanel />}
          {currentView === 'slack' && <SlackPanel />}
          {currentView === 'captures' && <CapturesPanel />}
          {currentView === 'weekly' && <WeeklyReviewPanel />}
          {currentView === 'stripe' && <StripePanel />}
          {currentView === 'gcal' && <GCalPanel />}
          {currentView === 'gmail' && <GmailPanel />}
          {currentView === 'gdrive' && <GDrivePanel />}
        </main>
      </div>

      {/* Mobile bottom nav — in-flow so content naturally sits above it */}
      <MobileNav />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onSetMode={handlePaletteSetMode}
        onNewChat={handlePaletteNewChat}
        onInjectPrompt={handlePaletteInject}
      />
    </div>
  );
}
