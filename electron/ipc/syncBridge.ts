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

async function startTunnel(port: number): Promise<string | null> {
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
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Henry">
<title>Henry</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#08080e;--surface:#0f0f18;--surface2:#13131e;
  --border:#1a1a28;--accent:#6366f1;--text:#e8e8f0;
  --muted:#5a5a72;--green:#22c55e;--red:#ef4444;
  --user-bg:#6366f1;--ai-bg:#13131e;
}
html,body{height:100%;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif;overflow:hidden;position:fixed;width:100%}
#app{display:flex;flex-direction:column;position:fixed;top:0;left:0;right:0;bottom:0;height:100%}

/* Top bar */
#topbar{
  padding:env(safe-area-inset-top,12px) 16px 10px;
  padding-top:max(env(safe-area-inset-top),12px);
  background:var(--surface);
  border-bottom:1px solid var(--border);
  display:flex;align-items:center;gap:10px;
  flex-shrink:0;
  z-index:10;
}
#dot{width:7px;height:7px;border-radius:50%;background:var(--muted);flex-shrink:0;transition:background 0.3s}
#dot.on{background:var(--green)}
#topbar-name{font-size:15px;font-weight:600;color:var(--text);flex:1}
#topbar-status{font-size:12px;color:var(--muted)}

/* Chat view container */
#chat-view{position:fixed;top:0;left:0;right:0;bottom:0;display:flex;flex-direction:column}

/* Messages */
#msgs{
  flex:1;overflow-y:auto;
  padding:12px 0 0;
  display:flex;flex-direction:column;
  gap:2px;
  -webkit-overflow-scrolling:touch;
  min-height:0;
}
.msg-row{display:flex;padding:2px 16px}
.msg-row.user{justify-content:flex-end}
.msg-row.ai{justify-content:flex-start}
.bubble{
  max-width:82%;padding:10px 14px;
  font-size:15px;line-height:1.45;
  white-space:pre-wrap;word-break:break-word;
  border-radius:18px;
}
.bubble.user{background:var(--user-bg);color:#fff;border-bottom-right-radius:4px}
.bubble.ai{background:var(--ai-bg);color:var(--text);border-bottom-left-radius:4px;border:1px solid var(--border)}
.typing{display:inline-flex;gap:4px;padding:12px 14px;background:var(--ai-bg);border:1px solid var(--border);border-radius:18px;border-bottom-left-radius:4px}
.typing span{width:6px;height:6px;background:var(--muted);border-radius:50%;animation:blink 1.2s infinite}
.typing span:nth-child(2){animation-delay:.2s}
.typing span:nth-child(3){animation-delay:.4s}
@keyframes blink{0%,80%,100%{opacity:.2}40%{opacity:1}}

/* Input bar */
#inputbar{
  padding:10px 12px;
  padding-bottom:max(env(safe-area-inset-bottom),10px);
  background:var(--surface);
  border-top:1px solid var(--border);
  display:flex;align-items:flex-end;gap:8px;
  flex-shrink:0;
  z-index:10;
}
#inp{
  flex:1;background:var(--surface2);
  border:1px solid var(--border);border-radius:22px;
  padding:10px 16px;font-size:16px;color:var(--text);
  outline:none;resize:none;max-height:120px;
  -webkit-text-fill-color:var(--text);
  font-family:inherit;line-height:1.4;
}
#inp::placeholder{color:var(--muted)}
#send{
  width:38px;height:38px;border-radius:50%;
  background:var(--accent);border:none;
  display:flex;align-items:center;justify-content:center;
  flex-shrink:0;cursor:pointer;
  transition:opacity 0.15s;
}
#send:disabled{opacity:0.35}
#send svg{width:18px;height:18px;fill:#fff}

