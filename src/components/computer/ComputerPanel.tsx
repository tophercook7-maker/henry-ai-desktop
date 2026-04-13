import { useState, useEffect, useRef } from 'react';

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
      { label: 'Finder', type: 'app' as const, value: 'Finder' },
      { label: 'Safari', type: 'app' as const, value: 'Safari' },
      { label: 'Terminal', type: 'app' as const, value: 'Terminal' },
      { label: 'System Settings', type: 'app' as const, value: 'System Settings' },
      { label: 'Activity Monitor', type: 'app' as const, value: 'Activity Monitor' },
    ],
  },
  {
    label: 'Files & folders',
    icon: '📁',
    actions: [
      { label: 'Open home folder', type: 'shell' as const, value: 'open ~' },
      { label: 'Open Downloads', type: 'shell' as const, value: 'open ~/Downloads' },
      { label: 'Open Desktop', type: 'shell' as const, value: 'open ~/Desktop' },
      { label: 'List Desktop files', type: 'shell' as const, value: 'ls -la ~/Desktop' },
      { label: 'Disk space', type: 'shell' as const, value: 'df -h ~' },
    ],
  },
  {
    label: 'System info',
    icon: '💻',
    actions: [
      { label: 'Check memory', type: 'shell' as const, value: 'vm_stat | head -10' },
      { label: 'Running processes', type: 'shell' as const, value: 'ps aux | head -20' },
      { label: 'Network info', type: 'shell' as const, value: 'ifconfig | grep "inet " | grep -v 127.0.0.1' },
      { label: 'macOS version', type: 'shell' as const, value: 'sw_vers' },
      { label: 'Uptime', type: 'shell' as const, value: 'uptime' },
    ],
  },
  {
    label: 'Automate',
    icon: '⚡',
    actions: [
      { label: 'Take screenshot', type: 'screenshot' as const, value: '' },
      { label: 'Empty trash', type: 'shell' as const, value: 'osascript -e \'tell application "Finder" to empty trash\'' },
      { label: 'Hide all windows', type: 'shell' as const, value: 'osascript -e \'tell application "System Events" to set visible of every process to false\'' },
      { label: 'Lock screen', type: 'shell' as const, value: 'pmset displaysleepnow' },
    ],
  },
];

