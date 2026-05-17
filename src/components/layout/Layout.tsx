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
import { HenrySelfRepairBoundary as PanelBoundary } from '../HenrySelfRepairBoundary';
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
import MachinesPanel from '../maker/MachinesPanel';
import MaterialsPanel from '../maker/MaterialsPanel';
import ProductionRunsPanel from '../maker/ProductionRunsPanel';
import WastePanel from '../maker/WastePanel';
import MaintenancePanel from '../maker/MaintenancePanel';
import ScripturePanel from '../scripture/ScripturePanel';
import PrayerPanel from '../prayer/PrayerPanel';
import QuotingPanel from '../quoting/QuotingPanel';
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
    // Copy to clipboard first (always works)
    navigator.clipboard?.writeText(url).catch(() => {});
    // Try to open Safari via shell
    fetch('http://127.0.0.1:4242/computer/shell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Henry-Internal': 'true' },
      body: JSON.stringify({ command: `open -a Safari "${url}"` })
    }).then(r => {
      if (!r.ok) throw new Error('shell failed');
    }).catch(() => {
      // Fallback: open in whatever browser is available
      window.open(url, '_blank');
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
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
              className="text-[11px] px-3 py-1.5 rounded-lg border border-henry-accent/30 bg-henry-accent/10 text-henry-accent hover:bg-henry-accent/20 transition-all font-medium">
              📱 Open in Safari
            </button>
          </div>
        </div>
        <p className="text-[11px] text-henry-text-muted leading-relaxed">
          📱 iPhone/iPad: Open Safari (not Chrome), type this URL, then tap Share (□↑) → "Add to Home Screen" to install as an app.
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
          {currentView === 'today' && <PanelBoundary><TodayPanel /></PanelBoundary>}
          {currentView === 'chat' && <ChatView />}
          {currentView === 'journal' && <PanelBoundary><JournalPanel /></PanelBoundary>}
          {currentView === 'focus' && <PanelBoundary><FocusPanel /></PanelBoundary>}
          {currentView === 'recorder' && <PanelBoundary><MeetingRecorderPanel /></PanelBoundary>}
          {currentView === 'modes' && <PanelBoundary><ModesPanel /></PanelBoundary>}
          {currentView === 'secretary' && <PanelBoundary><SecretaryPanel /></PanelBoundary>}
          {currentView === 'contacts' && <PanelBoundary><ContactsPanel /></PanelBoundary>}
          {currentView === 'tasks' && <PanelBoundary><TasksPanel /></PanelBoundary>}
          {currentView === 'files' && <PanelBoundary><FileBrowser /></PanelBoundary>}
          {currentView === 'workspace' && <PanelBoundary><WorkspaceView /></PanelBoundary>}
          {currentView === 'terminal' && <PanelBoundary><TerminalView /></PanelBoundary>}
          {currentView === 'computer' && <PanelBoundary><ComputerPanel /></PanelBoundary>}
          {currentView === 'printer' && <PanelBoundary><PrinterPanel /></PanelBoundary>}
          {currentView === 'costs' && <PanelBoundary><CostDashboard /></PanelBoundary>}
          {currentView === 'settings' && <PanelBoundary><SettingsView /></PanelBoundary>}
          {currentView === 'health' && <PanelBoundary><HealthPanel /></PanelBoundary>}
          {currentView === 'companion' && (
            <div className="h-full overflow-y-auto px-5 py-5 max-w-lg space-y-5">
              <div>
                <h2 className="text-lg font-bold text-henry-text">Henry AI — Phone &amp; Tablet</h2>
                <p className="text-xs text-henry-text-muted mt-1">Henry AI works as a standalone app on your iPhone and iPad. No App Store needed.</p>
              </div>

              {/* Step 1: Open on phone */}
              <div className="bg-henry-surface/40 border border-henry-border/15 rounded-2xl p-4 space-y-3">
                <p className="text-xs font-semibold text-henry-text uppercase tracking-wider">Step 1 — Open on your iPhone or iPad</p>
                <CompanionUrlCard />
                <p className="text-[11px] text-henry-text-muted leading-relaxed">
                  Both devices must be on the same WiFi. Open the URL above in Safari (not Chrome).
                </p>
              </div>

              {/* Step 2: Install as app */}
              <div className="bg-henry-accent/8 border border-henry-accent/20 rounded-2xl p-4 space-y-3">
                <p className="text-xs font-semibold text-henry-accent uppercase tracking-wider">Step 2 — Install as an App</p>
                <div className="space-y-2.5">
                  {[
                    { icon: '1', text: 'Tap the Share button (□↑) at the bottom of Safari' },
                    { icon: '2', text: 'Scroll down and tap "Add to Home Screen"' },
                    { icon: '3', text: 'Tap "Add" — Henry AI appears on your home screen' },
                    { icon: '4', text: 'Open it from your home screen — runs full-screen like a native app' },
                  ].map(step => (
                    <div key={step.icon} className="flex items-start gap-3">
                      <span className="w-5 h-5 rounded-full bg-henry-accent text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{step.icon}</span>
                      <p className="text-xs text-henry-text leading-relaxed">{step.text}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* QR code */}
              <details className="group">
                <summary className="text-xs text-henry-text-muted cursor-pointer hover:text-henry-text transition-all list-none flex items-center gap-1">
                  <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                  Scan QR code instead of typing the URL
                </summary>
                <div className="mt-3">
                  <DeviceLinkPanel />
                </div>
              </details>

              {/* What's available */}
              <div className="bg-henry-surface/30 border border-henry-border/10 rounded-2xl p-4">
                <p className="text-xs font-semibold text-henry-text mb-2">What's in the app</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {['💬 Chat with Henry','☀️ Today & Habits','✓ Tasks (add/complete)','⏰ Reminders','📔 Journal entries','❤️ Health logging','◎ Goals','💰 Finance','✝ Bible study','⊕ Smart capture'].map(f => (
                    <p key={f} className="text-[11px] text-henry-text-muted">{f}</p>
                  ))}
                </div>
              </div>
            </div>
          )}
          {currentView === 'reminders' && <PanelBoundary><RemindersPanel /></PanelBoundary>}
          {currentView === 'crm' && <PanelBoundary><CRMPanel /></PanelBoundary>}
          {currentView === 'finance' && <PanelBoundary><FinancePanel /></PanelBoundary>}
          {currentView === 'lists' && <PanelBoundary><ListsPanel /></PanelBoundary>}
          {currentView === 'goals' && <PanelBoundary><GoalsPanel /></PanelBoundary>}
          {currentView === 'hq' && <PanelBoundary><HQPanel /></PanelBoundary>}
          {currentView === 'setup' && <PanelBoundary><AutoSetupPanel /></PanelBoundary>}
          {currentView === 'printstudio' && <PanelBoundary><PrintStudioPanel /></PanelBoundary>}
          {currentView === 'machines' && <PanelBoundary><MachinesPanel /></PanelBoundary>}
          {currentView === 'materials' && <PanelBoundary><MaterialsPanel /></PanelBoundary>}
          {currentView === 'production' && <PanelBoundary><ProductionRunsPanel /></PanelBoundary>}
          {currentView === 'waste' && <PanelBoundary><WastePanel /></PanelBoundary>}
          {currentView === 'maintenance' && <PanelBoundary><MaintenancePanel /></PanelBoundary>}
          {currentView === 'scripture' && <PanelBoundary><ScripturePanel /></PanelBoundary>}
          {currentView === 'prayer' && <PanelBoundary><PrayerPanel /></PanelBoundary>}
          {currentView === 'quoting' && <PanelBoundary><QuotingPanel /></PanelBoundary>}
          {currentView === 'imagegen' && <PanelBoundary><ImageGenPanel /></PanelBoundary>}
      {currentView === 'videogen' && <PanelBoundary><VideoGenPanel /></PanelBoundary>}
          {currentView === 'integrations' && <PanelBoundary><IntegrationsPanel /></PanelBoundary>}
          {currentView === 'github' && <PanelBoundary><GitHubPanel /></PanelBoundary>}
          {currentView === 'linear' && <PanelBoundary><LinearPanel /></PanelBoundary>}
          {currentView === 'notion' && <PanelBoundary><NotionPanel /></PanelBoundary>}
          {currentView === 'slack' && <PanelBoundary><SlackPanel /></PanelBoundary>}
          {currentView === 'captures' && <PanelBoundary><CapturesPanel /></PanelBoundary>}
          {currentView === 'memory' && <PanelBoundary><MemoryPanel /></PanelBoundary>}
          {currentView === 'recorder' && <PanelBoundary><RecorderPanel /></PanelBoundary>}
          {currentView === 'weekly' && <PanelBoundary><WeeklyReviewPanel /></PanelBoundary>}
          {currentView === 'stripe' && <PanelBoundary><StripePanel /></PanelBoundary>}
          {currentView === 'gcal' && <PanelBoundary><GCalPanel /></PanelBoundary>}
          {currentView === 'gmail' && <PanelBoundary><GmailPanel /></PanelBoundary>}
          {currentView === 'gdrive' && <PanelBoundary><GDrivePanel /></PanelBoundary>}
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
