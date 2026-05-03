/**
 * Henry Desktop Sync Bridge
 *
 * Runs a small HTTP + SSE server inside the Electron main process so that
 * companion devices (iPhone / iPad / Android) can connect over LAN.
 *
 * Architecture:
 *   - HTTP server on port 4242 (configurable)
 *   - SSE endpoint for real-time push to mobile
 *   - REST endpoints for snapshot, events, capture, action approval
 *   - Short-lived pair token → long-lived companion token flow
 *
 * All data is read directly from the SQLite database that is already open
 * in the main process.  Captures are forwarded to the main window via
 * webContents.send so the renderer can process them as normal messages.
 */

import http from 'http';
import crypto from 'crypto';
import os from 'os';
import fs from 'fs';
import { ipcMain, BrowserWindow, webContents } from 'electron';
import {
  COMPANION_DEFAULT_DEVICE_CAPABILITIES,
  type SyncServerState,
  type DeviceInfo,
  type PairRequest,
  type PairResponse,
  type PendingAction,
  type ActionDecision,
  type CapturePayload,
  type SyncEvent,
  type SyncSnapshot,
  type SyncMessage,
  type DesktopStatus,
} from '../../src/sync/types';

// ── Types ──────────────────────────────────────────────────────────────────

interface SSEClient {
  deviceId: string;
  res: http.ServerResponse;
}

// ── State ──────────────────────────────────────────────────────────────────


// ── Cloudflare Tunnel (remote access from outside home network) ──────────

export async function startSyncTunnel(port: number): Promise<string | null> {
  try {
    const { spawn, execSync } = await import('child_process');
    try { execSync('which cloudflared', { stdio: 'ignore' }); }
    catch {
      console.log('[SyncBridge] cloudflared not installed — run: brew install cloudflared');
      return null;
    }
    return new Promise((resolve) => {
      tunnelProcess = spawn('cloudflared', [
        'tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });

      let resolved = false;
      const tryResolve = (data: Buffer) => {
        const text = data.toString();
        const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match && !resolved) {
          resolved = true;
          tunnelUrl = match[0];
          console.log(`[SyncBridge] Tunnel active: ${tunnelUrl}`);
          resolve(tunnelUrl);
        }
      };
      tunnelProcess!.stdout?.on('data', tryResolve);
      tunnelProcess!.stderr?.on('data', tryResolve);
      tunnelProcess!.on('exit', () => { tunnelUrl = null; tunnelProcess = null; });
      setTimeout(() => { if (!resolved) resolve(null); }, 15000);
    });
  } catch (e) {
    console.error('[SyncBridge] Tunnel error:', e);
    return null;
  }
}

function stopTunnel(): void {
  if (tunnelProcess) {
    tunnelProcess.kill();
    tunnelProcess = null;
    tunnelUrl = null;
  }
}

let server: http.Server | null = null;
let sseClients: SSEClient[] = [];
const linkedDevices: Map<string, DeviceInfo> = new Map();
const companionTokens: Map<string, string> = new Map(); // token → deviceId

// Per-device context memory — tracks last action for "do it again" / "open that"
interface DeviceContext {
  lastCommand?: string;       // last shell command run
  lastApp?: string;           // last app opened
  lastFolder?: string;        // last folder created/opened
  lastAiResponse?: string;    // last AI response text
  lastUserText?: string;      // last thing user said
}
const deviceContext: Map<string, DeviceContext> = new Map();

// Persist companion tokens to SQLite so they survive server restarts
function saveCompanionTokens(): void {
  try {
    const tokenData = JSON.stringify({
      tokens: Array.from(companionTokens.entries()),
      devices: Array.from(linkedDevices.entries()),
    });
    dbRun("INSERT OR REPLACE INTO settings(key,value) VALUES('companion_session_tokens',?)", tokenData);
  } catch { /* ignore */ }
}

function loadCompanionTokens(): void {
  try {
    const row = dbGetOne<{value:string}>('SELECT value FROM settings WHERE key=?', 'companion_session_tokens');
    if (row?.value) {
      const data = JSON.parse(row.value) as {tokens:[string,string][];devices:[string,DeviceInfo][]};
      if (data.tokens) for (const [k,v] of data.tokens) companionTokens.set(k, v);
      if (data.devices) for (const [k,v] of data.devices) linkedDevices.set(k, v);
    }
  } catch { /* ignore */ }
}
let pairToken: string | null = null;
let pairTokenExpiry = 0;
const pendingActions: Map<string, PendingAction> = new Map();
let eventLog: SyncEvent[] = [];
let currentPort = 4242;
let serverRunning = false;
let tunnelUrl: string | null = null;
let tunnelProcess: import('child_process').ChildProcess | null = null;

// ── Helpers ────────────────────────────────────────────────────────────────

function getLocalIp(): string {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function generateToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString('hex');
}

function jsonResponse(
  res: http.ServerResponse,
  status: number,
  body: unknown
): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(data);
}

function corsHeaders(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function validateToken(req: http.IncomingMessage): string | null {
  // Accept token from: Authorization: Bearer TOKEN, x-henry-token header, or ?token= param
  const authHeader = req.headers['authorization'] as string | undefined;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  const token =
    bearerToken ??
    (req.headers['x-henry-token'] as string | undefined) ??
    new URL(req.url ?? '', 'http://localhost').searchParams.get('token') ??
    '';
  return companionTokens.get(token) ?? null;
}

function recordEvent(event: Omit<SyncEvent, 'id' | 'timestamp'>): SyncEvent {
  const full: SyncEvent = {
    ...event,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  };
  eventLog.push(full);
  // Keep log bounded to last 500 events
  if (eventLog.length > 500) eventLog = eventLog.slice(-500);
  return full;
}

function pushToDevice(targetDeviceId: string, event: Omit<SyncEvent,'id'|'timestamp'>): void {
  const full: SyncEvent = { ...event as SyncEvent, id: generateToken(8), timestamp: Date.now() };
  for (const client of sseClients) {
    if (client.deviceId === targetDeviceId) {
      try { client.res.write(`data: ${JSON.stringify(full)}\n\n`); } catch { /* disconnected */ }
    }
  }
}

function pushToAll(event: SyncEvent): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of [...sseClients]) {
    try {
      client.res.write(data);
    } catch {
      sseClients = sseClients.filter((c) => c !== client);
    }
  }
}

// ── Database access helpers ────────────────────────────────────────────────
// These mirror the IPC handlers in database.ts but are called directly
// since we're already in the main process.

let _db: import('better-sqlite3').Database | null = null;

export function setSyncDb(db: import('better-sqlite3').Database): void {
  _db = db;
}

function dbGet<T>(sql: string, ...params: unknown[]): T[] {
  if (!_db) return [];
  try {
    return _db.prepare(sql).all(...params) as T[];
  } catch {
    return [];
  }
}

function dbRun(sql: string, ...params: unknown[]): void {
  try {
    const db = getDb();
    db.prepare(sql).run(...params);
  } catch { /* ignore */ }
}

function dbGetOne<T>(sql: string, ...params: unknown[]): T | null {
  if (!_db) return null;
  try {
    return (_db.prepare(sql).get(...params) as T) ?? null;
  } catch {
    return null;
  }
}

// ── Snapshot builder ───────────────────────────────────────────────────────

function buildSnapshot(status: DesktopStatus): SyncSnapshot {
  const conversations = dbGet<{
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
    message_count: number;
  }>(
    `SELECT c.id, c.title, c.created_at, c.updated_at,
            COUNT(m.id) as message_count
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
      GROUP BY c.id
      ORDER BY c.updated_at DESC
      LIMIT 50`
  ).map((c) => ({ ...c, preview: undefined }));

  // Last 30 messages across recent 5 conversations
  const recentConvoIds = conversations.slice(0, 5).map((c) => c.id);
  const recentMessages: SyncMessage[] =
    recentConvoIds.length > 0
      ? dbGet<{
          id: string;
          conversation_id: string;
          role: string;
          content: string;
          model: string;
          created_at: string;
        }>(
          `SELECT id, conversation_id, role, content, model, created_at
             FROM messages
            WHERE conversation_id IN (${recentConvoIds.map(() => '?').join(',')})
            ORDER BY created_at DESC
            LIMIT 30`,
          ...recentConvoIds
        ).map((m) => ({
          ...m,
          role: m.role as SyncMessage['role'],
        }))
      : [];

  const tasks = dbGet<{
    id: string;
    description: string;
    status: string;
    priority: number;
    type: string;
    result: string;
    error: string;
    cost: number;
    created_at: string;
    started_at: string;
    completed_at: string;
  }>(`SELECT * FROM tasks ORDER BY created_at DESC LIMIT 100`);

  const filesMetadata = dbGet<{
    id: string;
    file_path: string;
    file_type: string;
    summary: string;
    size_bytes: number;
    last_indexed: string;
  }>(
    `SELECT id, file_path, file_type, summary, size_bytes, last_indexed
       FROM workspace_index
      ORDER BY last_indexed DESC
      LIMIT 200`
  );

  // Notes are stored in localStorage on the renderer side; we expose
  // whatever has been reported to us via the /sync/notes endpoint or
  // via a renderer-pushed event.
  const notes = _notesCache;

  return {
    timestamp: Date.now(),
    conversations,
    recentMessages,
    tasks,
    notes,
    filesMetadata,
    settings: _roamingSettings,
    desktopStatus: status,
    pendingActions: Array.from(pendingActions.values()),
  };
}

