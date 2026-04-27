import { useState, useRef, useEffect } from 'react';
import { useStore } from '../../store';
import { runComputerAgent, type ComputerStep } from '../../henry/computerAgent';

export default function ComputerPanel() {
  const { providers, settings } = useStore();

  const groq = providers.find(p => p.id === 'groq');
  const openai = providers.find(p => p.id === 'openai');
  const activeProvider = (groq?.apiKey ? groq : openai) ?? null;

  const [command, setCommand] = useState('');
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<ComputerStep[]>([]);
  const [perms, setPerms] = useState<{ accessibility: boolean; screenRecording: boolean } | null>(null);
  const stepsEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    // Check permissions via sync server
    fetch('http://127.0.0.1:4242/computer/shell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Henry-Internal': 'true' },
      body: JSON.stringify({ command: 'osascript -e \'tell application "System Events" to return name of first process whose frontmost is true\' 2>/dev/null && echo ACC_OK || echo ACC_FAIL' }),
    })
      .then(r => r.json())
      .then((r: any) => {
        const acc = r.output?.includes('ACC_OK') ?? false;
        return fetch('http://127.0.0.1:4242/computer/shell', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Henry-Internal': 'true' },
          body: JSON.stringify({ command: 'screencapture -x /tmp/henry_perm_check.png 2>/dev/null && echo SC_OK || echo SC_FAIL' }),
        }).then(r2 => r2.json()).then((r2: any) => {
          setPerms({ accessibility: acc, screenRecording: r2.output?.includes('SC_OK') ?? false });
        });
      })
      .catch(() => setPerms(null));
  }, []);

  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [steps]);

  function openSystemSettings() {
    fetch('http://127.0.0.1:4242/computer/shell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Henry-Internal': 'true' },
      body: JSON.stringify({ command: 'open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"' }),
    });
    setTimeout(() => {
      fetch('http://127.0.0.1:4242/computer/shell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Henry-Internal': 'true' },
        body: JSON.stringify({ command: 'open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"' }),
      });
    }, 1500);
  }

  async function run() {
    if (!command.trim() || running || !activeProvider?.apiKey) return;
    setRunning(true);
    setSteps([]);
    const cmd = command.trim();
    setCommand('');

    await runComputerAgent({
      userRequest: cmd,
      provider: activeProvider.id,
      model: settings.companion_model || 'llama-3.3-70b-versatile',
      apiKey: activeProvider.apiKey,
      onStep: (step) => setSteps(prev => [...prev, step]),
      onDone: (summary) => {
        setSteps(prev => [...prev, { type: 'done', label: 'Done', detail: summary }]);
        setRunning(false);
      },
      onError: (err) => {
        setSteps(prev => [...prev, { type: 'result', label: '✗ Error', detail: err }]);
        setRunning(false);
      },
    });
  }

  const hasKey = !!activeProvider?.apiKey;
  const needsPerms = perms && (!perms.accessibility || !perms.screenRecording);

  return (
    <div className="h-full flex flex-col bg-henry-bg">

      {/* Header */}
      <div className="px-5 pt-5 pb-3 border-b border-henry-border/20 shrink-0">
        <h2 className="text-base font-semibold text-henry-text">Computer Control</h2>
        <p className="text-xs text-henry-text-muted mt-0.5">Henry executes real actions on your Mac</p>

        {/* Permission badges */}
        {perms && (
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
              perms.accessibility
                ? 'border-green-500/30 bg-green-500/8 text-green-400'
                : 'border-red-500/30 bg-red-500/8 text-red-400'
            }`}>
              {perms.accessibility ? '✓' : '✗'} Accessibility
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${
              perms.screenRecording
                ? 'border-green-500/30 bg-green-500/8 text-green-400'
                : 'border-red-500/30 bg-red-500/8 text-red-400'
            }`}>
              {perms.screenRecording ? '✓' : '✗'} Screen Recording
            </span>
            {needsPerms && (
              <button
                onClick={openSystemSettings}
                className="text-[10px] px-2 py-0.5 rounded-full border border-henry-accent/30 bg-henry-accent/8 text-henry-accent font-medium hover:bg-henry-accent/15 transition-all"
              >
                Fix permissions →
              </button>
            )}
          </div>
        )}
      </div>

      {/* Permission prompt if missing */}
      {needsPerms && (
        <div className="mx-5 mt-4 p-4 rounded-xl border border-henry-accent/20 bg-henry-accent/5 shrink-0">
          <p className="text-sm font-medium text-henry-text mb-1">Permissions needed</p>
          <p className="text-xs text-henry-text-muted mb-3 leading-relaxed">
            Henry needs Accessibility{!perms?.screenRecording ? ' and Screen Recording' : ''} to control your Mac.
            Click below — System Settings will open to the exact page.
          </p>
          <ol className="text-xs text-henry-text-muted space-y-1 mb-3">
            <li>1. Click "Open System Settings" below</li>
            {!perms?.accessibility && <li>2. Find <strong className="text-henry-text">Accessibility</strong> → find Henry AI → toggle ON</li>}
            {!perms?.screenRecording && <li>{!perms?.accessibility ? '3.' : '2.'} Find <strong className="text-henry-text">Screen Recording</strong> → find Henry AI → toggle ON</li>}
            <li>{(!perms?.accessibility && !perms?.screenRecording) ? '4.' : !perms?.accessibility || !perms?.screenRecording ? '3.' : '2.'} Restart Henry</li>
          </ol>
          <button
            onClick={openSystemSettings}
            className="w-full py-2.5 rounded-xl bg-henry-accent text-henry-bg font-semibold text-sm hover:bg-henry-accent/90 transition-all"
          >
            Open System Settings
          </button>
        </div>
      )}

      {/* Steps log */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2 min-h-0">
        {steps.length === 0 && !running && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-4xl mb-3">⌘</div>
            <p className="text-sm font-medium text-henry-text mb-1">Tell Henry what to do</p>
            <p className="text-xs text-henry-text-muted max-w-xs leading-relaxed">
              Type any command in plain English. Henry executes real shell commands on your Mac.
            </p>
            <div className="mt-4 space-y-1.5">
              {[
                'Create a folder called henrystuff on my desktop',
                'Open Safari and go to google.com',
                'What apps are currently running?',
                'Take a screenshot and show me',
                'Open my Desktop folder in Finder',
              ].map(ex => (
                <button
                  key={ex}
                  onClick={() => { setCommand(ex); inputRef.current?.focus(); }}
                  className="block text-left text-[11px] text-henry-accent hover:underline px-2 w-full"
                >
                  "{ex}"
                </button>
              ))}
            </div>
          </div>
        )}

        {steps.map((step, i) => (
          <div key={i} className="flex gap-2.5 items-start">
            <span className="text-sm shrink-0 mt-0.5">
              {step.type === 'thinking' ? '◎' :
               step.type === 'action'   ? '⊕' :
               step.type === 'result'   ? (step.label.startsWith('✓') ? '✓' : '✗') :
               step.type === 'done'     ? '✦' : '◉'}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-henry-text">{step.label}</p>
              {step.detail && (
                <p className="text-[11px] text-henry-text-muted mt-0.5 leading-snug whitespace-pre-wrap break-words">
                  {step.detail}
                </p>
              )}
              {step.screenshotUrl && (
                <img
                  src={step.screenshotUrl}
                  alt="Screenshot"
                  className="mt-2 rounded-lg border border-henry-border/30 max-w-full cursor-pointer hover:opacity-90"
                  onClick={() => window.open(step.screenshotUrl)}
                />
              )}
            </div>
          </div>
        ))}

        {running && (
          <div className="flex gap-2.5 items-center">
            <span className="w-4 h-4 border-2 border-henry-accent/30 border-t-henry-accent rounded-full animate-spin shrink-0" />
            <p className="text-[12px] text-henry-text-muted">Henry is working…</p>
          </div>
        )}

        <div ref={stepsEndRef} />
      </div>

      {/* Input */}
      <div className="px-5 py-4 border-t border-henry-border/20 shrink-0">
        {!hasKey && (
          <p className="text-xs text-henry-error mb-2">
            Groq or OpenAI key required.{' '}
            <button
              onClick={() => useStore.getState().setCurrentView('settings' as any)}
              className="underline"
            >Settings →</button>
          </p>
        )}
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={command}
            onChange={e => setCommand(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') run(); }}
            placeholder="Tell Henry what to do on your Mac…"
            disabled={running || !hasKey}
            className="flex-1 bg-henry-surface/50 border border-henry-border/30 rounded-xl px-4 py-3 text-sm text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/40 transition-all disabled:opacity-40"
          />
          <button
            onClick={run}
            disabled={!command.trim() || running || !hasKey}
            className="px-5 py-3 rounded-xl bg-henry-accent text-henry-bg font-semibold text-sm hover:bg-henry-accent/90 disabled:opacity-40 transition-all shrink-0"
          >
            {running ? '…' : 'Go'}
          </button>
        </div>
        <p className="text-[10px] text-henry-text-muted mt-1.5">
          Enter to send · Henry uses real shell commands · screenshots verify results
        </p>
      </div>

    </div>
  );
}
