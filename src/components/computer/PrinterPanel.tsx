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

const QUICK_ACTIONS = [
  { label: 'Check temps', code: 'M105', icon: '🌡️' },
  { label: 'Home printer', code: 'G28', icon: '🏠' },
  { label: 'Preheat PLA', code: 'M104 S210\nM140 S60', icon: '🔥' },
  { label: 'Preheat PETG', code: 'M104 S235\nM140 S75', icon: '🔥' },
  { label: 'Cool down', code: 'M104 S0\nM140 S0\nM106 S0', icon: '❄️' },
  { label: 'Level bed', code: 'G29', icon: '⬛' },
  { label: 'Motors off', code: 'M18', icon: '⏹️' },
  { label: 'Fan full', code: 'M106 S255', icon: '💨' },
];

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function PrinterPanel() {
  const [ports, setPorts] = useState<PrinterPort[]>([]);
  const [selectedPort, setSelectedPort] = useState('');
  const [baudRate, setBaudRate] = useState(115200);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [depsOk, setDepsOk] = useState<boolean | null>(null);
  const [depsInstall, setDepsInstall] = useState('pip3 install pyserial');
  const [log, setLog] = useState<PrinterLog[]>([]);
  const [gcodeInput, setGcodeInput] = useState('');
  const [sending, setSending] = useState(false);
  const [printGcode, setPrintGcode] = useState('');
  const [printing, setPrinting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPrintJob, setShowPrintJob] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    checkDeps();
    setupListener();
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [log]);

  function addLog(type: PrinterLog['type'], data: string) {
    setLog((prev) => [...prev, { id: crypto.randomUUID(), type, data, timestamp: Date.now() }]);
  }

  function setupListener() {
    window.henryAPI.onPrinterData((data: any) => {
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
  }

  async function checkDeps() {
    try {
      const result = await window.henryAPI.printerCheckDeps();
      setDepsOk(result.available);
      if (!result.available && result.installCommand) setDepsInstall(result.installCommand);
      if (result.available) scanForPrinters();
    } catch {
      setDepsOk(false);
    }
  }

  async function scanForPrinters() {
    setScanning(true);
    try {
      const result = await window.henryAPI.printerListPorts();
      if (result.ports) {
        setPorts(result.ports);
        if (result.ports.length === 1) {
          setSelectedPort(result.ports[0].device);
        } else if (result.ports.length > 1) {
          setSelectedPort(result.ports[0].device);
        }
        addLog('info', result.ports.length === 0
          ? 'No printers found. Make sure your printer is plugged in via USB, then scan again.'
          : `Found ${result.ports.length} printer${result.ports.length !== 1 ? 's' : ''}. Ready to connect.`
        );
      }
    } catch (e: any) {
      addLog('error', e.message);
    } finally {
      setScanning(false);
    }
  }

  async function connectToPrinter(port?: string) {
    const targetPort = port || selectedPort;
    if (!targetPort) return;
    setSelectedPort(targetPort);
    setConnecting(true);
    addLog('info', `Connecting to printer…`);
    try {
      const result = await window.henryAPI.printerConnect({ port: targetPort, baudRate });
      if (result.success) {
        setConnected(true);
        addLog('info', `Connected! Checking printer status…`);
        await sendGcode('M115');
        await sendGcode('M105');
      } else {
        addLog('error', result.error || 'Connection failed. Try unplugging and replugging the USB cable.');
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
        if (!result.success) addLog('error', result.error || 'Send failed.');
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
    addLog('info', 'Starting print job…');
    try {
      const result = await window.henryAPI.printerPrintGcode(printGcode);
      if (result.success) {
        addLog('info', `Print job started — ${result.sent}/${result.total} commands sent.`);
      } else {
        addLog('error', result.error || 'Print failed.');
      }
    } catch (e: any) {
      addLog('error', e.message);
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div className="h-full flex flex-col bg-henry-bg text-henry-text overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-henry-border/40 bg-henry-surface/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-2xl">🖨️</div>
            <div>
              <h2 className="text-base font-semibold text-henry-text">3D Printer</h2>
              <p className="text-xs text-henry-text-muted">
                {connected ? 'Connected and ready' : 'Not connected'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {connected && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-henry-success bg-henry-success/10 border border-henry-success/20 px-3 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-henry-success animate-pulse" />
                Connected
              </span>
            )}
            {connected && (
              <button
                onClick={disconnect}
                className="px-3 py-1.5 text-xs rounded-lg bg-henry-error/10 border border-henry-error/30 text-henry-error hover:bg-henry-error/20 transition-colors"
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Deps warning */}
      {depsOk === false && (
        <div className="mx-4 mt-4 p-4 rounded-xl bg-henry-warning/5 border border-henry-warning/20">
          <p className="text-sm font-medium text-henry-warning mb-1">One-time setup needed</p>
          <p className="text-xs text-henry-text-dim mb-2">
            Run this in your terminal to enable printer communication:
          </p>
          <code className="text-xs text-henry-accent bg-henry-bg px-2 py-1 rounded block mb-3">{depsInstall}</code>
          <button onClick={checkDeps} className="text-xs text-henry-accent hover:underline">
            Done — check again →
          </button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Not connected: discovery screen */}
          {!connected && depsOk !== false && (
            <div className="flex-1 overflow-y-auto">
              <div className="p-6 max-w-lg mx-auto space-y-5">
                {/* Scan / find printer */}
                {ports.length === 0 ? (
                  <div className="text-center py-8 space-y-4">
                    <div className="text-4xl">🔌</div>
                    <div>
                      <p className="text-sm font-medium text-henry-text mb-1">Plug in your printer via USB</p>
                      <p className="text-xs text-henry-text-muted">Works with Marlin, Klipper, Prusa, Bambu, and most USB printers.</p>
                    </div>
                    <button
                      onClick={scanForPrinters}
                      disabled={scanning}
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-henry-accent text-white rounded-xl text-sm font-semibold hover:bg-henry-accent/90 transition-colors disabled:opacity-50"
                    >
                      {scanning ? (
                        <>
                          <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                          Scanning…
                        </>
                      ) : 'Find my printer'}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wider text-henry-text-muted">
                        {ports.length === 1 ? 'Printer found' : `${ports.length} printers found`}
                      </p>
                      <button
                        onClick={scanForPrinters}
                        disabled={scanning}
                        className="text-xs text-henry-accent hover:underline"
                      >
                        {scanning ? 'Scanning…' : 'Scan again'}
                      </button>
                    </div>

                    <div className="space-y-2">
                      {ports.map((port) => (
                        <div
                          key={port.device}
                          className={`flex items-center gap-3 p-4 rounded-xl border transition-all ${
                            selectedPort === port.device
                              ? 'bg-henry-accent/5 border-henry-accent/30'
                              : 'bg-henry-surface/30 border-henry-border/30'
                          }`}
                        >
                          <div className="w-9 h-9 rounded-lg bg-henry-surface/60 flex items-center justify-center text-lg shrink-0">🖨️</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-henry-text truncate">
                              {port.description || 'USB Serial Device'}
                            </p>
                            <p className="text-xs text-henry-text-muted">{port.device}</p>
                          </div>
                          <button
                            onClick={() => connectToPrinter(port.device)}
                            disabled={connecting}
                            className="shrink-0 px-4 py-2 bg-henry-accent text-white rounded-lg text-xs font-semibold hover:bg-henry-accent/90 transition-colors disabled:opacity-50"
                          >
                            {connecting && selectedPort === port.device ? 'Connecting…' : 'Connect'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* Advanced settings */}
                <div>
                  <button
                    onClick={() => setShowAdvanced((v) => !v)}
                    className="flex items-center gap-1.5 text-xs text-henry-text-muted hover:text-henry-text transition-colors"
                  >
                    <svg className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                    Advanced settings
                  </button>

                  {showAdvanced && (
                    <div className="mt-3 pl-4 border-l border-henry-border/30 space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-henry-text-dim mb-1">Port</label>
                        <select
                          value={selectedPort}
                          onChange={(e) => setSelectedPort(e.target.value)}
                          disabled={connecting}
                          className="w-full bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-xs text-henry-text outline-none focus:border-henry-accent/50"
                        >
                          {ports.length === 0 && <option value="">No ports found</option>}
                          {ports.map((p) => (
                            <option key={p.device} value={p.device}>{p.device} — {p.description || 'Serial Device'}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-henry-text-dim mb-1">Baud rate</label>
                        <select
                          value={baudRate}
                          onChange={(e) => setBaudRate(Number(e.target.value))}
                          disabled={connecting}
                          className="w-full bg-henry-bg border border-henry-border rounded-lg px-3 py-2 text-xs text-henry-text outline-none focus:border-henry-accent/50"
                        >
                          {[9600, 19200, 38400, 57600, 115200, 250000].map((b) => (
                            <option key={b} value={b}>{b}</option>
                          ))}
                        </select>
                        <p className="text-[11px] text-henry-text-muted mt-1">Most printers use 115200. Try 250000 for Prusa/Creality.</p>
                      </div>
                      {selectedPort && (
                        <button
                          onClick={() => connectToPrinter()}
                          disabled={connecting}
                          className="px-4 py-2 bg-henry-accent text-white rounded-lg text-xs font-semibold hover:bg-henry-accent/90 transition-colors disabled:opacity-50"
                        >
                          {connecting ? 'Connecting…' : 'Connect'}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Activity log — show even when not connected */}
                {log.length > 0 && (
                  <div className="rounded-xl bg-henry-surface/20 border border-henry-border/20 overflow-hidden">
                    <div className="px-3 py-2 border-b border-henry-border/20">
                      <p className="text-[11px] font-medium text-henry-text-muted uppercase tracking-wider">Activity</p>
                    </div>
                    <div className="p-3 font-mono text-xs space-y-0.5 max-h-36 overflow-y-auto">
                      {log.map((entry) => (
                        <div key={entry.id} className={`leading-relaxed ${
                          entry.type === 'error' ? 'text-henry-error' :
                          entry.type === 'disconnected' ? 'text-henry-warning' :
                          'text-henry-text-muted'
                        }`}>
                          {entry.data}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Connected: controls */}
          {connected && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Quick actions */}
              <div className="shrink-0 px-4 py-3 border-b border-henry-border/30">
                <p className="text-[11px] font-medium text-henry-text-muted uppercase tracking-wider mb-2">Quick actions</p>
                <div className="flex flex-wrap gap-2">
                  {QUICK_ACTIONS.map((action) => (
                    <button
                      key={action.label}
                      onClick={() => sendGcode(action.code)}
                      disabled={sending}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-henry-surface/40 border border-henry-border/30 text-henry-text-dim hover:text-henry-text hover:border-henry-accent/40 transition-colors disabled:opacity-40"
                    >
                      <span>{action.icon}</span>
                      {action.label}
                    </button>
                  ))}
                  <button
                    onClick={() => sendGcode('M112')}
                    disabled={sending}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-henry-error/10 border border-henry-error/30 text-henry-error hover:bg-henry-error/20 transition-colors disabled:opacity-40 font-semibold"
                  >
                    ■ Emergency stop
                  </button>
                </div>
              </div>

              {/* Response log */}
              <div ref={logRef} className="flex-1 overflow-y-auto px-4 py-3 font-mono text-xs space-y-0.5">
                {log.map((entry) => (
                  <div key={entry.id} className={`leading-relaxed flex items-start gap-2 ${
                    entry.type === 'sent' ? 'text-henry-accent' :
                    entry.type === 'response' ? 'text-henry-success' :
                    entry.type === 'error' ? 'text-henry-error' :
                    entry.type === 'disconnected' ? 'text-henry-warning' :
                    'text-henry-text-muted'
                  }`}>
                    <span className="text-[10px] text-henry-text-muted/50 shrink-0 mt-0.5 tabular-nums">{formatTime(entry.timestamp)}</span>
                    <span>{entry.data}</span>
                  </div>
                ))}
                {(sending || printing) && (
                  <div className="text-henry-accent animate-pulse">▋</div>
                )}
              </div>

              {/* G-code input */}
              <div className="shrink-0 p-4 border-t border-henry-border/30 space-y-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={gcodeInput}
                    onChange={(e) => setGcodeInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendGcode()}
                    disabled={sending}
                    placeholder="Send a command (e.g. M105, G28)…"
                    className="flex-1 bg-henry-bg border border-henry-border rounded-xl px-4 py-2.5 text-sm text-henry-text font-mono outline-none focus:border-henry-accent/50 disabled:opacity-50"
                  />
                  <button
                    onClick={() => sendGcode()}
                    disabled={sending || !gcodeInput.trim()}
                    className="px-4 py-2.5 bg-henry-accent text-white rounded-xl text-sm font-medium hover:bg-henry-accent/90 transition-colors disabled:opacity-50"
                  >
                    Send
                  </button>
                </div>

                <button
                  onClick={() => setShowPrintJob((v) => !v)}
                  className="text-xs text-henry-accent/70 hover:text-henry-accent transition-colors"
                >
                  {showPrintJob ? '▾ Hide print job' : '▸ Start a print job'}
                </button>

                {showPrintJob && (
                  <div className="space-y-2">
                    <textarea
                      value={printGcode}
                      onChange={(e) => setPrintGcode(e.target.value)}
                      disabled={printing}
                      placeholder={`; Paste your full G-code here\nG28 ; Home\nM104 S210\n...`}
                      rows={5}
                      className="w-full bg-henry-bg border border-henry-border rounded-xl px-3 py-2.5 text-xs text-henry-text font-mono outline-none focus:border-henry-accent/50 resize-none disabled:opacity-50"
                    />
                    <button
                      onClick={startPrint}
                      disabled={printing || !printGcode.trim()}
                      className="w-full py-2.5 bg-henry-success/80 text-white rounded-xl text-sm font-medium hover:bg-henry-success transition-colors disabled:opacity-50"
                    >
                      {printing ? 'Printing…' : '▶ Start print'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