/* Pair screen */
#pair-screen{
  position:fixed;top:0;left:0;right:0;bottom:0;
  display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:20px;padding:40px 24px;
  text-align:center;background:var(--bg);
}
#pair-screen h1{font-size:26px;font-weight:700;letter-spacing:-0.5px}
#pair-screen p{color:var(--muted);font-size:15px;line-height:1.5;max-width:280px}
#pair-input{
  background:var(--surface);border:1px solid var(--border);
  border-radius:14px;padding:16px 20px;
  color:var(--text);font-size:24px;font-weight:700;
  width:100%;max-width:280px;outline:none;
  text-align:center;letter-spacing:6px;
  -webkit-text-fill-color:var(--text);
}
#pair-btn{
  background:var(--accent);color:#fff;border:none;
  border-radius:14px;padding:16px 28px;
  font-size:16px;font-weight:600;cursor:pointer;
  width:100%;max-width:280px;
}
#pair-btn:disabled{opacity:0.5}
.hidden{display:none!important}
.qbtn{background:var(--surface2);border:1px solid var(--border);border-radius:20px;padding:6px 14px;color:var(--text);font-size:13px;white-space:nowrap;cursor:pointer;flex-shrink:0}
.qbtn:active{background:var(--accent);color:#fff}
#quickbar::-webkit-scrollbar{display:none}
</style>
</head>
<body>
<div id="app">
  <!-- Connected chat view -->
  <div id="chat-view" style="display:none">
    <div id="topbar">
      <div id="dot"></div>
      <span id="topbar-name">Henry</span>
      <span id="topbar-status">Connecting…</span>
    </div>
    <div id="msgs"></div>
    <div id="quickbar" style="display:flex;gap:6px;overflow-x:auto;padding:8px 12px 0;scrollbar-width:none;flex-shrink:0">
      <button class="qbtn" onclick="qsend('screenshot')">📸 Screenshot</button>
      <button class="qbtn" onclick="qsend('what apps are running')">📱 Apps</button>
      <button class="qbtn" onclick="qsend('open Finder')">📁 Finder</button>
      <button class="qbtn" onclick="qsend('disk space')">💾 Disk</button>
      <button class="qbtn" onclick="qsend('open Safari')">🌐 Safari</button>
      <button class="qbtn" onclick="qsend('open Terminal')">⌨️ Terminal</button>
    </div>
    <div id="inputbar">
      <textarea id="inp" placeholder="Ask Henry or tell him to do something…" rows="1"></textarea>
      <button id="send" disabled>
        <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
      </button>
    </div>
  </div>

  <!-- Pair screen -->
  <div id="pair-screen">
    <h1>Henry</h1>
    <p>Your AI on <strong>${macName}</strong>.<br>Enter the 6-digit code from Henry on your Mac.</p>
    <input id="pair-input" type="number" inputmode="numeric" placeholder="000000" maxlength="6" autocomplete="off">
    <button id="pair-btn">Connect to Henry</button>
    <p id="pair-error" style="color:var(--red);font-size:13px" class="hidden"></p>
  </div>
</div>
<script>
  // State
  window.henryToken = localStorage.getItem('henry_token') || '';
  window.henryDeviceId = localStorage.getItem('henry_device_id') || '';
  window.henryEs = null;
  window.henryHistory = [];
  window.henryStreamBubble = null;
  window.henryStreamText = '';

  const chatView = document.getElementById('chat-view');
  const pairScreen = document.getElementById('pair-screen');
  const msgs = document.getElementById('msgs');
  const inp = document.getElementById('inp');
  const sendBtn = document.getElementById('send');
  const dot = document.getElementById('dot');
  const statusEl = document.getElementById('topbar-status');
  const pairBtn = document.getElementById('pair-btn');
  const pairErr = document.getElementById('pair-error');

  function showPairError(msg) {
    pairErr.textContent = msg;
    pairErr.style.display = 'block';
  }

  function goToChat() {
    pairScreen.style.display = 'none';
    chatView.style.cssText = 'display:flex;'; // clear all inline styles, just show it
    addBubble('ai', 'Hi! I am Henry. Ask me anything or tell me to do something on your Mac.');
    startSSE();
  }

  function startSSE() {
    if (window.henryEs) window.henryEs.close();
    statusEl.textContent = 'Connecting…';
    window.henryEs = new EventSource('/sync/stream?token=' + window.henryToken);
    window.henryEs.onopen = () => {
      dot.className = 'on';
      statusEl.textContent = 'Ready';
      sendBtn.disabled = false;
    };
    window.henryEs.onerror = () => {
      dot.className = '';
      statusEl.textContent = 'Reconnecting…';
      sendBtn.disabled = true;
      setTimeout(startSSE, 3000);
    };
    window.henryEs.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.type === 'companion_chunk') appendChunk(d.payload.chunk);
        else if (d.type === 'companion_response') finalizeStream(d.payload.text);
      } catch(err) {}
    };
  }

  function addBubble(role, text) {
    const row = document.createElement('div');
    row.className = 'msg-row ' + role;
    const b = document.createElement('div');
    b.className = 'bubble ' + role;
    b.textContent = text;
    row.appendChild(b);
    msgs.appendChild(row);
    msgs.scrollTop = msgs.scrollHeight;
    if (role === 'user') window.henryHistory.push({role:'user', content:text});
    else if (role === 'ai') window.henryHistory.push({role:'assistant', content:text});
  }

  function showTyping() {
    removeTyping();
    const row = document.createElement('div');
    row.className = 'msg-row ai';
    row.id = 'typing-row';
    row.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
    msgs.appendChild(row);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function removeTyping() {
    const t = document.getElementById('typing-row');
    if (t) t.remove();
  }

  function appendChunk(chunk) {
    removeTyping();
    if (!window.henryStreamBubble) {
      const row = document.createElement('div');
      row.className = 'msg-row ai';
      window.henryStreamBubble = document.createElement('div');
      window.henryStreamBubble.className = 'bubble ai';
      row.appendChild(window.henryStreamBubble);
      msgs.appendChild(row);
      window.henryStreamText = '';
    }
    window.henryStreamText += chunk;
    window.henryStreamBubble.textContent = window.henryStreamText;
    msgs.scrollTop = msgs.scrollHeight;
  }

  function showScreenshot(base64) {
    removeTyping();
    const row = document.createElement('div');
    row.className = 'msg-row ai';
    const img = document.createElement('img');
    img.src = 'data:image/png;base64,' + base64;
    img.style.cssText = 'max-width:100%;border-radius:12px;border:1px solid var(--border);margin-top:4px';
    img.onclick = () => window.open(img.src);
    row.appendChild(img);
    msgs.appendChild(row);
    msgs.scrollTop = msgs.scrollHeight;
    sendBtn.disabled = false;
  }

  function finalizeStream(fullText) {
    removeTyping();
    if (window.henryStreamBubble) {
      window.henryStreamBubble.textContent = fullText;
      window.henryHistory.push({role:'assistant', content:fullText});
      window.henryStreamBubble = null;
      window.henryStreamText = '';
    } else if (fullText) {
      addBubble('ai', fullText);
    }
    sendBtn.disabled = false;
    msgs.scrollTop = msgs.scrollHeight;
  }

  function qsend(text) {
    const inp = document.getElementById('inp');
    inp.value = text;
    inp.dispatchEvent(new Event('input', {bubbles:true}));
    sendMsg();
  }

  async function sendMsg() {
    const text = inp.value.trim();
    if (!text || sendBtn.disabled) return;
    inp.value = '';
    inp.style.height = 'auto';
    sendBtn.disabled = true;
    addBubble('user', text);
    showTyping();
    try {
      const r = await fetch('/sync/prompt', {
        method: 'POST',
        headers: {'Content-Type':'application/json','Authorization':'Bearer '+window.henryToken},
        body: JSON.stringify({text, history: window.henryHistory.slice(-10)})
      });
      if (r.status === 401) {
        // Token expired (server restarted) — re-pair and resend
        removeTyping();
        localStorage.removeItem('henry_token');
        localStorage.removeItem('henry_device_id');
        window.henryToken = '';
        const repaired = await autoPair();
        if (repaired) {
          // Retry the message
          const r2 = await fetch('/sync/prompt', {
            method: 'POST',
            headers: {'Content-Type':'application/json','Authorization':'Bearer '+window.henryToken},
            body: JSON.stringify({text, history: window.henryHistory.slice(-10)})
          });
          if (!r2.ok) { addBubble('ai', 'Could not reconnect. Try refreshing.'); sendBtn.disabled = false; }
          else showTyping();
        }
        return;
      }
      if (!r.ok) {
        removeTyping();
        addBubble('ai', 'Error sending message. Try again.');
        sendBtn.disabled = false;
      }
    } catch(e) {
      removeTyping();
      addBubble('ai', 'Connection error. Check WiFi.');
      sendBtn.disabled = false;
    }
  }

  async function autoPair() {
    pairBtn.disabled = true;
    pairBtn.textContent = 'Connecting…';
    try {
      const ua = navigator.userAgent;
      const isIpad = ua.includes('iPad') || (ua.includes('Mac') && navigator.maxTouchPoints > 1);
      const r = await fetch('/sync/auto-pair', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          deviceName: isIpad ? 'iPad' : ua.includes('iPhone') ? 'iPhone' : 'Mobile Browser',
          platform: (ua.includes('iPhone') || isIpad) ? 'ios' : 'android',
          appleProduct: isIpad ? 'ipad' : ua.includes('iPhone') ? 'iphone' : 'unknown',
          capabilities: ['chat','prompt','notify']
        })
      });
      const d = await r.json();
      if (d.companionToken) {
        window.henryToken = d.companionToken;
        window.henryDeviceId = d.deviceId;
        localStorage.setItem('henry_token', window.henryToken);
        localStorage.setItem('henry_device_id', window.henryDeviceId);
        goToChat();
        return true;
      } else {
        showPairError('Could not connect. Make sure your Mac and phone are on the same WiFi.');
        pairBtn.disabled = false;
        pairBtn.textContent = 'Connect to Henry';
        return false;
      }
    } catch(e) {
      showPairError('Connection failed: ' + e.message);
      pairBtn.disabled = false;
      pairBtn.textContent = 'Try Again';
      return false;
    }
  }

  // Wire up events
  pairBtn.addEventListener('click', autoPair);
  sendBtn.addEventListener('click', sendMsg);
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
  });
  inp.addEventListener('input', () => {
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';
  });

  // Auto-connect on load
  const urlParams = new URLSearchParams(window.location.search);
  const urlToken = urlParams.get('token') || '${initToken}';

  if (window.henryToken) {
    // Try stored token
    fetch('/sync/snapshot', {headers:{'Authorization':'Bearer '+window.henryToken}})
      .then(r => { if (r.ok) goToChat(); else { localStorage.clear(); autoPair(); } })
      .catch(() => autoPair());
  } else if (urlToken && urlToken.length === 6) {
    // QR code token
    document.getElementById('pair-input').value = urlToken;
    autoPair();
  } else {
    // Just auto-pair immediately — no code needed on local network
    autoPair();
  }

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
  if (path === '/sync/health' && req.method === 'GET') {
    const deviceId = validateToken(req);
    jsonResponse(res, deviceId ? 200 : 401, { ok: !!deviceId });
    return;
  }

  // ── Pairing ───────────────────────────────────────────────────────────
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
    saveCompanionTokens(); // Persist for server restarts

    jsonResponse(res, 200, {
      companionToken: companionToken2,
      deviceId: deviceId2,
      desktopName: os.hostname(),
    });
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

    // Call Groq directly in main process — stream response back via SSE
    try {
      const dbSettings = dbGet<{key:string;value:string}>('SELECT key, value FROM settings');
      const settingsMap: Record<string,string> = {};
      for (const {key,value} of dbSettings) settingsMap[key] = value;
      const dbProviders = dbGet<{id:string;api_key:string}>('SELECT id, api_key FROM providers WHERE enabled=1');
      const groq = dbProviders.find(p => p.id === 'groq');
      const apiKey = groq?.api_key || '';
      const model = settingsMap['companion_model'] || 'llama-3.3-70b-versatile';

      if (!apiKey) {
        pushToDevice(deviceId, { type: 'companion_response', payload: { text: 'No Groq API key set. Add one in Henry Settings → AI Providers.', done: true } });
        return;
      }

      const history = body.history || [];
      const messages = [
        { role: 'system', content: 'You are Henry, a personal AI installed on a Mac. The user is messaging from their phone. You can and DO control the physical Mac — this is real computer control, not a simulation. Be direct and concise (mobile screen). When the user asks you to do something on the computer, use these exact patterns and they will execute: computer:runShell(command=\"..\") for shell commands, computer:newFolder(path=\"/Users/christophercook/Desktop/FolderName\") to create and open folders, computer:openApp(\"AppName\") to open apps, computer:screenshot() to take and show a screenshot. Mac home: /Users/christophercook, Desktop: /Users/christophercook/Desktop. After using a tool pattern, report the result in one sentence.' },
        ...history.slice(-10),
        { role: 'user', content: body.text }
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
                pushToDevice(deviceId, { type: 'companion_response', payload: { text: fullText, done: true } });
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
    const url = await startTunnel(currentPort);
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