export default function ComputerPanel() {
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [systemInfo, setSystemInfo] = useState<any>(null);
  const [log, setLog] = useState<ActionLog[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<'actions' | 'shell' | 'applescript' | 'app'>('actions');
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [apps, setApps] = useState<string[]>([]);
  const [appFilter, setAppFilter] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadPermissions();
    loadSystemInfo();
    addLog('info', 'Henry Computer Control ready.');
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [log]);

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
    try {
      const info = await window.henryAPI.computerSystemInfo();
      setSystemInfo(info);
    } catch {}
  }

  async function loadApps() {
    try {
      const result = await window.henryAPI.computerListApps();
      setApps(result.apps);
    } catch {}
  }

  useEffect(() => {
    if (mode === 'app') loadApps();
  }, [mode]);

  async function runShell(cmd: string) {
    setRunning(true);
    addLog('command', `$ ${cmd}`);
    try {
      const result = await window.henryAPI.computerRunShell({ command: cmd, timeout: 30000 });
      if (result.output) addLog('result', result.output);
      if (result.error && !result.success) addLog('error', result.error);
    } catch (e: any) {
      addLog('error', e.message);
    } finally {
      setRunning(false);
    }
  }

  async function executeCommand() {
    if (!input.trim() || running) return;
    const cmd = input.trim();
    setInput('');
    setHistory((h) => [cmd, ...h.slice(0, 50)]);
    setHistoryIdx(-1);
    setRunning(true);
    addLog('command', `$ ${cmd}`);
    try {
      let result: any;
      if (mode === 'shell') {
        result = await window.henryAPI.computerRunShell({ command: cmd, timeout: 30000 });
        if (result.output) addLog('result', result.output);
        if (result.error && !result.success) addLog('error', result.error);
      } else if (mode === 'applescript') {
        result = await window.henryAPI.computerOsascript(cmd);
        if (result.output) addLog('result', result.output);
        if (result.error) addLog('error', result.error);
      }
    } catch (e: any) {
      addLog('error', e.message);
    } finally {
      setRunning(false);
    }
  }

  async function openApp(appName: string) {
    setRunning(true);
    addLog('info', `Opening ${appName}…`);
    try {
      const result = await window.henryAPI.computerOpenApp(appName);
      addLog(result.success ? 'result' : 'error', result.output);
    } catch (e: any) {
      addLog('error', e.message);
    } finally {
      setRunning(false);
    }
  }

  async function takeScreenshot() {
    setRunning(true);
    addLog('info', 'Taking screenshot…');
    try {
      const result = await window.henryAPI.computerScreenshot();
      if (result.success && result.base64) {
        setScreenshot(`data:${result.mimeType || 'image/png'};base64,${result.base64}`);
        addLog('screenshot', 'Screenshot captured.');
      } else {
        addLog('error', result.error || 'Screenshot failed.');
      }
    } catch (e: any) {
      addLog('error', e.message);
    } finally {
      setRunning(false);
    }
  }

  async function runQuickAction(action: { type: 'shell' | 'app' | 'screenshot'; value: string; label: string }) {
    if (running) return;
    if (action.type === 'screenshot') {
      await takeScreenshot();
    } else if (action.type === 'app') {
      await openApp(action.value);
    } else {
      await runShell(action.value);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      executeCommand();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.min(historyIdx + 1, history.length - 1);
      setHistoryIdx(next);
      if (history[next]) setInput(history[next]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = Math.max(historyIdx - 1, -1);
      setHistoryIdx(next);
      setInput(next >= 0 ? history[next] : '');
    }
  }

  const isDesktop = permissions?.platform !== 'web';
  const filteredApps = apps.filter((a) => a.toLowerCase().includes(appFilter.toLowerCase()));
  const missingPerms = permissions && (!permissions.accessibility || !permissions.screenRecording);

  return (
    <div className="h-full flex flex-col bg-henry-bg text-henry-text overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-henry-border/50 bg-henry-surface/20">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-henry-text flex items-center gap-2">
              🖥️ Computer Control
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
          <div className="flex items-center gap-2">
            <button
              onClick={takeScreenshot}
              disabled={running}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-henry-surface border border-henry-border/50 hover:border-henry-accent/50 text-henry-text-dim hover:text-henry-text transition-all disabled:opacity-50"
            >
              📸 Screenshot
            </button>
            <button
              onClick={loadPermissions}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-henry-surface border border-henry-border/50 hover:border-henry-accent/50 text-henry-text-dim hover:text-henry-text transition-all"
            >
              🔄 Refresh
            </button>
          </div>
        </div>

        {/* Permissions — only show if something is missing */}
        {permissions && missingPerms && (
          <div className="flex items-center gap-3 mt-3">
            <PermBadge label="Accessibility" granted={permissions.accessibility} instructions={permissions.accessibilityInstructions} />
            <PermBadge label="Screen Recording" granted={permissions.screenRecording} instructions={permissions.screenRecordingInstructions} />
            {permissions.message && (
              <div className="text-[11px] text-henry-text-muted italic">{permissions.message}</div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Mode tabs */}
          <div className="shrink-0 flex gap-1 px-4 pt-3 pb-2 border-b border-henry-border/30">
            {([
              { id: 'actions', label: '⚡ Quick Actions' },
              { id: 'shell', label: '💻 Shell' },
              { id: 'applescript', label: '🍎 AppleScript' },
              { id: 'app', label: '📱 Apps' },
            ] as const).map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-all ${
                  mode === m.id
                    ? 'bg-henry-accent/10 text-henry-accent border border-henry-accent/20'
                    : 'text-henry-text-muted hover:text-henry-text hover:bg-henry-hover/50'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Quick Actions panel */}
          {mode === 'actions' && (
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {QUICK_ACTION_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-henry-text-muted mb-2 flex items-center gap-1.5">
                    <span>{group.icon}</span>
                    {group.label}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {group.actions.map((action) => (
                      <button
                        key={action.label}
                        onClick={() => runQuickAction(action)}
                        disabled={running}
                        className="text-left px-3 py-2.5 rounded-xl bg-henry-surface/30 border border-henry-border/30 hover:border-henry-accent/30 hover:bg-henry-surface/50 transition-colors disabled:opacity-40 group"
                      >
                        <p className="text-xs font-medium text-henry-text group-hover:text-henry-accent transition-colors">{action.label}</p>
                        {action.type === 'shell' && (
                          <p className="text-[10px] text-henry-text-muted/60 mt-0.5 font-mono truncate">{action.value}</p>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* App launcher */}
          {mode === 'app' && (
            <div className="flex-1 overflow-y-auto p-4">
              <input
                type="text"
                value={appFilter}
                onChange={(e) => setAppFilter(e.target.value)}
                placeholder="Search apps…"
                className="w-full bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50 mb-3"
              />
              <div className="grid grid-cols-3 gap-2">
                {filteredApps.map((app) => (
                  <button
                    key={app}
                    onClick={() => openApp(app)}
                    disabled={running}
                    className="text-xs px-2 py-2 rounded-lg bg-henry-surface border border-henry-border/30 hover:border-henry-accent/50 hover:bg-henry-accent/5 text-henry-text-dim hover:text-henry-text transition-all text-left truncate disabled:opacity-50"
                  >
                    {app}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Shell / AppleScript: log + input */}
          {(mode === 'shell' || mode === 'applescript') && (
            <>
              <div ref={logRef} className="flex-1 overflow-y-auto px-4 py-3 font-mono text-xs space-y-1">
                {log.map((entry) => (
                  <div key={entry.id}>
                    <LogLine entry={entry} />
                  </div>
                ))}
                {running && <div className="text-henry-accent animate-pulse">▋ running…</div>}
              </div>

              <div className="shrink-0 p-4 border-t border-henry-border/30">
                <div className="flex gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={running}
                    placeholder={mode === 'shell' ? 'Shell command… (↑↓ history)' : 'AppleScript…'}
                    className="flex-1 bg-henry-bg border border-henry-border rounded-xl px-4 py-2.5 text-sm text-henry-text font-mono outline-none focus:border-henry-accent/50 disabled:opacity-50"
                  />
                  <button
                    onClick={executeCommand}
                    disabled={running || !input.trim()}
                    className="px-4 py-2.5 bg-henry-accent text-white rounded-xl text-sm font-medium hover:bg-henry-accent/90 transition-colors disabled:opacity-50"
                  >
                    Run
                  </button>
                </div>
                <p className="text-[10px] text-henry-text-muted mt-1.5 px-1">
                  {mode === 'shell'
                    ? 'Commands run in your henry-workspace. Use absolute paths for other locations.'
                    : 'AppleScript requires Accessibility permission.'}
                </p>
              </div>
            </>
          )}

          {/* Activity log for Quick Actions and App mode */}
          {(mode === 'actions' || mode === 'app') && log.length > 0 && (
            <div className="shrink-0 border-t border-henry-border/30 max-h-32 overflow-y-auto px-4 py-2 font-mono text-xs space-y-0.5" ref={logRef}>
              {log.slice(-20).map((entry) => (
                <div key={entry.id}>
                  <LogLine entry={entry} />
                </div>
              ))}
              {running && <div className="text-henry-accent animate-pulse">▋ running…</div>}
            </div>
          )}
        </div>

        {/* Screenshot panel */}
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
            The Henry desktop app gives Henry real ability to open apps, take screenshots, and run shell commands — with your approval before each action.
          </p>
        </div>
      )}
    </div>
  );
}

function PermBadge({ label, granted, instructions }: { label: string; granted: boolean; instructions?: string | null }) {
  const [showHelp, setShowHelp] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => !granted && setShowHelp(!showHelp)}
        className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium transition-all ${
          granted ? 'bg-henry-success/15 text-henry-success' : 'bg-henry-error/15 text-henry-error hover:bg-henry-error/20 cursor-pointer'
        }`}
      >
        {granted ? '✓' : '!'} {label}
        {!granted && instructions && <span className="opacity-60 ml-0.5">→ fix</span>}
      </button>
      {showHelp && instructions && (
        <div className="absolute top-7 left-0 z-10 w-72 p-3 rounded-xl bg-henry-surface border border-henry-border shadow-xl text-xs text-henry-text-dim leading-relaxed">
          {instructions}
          <button onClick={() => setShowHelp(false)} className="block mt-2 text-henry-accent hover:underline">Got it</button>
        </div>
      )}
    </div>
  );
}

function LogLine({ entry }: { entry: ActionLog }) {
  const colors: Record<ActionLog['type'], string> = {
    command: 'text-henry-accent',
    result: 'text-henry-success',
    screenshot: 'text-henry-worker',
    error: 'text-henry-error',
    info: 'text-henry-text-muted',
  };
  return (
    <div className={`${colors[entry.type]} leading-relaxed whitespace-pre-wrap break-all`}>
      {entry.content}
    </div>
  );
}
