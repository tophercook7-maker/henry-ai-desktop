import { useState, useRef, useEffect } from 'react';

interface OutputLine {
  id: string;
  type: 'stdin' | 'stdout' | 'stderr' | 'info';
  text: string;
  timestamp: number;
}

export default function TerminalView() {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [running, setRunning] = useState(false);
  const [currentExecId, setCurrentExecId] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Welcome message
    addLine('info', '🧠 Henry AI Terminal — execute commands in your workspace');
    addLine('info', 'Type a command and press Enter. Use ↑/↓ for history.\n');
  }, []);

  useEffect(() => {
    outputRef.current?.scrollTo(0, outputRef.current.scrollHeight);
  }, [output]);

  function addLine(type: OutputLine['type'], text: string) {
    setOutput((prev) => [
      ...prev,
      { id: crypto.randomUUID(), type, text, timestamp: Date.now() },
    ]);
  }

  async function executeCommand(cmd: string) {
    if (!cmd.trim()) return;

    // Add to history
    setHistory((prev) => [cmd, ...prev.slice(0, 50)]);
    setHistoryIndex(-1);

    // Show command in output
    addLine('stdin', `$ ${cmd}`);
    setInput('');
    setRunning(true);

    try {
      const result = await window.henryAPI.execTerminal({
        command: cmd,
        timeout: 30000,
      });

      if (result.stdout) {
        addLine('stdout', result.stdout);
      }
      if (result.stderr) {
        addLine('stderr', result.stderr);
      }
      if (!result.success) {
        addLine('info', `Exit code: ${result.exitCode}`);
      }
    } catch (err: any) {
      addLine('stderr', `Error: ${err.message}`);
    } finally {
      setRunning(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !running) {
      executeCommand(input);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const newIndex = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(newIndex);
      if (history[newIndex]) setInput(history[newIndex]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const newIndex = Math.max(historyIndex - 1, -1);
      setHistoryIndex(newIndex);
      setInput(newIndex >= 0 ? history[newIndex] : '');
    } else if (e.key === 'c' && e.ctrlKey && running) {
      // Cancel running command
      if (currentExecId) {
        window.henryAPI.killTerminal(currentExecId);
      }
    }
  }

  return (
    <div className="h-full flex flex-col bg-[#0d0d14]">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 bg-henry-surface/30 border-b border-henry-border/30">
        <div className="flex items-center gap-2">
          <span className="text-sm">💻</span>
          <span className="text-xs font-medium text-henry-text">Terminal</span>
        </div>
        <button
          onClick={() => setOutput([])}
          className="text-[10px] text-henry-text-muted hover:text-henry-text transition-colors"
        >
          Clear
        </button>
      </div>

      {/* Output */}
      <div
        ref={outputRef}
        className="flex-1 overflow-y-auto p-4 font-mono text-xs leading-relaxed"
        onClick={() => inputRef.current?.focus()}
      >
        {output.map((line) => (
          <div
            key={line.id}
            className={`whitespace-pre-wrap ${
              line.type === 'stdin'
                ? 'text-henry-accent font-medium'
                : line.type === 'stderr'
                ? 'text-henry-error/80'
                : line.type === 'info'
                ? 'text-henry-text-muted italic'
                : 'text-henry-text/90'
            }`}
          >
            {line.text}
          </div>
        ))}

        {running && (
          <div className="text-henry-text-muted animate-pulse">Running...</div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-henry-border/20 bg-henry-surface/10">
        <span className="text-henry-accent font-mono text-xs font-bold">$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={running}
          placeholder={running ? 'Running...' : 'Enter command...'}
          className="flex-1 bg-transparent text-henry-text font-mono text-xs outline-none placeholder:text-henry-text-muted/50"
          autoFocus
        />
        {running && (
          <button
            onClick={() => currentExecId && window.henryAPI.killTerminal(currentExecId)}
            className="text-[10px] text-henry-error hover:text-henry-error/80 transition-colors"
          >
            Ctrl+C
          </button>
        )}
      </div>
    </div>
  );
}