// ── Notes cache (renderer pushes notes to us) ──────────────────────────────

let _notesCache: SyncSnapshot['notes'] = [];
let _roamingSettings: SyncSnapshot['settings'] = {};

// ── HTTP Request Router ────────────────────────────────────────────────────

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  corsHeaders(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://localhost:${currentPort}`);
  const path = url.pathname;
  const urlToken = url.searchParams.get('token') || '';

  // ── Mobile Companion UI ──────────────────────────────────────────────
  if ((path === '/' || path === '/companion') && req.method === 'GET') {
    const macName = os.hostname().replace('.local', '');
    const initToken = urlToken || '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Henry">
<title>Henry</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
:root{
  --bg:#08080e;--surface:#0f0f18;--surface2:#13131e;
  --border:#1a1a28;--accent:#6366f1;--text:#e8e8f0;
  --muted:#5a5a72;--green:#22c55e;--red:#ef4444;
}
html,body{height:100%;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,sans-serif;overflow:hidden;position:fixed;width:100%}
#app{position:fixed;inset:0;display:flex;flex-direction:column}

/* Status bar */
#bar{
  padding:env(safe-area-inset-top,12px) 16px 8px;
  padding-top:max(env(safe-area-inset-top),12px);
  background:var(--surface);border-bottom:1px solid var(--border);
  display:flex;align-items:center;gap:8px;flex-shrink:0;
}
#dot{width:6px;height:6px;border-radius:50%;background:var(--muted);transition:background .3s;flex-shrink:0}
#dot.on{background:var(--green)}#dot.thinking{background:var(--accent);animation:pulse .8s infinite}
#bar-name{font-size:15px;font-weight:700;letter-spacing:-.3px;flex:1}
#bar-status{font-size:11px;color:var(--muted)}
#screen-btn{background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:4px 10px;font-size:11px;color:var(--text);cursor:pointer}

/* Messages */
#msgs{flex:1;overflow-y:auto;padding:10px 0 4px;display:flex;flex-direction:column;gap:1px;-webkit-overflow-scrolling:touch;min-height:0}
.row{display:flex;padding:3px 14px}
.row.user{justify-content:flex-end}
.row.ai{justify-content:flex-start}
.bubble{max-width:84%;padding:9px 13px;font-size:15px;line-height:1.45;white-space:pre-wrap;word-break:break-word;border-radius:18px}
.bubble.user{background:var(--accent);color:#fff;border-bottom-right-radius:5px}
.bubble.ai{background:var(--surface2);color:var(--text);border-bottom-left-radius:5px;border:1px solid var(--border)}
.bubble img{max-width:100%;border-radius:10px;margin-top:6px;display:block;cursor:pointer}
.typing{display:inline-flex;gap:4px;padding:12px 14px;background:var(--surface2);border:1px solid var(--border);border-radius:18px;border-bottom-left-radius:5px}
.typing span{width:6px;height:6px;background:var(--muted);border-radius:50%;animation:blink 1.2s infinite}
.typing span:nth-child(2){animation-delay:.2s}.typing span:nth-child(3){animation-delay:.4s}
@keyframes blink{0%,80%,100%{opacity:.2}40%{opacity:1}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

/* Quick actions */
#quick{display:flex;gap:6px;overflow-x:auto;padding:6px 14px;flex-shrink:0;scrollbar-width:none}
#quick::-webkit-scrollbar{display:none}
.q{background:var(--surface2);border:1px solid var(--border);border-radius:16px;padding:5px 12px;font-size:12px;color:var(--text);cursor:pointer;white-space:nowrap;flex-shrink:0}
.q:active{background:var(--accent);border-color:var(--accent);color:#fff}

/* Input */
#inputbar{padding:8px 12px;padding-bottom:max(env(safe-area-inset-bottom),8px);background:var(--surface);border-top:1px solid var(--border);display:flex;align-items:flex-end;gap:8px;flex-shrink:0}
#mic{width:40px;height:40px;border-radius:50%;background:var(--surface2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;transition:all .2s}
#mic.listening{background:var(--red);border-color:var(--red);animation:pulse .8s infinite}
#mic svg{width:18px;height:18px;fill:var(--muted);transition:fill .2s}
#mic.listening svg{fill:#fff}
#inp{flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:20px;padding:9px 14px;font-size:16px;color:var(--text);outline:none;resize:none;max-height:100px;font-family:inherit;line-height:1.4;-webkit-text-fill-color:var(--text)}
#inp::placeholder{color:var(--muted)}
#send{width:40px;height:40px;border-radius:50%;background:var(--accent);border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;opacity:.4;transition:opacity .2s}
#send.ready{opacity:1}
#send svg{width:18px;height:18px;fill:#fff}

/* Screen overlay */
#screen-overlay{position:fixed;inset:0;background:#000;z-index:100;display:none;flex-direction:column}
#screen-overlay.show{display:flex}
#screen-top{padding:env(safe-area-inset-top,12px) 14px 10px;padding-top:max(env(safe-area-inset-top),12px);background:rgba(0,0,0,.8);display:flex;align-items:center;gap:10px;flex-shrink:0}
#screen-close{background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:5px 12px;font-size:12px;color:var(--text);cursor:pointer}
#screen-img-wrap{flex:1;overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:8px}
#screen-img{max-width:100%;border-radius:8px}
#auto-label{display:flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);cursor:pointer;margin-left:auto}

/* Pair screen */
#pair-screen{position:fixed;inset:0;background:var(--bg);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:40px 24px;text-align:center;z-index:50}
#pair-screen h1{font-size:28px;font-weight:800;letter-spacing:-.5px}
#pair-screen p{color:var(--muted);font-size:15px;line-height:1.5;max-width:260px}
#pair-input{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:14px 20px;color:var(--text);font-size:24px;font-weight:700;width:100%;max-width:280px;outline:none;text-align:center;letter-spacing:6px;-webkit-text-fill-color:var(--text)}
#pair-btn{background:var(--accent);color:#fff;border:none;border-radius:14px;padding:15px 24px;font-size:16px;font-weight:700;cursor:pointer;width:100%;max-width:280px}
#pair-err{color:var(--red);font-size:13px;display:none;max-width:280px}
</style>
</head>
<body>
<div id="app">
  <!-- Main chat (hidden until connected) -->
  <div id="bar" style="display:none">
    <div id="dot"></div>
    <span id="bar-name">Henry</span>
    <span id="bar-status">Connecting…</span>
    <button id="screen-btn" onclick="toggleScreen()">📺 Screen</button>
  </div>
  <div id="msgs" style="display:none"></div>
  <div id="quick" style="display:none">
    <button class="q" onclick="q('open Finder')">📁 Finder</button>
    <button class="q" onclick="q('open Safari')">🌐 Safari</button>
    <button class="q" onclick="q('take a screenshot')">📸 Screen</button>
    <button class="q" onclick="q('what apps are running')">📱 Apps</button>
    <button class="q" onclick="q('disk space')">💾 Disk</button>
    <button class="q" onclick="q('open Chrome')">🔵 Chrome</button>
    <button class="q" onclick="q('open VS Code')">💻 VS Code</button>
    <button class="q" onclick="q('open Terminal')">⌨️ Terminal</button>
  </div>
  <div id="inputbar" style="display:none">
    <button id="mic"><svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1 1.93c-3.94-.49-7-3.86-7-7.93H2c0 4.97 3.66 9.09 8.5 9.82V22h3v-3.07c4.84-.73 8.5-4.85 8.5-9.82h-2c0 4.07-3.06 7.44-7 7.93z"/></svg></button>
    <textarea id="inp" placeholder="Ask Henry or tell him to do something…" rows="1"></textarea>
    <button id="send"><svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>
  </div>

  <!-- Live screen overlay -->
  <div id="screen-overlay">
    <div id="screen-top">
      <span style="font-size:13px;color:var(--muted)">Mac Screen · Live</span>
      <label id="auto-label"><input type="checkbox" id="auto-cb" onchange="toggleAuto(this.checked)"> Auto-refresh</label>
      <button id="screen-close" onclick="toggleScreen()">✕ Close</button>
    </div>
    <div id="screen-img-wrap">
      <img id="screen-img" alt="Tap 'Screen' to capture" onclick="refreshScreen()">
    </div>
  </div>

  <!-- Pair screen -->
  <div id="pair-screen">
    <h1>Henry</h1>
    <p>Your personal AI on <strong>${macName}</strong>.<br>Connecting automatically…</p>
    <input id="pair-input" type="number" inputmode="numeric" placeholder="______" maxlength="6" style="display:none">
    <button id="pair-btn" style="display:none">Connect</button>
    <p id="pair-err"></p>
    <p id="pair-hint" style="font-size:11px;color:var(--muted);margin-top:4px"></p>
  </div>
</div>
<script>
// ── State ──────────────────────────────────────────────────────────────────
const STORAGE_KEY_TOKEN = 'henry_token';
const STORAGE_KEY_UUID  = 'henry_device_uuid';
const STORAGE_KEY_HMAC  = 'henry_device_hmac';
const STORAGE_KEY_SECRET= 'henry_hmac_secret';

window.H = {
  token: localStorage.getItem(STORAGE_KEY_TOKEN) || '',
  uuid:  localStorage.getItem(STORAGE_KEY_UUID)  || '',
  hmac:  localStorage.getItem(STORAGE_KEY_HMAC)  || '',
  secret:localStorage.getItem(STORAGE_KEY_SECRET)|| '',
  history: [],
  streaming: null,  // current streaming bubble
  streamText: '',
  es: null,
  autoRefreshTimer: null,
  screenOpen: false,
};

// ── DOM refs ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const bar=$('bar'), msgs=$('msgs'), quick=$('quick'), inputbar=$('inputbar');
const dot=$('dot'), barStatus=$('bar-status');
const inp=$('inp'), sendBtn=$('send'), micBtn=$('mic');
const pairScreen=$('pair-screen'), pairErr=$('pair-err'), pairHint=$('pair-hint');
const pairInput=$('pair-input'), pairBtn=$('pair-btn');
const screenOverlay=$('screen-overlay'), screenImg=$('screen-img');

// ── Show/hide chat UI ──────────────────────────────────────────────────────
function showChat() {
  pairScreen.style.display = 'none';
  [bar, msgs, quick, inputbar].forEach(el => el.style.display = '');
  msgs.style.display = 'flex';
  msgs.style.flexDirection = 'column';
  inp.focus();
}

// ── Messages ───────────────────────────────────────────────────────────────
function addMsg(role, content) {
  const row = document.createElement('div');
  row.className = 'row ' + (role === 'user' ? 'user' : 'ai');
  const b = document.createElement('div');
  b.className = 'bubble ' + (role === 'user' ? 'user' : 'ai');
  if (typeof content === 'string') b.textContent = content;
  else b.appendChild(content);
  row.appendChild(b);
  msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
  if (role !== 'typing') H.history.push({role: role==='user'?'user':'assistant', content: typeof content==='string'?content:'[screenshot]'});
  return b;
}

function showTyping() {
  removeTyping();
  const row = document.createElement('div');
  row.id = 'typing-row'; row.className = 'row ai';
  row.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
  msgs.appendChild(row); msgs.scrollTop = msgs.scrollHeight;
}
function removeTyping() { const t = $('typing-row'); if (t) t.remove(); }

function appendChunk(chunk) {
  removeTyping();
  if (!H.streaming) {
    const row = document.createElement('div');
    row.className = 'row ai';
    H.streaming = document.createElement('div');
    H.streaming.className = 'bubble ai';
    row.appendChild(H.streaming);
    msgs.appendChild(row);
    H.streamText = '';
  }
  H.streamText += chunk;
  H.streaming.textContent = H.streamText;
  msgs.scrollTop = msgs.scrollHeight;
}

function finalizeStream(text) {
  removeTyping();
  if (H.streaming) {
    H.streaming.textContent = text;
    H.history.push({role:'assistant', content: text});
    H.streaming = null; H.streamText = '';
  } else if (text) {
    addMsg('ai', text);
  }
  dot.className = 'on';
  barStatus.textContent = 'Ready';
  sendBtn.classList.add('ready');
  msgs.scrollTop = msgs.scrollHeight;
}

function showScreenshotInChat(base64) {
  removeTyping();
  const img = document.createElement('img');
  img.src = 'data:image/png;base64,' + base64;
  img.onclick = () => {
    screenImg.src = img.src;
    screenOverlay.classList.add('show');
    H.screenOpen = true;
  };
  const bubble = document.createElement('div');
  bubble.className = 'bubble ai';
  bubble.appendChild(img);
  const row = document.createElement('div');
  row.className = 'row ai';
  row.appendChild(bubble);
  msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
  sendBtn.classList.add('ready');
  dot.className = 'on';
}

// ── Send message ───────────────────────────────────────────────────────────
async function send() {
  const text = inp.value.trim();
  if (!text) return;
  inp.value = ''; inp.style.height = 'auto';
  sendBtn.classList.remove('ready');
  dot.className = 'thinking';
  barStatus.textContent = 'Thinking…';
  addMsg('user', text);
  showTyping();

  try {
    const r = await fetch('/sync/prompt', {
      method: 'POST',
      headers: {'Content-Type':'application/json','Authorization':'Bearer '+H.token},
      body: JSON.stringify({text, history: H.history.slice(-8)})
    });
    if (r.status === 401) {
      removeTyping();
      addMsg('ai', 'Reconnecting…');
      const ok = await reconnect();
      if (ok) { inp.value = text; send(); }
      else { addMsg('ai', 'Could not reconnect. Refresh the page.'); }
    }
  } catch(e) {
    removeTyping();
    addMsg('ai', 'Connection lost. Check WiFi.');
    sendBtn.classList.add('ready');
    dot.className = '';
  }
}

window.q = function(text) { inp.value = text; send(); };

// ── Screen ─────────────────────────────────────────────────────────────────
function toggleScreen() {
  H.screenOpen = !H.screenOpen;
  screenOverlay.classList.toggle('show', H.screenOpen);
  if (H.screenOpen) refreshScreen();
}
function refreshScreen() {
  screenImg.src = '/screen?' + Date.now();
}
function toggleAuto(on) {
  clearInterval(H.autoRefreshTimer);
  if (on) H.autoRefreshTimer = setInterval(refreshScreen, 2500);
}
window.toggleScreen = toggleScreen;
window.toggleAuto = toggleAuto;

// ── SSE ────────────────────────────────────────────────────────────────────
function connectSSE() {
  if (H.es) { try { H.es.close(); } catch {} }
  H.es = new EventSource('/sync/stream?token=' + H.token);
  H.es.onopen = () => { dot.className = 'on'; barStatus.textContent = 'Ready'; sendBtn.classList.add('ready'); };
  H.es.onerror = () => { dot.className = ''; barStatus.textContent = 'Reconnecting…'; setTimeout(connectSSE, 3000); };
  H.es.onmessage = (e) => {
    try {
      const d = JSON.parse(e.data);
      if (d.type === 'companion_chunk') appendChunk(d.payload.chunk);
      else if (d.type === 'companion_response') finalizeStream(d.payload.text);
      else if (d.type === 'companion_screenshot') showScreenshotInChat(d.payload.base64);
    } catch {}
  };
}

// ── Auth ───────────────────────────────────────────────────────────────────
function getDeviceInfo() {
  const ua = navigator.userAgent;
  const isIpad = ua.includes('iPad') || (ua.includes('Mac') && navigator.maxTouchPoints > 1);
  return {
    deviceName: isIpad ? 'iPad' : ua.includes('iPhone') ? 'iPhone' : 'Browser',
    platform: (ua.includes('iPhone') || isIpad) ? 'ios' : 'android',
    appleProduct: isIpad ? 'ipad' : ua.includes('iPhone') ? 'iphone' : 'unknown',
    capabilities: ['chat','prompt','notify','screen'],
  };
}

async function tryRejoin() {
  if (!H.uuid || !H.hmac) return false;
  try {
    const r = await fetch('/sync/rejoin', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({deviceUuid: H.uuid, hmac: H.hmac, ...getDeviceInfo()})
    });
    const d = await r.json();
    if (d.companionToken) {
      H.token = d.companionToken;
      localStorage.setItem(STORAGE_KEY_TOKEN, H.token);
      return true;
    }
  } catch {}
  return false;
}

async function tryTokenAuth() {
  if (!H.token) return false;
  try {
    const r = await fetch('/sync/snapshot', {headers:{'Authorization':'Bearer '+H.token}});
    return r.ok;
  } catch { return false; }
}

async function autoPair() {
  pairHint.textContent = 'Connecting…';
  try {
    const r = await fetch('/sync/auto-pair', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(getDeviceInfo())
    });
    const d = await r.json();
    if (d.companionToken) {
      H.token = d.companionToken;
      H.uuid  = d.deviceId;
      // Store HMAC for future rejoin
      if (d.hmacSecret) {
        H.secret = d.hmacSecret;
        // Compute HMAC client-side using SubtleCrypto for future rejoin
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey('raw', enc.encode(d.hmacSecret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
        const sig = await crypto.subtle.sign('HMAC', key, enc.encode(d.deviceId));
        H.hmac = Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,'0')).join('');
        localStorage.setItem(STORAGE_KEY_HMAC, H.hmac);
        localStorage.setItem(STORAGE_KEY_SECRET, H.secret);
      }
      localStorage.setItem(STORAGE_KEY_TOKEN, H.token);
      localStorage.setItem(STORAGE_KEY_UUID, H.uuid);
      return true;
    }
  } catch(e) { pairHint.textContent = 'Auto-connect failed: ' + e.message; }
  return false;
}

async function submitManualPair() {
  const code = pairInput.value.trim();
  if (code.length !== 6) { pairErr.textContent = 'Enter the 6-digit code from Henry on your Mac.'; pairErr.style.display='block'; return; }
  pairBtn.disabled = true; pairBtn.textContent = 'Connecting…';
  try {
    const r = await fetch('/sync/pair', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({pairToken: code, ...getDeviceInfo()})
    });
    const d = await r.json();
    if (d.companionToken) {
      H.token = d.companionToken; H.uuid = d.deviceId;
      localStorage.setItem(STORAGE_KEY_TOKEN, H.token);
      localStorage.setItem(STORAGE_KEY_UUID, H.uuid);
      goConnected();
    } else {
      pairErr.textContent = d.error || 'Invalid code.';
      pairErr.style.display = 'block';
      pairBtn.disabled = false; pairBtn.textContent = 'Connect';
    }
  } catch { pairErr.textContent = 'Connection failed.'; pairErr.style.display='block'; pairBtn.disabled=false; pairBtn.textContent='Try Again'; }
}

async function reconnect() {
  if (await tryRejoin()) return true;
  if (await autoPair()) return true;
  return false;
}

function goConnected() {
  showChat();
  addMsg('ai', "Hi! I'm Henry. Tell me what you want or tap a quick action below.");
  connectSSE();
}

// ── Mic ────────────────────────────────────────────────────────────────────
let recognition = null;
function setupMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { micBtn.style.display = 'none'; return; }
  recognition = new SR();
  recognition.continuous = false; recognition.interimResults = true; recognition.lang = 'en-US';
  recognition.onstart = () => { micBtn.classList.add('listening'); inp.placeholder = 'Listening…'; };
  recognition.onresult = (e) => {
    const t = Array.from(e.results).map(r=>r[0].transcript).join('');
    inp.value = t;
    if (e.results[e.results.length-1].isFinal) { inp.value = t; setTimeout(send, 250); }
  };
  recognition.onend = () => { micBtn.classList.remove('listening'); inp.placeholder = 'Ask Henry or tell him to do something…'; };
  recognition.onerror = (e) => { micBtn.classList.remove('listening'); if (e.error!=='no-speech') addMsg('ai','Mic error: '+e.error); };
}
micBtn.addEventListener('click', () => {
  if (!recognition) setupMic();
  if (!recognition) return;
  if (micBtn.classList.contains('listening')) recognition.stop();
  else { inp.value = ''; recognition.start(); }
});
setupMic();

