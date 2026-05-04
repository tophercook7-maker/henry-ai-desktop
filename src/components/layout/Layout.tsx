import React, { useState, useCallback } from 'react';
import TitleBar from './TitleBar';
import PresenceBar from './PresenceBar';
import Sidebar from './Sidebar';
import MobileNav from './MobileNav';
import ChatView from '../chat/ChatView';
import TaskQueueView from '../queue/TaskQueueView';
import HealthPanel from '../health/HealthPanel';
import TasksPanel from '../tasks/TasksPanel';
import SettingsView from '../settings/SettingsView';
import FileBrowser from '../files/FileBrowser';
import WorkspaceView from '../workspace/WorkspaceView';
import TerminalView from '../terminal/TerminalView';
import CostDashboard from '../costs/CostDashboard';
import ComputerPanel from '../computer/ComputerPanel';
import DeviceLinkPanel from '../settings/DeviceLinkPanel';
import MemoryPanel from '../memory/MemoryPanel';
import RecorderPanel from '../recorder/RecorderPanel';
import PrinterPanel from '../computer/PrinterPanel';
import SecretaryPanel from '../secretary/SecretaryPanel';
import GoalsPanel from '../goals/GoalsPanel';
import HQPanel from '../hq/HQPanel';
import AutoSetupPanel from '../setup/AutoSetupPanel';
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
import ScripturePanel from '../scripture/ScripturePanel';
import ImageGenPanel from '../imagegen/ImageGenPanel';
import VideoGenPanel from '../videogen/VideoGenPanel';
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

function CompanionUrlCard() {
  const [state, setState] = React.useState<{localIp?: string; tunnelUrl?: string; running?: boolean} | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    fetch('http://127.0.0.1:4242/sync/state-internal', { headers: {'X-Henry-Internal':'true'} })
      .then(r => r.json())
      .then((d: any) => setState({ localIp: d.localIp, tunnelUrl: d.tunnelUrl, running: d.running }))
      .catch(() => {});
  }, []);

  const localUrl = state?.localIp ? `http://${state.localIp}:4242` : 'http://192.168.x.x:4242';
  const tunnelUrl = state?.tunnelUrl || null;

  function copy(url: string) {
    navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  function openInBrowser(url: string) {
    (window as any).henryAPI?.computerRunShell?.({ command: `open "${url}"`, timeout: 3000 });
  }

  return (
    <div className="space-y-3">
      <div className="bg-henry-surface border border-henry-border/20 rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-green-400 text-sm">●</span>
          <p className="text-sm font-semibold text-henry-text">Open on same WiFi</p>
        </div>
        <div className="bg-henry-bg rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <p className="font-mono text-henry-accent text-sm font-bold">{localUrl}</p>
          <div className="flex gap-2 flex-shrink-0">
            <button onClick={() => copy(localUrl)}
              className="text-[11px] px-3 py-1.5 rounded-lg bg-henry-accent/15 border border-henry-accent/30 text-henry-accent hover:bg-henry-accent/25 transition-all">
              {copied ? '✓ Copied' : 'Copy'}
            </button>
            <button onClick={() => openInBrowser(localUrl)}
              className="text-[11px] px-3 py-1.5 rounded-lg border border-henry-border/30 text-henry-text-muted hover:text-henry-text transition-all">
              Open ↗
            </button>
          </div>
        </div>
        <p className="text-[11px] text-henry-text-muted leading-relaxed">
          On your iPad or iPhone: open Safari, type this URL, bookmark it. Both must be on the same WiFi.
        </p>
      </div>
      {tunnelUrl && (
        <div className="bg-henry-surface border border-henry-border/20 rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-blue-400 text-sm">●</span>
            <p className="text-sm font-semibold text-henry-text">From anywhere</p>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-400/10 border border-blue-400/20 text-blue-400">Tunnel active</span>
          </div>
          <div className="bg-henry-bg rounded-xl px-3 py-2.5 flex items-center justify-between gap-2">
            <p className="font-mono text-henry-accent text-xs truncate">{tunnelUrl}</p>
            <button onClick={() => copy(tunnelUrl)}
              className="text-[11px] px-3 py-1.5 rounded-lg bg-henry-accent/15 border border-henry-accent/30 text-henry-accent flex-shrink-0">Copy</button>
          </div>
          <p className="text-[11px] text-henry-text-muted">Works over cellular. URL changes each restart.</p>
        </div>
      )}
    </div>
  );
}

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
          {currentView === 'tasks' && <TasksPanel />}
          {currentView === 'files' && <FileBrowser />}
          {currentView === 'workspace' && <WorkspaceView />}
          {currentView === 'terminal' && <TerminalView />}
          {currentView === 'computer' && <ComputerPanel />}
          {currentView === 'printer' && <PrinterPanel />}
          {currentView === 'costs' && <CostDashboard />}
          {currentView === 'settings' && <SettingsView />}
          {currentView === 'health' && <HealthPanel />}
          {currentView === 'companion' && (
            <div className="h-full overflow-y-auto px-5 py-5 max-w-lg space-y-5">
              <div>
                <h2 className="text-lg font-bold text-henry-text">iPad / iPhone Companion</h2>
                <p className="text-xs text-henry-text-muted mt-1">Open the link below on any device on your WiFi network.</p>
              </div>

              {/* Primary: web companion URL */}
              <CompanionUrlCard />

              {/* Secondary: full pairing for native app */}
              <details className="group">
                <summary className="text-xs text-henry-text-muted cursor-pointer hover:text-henry-text transition-all list-none flex items-center gap-1">
                  <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                  Advanced: pair a native iOS app
                </summary>
                <div className="mt-3">
                  <DeviceLinkPanel />
                </div>
              </details>
            </div>
          )}
          {currentView === 'reminders' && <RemindersPanel />}
          {currentView === 'crm' && <CRMPanel />}
          {currentView === 'finance' && <FinancePanel />}
          {currentView === 'lists' && <ListsPanel />}
          {currentView === 'goals' && <GoalsPanel />}
          {currentView === 'hq' && <HQPanel />}
          {currentView === 'setup' && <AutoSetupPanel />}
          {currentView === 'printstudio' && <PrintStudioPanel />}
          {currentView === 'scripture' && <ScripturePanel />}
          {currentView === 'imagegen' && <ImageGenPanel />}
      {currentView === 'videogen' && <VideoGenPanel />}
          {currentView === 'integrations' && <IntegrationsPanel />}
          {currentView === 'github' && <GitHubPanel />}
          {currentView === 'linear' && <LinearPanel />}
          {currentView === 'notion' && <NotionPanel />}
          {currentView === 'slack' && <SlackPanel />}
          {currentView === 'captures' && <CapturesPanel />}
          {currentView === 'memory' && <MemoryPanel />}
          {currentView === 'recorder' && <RecorderPanel />}
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
