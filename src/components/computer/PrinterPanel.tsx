import { useState, useEffect, useRef } from 'react';

interface PrinterPort {
  device: string;
  description: string;
  hwid: string;
}

interface PrinterLog {
  id: string;
  type: 'sent' | 'response' | 'error' | 'info' | 'disconnected';
  data: string;
  timestamp: number;
}

const GCODE_PRESETS = [
  { label: 'Get Info', code: 'M115' },
  { label: 'Temperature', code: 'M105' },
  { label: 'Home All', code: 'G28' },
  { label: 'Preheat PLA', code: 'M104 S210\nM140 S60' },
  { label: 'Preheat PETG', code: 'M104 S235\nM140 S75' },
  { label: 'Cool Down', code: 'M104 S0\nM140 S0\nM106 S0' },
  { label: 'Bed Level', code: 'G29' },
  { label: 'Emergency Stop', code: 'M112' },
  { label: 'Motors Off', code: 'M18' },
  { label: 'Fan Full', code: 'M106 S255' },
];

export default function PrinterPanel() {
  const [ports, setPorts] = useState<PrinterPort[]>([]);
  const [selectedPort, setSelectedPort] = useState('');
  const [baudRate, setBaudRate] = useState(115200);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [depsOk, setDepsOk] = useState<boolean | null>(null);
  const [depsInstall, setDepsInstall] = useState('pip3 install pyserial');
  const [log, setLog] = useState<PrinterLog[]>([]);
  const [gcodeInput, setGcodeInput] = useState('');
  const [sending, setSending] = useState(false);
  const [multilineMode, setMultilineMode] = useState(false);
  const [printGcode, setPrintGcode] = useState('');
  const [printing, setPrinting] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    checkDeps();
    setupListener();
    return () => {};
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [log]);

  function addLog(type: PrinterLog['type'], data: string) {
    setLog((prev) => [...prev, { id: crypto.randomUUID(), type, data, timestamp: Date.now() }]);
  }

  function setupListener() {
    const unsub = window.henryAPI.onPrinterData((data: any) => {
      if (data.type === 'disconnected') {
        setConnected(false);
        addLog('disconnected', 'Printer disconnected.');
      } else if (data.type === 'response') {
        addLog('response', data.data || '');
      } else if (data.type === 'sent') {
        addLog('sent', `→ ${data.data}`);
      } else if (data.type === 'error') {
        addLog('error', data.data || 'Unknown error');
      }
    });
    return unsub;
  }

  async function checkDeps() {
    try {
      const result = await window.henryAPI.printerCheckDeps();
      setDepsOk(result.available);
      if (!result.available && result.installCommand) setDepsInstall(result.installCommand);
      if (result.available) {
        loadPorts();
        addLog('info', `pyserial ${result.version} ready.`);
      } else {
        addLog('info', `Install pyserial to connect to printers: ${result.installCommand}`);
      }
    } catch {
      setDepsOk(false);
    }
  }

  async function loadPorts() {
    try {
      const result = await window.henryAPI.printerListPorts();
      if (result.ports) {
        setPorts(result.ports);
        if (result.ports.length > 0) setSelectedPort(result.ports[0].device);
        if (result.ports.length === 0) addLog('info', 'No serial ports found. Connect your printer via USB.');
        else addLog('info', `Found ${result.ports.length} port${result.ports.length !== 1 ? 's' : ''}.`);
      }
    } catch (e: any) {
      addLog('error', e.message);
    }
  }

  async function connect() {
    if (!selectedPort) return;
    setConnecting(true);
    addLog('info', `Connecting to ${selectedPort} @ ${baudRate}...`);
    try {
      const result = await window.henryAPI.printerConnect({ port: selectedPort, baudRate });
      if (result.success) {
        setConnected(true);
        addLog('info', `Connected to ${result.port} @ ${result.baudRate} baud.`);
        // Query printer info
        await sendGcode('M115');
        await sendGcode('M105');
      } else {
        addLog('error', result.error || 'Connection failed.');
      }
    } catch (e: any) {
      addLog('error', e.message);
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    try {
      await window.henryAPI.printerDisconnect();
      setConnected(false);
      addLog('info', 'Disconnected.');
    } catch (e: any) {
      addLog('error', e.message);
    }
  }

  async function sendGcode(cmd?: string) {
    const command = (cmd ?? gcodeInput).trim();
    if (!command || sending) return;
    if (!cmd) setGcodeInput('');
    setSending(true);
    try {
      const lines = command.split('\n').filter(Boolean);
      for (const line of lines) {
        const result = await window.henryAPI.printerSendGcode(line);
        if (!result.success) {
          addLog('error', result.error || 'Send failed.');
        }
      }
    } catch (e: any) {
      addLog('error', e.message);
    } finally {
      setSending(false);
    }
  }

  async function startPrint() {
    if (!printGcode.trim()) return;
    setPrinting(true);
    addLog('info', 'Starting print job...');
    try {
      const result = await window.henryAPI.printerPrintGcode(printGcode);
      if (result.success) {
        addLog('info', `Print job sent: ${result.sent}/${result.total} commands.`);
      } else {
        addLog('error', result.error || 'Print failed.');
      }
    } catch (e: any) {
      addLog('error', e.message);
    } finally {
      setPrinting(false);
    }
  }

  const isDesktop = depsOk !== null;

  return (
    <div className="h-full flex flex-col bg-henry-bg text-henry-text overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-henry-border/50 bg-henry-surface/30">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              🖨️ 3D Printer
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-normal ${
                connected
                  ? 'bg-henry-success/15 text-henry-success'
                  : 'bg-henry-hover text-henry-text-muted'
              }`}>
                {connected ? '● Connected' : '○ Disconnected'}
              </span>
            </h2>
            <p className="text-xs text-henry-text-muted mt-0.5">
              USB serial communication · Marlin · Klipper · Prusa · Bambu
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadPorts}
              disabled={connecting || connected}
              className="px-3 py-1.5 text-xs rounded-lg bg-henry-surface border border-henry-border/50 hover:border-henry-accent/50 text-henry-text-dim hover:text-henry-text transition-all disabled:opacity-50"
            >
              🔄 Scan Ports
            </button>
          </div>
        </div>
      </div>

      {/* Deps warning */}
      {depsOk === false && (
        <div className="mx-4 mt-4 p-4 rounded-xl bg-henry-warning/5 border border-henry-warning/20">
          <p className="text-sm font-medium text-henry-warning mb-1">pyserial not found</p>
          <p className="text-xs text-henry-text-dim mb-2">
            Henry uses Python's pyserial to talk to your printer over USB. Install it with:
          </p>
          <code className="text-xs text-henry-accent bg-henry-bg px-2 py-1 rounded block">
            {depsInstall}
          </code>
          <button
            onClick={checkDeps}
            className="mt-3 text-xs text-henry-accent hover:underline"
          >
            Check again after installing →
          </button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Left: connection + G-code terminal */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Connection bar */}
          <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-henry-border/30">
            <select
              value={selectedPort}
              onChange={(e) => setSelectedPort(e.target.value)}
              disabled={connected || connecting}
              className="flex-1 bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50 disabled:opacity-50"
            >
              {ports.length === 0 && <option value="">No ports found</option>}
              {ports.map((p) => (
                <option key={p.device} value={p.device}>
                  {p.device} — {p.description || 'Serial Device'}
                </option>
              ))}
            </select>

            <select
              value={baudRate}
              onChange={(e) => setBaudRate(Number(e.target.value))}
              disabled={connected || connecting}
              className="bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-sm text-henry-text outline-none focus:border-henry-accent/50 disabled:opacity-50"
            >
              {[9600, 19200, 38400, 57600, 115200, 250000].map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>

            {!connected ? (
              <button
                onClick={connect}
                disabled={!selectedPort || connecting || depsOk === false}
                className="px-4 py-2 bg-henry-accent text-white rounded-lg text-sm font-medium hover:bg-henry-accent-hover transition-all disabled:opacity-50 whitespace-nowrap"
              >
                {connecting ? 'Connecting...' : 'Connect'}
              </button>
            ) : (
              <button
                onClick={disconnect}
                className="px-4 py-2 bg-henry-error/80 text-white rounded-lg text-sm font-medium hover:bg-henry-error transition-all whitespace-nowrap"
              >
                Disconnect
              </button>
            )}
          </div>

          {/* G-code presets */}
          {connected && (
            <div className="shrink-0 flex flex-wrap gap-1.5 px-4 pt-3 pb-2">
              {GCODE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => sendGcode(preset.code)}
                  disabled={sending}
                  className={`px-2.5 py-1 text-[11px] rounded-lg transition-all disabled:opacity-50 ${
                    preset.label === 'Emergency Stop'
                      ? 'bg-henry-error/15 text-henry-error border border-henry-error/30 hover:bg-henry-error/25 font-semibold'
                      : 'bg-henry-surface border border-henry-border/50 text-henry-text-dim hover:border-henry-accent/50 hover:text-henry-text'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}

          {/* Response log */}
          <div
            ref={logRef}
            className="flex-1 overflow-y-auto px-4 py-3 font-mono text-xs space-y-0.5"
          >
            {log.map((entry) => (
              <div key={entry.id} className={`leading-relaxed ${
                entry.type === 'sent' ? 'text-henry-accent' :
                entry.type === 'response' ? 'text-henry-success' :
                entry.type === 'error' ? 'text-henry-error' :
                entry.type === 'disconnected' ? 'text-henry-warning' :
                'text-henry-text-muted'
              }`}>
                {entry.data}
              </div>
            ))}
            {(sending || printing) && (
              <div className="text-henry-accent animate-pulse">▋</div>
            )}
          </div>

          {/* G-code input */}
          <div className="shrink-0 p-4 border-t border-henry-border/30">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-henry-text-muted">Input mode:</span>
              <button
                onClick={() => setMultilineMode(false)}
                className={`text-xs px-2 py-0.5 rounded ${!multilineMode ? 'bg-henry-accent text-white' : 'text-henry-text-muted hover:text-henry-text'}`}
              >
                Single
              </button>
              <button
                onClick={() => setMultilineMode(true)}
                className={`text-xs px-2 py-0.5 rounded ${multilineMode ? 'bg-henry-accent text-white' : 'text-henry-text-muted hover:text-henry-text'}`}
              >
                Multi-line
              </button>
            </div>

            {!multilineMode ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={gcodeInput}
                  onChange={(e) => setGcodeInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendGcode()}
                  disabled={!connected || sending}
                  placeholder="G-code command (e.g. G28, M105)"
                  className="flex-1 bg-henry-bg border border-henry-border rounded-xl px-4 py-2.5 text-sm text-henry-text font-mono outline-none focus:border-henry-accent/50 disabled:opacity-50"
                />
                <button
                  onClick={() => sendGcode()}
                  disabled={!connected || sending || !gcodeInput.trim()}
                  className="px-4 py-2.5 bg-henry-accent text-white rounded-xl text-sm font-medium hover:bg-henry-accent-hover transition-all disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            ) : (
              <div>
                <textarea
                  value={gcodeInput}
                  onChange={(e) => setGcodeInput(e.target.value)}
                  disabled={!connected || sending}
                  placeholder="Paste multiple G-code lines here..."
                  rows={4}
                  className="w-full bg-henry-bg border border-henry-border rounded-xl px-4 py-2.5 text-sm text-henry-text font-mono outline-none focus:border-henry-accent/50 disabled:opacity-50 resize-none mb-2"
                />
                <button
                  onClick={() => sendGcode()}
                  disabled={!connected || sending || !gcodeInput.trim()}
                  className="px-4 py-2.5 bg-henry-accent text-white rounded-xl text-sm font-medium hover:bg-henry-accent-hover transition-all disabled:opacity-50"
                >
                  {sending ? 'Sending...' : 'Send All'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right: print job panel */}
        <div className="w-72 shrink-0 border-l border-henry-border/50 flex flex-col">
          <div className="px-4 py-3 border-b border-henry-border/30">
            <h3 className="text-sm font-medium text-henry-text">Print Job</h3>
            <p className="text-xs text-henry-text-muted">Paste full G-code for a print job</p>
          </div>
          <div className="flex-1 p-4 flex flex-col gap-3">
            <textarea
              value={printGcode}
              onChange={(e) => setPrintGcode(e.target.value)}
              disabled={printing}
              placeholder={`; Paste your G-code here\nG28 ; Home\nG29 ; Auto-level\nM104 S210 ; Set hotend temp\n...`}
              className="flex-1 min-h-0 bg-henry-bg border border-henry-border rounded-xl px-3 py-2.5 text-xs text-henry-text font-mono outline-none focus:border-henry-accent/50 resize-none disabled:opacity-50"
            />
            <div className="space-y-2">
              <button
                onClick={startPrint}
                disabled={!connected || printing || !printGcode.trim()}
                className="w-full py-2.5 bg-henry-success/80 text-white rounded-xl text-sm font-medium hover:bg-henry-success transition-all disabled:opacity-50"
              >
                {printing ? 'Printing...' : '▶ Start Print'}
              </button>
              <button
                onClick={() => sendGcode('M112')}
                disabled={!connected}
                className="w-full py-2 bg-henry-error/15 text-henry-error border border-henry-error/30 rounded-xl text-xs font-semibold hover:bg-henry-error/25 transition-all disabled:opacity-50"
              >
                ■ Emergency Stop (M112)
              </button>
            </div>
          </div>

          {/* Quick reference */}
          <div className="px-4 pb-4">
            <details className="text-xs text-henry-text-muted">
              <summary className="cursor-pointer hover:text-henry-text mb-2">G-code reference ▾</summary>
              <div className="space-y-1 font-mono bg-henry-bg rounded-lg p-2 border border-henry-border/30 text-[10px] leading-relaxed">
                <div><span className="text-henry-accent">G28</span> — Home all axes</div>
                <div><span className="text-henry-accent">G29</span> — Auto bed leveling</div>
                <div><span className="text-henry-accent">M104 S210</span> — Hotend temp</div>
                <div><span className="text-henry-accent">M140 S60</span> — Bed temp</div>
                <div><span className="text-henry-accent">M105</span> — Get temps</div>
                <div><span className="text-henry-accent">M106 S255</span> — Fan 100%</div>
                <div><span className="text-henry-accent">M18</span> — Disable motors</div>
                <div><span className="text-henry-accent">M112</span> — Emergency stop</div>
              </div>
            </details>
          </div>
        </div>
      </div>

      {/* Desktop app CTA (web only) */}
      {depsOk === false && (
        <div className="shrink-0 mx-4 mb-4 p-4 rounded-xl bg-henry-surface border border-henry-border/30">
          <p className="text-xs text-henry-text-dim leading-relaxed">
            <span className="text-henry-text font-medium">Running the desktop app?</span> Make sure pyserial is installed, then connect your printer via USB and it will show up here automatically.
          </p>
        </div>
      )}
    </div>
  );
}