// ── Input ──────────────────────────────────────────────────────────────────
inp.addEventListener('input', () => {
  inp.style.height = 'auto';
  inp.style.height = Math.min(inp.scrollHeight, 100) + 'px';
  sendBtn.classList.toggle('ready', inp.value.trim().length > 0);
});
inp.addEventListener('keydown', e => { if (e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();} });
sendBtn.addEventListener('click', send);
pairBtn.addEventListener('click', submitManualPair);

// ── Boot ───────────────────────────────────────────────────────────────────
(async function boot() {
  const urlToken = '${initToken}';

  // Try fastest path first
  if (urlToken && urlToken.length === 6) {
    // QR code with pairing token
    pairInput.value = urlToken;
    pairInput.style.display = '';
    pairBtn.style.display = '';
    submitManualPair();
    return;
  }

  // Try existing session token
  if (H.token && await tryTokenAuth()) { goConnected(); return; }

  // Try persistent device rejoin (no-code reconnect)
  pairHint.textContent = 'Reconnecting…';
  if (await tryRejoin()) { goConnected(); return; }

  // Auto-pair on same network
  if (await autoPair()) { goConnected(); return; }

  // Fall back to manual pair input
  pairHint.textContent = 'Enter the 6-digit code shown in Henry on your Mac.';
  pairInput.style.display = '';
  pairBtn.style.display = '';
  pairErr.style.display = 'none';
})();
</script>
</body>
</html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
    return;
  }
     // ── Internal Computer Control (called from renderer to bypass webMock) ──
  const isInternal = req.headers['x-henry-internal'] === 'true';
  if (isInternal && req.method === 'POST') {
    if (path === '/computer/shell') {
      const body = await readBody<{command: string}>(req);
      if (!body) { jsonResponse(res, 400, {success: false, error: 'Bad request'}); return; }
      try {
        const { exec } = await import('child_process');
        const home = os.homedir();
        const cmd = (body.command || '')
          .replace(/\/Users\/yourusername\//g, home + '/')
          .replace(/\/Users\/your_username\//g, home + '/')
          .replace(/^~\//g, home + '/');
        const result = await new Promise<{stdout:string;stderr:string;exitCode:number}>((resolve) => {
          exec(cmd, {timeout: 30000, env: {...process.env, HOME: home}}, (err, stdout, stderr) => {
            resolve({stdout: stdout || '', stderr: stderr || '', exitCode: err?.code ?? 0});
          });
        });
        jsonResponse(res, 200, {success: result.exitCode === 0, output: result.stdout, error: result.stderr, exitCode: result.exitCode});
      } catch(e) {
        jsonResponse(res, 200, {success: false, error: e instanceof Error ? e.message : String(e)});
      }
      return;
    }
    if (path === '/computer/newfolder') {
      const body = await readBody<{path: string}>(req);
      if (!body) { jsonResponse(res, 400, {ok: false, error: 'Bad request'}); return; }
      try {
        const home = os.homedir();
        const target = (body.path || '')
          .replace(/^~/, home)
          .replace(/\/Users\/yourusername\//g, home + '/')
          .replace(/\/Users\/your_username\//g, home + '/');
        fs.mkdirSync(target, {recursive: true});
        jsonResponse(res, 200, {ok: true, path: target});
      } catch(e) {
        jsonResponse(res, 200, {ok: false, error: e instanceof Error ? e.message : String(e)});
      }
      return;
    }
    if (path === '/computer/openapp') {
      const body = await readBody<{name: string}>(req);
      if (!body) { jsonResponse(res, 400, {ok: false, error: 'Bad request'}); return; }
      try {
        const { exec } = await import('child_process');
        exec(`open -a "${body.name}"`, (err) => {});
        jsonResponse(res, 200, {ok: true});
      } catch(e) {
        jsonResponse(res, 200, {ok: false, error: e instanceof Error ? e.message : String(e)});
      }
      return;
    }
    if (path === '/computer/screenshot') {
      try {
        const tmpFile = os.tmpdir() + '/henry_sc_' + Date.now() + '.png';
        const { exec } = await import('child_process');
        await new Promise<void>((resolve, reject) => {
          exec(`screencapture -x "${tmpFile}"`, (err) => err ? reject(err) : resolve());
        });
        const buf = fs.readFileSync(tmpFile);
        fs.unlinkSync(tmpFile);
        jsonResponse(res, 200, {success: true, base64: buf.toString('base64')});
      } catch(e) {
        jsonResponse(res, 200, {success: false, error: e instanceof Error ? e.message : String(e)});
      }
      return;
    }
    if (path === '/computer/osascript') {
      const body = await readBody<{script: string}>(req);
      if (!body) { jsonResponse(res, 400, {ok: false, error: 'Bad request'}); return; }
      try {
        const { exec } = await import('child_process');
        const result = await new Promise<string>((resolve, reject) => {
          exec(`osascript -e '${body.script.replace(/'/g, "'\''")}'`, (err, stdout) => {
            err ? reject(err) : resolve(stdout.trim());
          });
        });
        jsonResponse(res, 200, {ok: true, output: result});
      } catch(e) {
        jsonResponse(res, 200, {ok: false, error: e instanceof Error ? e.message : String(e)});
      }
      return;
    }
  }

  // ── Internal sync state endpoints (called from renderer to bypass webMock) ──
  if (isInternal) {
    if (path === '/sync/start-internal') {
      jsonResponse(res, 200, { ok: serverRunning, port: currentPort });
      return;
    }
    if (path === '/sync/state-internal') {
      jsonResponse(res, 200, {
        running: serverRunning,
        port: currentPort,
        tunnelUrl,
        pairToken: pairToken && Date.now() < pairTokenExpiry ? pairToken : null,
        pairTokenExpiry,
        linkedDevices: [...linkedDevices.values()],
      });
      return;
    }
    if (path === '/sync/generate-pair-internal' && req.method === 'POST') {
      const token = Math.floor(100000 + Math.random() * 900000).toString();
      pairToken = token;
      pairTokenExpiry = Date.now() + 10 * 60 * 1000; // 10 min
      jsonResponse(res, 200, { token, expiry: pairTokenExpiry });
      return;
    }
    if (path === '/sync/revoke-pair-internal' && req.method === 'POST') {
      revokePairToken();
      jsonResponse(res, 200, { ok: true });
      return;
    }
    if (path === '/sync/unlink-device-internal' && req.method === 'POST') {
      const body = await readBody<{id: string}>(req);
      if (body?.id) unlinkDevice(body.id);
      jsonResponse(res, 200, { ok: true });
      return;
    }
    if (path === '/sync/get-tunnel-url') {
      jsonResponse(res, 200, { url: tunnelUrl });
      return;
    }
  }

  // ── Health ────────────────────────────────────────────────────────────
  // Live screen endpoint — no auth, returns fresh screenshot as JPEG
  if (path === '/screen' && req.method === 'GET') {
    try {
      const { execSync } = await import('child_process') as typeof import('child_process');
      const tmp = os.tmpdir() + '/henry_live_' + Date.now() + '.jpg';
      execSync('screencapture -x -t jpg "' + tmp + '"', { timeout: 5000 });
      const buf = fs.readFileSync(tmp);
      try { fs.unlinkSync(tmp); } catch { }
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(buf);
    } catch (e) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Screenshot unavailable. Grant Screen Recording permission in System Settings.' }));
    }
    return;
  }

  if (path === '/sync/health' && req.method === 'GET') {
    const deviceId = validateToken(req);
    jsonResponse(res, deviceId ? 200 : 401, { ok: !!deviceId });
    return;
  }

  // ── Pairing ───────────────────────────────────────────────────────────
  // ── Rejoin: persistent device re-auth — no pairing needed after first pair ──
  // Device stores its UUID and a shared secret. On reconnect it sends both.
  // Server validates against companion_linked_devices table and issues new token.
  if (path === '/sync/rejoin' && req.method === 'POST') {
    const body = await readBody<{deviceUuid: string; hmac: string; deviceName?: string}>(req);
    if (!body?.deviceUuid) { jsonResponse(res, 400, { error: 'Bad request' }); return; }

    try {
      // Look up device by UUID in SQLite
      const stored = dbGetOne<{
        device_id: string; device_name: string; platform: string;
        token_hmac: string; capabilities_json: string; apple_product: string;
      }>('SELECT * FROM companion_linked_devices WHERE device_id = ?', body.deviceUuid);

      if (!stored) {
        jsonResponse(res, 401, { error: 'Device not registered. Pair first.' });
        return;
      }

      // Validate HMAC — device signs its UUID with the shared secret
      const { createHmac } = await import('crypto') as typeof import('crypto');
      const secret = dbGetOne<{value: string}>('SELECT value FROM settings WHERE key = ?', 'companion_hmac_secret_v1');
      const expectedHmac = createHmac('sha256', secret?.value || 'henry-default-secret')
        .update(body.deviceUuid)
        .digest('hex');

      if (body.hmac !== expectedHmac) {
        jsonResponse(res, 401, { error: 'Invalid device signature.' });
        return;
      }

      // Issue new session token
      const newToken = generateToken(32);
      companionTokens.set(newToken, stored.device_id);

      // Update last_seen
      dbRun('UPDATE companion_linked_devices SET last_seen = ?, last_sync_at = ? WHERE device_id = ?',
        new Date().toISOString(), new Date().toISOString(), stored.device_id);

      // Restore device to in-memory map
      linkedDevices.set(stored.device_id, {
        id: stored.device_id,
        name: body.deviceName || stored.device_name,
        platform: stored.platform as DeviceInfo['platform'],
        linkedAt: '',
        lastSeen: new Date().toISOString(),
        lastSyncAt: new Date().toISOString(),
        linkStatus: 'linked',
        capabilities: [...COMPANION_DEFAULT_DEVICE_CAPABILITIES],
        appleProduct: (stored.apple_product || 'unknown') as DeviceInfo['appleProduct'],
      });

      saveCompanionTokens();
      jsonResponse(res, 200, { companionToken: newToken, deviceId: stored.device_id, desktopName: os.hostname() });
    } catch (e) {
      jsonResponse(res, 500, { error: 'Rejoin failed: ' + (e instanceof Error ? e.message : String(e)) });
    }
    return;
  }

  // Auto-pair: generates token + pairs in one request, no code needed
  // Only works on local network (no external auth needed)
  if (path === '/sync/auto-pair' && req.method === 'POST') {
    const body = await readBody<PairRequest>(req);
    if (!body) { jsonResponse(res, 400, { error: 'Bad request' }); return; }

    // Generate a fresh token and immediately pair
    const autoToken = Math.floor(100000 + Math.random() * 900000).toString();
    pairToken = autoToken;
    pairTokenExpiry = Date.now() + 30_000; // 30 seconds

    const deviceId2 = generateToken(12);
    const companionToken2 = generateToken(32);
    companionTokens.set(companionToken2, deviceId2);

    const ap2 = body.appleProduct;
    const appleProduct2: DeviceInfo['appleProduct'] =
      ap2 === 'ipad' ? 'ipad' : ap2 === 'iphone' ? 'iphone' : 'unknown';

    const device2: DeviceInfo = {
      id: deviceId2,
      name: body.deviceName ?? 'Device',
      platform: (body.platform as DeviceInfo['platform']) ?? 'web',
      linkedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      lastSyncAt: new Date().toISOString(),
      pushToken: body.pushToken,
      linkStatus: 'linked',
      capabilities: [...COMPANION_DEFAULT_DEVICE_CAPABILITIES],
      appleProduct: appleProduct2,
    };
    linkedDevices.set(deviceId2, device2);
    pairToken = null; // consumed

    notifyRenderer('henry:companion:device-linked', { device: device2 });
    saveCompanionTokens();

    // Persist to SQLite for permanent re-auth
    try {
      const { createHmac } = await import('crypto') as typeof import('crypto');
      let secret = dbGetOne<{value:string}>('SELECT value FROM settings WHERE key = ?', 'companion_hmac_secret_v1');
      if (!secret) {
        const newSecret = generateToken(32);
        dbRun("INSERT OR IGNORE INTO settings(key,value) VALUES('companion_hmac_secret_v1',?)", newSecret);
        secret = { value: newSecret };
      }
      const hmac = createHmac('sha256', secret.value).update(deviceId2).digest('hex');
      dbRun(`INSERT OR REPLACE INTO companion_linked_devices
        (device_id,device_name,platform,apple_product,capabilities_json,link_status,linked_at,last_seen,last_sync_at,token_hmac)
        VALUES(?,?,?,?,?,?,?,?,?,?)`,
        deviceId2, body?.deviceName ?? 'Device',
        body?.platform ?? 'web', body?.appleProduct ?? 'unknown',
        JSON.stringify(COMPANION_DEFAULT_DEVICE_CAPABILITIES),
        'linked', new Date().toISOString(), new Date().toISOString(), new Date().toISOString(), hmac
      );
      // Return the HMAC secret so device can rejoin later without pairing
      jsonResponse(res, 200, {
        companionToken: companionToken2,
        deviceId: deviceId2,
        deviceHmac: hmac,
        hmacSecret: secret.value,
        desktopName: os.hostname(),
      });
    } catch {
      jsonResponse(res, 200, { companionToken: companionToken2, deviceId: deviceId2, desktopName: os.hostname() });
    }
    return;
  }

  if (path === '/sync/pair' && req.method === 'POST') {
    const body = await readBody<PairRequest>(req);
    if (!body) { jsonResponse(res, 400, { error: 'Bad request' }); return; }
    if (!pairToken || Date.now() > pairTokenExpiry) {
      jsonResponse(res, 403, { error: 'Pair token expired or not set' });
      return;
    }
    if (body.pairToken !== pairToken) {
      jsonResponse(res, 403, { error: 'Invalid pair token' });
      return;
    }

    const deviceId = generateToken(12);
    const companionToken = generateToken(32);
    companionTokens.set(companionToken, deviceId);

    const ap = body.appleProduct;
    const appleProduct: DeviceInfo['appleProduct'] =
      ap === 'ipad' ? 'ipad' : ap === 'iphone' ? 'iphone' : 'unknown';

    const device: DeviceInfo = {
      id: deviceId,
      name: body.deviceName ?? 'Unknown',
      platform: (body.platform as DeviceInfo['platform']) ?? 'ios',
      linkedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      lastSyncAt: new Date().toISOString(),
      pushToken: body.pushToken,
      linkStatus: 'linked',
      capabilities: [...COMPANION_DEFAULT_DEVICE_CAPABILITIES],
      appleProduct,
    };
    linkedDevices.set(deviceId, device);

    // Invalidate pair token after use
    pairToken = null;

    // Notify renderer
    notifyRenderer('henry:companion:device-linked', { device });
    saveCompanionTokens(); // Persist for server restarts

    const resp: PairResponse = {
      companionToken,
      deviceId,
      desktopName: os.hostname(),
    };
    jsonResponse(res, 200, resp);
    return;
  }

  // All routes below require a valid token
  const deviceId = validateToken(req);
  if (!deviceId) {
    jsonResponse(res, 401, { error: 'Unauthorized' });
    return;
  }

  // Update last seen (+ sync time for companion device model)
  const nowIso = new Date().toISOString();
  const dev = linkedDevices.get(deviceId);
  if (dev) {
    linkedDevices.set(deviceId, {
      ...dev,
      lastSeen: nowIso,
      lastSyncAt: nowIso,
      linkStatus: 'linked',
    });
  }

  // ── Snapshot ──────────────────────────────────────────────────────────
  if (path === '/sync/snapshot' && req.method === 'GET') {
    const status = await getDesktopStatus();
    const snap = buildSnapshot(status);
    jsonResponse(res, 200, snap);
    return;
  }

  // ── Events (delta) ────────────────────────────────────────────────────
  if (path === '/sync/events' && req.method === 'GET') {
    const since = parseInt(url.searchParams.get('since') ?? '0', 10);
    const events = eventLog.filter((e) => e.timestamp > since);
    jsonResponse(res, 200, events);
    return;
  }

  // ── Messages for a conversation ───────────────────────────────────────
  if (path.startsWith('/sync/conversations/') && req.method === 'GET') {
    const parts = path.split('/').filter(Boolean);
    // /sync/conversations/:id or /sync/conversations/:id/messages
    const convId = parts[2];
    const tail = parts[3];
    if (!convId) { jsonResponse(res, 400, { error: 'Missing conversationId' }); return; }
    if (tail && tail !== 'messages') {
      jsonResponse(res, 404, { error: 'Unknown route' });
      return;
    }
    const msgs = dbGet(
      `SELECT id, conversation_id, role, content, model, created_at
         FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`,
      convId
    );
    jsonResponse(res, 200, msgs);
    return;
  }

  // ── SSE stream ────────────────────────────────────────────────────────
  if (path === '/sync/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(': connected\n\n');

    const client: SSEClient = { deviceId, res };
    sseClients.push(client);

    // Send a heartbeat every 25 s; clean up eagerly on write failure.
    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
        // Update lastSeen so the desktop shows "Online now"
        const d = linkedDevices.get(deviceId);
        if (d) linkedDevices.set(deviceId, {...d, lastSeen: new Date().toISOString(), lastSyncAt: new Date().toISOString()});
      } catch {
        clearInterval(heartbeat);
        sseClients = sseClients.filter((c) => c !== client);
      }
    }, 15_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients = sseClients.filter((c) => c !== client);
    });
    return;
  }

  // ── Capture ───────────────────────────────────────────────────────────
  if (path === '/sync/capture' && req.method === 'POST') {
    const capture = await readBody<CapturePayload>(req);
    if (!capture) { jsonResponse(res, 400, { error: 'Bad request' }); return; }
    capture.fromDevice = deviceId;
    capture.timestamp = Date.now();

    // Forward to renderer for processing
    notifyRenderer('henry:companion:capture', capture);

    jsonResponse(res, 200, { captureId: capture.id, accepted: true });
    return;
  }

  // ── Text prompt ───────────────────────────────────────────────────────
  // ── Intent resolver — stateless helper ────────────────────────────────────
  function resolveIntent(text: string, ctx: DeviceContext): string {
    const t = text.toLowerCase().trim();

    // "do it again" / "again" / "repeat that"
    if (/^(do it again|again|repeat( that)?|one more time|redo)\.?$/i.test(t)) {
      if (ctx.lastCommand) return ctx.lastCommand;
      if (ctx.lastApp) return 'open ' + ctx.lastApp;
    }

    // "open it" / "open that" → last app
    if (/^open (it|that)\.?$/i.test(t) && ctx.lastApp) {
      return 'open ' + ctx.lastApp;
    }

    // "show me" / "show it" → screenshot
    if (/^show (me |it |that )?now\.?$/i.test(t) || t === 'show me') {
      return 'take a screenshot';
    }

    // "yes" / "do it" / "go ahead" after AI suggested something
    if (/^(yes|yeah|yep|do it|go ahead|sure|ok|okay|proceed)\.?$/i.test(t) && ctx.lastAiResponse) {
      // Extract any command-like suggestion from last AI response
      const cmdMatch = ctx.lastAiResponse.match(/`([^`]+)`/) || ctx.lastAiResponse.match(/run[:\s]+(.+)/i);
      if (cmdMatch) return cmdMatch[1];
    }

    return text; // no resolution needed
  }

  if (path === '/sync/prompt' && req.method === 'POST') {
    const body = await readBody<{
      text: string;
      conversationId?: string;
      contextNote?: string;
      history?: {role:string;content:string}[];
    }>(req);
    if (!body) { jsonResponse(res, 400, { error: 'Bad request' }); return; }

    // Acknowledge immediately
    jsonResponse(res, 200, { ok: true });

    const userText = (body.text || '').trim();
    const macHome = os.homedir();

    // ── Intent resolution — "do it again", "open that", context-aware ──────────
    const ctx = deviceContext.get(deviceId) || {};
    const resolvedText = resolveIntent(text, ctx);

    // Save last user text regardless
    deviceContext.set(deviceId, { ...ctx, lastUserText: text });

    // Direct computer command detection — no AI, just execute
    async function tryComputerCommand(text: string): Promise<string | null> {
      const t = text.toLowerCase().trim();
      const { execSync, exec } = await import('child_process') as typeof import('child_process');

      // Screenshot
      if (/screenshot|screen shot/.test(t)) {
        try {
          const tmp = os.tmpdir() + '/henry_sc_' + Date.now() + '.png';
          execSync('screencapture -x "' + tmp + '"', { timeout: 5000 });
          const buf = fs.readFileSync(tmp);
          try { fs.unlinkSync(tmp); } catch { }
          pushToDevice(deviceId, { type: 'companion_screenshot', payload: { base64: buf.toString('base64') } });
          return 'Screenshot taken.';
        } catch (e) { return 'Screenshot failed: ' + (e instanceof Error ? e.message : String(e)); }
      }

      // Create folder
      const folderM = text.match(/(?:create|make|new)\s+(?:a\s+)?folder\s+(?:called\s+|named\s+)?["\'\u201c\u2018]?([\w\s._-]+?)["\'\u201d\u2019]?(?:\s+(?:on|in|at)\s+(?:my\s+)?(desktop|documents|downloads))?/i);
      if (folderM) {
        const name = folderM[1].trim().replace(/\s+/g, ' ');
        const locStr = (folderM[2] || 'desktop').toLowerCase();
        const where = locStr === 'documents' ? macHome + '/Documents' : locStr === 'downloads' ? macHome + '/Downloads' : macHome + '/Desktop';
        const fullPath = where + '/' + name;
        try {
          fs.mkdirSync(fullPath, { recursive: true });
          exec('open "' + fullPath + '"');
          deviceContext.set(deviceId, { ...deviceContext.get(deviceId), lastFolder: fullPath });
          return 'Created "' + name + '" on your ' + locStr + ' and opened it in Finder.';
        } catch (e) { return 'Failed: ' + (e instanceof Error ? e.message : String(e)); }
      }

      // Open app
      const openAppM = text.match(/^open\s+(?:the\s+)?(?:app\s+)?(.+?)(?:\s+app)?$/i);
      if (openAppM && !t.includes('file') && !t.includes('/') && !t.includes('folder')) {
        const appName = openAppM[1].trim();
        try { execSync('open -a "' + appName + '"', { timeout: 5000 }); return 'Opened ' + appName + '.'; }
        catch { return 'Could not find "' + appName + '". Check the name.'; }
      }

      // Open URL
      const urlM = text.match(/(?:go to|open|navigate to)\s+(https?:\/\/\S+|www\.\S+)/i);
      if (urlM) {
        const url = urlM[1].startsWith('http') ? urlM[1] : 'https://' + urlM[1];
        execSync('open "' + url + '"', { timeout: 5000 });
        return 'Opening ' + url;
      }

      // Disk space
      if (/disk|storage|free space|how much/.test(t)) {
        const out = execSync('df -h / | tail -1', { encoding: 'utf8', timeout: 5000 }) as string;
        const p = out.trim().split(/\s+/);
        return 'Disk: ' + p[1] + ' total, ' + p[3] + ' free (' + p[4] + ' used)';
      }

      // Running apps
      if (/what.*(running|apps|open)|list.*apps/.test(t)) {
        const out = execSync("ps aux | awk '{print $11}' | grep -E '\\.app/' | sed 's/.*\\/\\([^\\/]*\\)\\.app.*/\\1/' | sort -u | grep -v '^$' | head -12", { encoding: 'utf8', shell: '/bin/bash', timeout: 5000 }) as string;
        return 'Running apps:\n' + out.trim();
      }

      // List files
      if (/list|show.*(?:desktop|files)|desktop.*files/.test(t)) {
        const target = t.includes('document') ? macHome + '/Documents' : t.includes('download') ? macHome + '/Downloads' : macHome + '/Desktop';
        const out = execSync('ls "' + target + '"', { encoding: 'utf8', timeout: 5000 }) as string;
        return (target.split('/').pop() || 'Desktop') + ':\n' + out.trim();
      }

      return null;
    }

    try {
      const cmdResult = await tryComputerCommand(resolvedText);
      if (cmdResult !== null) {
        pushToDevice(deviceId, { type: 'companion_response', payload: { text: cmdResult, done: true } });
        return;
      }
    } catch { /* fall through to AI */ }

    // Send to Groq for real questions
    try {
      const dbSettings = dbGet<{key:string;value:string}>('SELECT key, value FROM settings');
      const settingsMap: Record<string,string> = {};
      for (const {key,value} of dbSettings) settingsMap[key] = value;
      const dbProviders = dbGet<{id:string;api_key:string}>('SELECT id, api_key FROM providers WHERE enabled=1');
      const groq = dbProviders.find(p => p.id === 'groq');
      const apiKey = groq?.api_key || '';
      const model = settingsMap['companion_model'] || 'llama-3.3-70b-versatile';

      if (!apiKey) {
        pushToDevice(deviceId, { type: 'companion_response', payload: { text: 'No Groq API key set.', done: true } });
        return;
      }

      const history = body.history || [];
      const messages = [
        { role: 'system', content: 'You are Henry, a helpful AI assistant. The user is on their phone. Be concise.' },
        ...history.slice(-10),
        { role: 'user', content: userText }
      ];

      // Stream from Groq
      const { default: https } = await import('https');
      const postBody = JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 1500, stream: true });
      const opts = {
        hostname: 'api.groq.com',
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey, 'Content-Length': Buffer.byteLength(postBody) }
      };

      let fullText = '';
      let doneSent = false;
      const req2 = https.request(opts, (r2) => {
        r2.on('data', (chunk: Buffer) => {
          const lines = chunk.toString().split('\n');
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6);
            if (data === '[DONE]') {
              if (!doneSent) {
                doneSent = true;
                // Track AI response for intent resolution ("yes, do it", etc.)
                deviceContext.set(deviceId, { ...deviceContext.get(deviceId), lastAiResponse: fullText });
                // Strip "I can't access your computer" type responses — these shouldn't reach the user
                let cleanText = fullText;
                const cantPhrases = [
                  "I don't have direct access",
                  "I don't have access to your computer",
                  "I'm currently interacting with you on your phone",
                  "I cannot access your",
                  "I can't directly access",
                  "don't have the ability to",
                  "I'm a text-based AI",
                  "As an AI, I don't",
                  "I'm not able to access",
                ];
                const hasCannotPhrase = cantPhrases.some(p => cleanText.includes(p));
                if (hasCannotPhrase) {
                  cleanText = 'I had trouble with that. Try asking differently, or use the quick buttons at the bottom.';
                }
                pushToDevice(deviceId, { type: 'companion_response', payload: { text: cleanText, done: true } });
              }
              return;
            }
            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content || '';
              if (delta) {
                fullText += delta;
                pushToDevice(deviceId, { type: 'companion_chunk', payload: { chunk: delta } });
              }
            } catch { /* ignore parse errors */ }
          }
        });
        r2.on('end', async () => {
          if (!fullText || doneSent) return; // doneSent means [DONE] already pushed the response

          // Execute any computer actions Henry mentioned
          let finalText = fullText;
          const { execSync } = await import('child_process');
          const sysOs = await import('os');
          const sysHome = sysOs.default.homedir();

          // Check for screenshot request
          if (/computer:screenshot\s*\(\s*\)|take.*screenshot|screenshot/i.test(fullText)) {
            try {
              const tmpFile = sysOs.default.tmpdir() + '/henry_mobile_sc_' + Date.now() + '.png';
              execSync('screencapture -x "' + tmpFile + '"', {timeout: 5000});
              const sysFs = await import('fs');
              const buf = sysFs.default.readFileSync(tmpFile);
              sysFs.default.unlinkSync(tmpFile);
              const b64 = buf.toString('base64');
              pushToDevice(deviceId, { type: 'companion_screenshot', payload: { base64: b64 } });
            } catch(e) { /* screenshot failed */ }
          }

          // Check for folder creation
          const folderMatch = fullText.match(/computer:newFolder\s*\([^)]*path=["']?([^"',)]+)["']?[^)]*name=["']?([^"',)]+)["']?/i);
          if (folderMatch) {
            try {
              const folderPath = (folderMatch[1].trim().replace(/\/$/, '') + '/' + folderMatch[2].trim()).replace(/^~/, sysHome);
              const sysFs2 = await import('fs');
              sysFs2.default.mkdirSync(folderPath, {recursive: true});
              const { exec } = await import('child_process');
              exec('open "' + folderPath + '"');
              finalText = fullText + '\n\n✓ Folder created: ' + folderPath;
            } catch(e) { finalText = fullText + '\n\n✗ Folder error: ' + (e instanceof Error ? e.message : String(e)); }
          }

          // Check for shell command
          const shellMatch = fullText.match(/computer:runShell\s*\([^)]*command=["']([^"']+)["']/i)
            || fullText.match(/computer:runShell\s*\(([^)]+)\)/i);
          if (shellMatch && !folderMatch) {
            try {
              const cmd = shellMatch[1].replace(/command=["']?/i,'').replace(/["']$/,'').trim()
                .replace(/\/Users\/yourusername\//g, sysHome + '/').replace(/^~\//, sysHome + '/');
              const out = execSync(cmd, {timeout: 10000, encoding: 'utf8'});
              finalText = fullText + '\n\n✓ Output:\n' + (out?.trim() || 'Done');
            } catch(e) { finalText = fullText + '\n\n✗ Error: ' + (e instanceof Error ? e.message : String(e)); }
          }

          // Check for open app
          const appMatch = fullText.match(/computer:openApp\s*\(["']?([^"',)]+)["']?\)/i);
          if (appMatch) {
            try {
              const { exec } = await import('child_process');
              exec('open -a "' + appMatch[1].trim() + '"');
              finalText = fullText + '\n\n✓ Opened ' + appMatch[1].trim();
            } catch(e) { /* ignore */ }
          }

          pushToDevice(deviceId, { type: 'companion_response', payload: { text: finalText, done: true } });
        });
      });
      req2.on('error', (e: Error) => {
        pushToDevice(deviceId, { type: 'companion_response', payload: { text: 'Error: ' + e.message, done: true } });
      });
      req2.write(postBody);
      req2.end();
    } catch (e) {
      pushToDevice(deviceId, { type: 'companion_response', payload: { text: 'Error: ' + (e instanceof Error ? e.message : String(e)), done: true } });
    }
    return;
  }

  // ── Action decision ───────────────────────────────────────────────────
  if (path.match(/^\/sync\/actions\/[^/]+\/decide$/) && req.method === 'POST') {
    const actionId = path.split('/')[3];
    const decision = await readBody<ActionDecision>(req);
    if (!decision) { jsonResponse(res, 400, { error: 'Bad request' }); return; }
    decision.actionId = actionId;
    decision.fromDevice = deviceId;
    decision.decidedAt = new Date().toISOString();

    pendingActions.delete(actionId);
    notifyRenderer('henry:companion:action-decision', decision);

    const event = recordEvent({
      type: 'action_resolved',
      payload: decision,
      fromDevice: deviceId,
    });
    pushToAll(event);

    jsonResponse(res, 200, { ok: true });
    return;
  }

  // ── Push token registration ───────────────────────────────────────────
  if (path === '/sync/push-token' && req.method === 'POST') {
    const body = await readBody<{ pushToken: string }>(req);
    if (body?.pushToken) {
      const d = linkedDevices.get(deviceId);
      if (d) linkedDevices.set(deviceId, { ...d, pushToken: body.pushToken });
    }
    jsonResponse(res, 200, { ok: true });
    return;
  }

  // ── Devices list ──────────────────────────────────────────────────────
  if (path === '/sync/devices' && req.method === 'GET') {
    jsonResponse(res, 200, Array.from(linkedDevices.values()));
    return;
  }

  jsonResponse(res, 404, { error: 'Unknown route' });
}

// ── Body reader ────────────────────────────────────────────────────────────

function readBody<T>(req: http.IncomingMessage, timeoutMs = 30_000): Promise<T | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let settled = false;

    const done = (val: T | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(val);
    };

    const timer = setTimeout(() => {
      req.destroy(new Error('readBody timeout'));
      done(null);
    }, timeoutMs);

    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      try {
        done(JSON.parse(Buffer.concat(chunks).toString()) as T);
      } catch {
        done(null);
      }
    });
    req.on('error', () => done(null));
  });
}

// ── Renderer communication ─────────────────────────────────────────────────

function notifyRenderer(channel: string, data: unknown): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    try { win.webContents.send(channel, data); } catch { /* ignore */ }
  });
}

async function getDesktopStatus(): Promise<DesktopStatus> {
  return new Promise((resolve) => {
    const wins = BrowserWindow.getAllWindows();
    if (!wins.length) {
      resolve({ online: true, companionStatus: 'idle', workerStatus: 'idle', tasksRunning: 0, tasksQueued: 0 });
      return;
    }
    const channel = `henry:sync:status-reply-${Date.now()}`;
    const timer = setTimeout(() => {
      resolve({ online: true, companionStatus: 'idle', workerStatus: 'idle', tasksRunning: 0, tasksQueued: 0 });
    }, 500);
    ipcMain.once(channel, (_e, status: DesktopStatus) => {
      clearTimeout(timer);
      resolve(status);
    });
    wins[0].webContents.send('henry:sync:request-status', { replyChannel: channel });
  });
}

// ── Public API (called from main.ts) ──────────────────────────────────────

export function startSyncServer(port = 4242): SyncServerState {
  if (server) return getSyncState();
  currentPort = port;

  server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error('[SyncBridge] Request error:', err);
      try { jsonResponse(res, 500, { error: 'Internal error' }); } catch { /* ignore */ }
    });
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`[SyncBridge] Sync server listening on port ${port}`);
    serverRunning = true;
    loadCompanionTokens(); // Restore tokens from previous session
  });

  server.on('error', (err) => {
    console.error('[SyncBridge] Server error:', err);
  });

  return getSyncState();
}

export function stopSyncServer(): void {
  server?.close();
  server = null;
  sseClients = [];
  console.log('[SyncBridge] Sync server stopped');
}

export function getSyncState(): SyncServerState {
  return {
    running: !!server,
    port: currentPort,
    localIp: getLocalIp(),
    pairToken,
    pairTokenExpiry,
    linkedDevices: Array.from(linkedDevices.values()),
  };
}

export function generatePairToken(ttlMs = 5 * 60 * 1000): string {
  pairToken = crypto.randomBytes(4).toString('hex').toUpperCase();
  pairTokenExpiry = Date.now() + ttlMs;
  return pairToken;
}

export function revokePairToken(): void {
  pairToken = null;
  pairTokenExpiry = 0;
}

export function unlinkDevice(deviceId: string): void {
  linkedDevices.delete(deviceId);
  for (const [token, id] of companionTokens.entries()) {
    if (id === deviceId) companionTokens.delete(token);
  }
}

export function addPendingAction(action: PendingAction): void {
  pendingActions.set(action.id, action);
  const event = recordEvent({
    type: 'pending_action',
    payload: action,
    fromDevice: 'desktop',
  });
  pushToAll(event);
}

export function resolvePendingAction(actionId: string): void {
  pendingActions.delete(actionId);
}

/** Called by the renderer to push notes, settings, and status changes. */
export function pushSyncEvent(event: Omit<SyncEvent, 'id' | 'timestamp'>): void {
  const full = recordEvent(event);
  pushToAll(full);
}

export function updateNotesCache(notes: SyncSnapshot['notes']): void {
  _notesCache = notes;
}

export function updateRoamingSettings(settings: SyncSnapshot['settings']): void {
  _roamingSettings = settings;
}

// ── IPC handler registration ───────────────────────────────────────────────

export function registerSyncBridgeIpc(): void {
  ipcMain.handle('henry:sync:start', (_e, port?: number) => {
    return startSyncServer(port ?? 4242);
  });

  ipcMain.handle('henry:sync:stop', () => {
    stopSyncServer();
    return { ok: true };
  });

  ipcMain.handle('henry:sync:state', () => getSyncState());

  ipcMain.handle('henry:sync:generate-pair-token', (_e, ttlMs?: number) => {
    if (!server) startSyncServer(currentPort);
    return generatePairToken(ttlMs);
  });

  ipcMain.handle('henry:sync:revoke-pair-token', () => {
    revokePairToken();
    return { ok: true };
  });

  ipcMain.handle('henry:sync:unlink-device', (_e, deviceId: string) => {
    unlinkDevice(deviceId);
    return { ok: true };
  });

  ipcMain.handle('henry:sync:push-event', (_e, event: Omit<SyncEvent, 'id' | 'timestamp'>) => {
    pushSyncEvent(event);
    return { ok: true };
  });

  ipcMain.handle('henry:sync:add-pending-action', (_e, action: PendingAction) => {
    addPendingAction(action);
    return { ok: true };
  });

  ipcMain.handle('henry:sync:update-notes', (_e, notes: SyncSnapshot['notes']) => {
    updateNotesCache(notes);
    return { ok: true };
  });

  ipcMain.handle('henry:sync:update-settings', (_e, settings: SyncSnapshot['settings']) => {
    updateRoamingSettings(settings);
    return { ok: true };
  });

  ipcMain.handle('henry:sync:start-tunnel', async () => {
    if (tunnelUrl) return { ok: true, url: tunnelUrl };
    const url = await startSyncTunnel(currentPort);
    return { ok: !!url, url };
  });

  ipcMain.handle('henry:sync:stop-tunnel', () => {
    stopTunnel();
    return { ok: true };
  });

  ipcMain.handle('henry:sync:get-tunnel-url', () => {
    return { url: tunnelUrl };
  });
}
