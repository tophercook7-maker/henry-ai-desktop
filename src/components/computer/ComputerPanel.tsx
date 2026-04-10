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

export default function ComputerPanel() {
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [systemInfo, setSystemInfo] = useState<any>(null);
  const [log, setLog] = useState<ActionLog[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<'shell' | 'applescript' | 'app'>('shell');
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [apps, setApps] = useState<string[]>([]);
  const [appFilter, setAppFilter] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [pendingAction, setPendingAction] = useState<{ label: string; fn: () => Promise<void> } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadPermissions();
    loadSystemInfo();
    addLog('info', 'Henry Computer Control ready. Commands run on your computer via the desktop app.');
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
    addLog('command', `open -a "${appName}"`);
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
    addLog('info', 'Taking screenshot...');
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

  async function typeText(text: string) {
    setRunning(true);
    addLog('command', `type: "${text}"`);
    try {
      const result = await window.henryAPI.computerTypeText(text);
      addLog(result.success ? 'result' : 'error', result.success ? 'Text typed.' : (result.error || 'Failed.'));
    } catch (e: any) {
      addLog('error', e.message);
    } finally {
      setRunning(false);
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

  return (
    <div className="h-full flex flex-col bg-henry-bg text-henry-text overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-henry-border/50 bg-henry-surface/30">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold text-henry-text flex items-center gap-2">
              🖥️ Computer Control
              {!isDesktop && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-henry-warning/15 text-henry-warning font-normal">
                  Web Preview
                </span>
              )}
            </h2>
            {systemInfo && (
              <p className="text-xs text-henry-text-muted mt-0.5">
                {systemInfo.platform} · {systemInfo.arch} · {systemInfo.hostname} · {systemInfo.freeMemoryGB}GB free
                {systemInfo.macOS && ` · ${systemInfo.macOS.split('\n')[0]}`}
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

        {/* Permission status */}
        {permissions && (
          <div className="flex items-start gap-3">
            <PermBadge
              label="Accessibility"
              granted={permissions.accessibility}
              instructions={permissions.accessibilityInstructions}
            />
            <PermBadge
              label="Screen Recording"
              granted={permissions.screenRecording}
              instructions={permissions.screenRecordingInstructions}
            />
            {permissions.message && (
              <div className="text-[11px] text-henry-text-muted italic">{permissions.message}</div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: log + input */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Mode tabs */}
          <div className="shrink-0 flex gap-1 px-4 pt-3 pb-2 border-b border-henry-border/30">
            {(['shell', 'applescript', 'app'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1 text-xs rounded-lg font-medium transition-all ${
                  mode === m
                    ? 'bg-henry-accent text-white'
                    : 'bg-henry-hover text-henry-text-dim hover:text-henry-text'
                }`}
              >
                {m === 'shell' ? '💻 Shell' : m === 'applescript' ? '🍎 AppleScript' : '📱 Apps'}
              </button>
            ))}
          </div>

          {/* App launcher */}
          {mode === 'app' && (
            <div className="shrink-0 px-4 py-3 border-b border-henry-border/20">
              <input
                type="text"
                value={appFilter}
                onChange={(e) => setAppFilter(e.target.value)}
                placeholder="Filter apps..."
                className="w-full bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50 mb-3"
              />
              <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto">
                {filteredApps.map((app) => (
                  <button
                    key={app}
                    onClick={() => openApp(app)}
                    disabled={running}
                    className="text-xs px-2 py-1.5 rounded-lg bg-henry-surface border border-henry-border/30 hover:border-henry-accent/50 hover:bg-henry-accent/5 text-henry-text-dim hover:text-henry-text transition-all text-left truncate disabled:opacity-50"
                  >
                    {app}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Action log */}
          <div
            ref={logRef}
            className="flex-1 overflow-y-auto px-4 py-3 font-mono text-xs space-y-1"
          >
            {log.map((entry) => (
              <div key={entry.id}>
                <LogLine entry={entry} />
              </div>
            ))}
            {running && (
              <div className="text-henry-accent animate-pulse">▋ running...</div>
            )}
          </div>

          {/* Input */}
          {mode !== 'app' && (
            <div className="shrink-0 p-4 border-t border-henry-border/30">
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={running}
                  placeholder={
                    mode === 'shell'
                      ? 'Enter shell command... (↑↓ for history)'
                      : 'Enter AppleScript... (e.g. tell application "Safari" to activate)'
                  }
                  className="flex-1 bg-henry-bg border border-henry-border rounded-xl px-4 py-2.5 text-sm text-henry-text font-mono outline-none focus:border-henry-accent/50 disabled:opacity-50"
                />
                <button
                  onClick={executeCommand}
                  disabled={running || !input.trim()}
                  className="px-4 py-2.5 bg-henry-accent text-white rounded-xl text-sm font-medium hover:bg-henry-accent-hover transition-all disabled:opacity-50"
                >
                  Run
                </button>
              </div>
              <p className="text-[10px] text-henry-text-muted mt-1.5 px-1">
                {mode === 'shell'
                  ? 'Shell commands execute in your henry-workspace. Use absolute paths for other locations.'
                  : 'AppleScript requires Accessibility permission in System Settings.'}
              </p>
            </div>
          )}
        </div>

        {/* Right: screenshot */}
        {screenshot && (
          <div className="w-80 shrink-0 border-l border-henry-border/50 flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-henry-border/30 text-xs text-henry-text-muted">
              <span>Screenshot</span>
              <button
                onClick={() => setScreenshot(null)}
                className="hover:text-henry-text transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto p-2">
              <img
                src={screenshot}
                alt="Screenshot"
                className="w-full rounded border border-henry-border/30"
              />
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

      {/* Desktop app CTA (web only) */}
      {!isDesktop && (
        <div className="shrink-0 mx-4 mb-4 p-4 rounded-xl bg-henry-accent/5 border border-henry-accent/20">
          <p className="text-sm font-medium text-henry-text mb-1">Full computer control requires the desktop app</p>
          <p className="text-xs text-henry-text-dim leading-relaxed">
            The Henry desktop app (built with Electron) gives Henry real ability to open apps, control your mouse and
            keyboard, take screenshots, and execute shell commands — all with your approval before each action.
            Build it with <code className="text-henry-accent">npm run build:mac</code>.
          </p>
        </div>
      )}
    </div>
  );
}

function PermBadge({
  label,
  granted,
  instructions,
}: {
  label: string;
  granted: boolean;
  instructions?: string | null;
}) {
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => !granted && setShowHelp(!showHelp)}
        className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium transition-all ${
          granted
            ? 'bg-henry-success/15 text-henry-success'
            : 'bg-henry-error/15 text-henry-error hover:bg-henry-error/20 cursor-pointer'
        }`}
      >
        {granted ? '✓' : '✕'} {label}
        {!granted && instructions && <span className="opacity-60">?</span>}
      </button>
      {showHelp && instructions && (
        <div className="absolute top-7 left-0 z-10 w-72 p-3 rounded-xl bg-henry-surface border border-henry-border shadow-xl text-xs text-henry-text-dim leading-relaxed">
          {instructions}
          <button
            onClick={() => setShowHelp(false)}
            className="block mt-2 text-henry-accent hover:underline"
          >
            Got it
          </button>
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
