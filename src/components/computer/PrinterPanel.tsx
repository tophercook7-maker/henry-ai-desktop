import { useState, useEffect, useRef, useCallback } from 'react';
import {
  detectFirmware, fetchStatus, sendGcodeWifi, setPrinterTemp,
  pausePrint, resumePrint, cancelPrint, emergencyStop,
  loadWifiConfig, saveWifiConfig, clearWifiConfig,
  WIFI_GCODE_PRESETS,
  type PrinterWifiConfig, type PrinterStatus, type PrinterFirmware,
} from '../../henry/printerApi';
import {
  connectBambu, disconnectBambu,
  bambuPause, bambuResume, bambuStop, bambuEmergencyStop,
  bambuSetNozzleTemp, bambuSetBedTemp, bambuSendGcode, bambuGetStatus,
  bambuSetFan,
  loadBambuConfig, saveBambuConfig, clearBambuConfig,
  BAMBU_SETUP_GUIDE, BAMBU_GCODE_PRESETS,
  type BambuConfig,
} from '../../henry/bambuApi';

// ── Types ──────────────────────────────────────────────────────────────────

type TabMode = 'printer' | 'terminal' | 'devices';
type ConnType = 'bambu' | 'rest' | 'usb';

interface Log { id: string; type: 'sent'|'response'|'error'|'info'|'disconnected'|'data'; text: string; ts: number; }
interface PortItem { device: string; description: string; hwid: string; }
interface Device { id: string; name: string; kind: 'serial'|'network'|'usb'; address: string; online: boolean; firmware?: string; }

// ── Helpers ────────────────────────────────────────────────────────────────

function tempState(current?: number, target?: number): 'heating'|'ready'|'cooling'|'cold' {
  if (current == null) return 'cold';
  if (target != null && target > 0) {
    if (current >= target - 3) return 'ready';
    return 'heating';
  }
  return current > 35 ? 'cooling' : 'cold';
}

const TEMP_COLORS = {
  heating: { dot: 'bg-orange-400 animate-pulse', bar: 'bg-orange-400', label: 'text-orange-400', badge: 'bg-orange-400/15 text-orange-400' },
  ready:   { dot: 'bg-green-400',                bar: 'bg-green-400',  label: 'text-green-400',  badge: 'bg-green-400/15 text-green-400'  },
  cooling: { dot: 'bg-blue-400',                 bar: 'bg-blue-400',   label: 'text-blue-400',   badge: 'bg-blue-400/15 text-blue-400'    },
  cold:    { dot: 'bg-henry-text-muted',          bar: 'bg-henry-border/30', label: 'text-henry-text-muted', badge: 'bg-henry-hover text-henry-text-muted' },
};

const TEMP_STATE_LABELS = { heating: 'Heating…', ready: 'At temp', cooling: 'Cooling', cold: 'Cold' };

const FW_LABELS: Record<PrinterFirmware, string> = {
  moonraker: 'Klipper / Moonraker', octoprint: 'OctoPrint',
  bambu: 'Bambu Lab', prusa: 'Prusa Connect', unknown: 'Unknown',
};

function mkLog(type: Log['type'], text: string): Log {
  return { id: crypto.randomUUID(), type, text, ts: Date.now() };
}

// ── Component ──────────────────────────────────────────────────────────────

