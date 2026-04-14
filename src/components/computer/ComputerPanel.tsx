import { useState, useEffect, useRef } from 'react';
import { useComputerSnapshotStore } from '../../henry/computerSnapshotStore';

interface ActionLog {
  id: string;
  type: 'command' | 'result' | 'screenshot' | 'error' | 'info';
  content: string;
  timestamp: number;
  imageBase64?: string;
}

interface Permissions {
  platform: string;
  accessibility: boolean;
  screenRecording: boolean;
  accessibilityInstructions?: string | null;
  screenRecordingInstructions?: string | null;
  message?: string;
}

const QUICK_ACTION_GROUPS = [
  {
    label: 'Open apps',
    icon: '📱',
    actions: [
      { label: 'Finder',           type: 'app'   as const, value: 'Finder' },
      { label: 'Safari',           type: 'app'   as const, value: 'Safari' },
      { label: 'Terminal',         type: 'app'   as const, value: 'Terminal' },
      { label: 'System Settings',  type: 'app'   as const, value: 'System Settings' },
      { label: 'Activity Monitor', type: 'app'   as const, value: 'Activity Monitor' },
    ],
  },
  {
    label: 'Files & folders',
    icon: '📁',
    actions: [
      { label: 'Open home folder',   type: 'shell' as const, value: 'open ~' },
      { label: 'Open Downloads',     type: 'shell' as const, value: 'open ~/Downloads' },
      { label: 'Open Desktop',       type: 'shell' as const, value: 'open ~/Desktop' },
      { label: 'List Desktop files', type: 'shell' as const, value: 'ls -la ~/Desktop' },
      { label: 'Disk space',         type: 'shell' as const, value: 'df -h ~' },
    ],
  },
  {
    label: 'System info',
    icon: '💻',
    actions: [
      { label: 'Check memory',     type: 'shell' as const, value: 'vm_stat | head -10' },
      { label: 'Running processes',type: 'shell' as const, value: 'ps aux | head -20' },
      { label: 'Network info',     type: 'shell' as const, value: 'ifconfig | grep "inet " | grep -v 127.0.0.1' },
      { label: 'macOS version',    type: 'shell' as const, value: 'sw_vers' },
      { label: 'Uptime',           type: 'shell' as const, value: 'uptime' },
    ],
  },
  {
    label: 'Automate',
    icon: '⚡',
    actions: [
      { label: 'Take screenshot', type: 'screenshot' as const, value: '' },
      { label: 'Empty trash',     type: 'shell' as const, value: 'osascript -e \'tell application "Finder" to empty trash\'' },
      { label: 'Lock screen',     type: 'shell' as const, value: 'pmset displaysleepnow' },
    ],
  },
];

type MainTab = 'overview' | 'apps' | 'actions';