export default function PrinterPanel() {
  const [tab, setTab] = useState<TabMode>('printer');

  // Active connection
  const [connType, setConnType] = useState<ConnType | null>(null);
  const [status, setStatus] = useState<PrinterStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connError, setConnError] = useState('');

  // REST (WiFi) config
  const [wifiCfg, setWifiCfg] = useState<PrinterWifiConfig | null>(loadWifiConfig);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Bambu config
  const [bambuCfg, setBambuCfg] = useState<BambuConfig | null>(loadBambuConfig);
  const [bambuDisconnectFn, setBambuDisconnectFn] = useState<(() => void) | null>(null);

  // USB
  const [ports, setPorts] = useState<PortItem[]>([]);
  const [selectedPort, setSelectedPort] = useState('');
  const [baudRate, setBaudRate] = useState(115200);
  const [depsOk, setDepsOk] = useState<boolean | null>(null);
  const [depsInstall, setDepsInstall] = useState('pip3 install pyserial');

  // Connect form
  const [formFw, setFormFw] = useState<PrinterFirmware>(bambuCfg ? 'bambu' : 'moonraker');
  const [formHost, setFormHost] = useState(bambuCfg?.host || wifiCfg?.host || '');
  const [formPort, setFormPort] = useState(String(wifiCfg?.port || 7125));
  const [formKey, setFormKey] = useState('');
  const [formSerial, setFormSerial] = useState(bambuCfg?.serial || '');
  const [formCode, setFormCode] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  // Terminal
  const [logs, setLogs] = useState<Log[]>([]);
  const [gcodeInput, setGcodeInput] = useState('');
  const [sending, setSending] = useState(false);
  const [gcodeHistory, setGcodeHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const logRef = useRef<HTMLDivElement>(null);

  // Devices
  const [devices, setDevices] = useState<Device[]>([]);
  const [scanning, setScanning] = useState(false);

  // Misc
  const [fanSlider, setFanSlider] = useState(0);
  const [speedSlider, setSpeedSlider] = useState(100);

  const isDesktop = !!window.henryAPI?.printerListPorts;
  const isConnected = connType !== null;
  const isBambu = connType === 'bambu';

  useEffect(() => {
    addLog('info', 'Henry Printer ready. Connect your printer to get started.');
    if (isDesktop) { checkDeps(); setupUsbListener(); }
    // Auto-reconnect on panel open
    if (bambuCfg) tryReconnectBambu(bambuCfg);
    else if (wifiCfg) tryReconnectWifi(wifiCfg);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      disconnectBambu();
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [logs]);

  useEffect(() => {
    if (status?.fanPercent != null) setFanSlider(status.fanPercent);
    if (status?.printSpeed != null) setSpeedSlider(status.printSpeed);
  }, [status?.fanPercent, status?.printSpeed]);

  function addLog(type: Log['type'], text: string) {
    setLogs((p) => [...p, mkLog(type, text)]);
  }

  // ── Auto-reconnect ─────────────────────────────────────────────────────

  async function tryReconnectBambu(cfg: BambuConfig) {
    try {
      const disc = await connectBambu(cfg,
        (s) => setStatus(s),
        (type, msg) => { if (type !== 'data') addLog(type as any, msg); }
      );
      setBambuDisconnectFn(() => disc);
      setConnType('bambu');
      setBambuCfg(cfg);
      addLog('info', `Reconnected to Bambu ${cfg.serial}`);
    } catch { /* silent on auto-reconnect fail */ }
  }

  async function tryReconnectWifi(cfg: PrinterWifiConfig) {
    const s = await fetchStatus(cfg);
    if (s.connected) {
      setStatus(s);
      setConnType('rest');
      setWifiCfg(cfg);
      startPolling(cfg);
    }
  }

  // ── Bambu connect ──────────────────────────────────────────────────────

  async function connectBambuPrinter(cfg: BambuConfig) {
    setConnecting(true); setConnError('');
    addLog('info', `Connecting to Bambu ${cfg.host} via MQTT…`);
    try {
      const disc = await connectBambu(
        cfg,
        (s) => setStatus(s),
        (type, msg) => {
          if (type !== 'data') addLog(type as any, msg);
        }
      );
      saveBambuConfig(cfg);
      setBambuCfg(cfg);
      setBambuDisconnectFn(() => disc);
      setConnType('bambu');
      addLog('info', 'MQTT connected. Live status incoming…');
    } catch (err: any) {
      setConnError(err.message || 'Connection failed. Check IP, serial, and access code.');
      addLog('error', err.message);
    } finally {
      setConnecting(false);
    }
  }

  // ── REST connect ───────────────────────────────────────────────────────

  async function autoDetect() {
    if (!formHost.trim()) return;
    setDetecting(true); setConnError('');
    addLog('info', `Auto-detecting firmware at ${formHost.trim()}…`);
    try {
      const result = await detectFirmware(formHost.trim(), formKey.trim() || undefined);
      if (result.firmware === 'unknown') {
        setConnError('No printer API found at that address. Check the IP and that the printer is on.');
      } else {
        const cfg: PrinterWifiConfig = { host: formHost.trim(), port: result.port, firmware: result.firmware, apiKey: formKey.trim() || undefined };
        addLog('info', `Detected: ${result.version || FW_LABELS[result.firmware]}`);
        await connectRestPrinter(cfg);
      }
    } catch (e: any) { setConnError(e.message); }
    finally { setDetecting(false); }
  }

  async function connectRestPrinter(cfg?: PrinterWifiConfig) {
    const useCfg = cfg || { host: formHost.trim(), port: Number(formPort) || 7125, firmware: formFw as Exclude<PrinterFirmware, 'bambu'|'unknown'>, apiKey: formKey.trim() || undefined };
    if (!useCfg.host) return;
    setConnecting(true); setConnError('');
    addLog('info', `Connecting to ${useCfg.host}…`);
    const s = await fetchStatus(useCfg);
    if (s.connected) {
      saveWifiConfig(useCfg); setWifiCfg(useCfg); setStatus(s); setConnType('rest');
      startPolling(useCfg);
      addLog('info', `Connected. State: ${s.state || 'idle'}`);
    } else {
      setConnError(`No response. ${s.raw?.error || 'Check IP and port.'}`);
    }
    setConnecting(false);
  }

  function startPolling(cfg: PrinterWifiConfig) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const s = await fetchStatus(cfg);
      if (s.connected) setStatus(s);
      else { disconnect(); addLog('disconnected', 'Printer went offline.'); }
    }, 3000);
  }

  // ── Disconnect ─────────────────────────────────────────────────────────

  function disconnect() {
    if (pollRef.current) clearInterval(pollRef.current);
    if (bambuDisconnectFn) bambuDisconnectFn();
    disconnectBambu();
    setConnType(null); setStatus(null); setBambuDisconnectFn(null);
    clearWifiConfig(); clearBambuConfig();
    addLog('info', 'Disconnected.');
  }

  // ── Send G-code ────────────────────────────────────────────────────────

  async function sendGcode(cmd?: string) {
    const command = (cmd ?? gcodeInput).trim();
    if (!command || sending) return;
    if (!cmd) { setGcodeInput(''); setGcodeHistory((h) => [command, ...h.slice(0, 49)]); setHistIdx(-1); }
    setSending(true);
    addLog('sent', `→ ${command}`);
    try {
      if (isBambu && bambuCfg) {
        bambuSendGcode(bambuCfg, command);
        addLog('response', 'ok');
      } else if (wifiCfg) {
        const r = await sendGcodeWifi(wifiCfg, command);
        if (r.success) addLog('response', 'ok'); else addLog('error', r.error || 'Failed');
      } else if (connType === 'usb') {
        await window.henryAPI.printerSendGcode(command);
      }
    } catch (e: any) { addLog('error', e.message); }
    finally { setSending(false); }
  }

  function handleHistoryKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); sendGcode(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); const n = Math.min(histIdx+1, gcodeHistory.length-1); setHistIdx(n); if (gcodeHistory[n]) setGcodeInput(gcodeHistory[n]); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); const n = Math.max(histIdx-1, -1); setHistIdx(n); setGcodeInput(n>=0 ? gcodeHistory[n] : ''); }
  }

  // ── Controls ───────────────────────────────────────────────────────────

  function doPause()  { if (isBambu && bambuCfg) { bambuPause(bambuCfg);  addLog('sent','→ PAUSE');  } else if (wifiCfg) pausePrint(wifiCfg).then(()  => addLog('sent','→ PAUSE')); }
  function doResume() { if (isBambu && bambuCfg) { bambuResume(bambuCfg); addLog('sent','→ RESUME'); } else if (wifiCfg) resumePrint(wifiCfg).then(() => addLog('sent','→ RESUME')); }
  function doStop()   { if (isBambu && bambuCfg) { bambuStop(bambuCfg);   addLog('sent','→ STOP');   } else if (wifiCfg) cancelPrint(wifiCfg).then(()  => addLog('sent','→ CANCEL')); }
  function doEstop()  { if (isBambu && bambuCfg) { bambuEmergencyStop(bambuCfg); addLog('error','⚡ E-STOP'); } else if (wifiCfg) emergencyStop(wifiCfg).then(() => addLog('error','⚡ E-STOP')); }

  function setTemp(tool: 'nozzle'|'bed', val: number) {
    if (isNaN(val)) return;
    addLog('sent', `→ Set ${tool} → ${val}°C`);
    if (isBambu && bambuCfg) { tool === 'nozzle' ? bambuSetNozzleTemp(bambuCfg, val) : bambuSetBedTemp(bambuCfg, val); }
    else if (wifiCfg) setPrinterTemp(wifiCfg, tool, val);
  }

  function setFan(pct: number) {
    const raw = Math.round((pct / 100) * (isBambu ? 15 : 255));
    addLog('sent', `→ Fan ${pct}%`);
    if (isBambu && bambuCfg) bambuSetFan(bambuCfg, raw);
    else if (wifiCfg) sendGcodeWifi(wifiCfg, `M106 S${raw}`);
  }

  // ── USB ────────────────────────────────────────────────────────────────

  function setupUsbListener() {
    try {
      window.henryAPI.onPrinterData((d: HenryPrinterData) => {
        if (d.type === 'disconnected') { setConnType(null); addLog('disconnected', 'USB disconnected.'); }
        else if (d.type === 'response') addLog('response', d.data || '');
        else if (d.type === 'sent')     addLog('sent', `→ ${d.data}`);
        else if (d.type === 'error')    addLog('error', d.data || 'Error');
      });
    } catch {}
  }

  async function checkDeps() {
    try {
      const r = await window.henryAPI.printerCheckDeps();
      setDepsOk(r.available);
      if (!r.available && r.installCommand) setDepsInstall(r.installCommand);
      if (r.available) loadPorts();
    } catch { setDepsOk(false); }
  }

  async function loadPorts() {
    try {
      const r = await window.henryAPI.printerListPorts();
      if (r.ports) { setPorts(r.ports); if (r.ports.length) setSelectedPort(r.ports[0].device); }
    } catch {}
  }

  async function connectUsb() {
    setConnecting(true);
    addLog('info', `Connecting USB ${selectedPort} @ ${baudRate}…`);
    try {
      const r = await window.henryAPI.printerConnect({ port: selectedPort, baudRate });
      if (r.success) { setConnType('usb'); addLog('info', `USB connected @ ${r.baudRate} baud.`); sendGcode('M115'); sendGcode('M105'); }
      else addLog('error', r.error || 'Connection failed.');
    } catch (e: any) { addLog('error', e.message); }
    finally { setConnecting(false); }
  }

  async function disconnectUsb() {
    try { await window.henryAPI.printerDisconnect(); } catch {}
    setConnType(null); addLog('info', 'USB disconnected.');
  }

  // ── Devices scan ───────────────────────────────────────────────────────

  const scanDevices = useCallback(async () => {
    setScanning(true); const found: Device[] = [];
    if (isDesktop) {
      try {
        const r = await window.henryAPI.printerListPorts();
        for (const p of r.ports || []) found.push({ id: `serial-${p.device}`, name: p.description || 'Serial Device', kind: 'serial', address: p.device, online: true });
      } catch {}
    }
    const netTargets = [
      { host: 'printer.local', port: 7125 }, { host: 'octopi.local', port: 80 }, { host: 'klipper.local', port: 7125 },
      ...(wifiCfg?.host ? [{ host: wifiCfg.host, port: wifiCfg.port }] : []),
      ...(bambuCfg?.host ? [{ host: bambuCfg.host, port: 1883, bambu: true }] : []),
    ];
    for (const t of netTargets as any[]) {
      try {
        if (t.bambu) { found.push({ id: `bambu-${t.host}`, name: t.host, kind: 'network', address: `${t.host}:1883`, online: true, firmware: 'Bambu Lab' }); continue; }
        const r = await detectFirmware(t.host, wifiCfg?.apiKey);
        if (r.firmware !== 'unknown') found.push({ id: `net-${t.host}`, name: t.host, kind: 'network', address: `${t.host}:${r.port}`, online: true, firmware: FW_LABELS[r.firmware] });
      } catch {}
    }
    setDevices(found); setScanning(false);
  }, [wifiCfg, bambuCfg, isDesktop]);

  useEffect(() => { if (tab === 'devices') scanDevices(); }, [tab]);

  // ── Shared connect handler ─────────────────────────────────────────────

  async function handleConnect() {
    if (formFw === 'bambu') {
      await connectBambuPrinter({ host: formHost.trim(), serial: formSerial.trim(), accessCode: formCode.trim() });
    } else {
      await connectRestPrinter();
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  const s = status;
  const isPrinting = s?.state === 'printing' || s?.state === 'running';
  const isPaused   = s?.state === 'paused';
  const isComplete = s?.state === 'complete' || s?.state === 'finish';

  return (
    <div className="h-full flex flex-col bg-henry-bg text-henry-text overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-5 pt-4 pb-3 border-b border-henry-border/40 bg-henry-surface/20">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🖨️</span>
            <div>
              <h2 className="text-base font-semibold text-henry-text leading-tight flex items-center gap-2">
                3D Printer
                {isConnected && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                    isBambu ? 'bg-green-400/15 text-green-400' : connType === 'usb' ? 'bg-purple-400/15 text-purple-400' : 'bg-blue-400/15 text-blue-400'
                  }`}>
                    ● {isBambu ? 'Bambu MQTT' : connType === 'usb' ? 'USB' : 'WiFi'}
                  </span>
                )}
                {!isConnected && <span className="text-[10px] px-2 py-0.5 rounded-full bg-henry-hover text-henry-text-muted font-normal">○ Offline</span>}
              </h2>
              {isConnected && s && (
                <p className="text-[11px] text-henry-text-muted leading-tight">
                  {isBambu && bambuCfg ? `${bambuCfg.host}` : wifiCfg ? `${wifiCfg.host}:${wifiCfg.port}` : selectedPort}
                  {s.wifiSignal && <span className="ml-2 opacity-60">{s.wifiSignal}</span>}
                </p>
              )}
            </div>
          </div>
          {isConnected && (
            <button onClick={disconnect} className="text-xs px-3 py-1.5 rounded-lg border border-henry-border/30 text-henry-text-muted hover:text-red-400 hover:border-red-400/30 transition-all">
              Disconnect
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1">
          {([['printer','🖨️ Printer'],['terminal','💻 Terminal'],['devices','🔍 Devices']] as const).map(([t,label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1 text-xs rounded-lg font-medium transition-all ${tab === t ? 'bg-henry-accent text-white' : 'bg-henry-hover text-henry-text-dim hover:text-henry-text'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── PRINTER TAB ─────────────────────────────────────────────────── */}
      {tab === 'printer' && (
        <div className="flex-1 overflow-y-auto">
          {!isConnected ? (
            /* ── Connect form ── */
            <div className="p-5 space-y-4 max-w-lg">
              <div>
                <p className="text-sm font-medium text-henry-text mb-0.5">Connect your printer</p>
                <p className="text-xs text-henry-text-muted">Supports Bambu Lab (LAN MQTT), Klipper, OctoPrint, and Prusa Connect.</p>
              </div>

              {/* Firmware selector */}
              <div>
                <label className="text-xs font-medium text-henry-text-muted block mb-1.5">Firmware</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {([['bambu','🟢 Bambu'],['moonraker','⚡ Klipper'],['octoprint','🐙 OctoPrint'],['prusa','🔴 Prusa']] as const).map(([fw, label]) => (
                    <button key={fw} onClick={() => { setFormFw(fw); if (fw === 'moonraker') setFormPort('7125'); else if (fw !== 'bambu') setFormPort('80'); }}
                      className={`py-2 px-1 text-xs rounded-xl font-medium border transition-all ${formFw === fw ? 'border-henry-accent bg-henry-accent/10 text-henry-accent' : 'border-henry-border/30 bg-henry-surface/20 text-henry-text-muted hover:text-henry-text hover:border-henry-border/60'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2.5">
                <div>
                  <label className="text-xs font-medium text-henry-text-muted block mb-1">{formFw === 'bambu' ? 'Printer IP address' : 'IP address or hostname'}</label>
                  <input value={formHost} onChange={(e) => setFormHost(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                    placeholder={formFw === 'bambu' ? '192.168.1.105' : 'printer.local or 192.168.1.100'}
                    className="w-full bg-henry-surface/30 border border-henry-border/30 rounded-xl px-4 py-2.5 text-sm text-henry-text outline-none focus:border-henry-accent/60" />
                </div>

                {/* Bambu-specific fields */}
                {formFw === 'bambu' && (
                  <>
                    <div>
                      <label className="text-xs font-medium text-henry-text-muted block mb-1">Serial Number</label>
                      <input value={formSerial} onChange={(e) => setFormSerial(e.target.value)}
                        placeholder="00M09A… (Settings → Device → Serial Number)"
                        className="w-full bg-henry-surface/30 border border-henry-border/30 rounded-xl px-4 py-2.5 text-sm text-henry-text outline-none focus:border-green-400/60" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-henry-text-muted block mb-1">Access Code</label>
                      <input value={formCode} onChange={(e) => setFormCode(e.target.value)} type="password"
                        placeholder="8-digit code shown in LAN mode settings"
                        className="w-full bg-henry-surface/30 border border-henry-border/30 rounded-xl px-4 py-2.5 text-sm text-henry-text outline-none focus:border-green-400/60" />
                    </div>

                    {/* Setup guide toggle */}
                    <button onClick={() => setShowGuide(!showGuide)} className="text-xs text-henry-accent hover:underline flex items-center gap-1">
                      {showGuide ? '▾' : '▸'} How to find these on your Bambu printer
                    </button>
                    {showGuide && (
                      <div className="rounded-xl bg-henry-surface/15 border border-henry-border/20 divide-y divide-henry-border/10">
                        {BAMBU_SETUP_GUIDE.map((g, i) => (
                          <div key={i} className="flex gap-3 p-3">
                            <span className="text-[11px] font-bold text-henry-accent shrink-0 w-4 mt-0.5">{i+1}</span>
                            <div>
                              <p className="text-xs font-medium text-henry-text">{g.step}</p>
                              <p className="text-[11px] text-henry-text-muted leading-relaxed">{g.detail}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {/* REST-specific fields */}
                {formFw !== 'bambu' && (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-1">
                      <label className="text-xs font-medium text-henry-text-muted block mb-1">Port</label>
                      <input value={formPort} onChange={(e) => setFormPort(e.target.value)}
                        className="w-full bg-henry-surface/30 border border-henry-border/30 rounded-xl px-3 py-2.5 text-sm text-henry-text outline-none focus:border-henry-accent/60" />
                    </div>
                    <div className="col-span-2">
                      <label className="text-xs font-medium text-henry-text-muted block mb-1">API Key <span className="opacity-50">(OctoPrint/Prusa)</span></label>
                      <input value={formKey} onChange={(e) => setFormKey(e.target.value)} type="password" placeholder="Paste key from settings…"
                        className="w-full bg-henry-surface/30 border border-henry-border/30 rounded-xl px-3 py-2.5 text-sm text-henry-text outline-none focus:border-henry-accent/60" />
                    </div>
                  </div>
                )}

                {connError && <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-xl px-3 py-2">{connError}</p>}

                <div className="flex gap-2 pt-1">
                  {formFw === 'bambu' ? (
                    <button onClick={handleConnect} disabled={connecting || !formHost.trim() || !formSerial.trim() || !formCode.trim()}
                      className="flex-1 py-2.5 bg-green-500 text-white text-sm font-semibold rounded-xl hover:bg-green-500/90 disabled:opacity-40 transition-all">
                      {connecting ? <Spinner label="Connecting via MQTT…" /> : '🟢 Connect to Bambu'}
                    </button>
                  ) : (
                    <>
                      <button onClick={autoDetect} disabled={detecting || connecting || !formHost.trim()}
                        className="flex-1 py-2.5 bg-henry-accent text-white text-sm font-semibold rounded-xl hover:bg-henry-accent/90 disabled:opacity-40 transition-all">
                        {detecting ? <Spinner label="Detecting…" /> : '🔍 Auto-detect & Connect'}
                      </button>
                      <button onClick={() => connectRestPrinter()} disabled={connecting || !formHost.trim()}
                        className="px-4 py-2.5 bg-henry-surface border border-henry-border/40 text-henry-text text-sm rounded-xl hover:bg-henry-hover/50 disabled:opacity-40 transition-all">
                        Manual
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* USB section */}
              {isDesktop && (
                <div className="pt-2 border-t border-henry-border/20 space-y-2">
                  <p className="text-xs font-medium text-henry-text-muted">Or connect via USB cable</p>
                  {depsOk === false && (
                    <div className="p-3 rounded-xl bg-henry-warning/5 border border-henry-warning/20 text-xs">
                      <p className="text-henry-warning font-medium mb-1">pyserial not installed</p>
                      <code className="text-henry-accent">{depsInstall}</code>
                      <button onClick={checkDeps} className="block mt-1 text-henry-accent hover:underline">Check again</button>
                    </div>
                  )}
                  {depsOk === true && (
                    <div className="flex gap-2">
                      <select value={selectedPort} onChange={(e) => setSelectedPort(e.target.value)}
                        className="flex-1 bg-henry-surface/30 border border-henry-border/30 rounded-xl px-3 py-2 text-sm text-henry-text outline-none">
                        {ports.length === 0 && <option value="">No ports — plug in printer</option>}
                        {ports.map((p) => <option key={p.device} value={p.device}>{p.device} — {p.description || 'Serial'}</option>)}
                      </select>
                      <select value={baudRate} onChange={(e) => setBaudRate(Number(e.target.value))}
                        className="bg-henry-surface/30 border border-henry-border/30 rounded-xl px-2 py-2 text-sm text-henry-text outline-none">
                        {[9600, 57600, 115200, 250000].map((b) => <option key={b}>{b}</option>)}
                      </select>
                      <button onClick={loadPorts} className="px-2 py-2 text-xs rounded-xl bg-henry-surface border border-henry-border/30 text-henry-text-muted">🔄</button>
                      <button onClick={connectUsb} disabled={!selectedPort || connecting}
                        className="px-4 py-2 bg-henry-accent text-white rounded-xl text-sm disabled:opacity-40">Connect</button>
                    </div>
                  )}
                </div>
              )}
            </div>

          ) : (
            /* ── Connected dashboard ── */
            <div className="flex-1 flex flex-col">

              {/* Bambu premium dashboard */}
              {isBambu ? (
                <div className="p-4 space-y-3">

                  {/* Temps row */}
                  <div className="grid grid-cols-2 gap-3">
                    <TempCard label="Nozzle" icon="🔥" current={s?.nozzleTemp} target={s?.nozzleTarget} onSet={(v) => setTemp('nozzle', v)} />
                    <TempCard label="Bed"    icon="⬛" current={s?.bedTemp}    target={s?.bedTarget}    onSet={(v) => setTemp('bed', v)} />
                    {s?.chambTemp != null && <TempCard label="Chamber" icon="🏠" current={s.chambTemp} target={s.chambTarget} onSet={() => {}} />}
                  </div>

                  {/* Print progress */}
                  {s?.printProgress != null && (
                    <div className="rounded-2xl bg-henry-surface/30 border border-henry-border/20 p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="min-w-0 flex-1 mr-3">
                          <p className="text-xs text-henry-text-muted mb-0.5 uppercase tracking-wider">Printing</p>
                          <p className="text-sm font-semibold text-henry-text truncate">{s.printFile || 'Unknown file'}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-2xl font-bold text-henry-accent leading-none">{s.printProgress}%</p>
                          {s.printTimeLeft != null && (
                            <p className="text-[11px] text-henry-text-muted">{formatTime(s.printTimeLeft)}</p>
                          )}
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="h-2 bg-henry-bg rounded-full overflow-hidden mb-2">
                        <div className="h-full bg-gradient-to-r from-henry-accent to-green-400 rounded-full transition-all duration-1000" style={{ width: `${s.printProgress}%` }} />
                      </div>

                      {/* Layer counter + speed */}
                      <div className="flex items-center justify-between text-xs text-henry-text-muted">
                        {s.layerCurrent != null && s.layerTotal != null ? (
                          <span>Layer <span className="font-semibold text-henry-text">{s.layerCurrent}</span> / {s.layerTotal}</span>
                        ) : <span />}
                        {s.printSpeed != null && (
                          <span>Speed <span className="font-semibold text-henry-text">{s.printSpeed}%</span></span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* State badge when not printing */}
                  {!s?.printProgress && (
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-3 py-1 rounded-full font-medium ${
                        s?.state === 'error' ? 'bg-red-400/15 text-red-400' :
                        s?.state === 'complete' || s?.state === 'finish' ? 'bg-green-400/15 text-green-400' :
                        'bg-henry-hover text-henry-text-muted'
                      }`}>
                        {s?.state ? s.state.charAt(0).toUpperCase() + s.state.slice(1) : 'Idle'}
                      </span>
                      {s?.wifiSignal && <span className="text-xs text-henry-text-muted">📶 {s.wifiSignal}</span>}
                    </div>
                  )}

                  {/* Print controls */}
                  <div className="flex gap-2 flex-wrap">
                    {(isPrinting || isPaused) && <>
                      {isPrinting  && <CtrlBtn onClick={doPause}  color="yellow" label="⏸ Pause"  />}
                      {isPaused    && <CtrlBtn onClick={doResume} color="green"  label="▶ Resume" />}
                      <CtrlBtn onClick={doStop} color="orange" label="⏹ Stop" />
                    </>}
                    <CtrlBtn onClick={doEstop} color="red" label="⚡ E-Stop" bold />
                    {isBambu && bambuCfg && (
                      <button onClick={() => { bambuGetStatus(bambuCfg); addLog('info', 'Refreshed status'); }}
                        className="px-3 py-1.5 text-xs rounded-lg bg-henry-surface border border-henry-border/30 text-henry-text-muted hover:text-henry-text transition-all ml-auto">
                        🔄 Refresh
                      </button>
                    )}
                  </div>

                  {/* Fan + Speed sliders */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-henry-surface/20 border border-henry-border/20 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] text-henry-text-muted uppercase tracking-wider">💨 Fan</p>
                        <span className="text-xs font-semibold text-henry-text">{fanSlider}%</span>
                      </div>
                      <input type="range" min={0} max={100} step={5} value={fanSlider}
                        onChange={(e) => setFanSlider(Number(e.target.value))}
                        onMouseUp={() => setFan(fanSlider)}
                        onTouchEnd={() => setFan(fanSlider)}
                        className="w-full accent-henry-accent h-1.5 rounded-full" />
                    </div>
                    {s?.printSpeed != null && (
                      <div className="rounded-xl bg-henry-surface/20 border border-henry-border/20 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[10px] text-henry-text-muted uppercase tracking-wider">⚡ Speed</p>
                          <span className="text-xs font-semibold text-henry-text">{speedSlider}%</span>
                        </div>
                        <input type="range" min={50} max={200} step={10} value={speedSlider}
                          onChange={(e) => setSpeedSlider(Number(e.target.value))}
                          onMouseUp={() => { addLog('sent', `→ Set speed ${speedSlider}%`); bambuCfg && bambuSendGcode(bambuCfg, `M220 S${speedSlider}`); }}
                          className="w-full accent-henry-accent h-1.5 rounded-full" />
                      </div>
                    )}
                  </div>

                  {/* Quick presets */}
                  <div>
                    <p className="text-[10px] text-henry-text-muted uppercase tracking-wider mb-2">Quick actions</p>
                    <div className="flex flex-wrap gap-1.5">
                      {BAMBU_GCODE_PRESETS.map((p) => (
                        <button key={p.label}
                          onClick={() => {
                            if (!bambuCfg) return;
                            if ('fn' in p && p.fn) { p.fn(bambuCfg); addLog('sent', `→ ${p.label}`); }
                            else if ('gcode' in p && p.gcode) { bambuSendGcode(bambuCfg, p.gcode as string); addLog('sent', `→ ${p.gcode}`); }
                            else if ('nozzle' in p) { bambuSetNozzleTemp(bambuCfg, (p as any).nozzle); bambuSetBedTemp(bambuCfg, (p as any).bed); addLog('sent', `→ Preheat ${p.label}`); }
                          }}
                          className="px-2.5 py-1 text-xs rounded-lg bg-henry-surface/40 border border-henry-border/20 text-henry-text-dim hover:border-green-400/40 hover:text-henry-text transition-all">
                          {p.icon} {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

              ) : (
                /* Standard REST / USB dashboard */
                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <TempCard label="Nozzle" icon="🔥" current={s?.nozzleTemp} target={s?.nozzleTarget} onSet={(v) => setTemp('nozzle', v)} />
                    <TempCard label="Bed"    icon="⬛" current={s?.bedTemp}    target={s?.bedTarget}    onSet={(v) => setTemp('bed', v)} />
                  </div>
                  {s?.printProgress != null && (
                    <div className="rounded-xl bg-henry-surface/30 border border-henry-border/20 p-3">
                      <div className="flex justify-between mb-2">
                        <p className="text-xs text-henry-text truncate">{s.printFile || 'Printing…'}</p>
                        <span className="text-xs font-bold text-henry-accent ml-2 shrink-0">{s.printProgress}%</span>
                      </div>
                      <div className="h-1.5 bg-henry-bg rounded-full overflow-hidden">
                        <div className="h-full bg-henry-accent rounded-full transition-all" style={{ width: `${s.printProgress}%` }} />
                      </div>
                      {s.printTimeLeft != null && <p className="text-[10px] text-henry-text-muted mt-1">{formatTime(s.printTimeLeft)} remaining</p>}
                    </div>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    {(isPrinting || isPaused) && <>{isPrinting && <CtrlBtn onClick={doPause} color="yellow" label="⏸ Pause" />}{isPaused && <CtrlBtn onClick={doResume} color="green" label="▶ Resume" />}<CtrlBtn onClick={doStop} color="orange" label="⏹ Stop" /></>}
                    <CtrlBtn onClick={doEstop} color="red" label="⚡ E-Stop" bold />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {WIFI_GCODE_PRESETS.map((p) => (
                      <button key={p.label} onClick={() => sendGcode(p.code)}
                        className="px-2.5 py-1 text-xs rounded-lg bg-henry-surface/40 border border-henry-border/20 text-henry-text-dim hover:border-henry-accent/40 hover:text-henry-text transition-all">
                        {p.icon} {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── TERMINAL TAB ───────────────────────────────────────────────────── */}
      {tab === 'terminal' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {!isConnected && <div className="m-4 p-3 rounded-xl bg-henry-hover text-xs text-henry-text-muted">Connect a printer first to use the G-code terminal.</div>}
          <div ref={logRef} className="flex-1 overflow-y-auto px-4 py-3 font-mono text-xs space-y-0.5 min-h-0">
            {logs.map((e) => <div key={e.id} className={logColor(e.type)}>{e.text}</div>)}
            {sending && <div className="text-henry-accent animate-pulse">▋</div>}
          </div>
          <div className="shrink-0 border-t border-henry-border/30 p-3">
            {/* Preset row */}
            <div className="flex flex-wrap gap-1 mb-2">
              {(isBambu ? BAMBU_GCODE_PRESETS.filter((p) => 'gcode' in p) : WIFI_GCODE_PRESETS).map((p) => (
                <button key={p.label} onClick={() => sendGcode(('gcode' in p ? p.gcode : (p as any).code) as string)}
                  className="px-2 py-0.5 text-[10px] rounded-lg bg-henry-surface border border-henry-border/20 text-henry-text-muted hover:text-henry-text transition-all">
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={gcodeInput} onChange={(e) => setGcodeInput(e.target.value)} onKeyDown={handleHistoryKey} disabled={sending || !isConnected}
                placeholder={isConnected ? 'G-code command… (↑↓ history, ↵ send)' : 'Not connected'}
                className="flex-1 bg-henry-bg border border-henry-border/40 rounded-xl px-4 py-2.5 text-sm text-henry-text font-mono outline-none focus:border-henry-accent/60 disabled:opacity-40" />
              <button onClick={() => sendGcode()} disabled={sending || !gcodeInput.trim() || !isConnected}
                className={`px-4 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40 transition-all text-white ${isBambu ? 'bg-green-500 hover:bg-green-500/90' : 'bg-henry-accent hover:bg-henry-accent/90'}`}>
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DEVICES TAB ────────────────────────────────────────────────────── */}
      {tab === 'devices' && (
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          <div className="flex justify-between items-center">
            <p className="text-xs text-henry-text-muted">Printers and devices on your network</p>
            <button onClick={scanDevices} disabled={scanning}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-henry-surface border border-henry-border/30 text-henry-text-muted hover:text-henry-text disabled:opacity-50 transition-all">
              {scanning ? <><span className="w-3 h-3 rounded-full border-2 border-henry-text-muted/30 border-t-henry-text-muted animate-spin" /> Scanning…</> : '🔄 Scan'}
            </button>
          </div>
          {scanning && devices.length === 0 && <div className="text-center py-8 text-henry-text-muted text-sm">Scanning your network…</div>}
          {!scanning && devices.length === 0 && <div className="text-center py-8 text-henry-text-muted text-sm">No devices found. Make sure your printer is on the same WiFi.</div>}
          {devices.map((d) => (
            <div key={d.id} className="rounded-xl border border-henry-border/25 bg-henry-surface/10 p-3.5 flex items-center gap-3">
              <span className="text-xl shrink-0">{d.kind === 'serial' ? '🔌' : d.firmware?.toLowerCase().includes('bambu') ? '🟢' : '📡'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-henry-text truncate">{d.name}</p>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-400/15 text-green-400 font-medium shrink-0">online</span>
                </div>
                <p className="text-xs text-henry-text-muted font-mono">{d.address}</p>
                {d.firmware && <p className="text-[11px] text-henry-text-muted mt-0.5">{d.firmware}</p>}
              </div>
              <button
                onClick={() => {
                  const [host] = d.address.split(':');
                  if (d.firmware?.toLowerCase().includes('bambu')) { setBambuCfg((c) => c ? { ...c, host } : null); setFormHost(host); setFormFw('bambu'); setTab('printer'); }
                  else if (d.kind === 'serial') { setSelectedPort(d.address); setTab('printer'); }
                  else { setFormHost(host); setFormFw('moonraker'); setTab('printer'); }
                }}
                className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all shrink-0 ${
                  d.firmware?.toLowerCase().includes('bambu')
                    ? 'bg-green-400/15 text-green-400 border-green-400/20 hover:bg-green-400/25'
                    : 'bg-henry-accent/15 text-henry-accent border-henry-accent/20 hover:bg-henry-accent/25'
                }`}>
                Connect
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function TempCard({ label, icon, current, target, onSet }: {
  label: string; icon: string; current?: number; target?: number; onSet: (v: number) => void;
}) {
  const [input, setInput] = useState('');
  const state = tempState(current, target);
  const col = TEMP_COLORS[state];
  const pct = current != null && target != null && target > 0 ? Math.min(100, (current / target) * 100) : 0;

  return (
    <div className="rounded-2xl bg-henry-surface/25 border border-henry-border/20 p-3.5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{icon}</span>
          <p className="text-[10px] font-medium text-henry-text-muted uppercase tracking-wider">{label}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${col.dot}`} />
          <span className={`text-[9px] font-medium ${col.label}`}>{TEMP_STATE_LABELS[state]}</span>
        </div>
      </div>

      <p className="text-3xl font-bold text-henry-text leading-none mb-0.5">
        {current != null ? Math.round(current) : '—'}
        <span className="text-base font-normal text-henry-text-muted ml-0.5">°C</span>
      </p>
      {target != null && target > 0 && (
        <p className="text-[11px] text-henry-text-muted mb-2">→ {target}°C</p>
      )}

      {/* Heat bar */}
      <div className="h-1 bg-henry-bg rounded-full overflow-hidden mb-3">
        <div className={`h-full rounded-full transition-all duration-1000 ${col.bar}`} style={{ width: `${pct}%` }} />
      </div>

      {/* Set temp */}
      <div className="flex gap-1.5">
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { onSet(Number(input)); setInput(''); } }}
          placeholder="Set °C"
          className="flex-1 min-w-0 text-xs bg-henry-bg border border-henry-border/30 rounded-lg px-2.5 py-1.5 text-henry-text outline-none focus:border-henry-accent/60" />
        <button onClick={() => { onSet(Number(input)); setInput(''); }}
          className="text-xs px-2.5 py-1.5 rounded-lg bg-henry-accent/20 text-henry-accent hover:bg-henry-accent/30 font-medium transition-all shrink-0">
          Set
        </button>
      </div>
    </div>
  );
}

function CtrlBtn({ onClick, color, label, bold }: { onClick: () => void; color: string; label: string; bold?: boolean }) {
  const map: Record<string, string> = {
    yellow: 'bg-yellow-400/15 text-yellow-400 border-yellow-400/20 hover:bg-yellow-400/25',
    green:  'bg-green-400/15  text-green-400  border-green-400/20  hover:bg-green-400/25',
    orange: 'bg-orange-400/15 text-orange-400 border-orange-400/20 hover:bg-orange-400/25',
    red:    'bg-red-500/20    text-red-400    border-red-400/30    hover:bg-red-500/30',
  };
  return (
    <button onClick={onClick} className={`px-3 py-1.5 text-xs rounded-xl border transition-all ${map[color]} ${bold ? 'font-semibold' : ''}`}>
      {label}
    </button>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <span className="flex items-center justify-center gap-2">
      <span className="w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
      {label}
    </span>
  );
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function logColor(type: Log['type']): string {
  switch (type) {
    case 'sent':         return 'text-henry-accent';
    case 'response':     return 'text-green-400/80';
    case 'data':         return 'text-green-400/50';
    case 'error':        return 'text-red-400';
    case 'disconnected': return 'text-henry-text-muted italic';
    default:             return 'text-henry-text-muted';
  }
}