export default function ComputerPanel() {
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [systemInfo, setSystemInfo]   = useState<any>(null);
  const [log, setLog]                 = useState<ActionLog[]>([]);
  const [running, setRunning]         = useState(false);
  const [tab, setTab]                 = useState<MainTab>('overview');
  const [screenshot, setScreenshot]   = useState<string | null>(null);
  const [apps, setApps]               = useState<string[]>([]);
  const [appFilter, setAppFilter]     = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedMode, setAdvancedMode] = useState<'shell' | 'applescript'>('shell');
  const [shellInput, setShellInput]   = useState('');
  const [history, setHistory]         = useState<string[]>([]);
  const [historyIdx, setHistoryIdx]   = useState(-1);
  const { snapshot: computerSnapshot, scanning: snapshotScanning, error: snapshotError, takeSnapshot } = useComputerSnapshotStore();
  const logRef  = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadPermissions();
    loadSystemInfo();
    if (!computerSnapshot || Date.now() - computerSnapshot.takenAt > 30 * 60 * 1000) {
      takeSnapshot();
    }
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [log]);

  useEffect(() => {
    if (tab === 'apps') loadApps();
  }, [tab]);

  function addLog(type: ActionLog['type'], content: string, imageBase64?: string) {
    setLog((prev) => [...prev, { id: crypto.randomUUID(), type, content, timestamp: Date.now(), imageBase64 }]);
  }

  async function loadPermissions() {
    try {
      const perms = await window.henryAPI.computerCheckPermissions();
      setPermissions(perms);
    } catch {
      setPermissions({ platform: 'unknown', accessibility: false, screenRecording: false });
    }
  }

  async function loadSystemInfo() {
    try { setSystemInfo(await window.henryAPI.computerSystemInfo()); } catch {}
  }

  async function loadApps() {
    try { const r = await window.henryAPI.computerListApps(); setApps(r.apps); } catch {}
  }

  async function runShell(cmd: string) {
    setRunning(true);
    addLog('command', `$ ${cmd}`);
    try {
      const r = await window.henryAPI.computerRunShell({ command: cmd, timeout: 30000 });
      if (r.output) addLog('result', r.output);
      if (r.error && !r.success) addLog('error', r.error);
    } catch (e: any) { addLog('error', e.message); }
    finally { setRunning(false); }
  }

  async function executeShell() {
    if (!shellInput.trim() || running) return;
    const cmd = shellInput.trim();
    setShellInput('');
    setHistory((h) => [cmd, ...h.slice(0, 50)]);
    setHistoryIdx(-1);
    setRunning(true);
    addLog('command', advancedMode === 'shell' ? `$ ${cmd}` : cmd);
    try {
      let r: any;
      if (advancedMode === 'shell') {
        r = await window.henryAPI.computerRunShell({ command: cmd, timeout: 30000 });
        if (r.output) addLog('result', r.output);
        if (r.error && !r.success) addLog('error', r.error);
      } else {
        r = await window.henryAPI.computerOsascript(cmd);
        if (r.output) addLog('result', r.output);
        if (r.error) addLog('error', r.error);
      }
    } catch (e: any) { addLog('error', e.message); }
    finally { setRunning(false); }
  }

  async function openApp(appName: string) {
    setRunning(true);
    addLog('info', `Opening ${appName}…`);
    try {
      const r = await window.henryAPI.computerOpenApp(appName);
      addLog(r.success ? 'result' : 'error', r.output);
    } catch (e: any) { addLog('error', e.message); }
    finally { setRunning(false); }
  }

  async function takeScreenshot() {
    setRunning(true);
    addLog('info', 'Taking screenshot…');
    try {
      const r = await window.henryAPI.computerScreenshot();
      if (r.success && r.base64) {
        setScreenshot(`data:${r.mimeType || 'image/png'};base64,${r.base64}`);
        addLog('screenshot', 'Screenshot captured.');
      } else {
        addLog('error', r.error || 'Screenshot failed.');
      }
    } catch (e: any) { addLog('error', e.message); }
    finally { setRunning(false); }
  }

  async function runQuickAction(action: { type: 'shell' | 'app' | 'screenshot'; value: string }) {
    if (running) return;
    if      (action.type === 'screenshot') await takeScreenshot();
    else if (action.type === 'app')        await openApp(action.value);
    else                                   await runShell(action.value);
  }

  function handleShellKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); executeShell(); }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(next); if (history[next]) setShellInput(history[next]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.max(historyIdx - 1, -1);
      setHistoryIdx(next); setShellInput(next >= 0 ? history[next] : '');
    }
  }

  const isDesktop     = permissions?.platform !== 'web';
  const allPermsOk    = permissions?.accessibility && permissions?.screenRecording;
  const filteredApps  = apps.filter((a) => a.toLowerCase().includes(appFilter.toLowerCase()));

  return (
    <div className="h-full flex flex-col bg-henry-bg text-henry-text overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-henry-border/50 bg-henry-surface/20">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-henry-text flex items-center gap-2">
              🖥️ My Computer
              {!isDesktop && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-henry-warning/15 text-henry-warning font-normal">
                  Desktop app required
                </span>
              )}
            </h2>
            {systemInfo && (
              <p className="text-xs text-henry-text-muted mt-0.5">
                {systemInfo.hostname} · {systemInfo.platform} · {systemInfo.freeMemoryGB}GB free
              </p>
            )}
          </div>
          <button
            onClick={takeScreenshot}
            disabled={running}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-henry-surface border border-henry-border/50 hover:border-henry-accent/50 text-henry-text-dim hover:text-henry-text transition-all disabled:opacity-50"
          >
            📸 Screenshot
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Main tabs */}
          <div className="shrink-0 flex gap-1 px-4 pt-3 pb-2 border-b border-henry-border/30">
            {([
              { id: 'overview', label: '💻 This Mac' },
              { id: 'apps',     label: '📱 My Apps' },
              { id: 'actions',  label: '⚡ Quick Actions' },
            ] as const).map((m) => (
              <button
                key={m.id}
                onClick={() => setTab(m.id)}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-all ${
                  tab === m.id
                    ? 'bg-henry-accent/10 text-henry-accent border border-henry-accent/20'
                    : 'text-henry-text-muted hover:text-henry-text hover:bg-henry-hover/50'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* ── OVERVIEW TAB ─────────────────────────────────────────────────── */}
          {tab === 'overview' && (
            <div className="flex-1 overflow-y-auto p-5 space-y-4">

              {/* Access status — most prominent thing */}
              <div className={`rounded-2xl border p-4 ${allPermsOk ? 'bg-henry-success/5 border-henry-success/20' : 'bg-henry-warning/5 border-henry-warning/20'}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xl ${allPermsOk ? 'bg-henry-success/15' : 'bg-henry-warning/15'}`}>
                    {allPermsOk ? '✓' : '⚠'}
                  </div>
                  <div>
                    <p className={`text-sm font-semibold ${allPermsOk ? 'text-henry-success' : 'text-henry-warning'}`}>
                      {allPermsOk ? 'Henry has full access' : 'Some permissions needed'}
                    </p>
                    <p className="text-xs text-henry-text-muted mt-0.5">
                      {allPermsOk
                        ? 'Henry can open apps, control the screen, and run commands.'
                        : 'Grant the permissions below to unlock full computer control.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Permission cards */}
              {permissions && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-henry-text-muted">Permissions</p>
                  <PermCard
                    icon="♿"
                    label="Accessibility"
                    granted={permissions.accessibility}
                    what="Lets Henry control apps, click UI elements, and automate tasks."
                    instructions={permissions.accessibilityInstructions}
                  />
                  <PermCard
                    icon="📹"
                    label="Screen Recording"
                    granted={permissions.screenRecording}
                    what="Lets Henry take screenshots and see what's on screen."
                    instructions={permissions.screenRecordingInstructions}
                  />
                </div>
              )}

              {/* Snapshot / machine info */}
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-henry-text-muted">This Mac</p>
                <button
                  onClick={() => takeSnapshot()}
                  disabled={snapshotScanning}
                  className="text-xs text-henry-accent hover:underline disabled:opacity-40"
                >
                  {snapshotScanning ? '⏳ Scanning…' : '↻ Refresh'}
                </button>
              </div>

              {snapshotError && (
                <div className="p-3 rounded-xl bg-henry-error/10 border border-henry-error/20 text-xs text-henry-error">{snapshotError}</div>
              )}

              {!computerSnapshot && !snapshotScanning && !snapshotError && (
                <div className="p-6 rounded-xl bg-henry-surface/30 border border-henry-border/30 text-center">
                  <p className="text-sm text-henry-text-muted mb-2">No snapshot yet</p>
                  <button onClick={() => takeSnapshot()} className="text-xs text-henry-accent hover:underline">Scan now →</button>
                </div>
              )}

              {computerSnapshot && (
                <div className="space-y-2">
                  <InfoCard title="System" icon="💻">
                    <InfoRow label="Device"  value={computerSnapshot.hostname} />
                    <InfoRow label="System"  value={`${computerSnapshot.platform}${computerSnapshot.osVersion ? ` · ${computerSnapshot.osVersion}` : ''}`} />
                    {computerSnapshot.freeMemoryGB != null && (
                      <InfoRow label="Memory" value={`${computerSnapshot.freeMemoryGB}GB free${computerSnapshot.totalMemoryGB ? ` of ${computerSnapshot.totalMemoryGB}GB` : ''}`} />
                    )}
                    {computerSnapshot.uptime && <InfoRow label="Uptime" value={computerSnapshot.uptime} />}
                  </InfoCard>

                  {computerSnapshot.activeApp && (
                    <InfoCard title="Active now" icon="🎯">
                      <InfoRow label="App in focus" value={computerSnapshot.activeApp} />
                    </InfoCard>
                  )}

                  {computerSnapshot.runningApps.length > 0 && (
                    <InfoCard title="Open apps" icon="📱">
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {computerSnapshot.runningApps.slice(0, 12).map((app) => (
                          <span key={app} className="px-2 py-0.5 rounded-full bg-henry-bg border border-henry-border/40 text-[10px] text-henry-text-dim">{app}</span>
                        ))}
                        {computerSnapshot.runningApps.length > 12 && (
                          <span className="px-2 py-0.5 rounded-full bg-henry-bg border border-henry-border/40 text-[10px] text-henry-text-muted">
                            +{computerSnapshot.runningApps.length - 12} more
                          </span>
                        )}
                      </div>
                    </InfoCard>
                  )}

                  {computerSnapshot.recentFiles.length > 0 && (
                    <InfoCard title="Recent Downloads" icon="📁">
                      <div className="space-y-1 mt-1">
                        {computerSnapshot.recentFiles.map((f) => (
                          <p key={f} className="text-[11px] text-henry-text-dim font-mono truncate">{f}</p>
                        ))}
                      </div>
                    </InfoCard>
                  )}
                </div>
              )}

              {/* Advanced section */}
              <div className="border-t border-henry-border/20 pt-4">
                <button
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="flex items-center gap-2 text-xs text-henry-text-muted hover:text-henry-text transition-colors"
                >
                  <svg className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  Advanced — Shell &amp; AppleScript
                </button>

                {showAdvanced && (
                  <div className="mt-4 space-y-3">
                    <div className="flex gap-1">
                      {(['shell', 'applescript'] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => setAdvancedMode(m)}
                          className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-all ${
                            advancedMode === m
                              ? 'bg-henry-accent/10 text-henry-accent border border-henry-accent/20'
                              : 'text-henry-text-muted hover:text-henry-text hover:bg-henry-hover/50'
                          }`}
                        >
                          {m === 'shell' ? '💻 Shell' : '🍎 AppleScript'}
                        </button>
                      ))}
                    </div>

                    <div ref={logRef} className="rounded-xl bg-henry-surface/20 border border-henry-border/20 p-3 font-mono text-xs space-y-0.5 max-h-40 overflow-y-auto">
                      {log.length === 0 && <p className="text-henry-text-muted/50">No output yet.</p>}
                      {log.map((entry) => (
                        <div key={entry.id}>
                          <LogLine entry={entry} />
                        </div>
                      ))}
                      {running && <div className="text-henry-accent animate-pulse">▋ running…</div>}
                    </div>

                    <div className="flex gap-2">
                      <input
                        ref={shellRef}
                        type="text"
                        value={shellInput}
                        onChange={(e) => setShellInput(e.target.value)}
                        onKeyDown={handleShellKeyDown}
                        disabled={running}
                        placeholder={advancedMode === 'shell' ? 'Shell command… (↑↓ history)' : 'AppleScript…'}
                        className="flex-1 bg-henry-bg border border-henry-border rounded-xl px-4 py-2.5 text-sm text-henry-text font-mono outline-none focus:border-henry-accent/50 disabled:opacity-50"
                      />
                      <button
                        onClick={executeShell}
                        disabled={running || !shellInput.trim()}
                        className="px-4 py-2.5 bg-henry-accent text-white rounded-xl text-sm font-medium hover:bg-henry-accent/90 transition-colors disabled:opacity-50"
                      >
                        Run
                      </button>
                    </div>
                    <p className="text-[10px] text-henry-text-muted px-1">
                      {advancedMode === 'shell'
                        ? 'Commands run in your henry-workspace. Use absolute paths for other locations.'
                        : 'AppleScript requires Accessibility permission.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── APPS TAB ─────────────────────────────────────────────────────── */}
          {tab === 'apps' && (
            <div className="flex-1 overflow-y-auto p-4">
              <input
                type="text"
                value={appFilter}
                onChange={(e) => setAppFilter(e.target.value)}
                placeholder="Search apps…"
                className="w-full bg-henry-bg border border-henry-border rounded-xl px-3 py-2.5 text-sm text-henry-text outline-none focus:border-henry-accent/50 mb-3"
              />
              {filteredApps.length === 0 && !apps.length ? (
                <div className="text-center py-8">
                  <p className="text-sm text-henry-text-muted">No apps loaded yet</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {filteredApps.map((app) => (
                    <button
                      key={app}
                      onClick={() => openApp(app)}
                      disabled={running}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-henry-surface/30 border border-henry-border/30 hover:border-henry-accent/50 hover:bg-henry-accent/5 text-henry-text-dim hover:text-henry-text transition-all disabled:opacity-50"
                    >
                      <div className="w-9 h-9 rounded-xl bg-henry-bg border border-henry-border/40 flex items-center justify-center text-lg">
                        💻
                      </div>
                      <span className="text-[10px] text-center leading-tight truncate w-full">{app}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Activity log */}
              {log.length > 0 && (
                <div className="mt-4 border-t border-henry-border/30 pt-3 max-h-28 overflow-y-auto font-mono text-xs space-y-0.5">
                  {log.slice(-10).map((entry) => <div key={entry.id}><LogLine entry={entry} /></div>)}
                  {running && <div className="text-henry-accent animate-pulse">▋</div>}
                </div>
              )}
            </div>
          )}

          {/* ── ACTIONS TAB ──────────────────────────────────────────────────── */}
          {tab === 'actions' && (
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {QUICK_ACTION_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-henry-text-muted mb-2 flex items-center gap-1.5">
                    <span>{group.icon}</span>{group.label}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {group.actions.map((action) => (
                      <button
                        key={action.label}
                        onClick={() => runQuickAction(action)}
                        disabled={running}
                        className="text-left px-3 py-3 rounded-xl bg-henry-surface/30 border border-henry-border/30 hover:border-henry-accent/30 hover:bg-henry-surface/50 transition-colors disabled:opacity-40 group"
                      >
                        <p className="text-xs font-medium text-henry-text group-hover:text-henry-accent transition-colors">{action.label}</p>
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              {running && (
                <div className="flex items-center gap-2 text-xs text-henry-text-muted pt-1">
                  <div className="w-3 h-3 rounded-full border-2 border-henry-accent/30 border-t-henry-accent animate-spin" />
                  Running…
                </div>
              )}
            </div>
          )}
        </div>

        {/* Screenshot side panel */}
        {screenshot && (
          <div className="w-72 shrink-0 border-l border-henry-border/50 flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-henry-border/30 text-xs text-henry-text-muted">
              <span>Screenshot</span>
              <button onClick={() => setScreenshot(null)} className="hover:text-henry-text transition-colors">✕</button>
            </div>
            <div className="flex-1 overflow-auto p-2">
              <img src={screenshot} alt="Screenshot" className="w-full rounded border border-henry-border/30" />
            </div>
            <div className="p-2 border-t border-henry-border/30">
              <button
                onClick={takeScreenshot}
                className="w-full text-xs py-1.5 rounded-lg bg-henry-surface hover:bg-henry-hover text-henry-text-dim hover:text-henry-text transition-all"
              >
                📸 Refresh
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Desktop app CTA */}
      {!isDesktop && (
        <div className="shrink-0 mx-4 mb-4 p-4 rounded-xl bg-henry-accent/5 border border-henry-accent/20">
          <p className="text-sm font-medium text-henry-text mb-1">Full computer control requires the desktop app</p>
          <p className="text-xs text-henry-text-dim leading-relaxed">
            The Henry desktop app gives Henry real ability to open apps, take screenshots, and run shell commands.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PermCard({
  icon, label, granted, what, instructions,
}: {
  icon: string; label: string; granted: boolean; what: string; instructions?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`rounded-xl border p-3 transition-all ${granted ? 'bg-henry-surface/20 border-henry-border/30' : 'bg-henry-warning/5 border-henry-warning/20'}`}>
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-base ${granted ? 'bg-henry-success/10' : 'bg-henry-warning/10'}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-henry-text">{label}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${granted ? 'bg-henry-success/15 text-henry-success' : 'bg-henry-warning/15 text-henry-warning'}`}>
              {granted ? 'Enabled' : 'Not granted'}
            </span>
          </div>
          <p className="text-[11px] text-henry-text-muted mt-0.5">{what}</p>
        </div>
        {!granted && instructions && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="shrink-0 text-xs text-henry-accent hover:underline"
          >
            {expanded ? 'Hide' : 'How to fix →'}
          </button>
        )}
      </div>
      {expanded && instructions && (
        <div className="mt-3 pl-11 text-xs text-henry-text-dim leading-relaxed border-t border-henry-border/20 pt-3">
          {instructions}
        </div>
      )}
    </div>
  );
}

function InfoCard({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-henry-surface/30 border border-henry-border/30 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-henry-text-muted mb-2 flex items-center gap-1.5">
        <span>{icon}</span>{title}
      </p>
      {children}
    </div>
  );
}

function InfoRow({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[11px] text-henry-text-muted">{label}</span>
      <span className={`text-[11px] font-medium ${ok === false ? 'text-henry-warning' : ok === true ? 'text-henry-success' : 'text-henry-text-dim'}`}>{value}</span>
    </div>
  );
}

function LogLine({ entry }: { entry: ActionLog }) {
  const colors: Record<ActionLog['type'], string> = {
    command:    'text-henry-accent',
    result:     'text-henry-success',
    screenshot: 'text-henry-worker',
    error:      'text-henry-error',
    info:       'text-henry-text-muted',
  };
  return (
    <div className={`${colors[entry.type]} leading-relaxed whitespace-pre-wrap break-all`}>
      {entry.content}
    </div>
  );
}
