import { buildCompanionHtml } from './companionHtml';
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
    const { spawn, execSync } = await import('child_process') as typeof import('child_process');
    const cfPath = '/opt/homebrew/bin/cloudflared';
    try { execSync(`which cloudflared || test -f ${cfPath}`, { stdio: 'ignore' }); }
    catch {
      console.log('[SyncBridge] cloudflared not found');
      return null;
    }

    // Try named tunnel first (same URL every time)
    // Named tunnel config at ~/.cloudflared/henry.yml
    const tunnelArgs = (() => {
      try {
        const configPath = require('os').homedir() + '/.cloudflared/henry.yml';
        const fs = require('fs');
        if (fs.existsSync(configPath)) {
          console.log('[SyncBridge] Using named tunnel config:', configPath);
          return ['tunnel', '--config', configPath, 'run', '--no-autoupdate'];
        }
      } catch { /* fall through */ }
      // Quick tunnel — random URL each restart
      return ['tunnel', '--url', `http://localhost:${port}`, '--no-autoupdate'];
    })();

    return new Promise((resolve) => {
      tunnelProcess = spawn('cloudflared', tunnelArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

      let resolved = false;
      const tryResolve = (data: Buffer) => {
        const text = data.toString();
        const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match && !resolved) {
          resolved = true;
          tunnelUrl = match[0];
          console.log(`[SyncBridge] Tunnel active: ${tunnelUrl}`);
          // Push tunnel URL to all connected devices so they can switch to it
          setTimeout(() => {
            pushToAll({ type: 'tunnel_active', payload: { url: tunnelUrl }, id: '', timestamp: 0 } as any);
          }, 1000);
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

// Simple fact extraction — finds key facts stated in conversation
function extractAndSaveFacts(userText: string, aiText: string): void {
  try {
    const facts: string[] = [];
    const combined = userText + ' ' + aiText;

    // Name patterns
    const nameM = userText.match(/my name is ([A-Z][a-z]+ [A-Z][a-z]+|[A-Z][a-z]+)/);
    if (nameM) facts.push('User name: ' + nameM[1]);

    // Location
    const locM = userText.match(/i(?:'m| am) (?:in|from|based in) ([A-Z][a-zA-Z\s,]+)/);
    if (locM) facts.push('User location: ' + locM[1].trim());

    // Preferences stated
    const prefM = userText.match(/i (?:prefer|like|love|hate|always|never) ([^.!?]+)/gi);
    if (prefM) prefM.slice(0,2).forEach(m => facts.push('Preference: ' + m));

    // Save to SQLite
    if (facts.length > 0) {
      const { v4: uuidv4 } = require('uuid') as typeof import('uuid');
      const now = new Date().toISOString();
      for (const fact of facts) {
        try {
          dbRun(
            'INSERT OR IGNORE INTO memory_facts (id, fact, category, importance, created_at) VALUES (?,?,?,?,?)',
            uuidv4(), fact, 'mobile', 2, now
          );
        } catch { /* duplicate or error, ignore */ }
      }
    }
  } catch { /* ignore fact extraction errors */ }
}
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

function pushToDevice(targetDeviceId: string, event: Omit<SyncEvent,'id'|'timestamp'|'fromDevice'>): void {
  const full: SyncEvent = { ...event as SyncEvent, fromDevice: 'desktop', id: generateToken(8), timestamp: Date.now() };
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
    if (!_db) return;
    _db.prepare(sql).run(...params);
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

    const html = buildCompanionHtml(macName);
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
        // Henry no longer auto-opens apps
        res.writeHead(200).end('{"ok":false,"reason":"Henry does not open apps"}');
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
        localIp: getLocalIp(),
        companionUrl: `http://${getLocalIp()}:${currentPort}`,
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
  // Tunnel URL endpoint — returns current tunnel URL if active
  if (path === '/sync/tunnel-url' && req.method === 'GET') {
    jsonResponse(res, 200, { url: tunnelUrl || null });
    return;
  }

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

  // ── PWA Static Assets ─────────────────────────────────────────────────────
  if (path === '/manifest.json' && req.method === 'GET') {
    const manifest = {
      name: "Henry AI",
      short_name: "Henry",
      description: "Your personal AI assistant",
      start_url: "/",
      display: "standalone",
      background_color: "#07070f",
      theme_color: "#07070f",
      orientation: "portrait-primary",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
      ],
      categories: ["productivity", "utilities"],
      shortcuts: [
        { name: "Chat", short_name: "Chat", url: "/#chat", description: "Open Henry chat" },
        { name: "Today", short_name: "Today", url: "/#today", description: "View today" },
        { name: "Tasks", short_name: "Tasks", url: "/#tasks", description: "View tasks" },
      ],
    };
    res.writeHead(200, {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'max-age=3600',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(manifest));
    return;
  }

  if (path === '/sw.js' && req.method === 'GET') {
    const swCode = `
const CACHE_NAME = 'henry-ai-v1';
const OFFLINE_CACHE = ['/'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(OFFLINE_CACHE))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Don't cache API calls — always go network
  if (url.pathname.startsWith('/sync/')) {
    event.respondWith(fetch(event.request).catch(() =>
      new Response(JSON.stringify({error:'offline'}), {headers:{'Content-Type':'application/json'}})
    ));
    return;
  }
  // For the app shell, try network first, fall back to cache
  event.respondWith(
    fetch(event.request).then(response => {
      const clone = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
      return response;
    }).catch(() => caches.match(event.request))
  );
});
`;
    res.writeHead(200, {
      'Content-Type': 'application/javascript',
      'Cache-Control': 'no-cache',
      'Service-Worker-Allowed': '/',
    });
    res.end(swCode);
    return;
  }

  if ((path === '/icon-192.png' || path === '/icon-512.png') && req.method === 'GET') {
    const size = path.includes('512') ? 512 : 192;
    // Generate a simple SVG icon and serve it as PNG via SVG data
    // We serve an SVG that Safari will render as the icon
    const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect width="${size}" height="${size}" rx="${size * 0.2}" fill="#07070f"/>
      <rect width="${size}" height="${size}" rx="${size * 0.2}" fill="url(#g)"/>
      <defs>
        <radialGradient id="g" cx="35%" cy="25%" r="70%">
          <stop offset="0%" stop-color="#9f5cff"/>
          <stop offset="100%" stop-color="#07070f"/>
        </radialGradient>
      </defs>
      <text x="${size/2}" y="${size * 0.62}" font-family="system-ui,-apple-system,sans-serif" 
            font-size="${size * 0.42}" font-weight="900" text-anchor="middle" 
            fill="white" letter-spacing="-2">H</text>
      <text x="${size/2}" y="${size * 0.82}" font-family="system-ui,-apple-system,sans-serif" 
            font-size="${size * 0.1}" font-weight="600" text-anchor="middle" 
            fill="rgba(255,255,255,0.5)" letter-spacing="3">AI</text>
    </svg>`;
    res.writeHead(200, {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(svgIcon);
    return;
  }

  // ── Shared chat history (phone ↔ desktop sync) ─────────────────────────
  if (path === '/sync/chat/history' && req.method === 'GET') {
    try {
      const url = new URL('http://x' + req.url!);
      const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50'));
      // Get or create the shared companion conversation
      let conv = dbGetOne<{id:string}>(
        "SELECT id FROM conversations WHERE title = 'Henry — Companion' LIMIT 1"
      );
      if (!conv) {
        const convId = require('crypto').randomUUID();
        dbRun("INSERT INTO conversations (id, title) VALUES (?, 'Henry — Companion')", convId);
        conv = { id: convId };
      }
      const messages = dbGet<any>(
        `SELECT id, role, content, model, provider, created_at FROM messages
         WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?`,
        conv.id, limit
      ) as any[] || [];
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ conversation_id: conv.id, messages: messages.reverse() }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  if (path === '/sync/chat/save' && req.method === 'POST') {
    const body = await readBody<{ conversation_id: string; messages: Array<{id:string;role:string;content:string;model?:string;provider?:string}> }>(req);
    if (!body) { jsonResponse(res, 400, { error: 'bad body' }); return; }
    try {
      for (const msg of (body.messages || [])) {
        // Upsert — ignore if already exists
        try {
          dbRun(
            `INSERT OR IGNORE INTO messages (id, conversation_id, role, content, model, provider, engine)
             VALUES (?, ?, ?, ?, ?, ?, 'companion')`,
            msg.id, body.conversation_id, msg.role, msg.content,
            msg.model || null, msg.provider || null
          );
        } catch { /* already exists, skip */ }
      }
      dbRun("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?", body.conversation_id);
      // Push to desktop via SSE so ChatView can show companion messages live
      const chatUpdateEvent: SyncEvent = { id: require('crypto').randomUUID(), type: 'companion_chat_update', payload: { conversation_id: body.conversation_id, messages: body.messages }, timestamp: Date.now(), fromDevice: '' };
      pushToAll(chatUpdateEvent);
      jsonResponse(res, 200, { ok: true });
    } catch (e) { jsonResponse(res, 500, { error: String(e) }); }
    return;
  }

  if (path === '/sync/chat/conversation_id' && req.method === 'GET') {
    try {
      let conv = dbGetOne<{id:string}>(
        "SELECT id FROM conversations WHERE title = 'Henry — Companion' LIMIT 1"
      );
      if (!conv) {
        const convId = require('crypto').randomUUID();
        dbRun("INSERT INTO conversations (id, title) VALUES (?, 'Henry — Companion')", convId);
        conv = { id: convId };
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ conversation_id: conv.id }));
    } catch (e) { jsonResponse(res, 500, { error: String(e) }); }
    return;
  }

  if (path === '/sync/health' && req.method === 'GET') {
    // Health is public — allows mobile to check server is up before pairing
    let appVersion = (() => {
  try {
    const { app } = require('electron') as typeof import('electron');
    const v = app.getVersion();
    return v || '1.0.7';
  } catch {
    // Fallback: read from embedded package.json
    try {
      const path2 = require('path');
      const pkg = require(path2.join(process.resourcesPath || __dirname, '../package.json')) as {version:string};
      return pkg.version || '1.0.7';
    } catch { return '1.0.7'; }
  }
})();
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pkg = require('../../package.json') as { version?: string };
      appVersion = pkg.version || appVersion;
    } catch { /* ignore */ }
    jsonResponse(res, 200, { ok: true, version: appVersion, paired: !!validateToken(req) });
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


  // ── Companion web app routes — no token required (local network, web page) ──
  // The companion HTML served at http://MAC-IP:4242 makes these calls.
  // They only work on the local network (same WiFi) — not internet-exposed.
  const companionWebPaths = [
    '/sync/prompt', '/sync/chat/history', '/sync/chat/save', '/sync/chat/conversation_id', '/sync/mac/today', '/sync/mac/screen',
    '/sync/mac/habit-toggle', '/sync/mac/run', '/sync/mac/open-app', '/sync/mac/health', '/sync/mac/bible', '/sync/learn',
    '/sync/capture-and-process', '/sync/capture', '/sync/mac/finance',
    '/sync/mac/reminders', '/sync/mac/tasks', '/sync/mac/tasks/create',
    '/sync/mac/goals', '/sync/mac/tasks/complete',
    '/sync/mac/reminders/create', '/sync/mac/reminders/done',
    '/sync/mac/journal/create', '/sync/mac/health/log',
  ];
  if (companionWebPaths.some(p => path === p) && req.method !== undefined) {
    // Allow through — companion web page handles these without a paired token
    // Fall through to the route handlers below with a synthetic deviceId
    const syntheticDeviceId = 'companion-web';
    // Run the handlers inline — skip the auth check
    // (routes are defined further below and handle the request normally)
  }

  // All routes below require a valid token
  const deviceId = validateToken(req) || (
    companionWebPaths.some(p => path === p) ? 'companion-web' : null
  );
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

  // ── Capture + AI process — Henry Engage hotkey & clipboard capture ─────────
  // Receives text, runs it through AI extraction, returns ideas/prospects/tasks
  if (path === '/sync/capture-and-process' && req.method === 'POST') {
    const body = await readBody<{ text: string; source?: string; pageTitle?: string; context?: string }>(req);
    if (!body?.text?.trim()) { jsonResponse(res, 400, { error: 'No text' }); return; }

    const text = body.text.trim().slice(0, 8000);
    const source = body.source || '';
    const pageTitle = body.pageTitle || '';

    // First: save the raw capture immediately
    const rawCapture = { text, source, pageTitle, category: 'auto', fromDevice: deviceId, timestamp: Date.now() };
    notifyRenderer('henry:companion:capture', rawCapture);

    // Then: run AI extraction asynchronously
    const dbSettings2 = dbGet<{key:string;value:string}>('SELECT key, value FROM settings');
    const settingsMap2: Record<string,string> = {};
    for (const {key,value} of dbSettings2) settingsMap2[key] = value;
    const dbProviders2 = dbGet<{id:string;api_key:string}>('SELECT id, api_key FROM providers WHERE enabled=1');
    const groq2 = dbProviders2.find(p => p.id === 'groq');
    const apiKey2 = groq2?.api_key || '';
    const ollamaModel = settingsMap2['companion_model'] || 'llama3.2:latest';
    const useOllama = !apiKey2 && (settingsMap2['companion_provider'] === 'ollama');

    const extractionPrompt = 'You are Henry extraction engine. Analyze this text and extract EVERYTHING useful. Leave nothing out.\n\n' +
      'TEXT TO ANALYZE:\n' + text + (source ? '\nSource: ' + source : '') +
      '\n\nExtract and return a JSON object with these fields (empty arrays if none found):\n' +
      '{\n' +
      '  "summary": "2-3 sentence summary",\n' +
      '  "ideas": ["actionable ideas from this text"],\n' +
      '  "prospects": ["clients, partners, leads, opportunities"],\n' +
      '  "tasks": ["specific action items or next steps"],\n' +
      '  "insights": ["key facts, patterns, insights worth remembering"],\n' +
      '  "quotes": ["notable phrases worth saving exactly"],\n' +
      '  "questions": ["important questions this raises"],\n' +
      '  "category": "one of: idea|prospect|task|insight|research|quote|web_clip|note"\n' +
      '}\n\nReturn ONLY valid JSON, no explanation.';

    // Async — don't make client wait for AI
    (async () => {
      try {
        let extractedText = '';
        if (apiKey2) {
          const { default: https2 } = await import('https');
          const postBody2 = JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: extractionPrompt }],
            temperature: 0.3,
            max_tokens: 1200,
          });
          await new Promise<void>((resolve) => {
            const opts2 = {
              hostname: 'api.groq.com',
              path: '/openai/v1/chat/completions',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey2,
                'Content-Length': Buffer.byteLength(postBody2),
              },
            };
            const req2 = https2.request(opts2, (r2) => {
              let data = '';
              r2.on('data', (chunk: Buffer) => { data += chunk.toString(); });
              r2.on('end', () => {
                try {
                  const parsed = JSON.parse(data);
                  extractedText = parsed.choices?.[0]?.message?.content || '';
                } catch { /* ignore */ }
                resolve();
              });
            });
            req2.on('error', () => resolve());
            req2.write(postBody2);
            req2.end();
          });
        } else if (useOllama) {
          const ollamaResp = await fetch('http://127.0.0.1:11434/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: ollamaModel,
              messages: [{ role: 'user', content: extractionPrompt }],
              stream: false,
              options: { temperature: 0.3 },
            }),
            signal: AbortSignal.timeout(30000),
          }).catch(() => null);
          if (ollamaResp?.ok) {
            const od = await ollamaResp.json() as { message?: { content?: string } };
            extractedText = od.message?.content || '';
          }
        }

        if (extractedText) {
          // Parse JSON extraction
          const jsonMatch = extractedText.match(/\{[\s\S]+\}/);
          if (jsonMatch) {
            try {
              const extracted = JSON.parse(jsonMatch[0]);
              // Send extracted insights back to renderer
              notifyRenderer('henry:quick-extract:result', {
                originalText: text,
                source,
                pageTitle,
                extracted,
                timestamp: Date.now(),
              });
            } catch { /* JSON parse failed — send raw */ }
          }
        }
      } catch { /* extraction failed — raw capture already saved */ }
    })();

    jsonResponse(res, 200, { accepted: true, processing: true });
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
    // ── Bible shortcut: BIBLE_LOOKUP:ref → fast DB query, no AI ─────────────
    if (req.method === 'POST') {
      try {
        // Peek at body without consuming (clone via Buffer)
        const rawPeek = await new Promise<string>((resolve) => {
          let data = '';
          req.on('data', (chunk: Buffer) => data += chunk.toString());
          req.on('end', () => resolve(data));
        });
        const peekBody = JSON.parse(rawPeek || '{}') as {text?: string};
        if (peekBody.text?.startsWith('BIBLE_LOOKUP:')) {
          const ref = peekBody.text.slice('BIBLE_LOOKUP:'.length).trim();
          const rows = dbGet(
            "SELECT text, normalized_reference FROM scripture_entries WHERE LOWER(normalized_reference) LIKE LOWER(?) LIMIT 1",
            ref + '%'
          ) as {text:string; normalized_reference:string}[];
          if (rows.length) {
            jsonResponse(res, 200, { reply: rows[0].text, ref: rows[0].normalized_reference });
          } else {
            jsonResponse(res, 200, { reply: 'Verse not found in your Bible. Go to ✝ Scripture → Import to download the KJV.' });
          }
          return;
        }
        // Not a Bible lookup — reconstruct req body for normal handler
        (req as any)._rawBody = rawPeek;
      } catch { /* continue normally */ }
    }
    const body = await readBody<{
      text: string;
      conversationId?: string;
      contextNote?: string;
      history?: {role:string;content:string}[];
    }>(req);
    if (!body) { jsonResponse(res, 400, { error: 'Bad request' }); return; }

    // Helper: send the reply both as HTTP response (for companion HTML which
    // expects inline reply) AND push via SSE (for paired devices listening to /sync/stream).
    let httpResponseSent = false;
    const sendReply = (text: string) => {
      if (!httpResponseSent) {
        httpResponseSent = true;
        try { jsonResponse(res, 200, { reply: text }); } catch { /* connection closed */ }
      }
      try { pushToDevice(deviceId, { type: 'companion_response', payload: { text, done: true } }); } catch { /* */ }
    };

    const userText = (body.text || '').trim();
    const macHome = os.homedir();

    // ── Intent resolution — "do it again", "open that", context-aware ──────────
    const ctx = deviceContext.get(deviceId) || {};
    const resolvedText = resolveIntent(userText, ctx);

    // Save last user text regardless
    deviceContext.set(deviceId, { ...ctx, lastUserText: userText });

    // ── Knowledge router — instant answers, no AI needed ─────────────────────
    const lowerText = resolvedText.toLowerCase().trim();

    // ── Implicit task creation: "I need to X" / "I should X" ──────────────────
    const implicitTaskRx = lowerText.match(/^i (?:need to|should|have to|must|gotta)(?: still)? (.+?)(?:\s+today)?$/i)
                       || lowerText.match(/^(?:need to|gotta|must) (.+?)(?:\s+today)?$/i)
                       || lowerText.match(/^(?:\w+) (?:wants?|needs?|ordered)(?: a| an| \d+)? (.+?) (?:from me|asap|today|done)$/i);
    const implicitTaskGuard = /^i (?:need to|should|have to) (remember|note|write|journal|pray|exercise|read|drink|sleep)/.test(lowerText);
    const implicitTaskMatch = implicitTaskRx && !implicitTaskGuard ? implicitTaskRx : null;
    if (implicitTaskMatch && implicitTaskMatch[1] && implicitTaskMatch[1].length > 3) {
      const title = implicitTaskMatch[1].trim();
      const habitWords = ['prayer','pray','bible','exercise','water','journal'];
      if (!habitWords.some(h => title.toLowerCase().includes(h))) {
        try {
          const id = require('crypto').randomUUID();
          dbRun("INSERT INTO personal_tasks (id,title,status,priority,created_at) VALUES (?,?,?,?,?)",
            id, title, 'todo', 2, new Date().toISOString());
          sendReply('Task saved: "' + title + '"\n\nSay "what tasks do I have" to see your list.');
        } catch (e) { sendReply('Could not save task: ' + e); }
        return;
      }
    }
    // ── AI provider status ────────────────────────────────────────────────────
    const aiStatusMatch = /^(?:show |what(?:'s| are)(?: my)? )?(?:ai |provider )?(?:providers?|models?)(?: status)?$/.test(lowerText)
                       || lowerText === 'ai status' || lowerText === 'providers' || lowerText === 'which ai' || lowerText === 'provider status';
    if (aiStatusMatch) {
      const g2 = global as any;
      const rlStore2: Record<string, number> = g2['__henry_rl__'] || {};
      const now3 = Date.now();
      const dbP = dbGet<{id:string;api_key:string}>('SELECT id, api_key FROM providers WHERE enabled=1');
      const dbS = dbGet<{key:string;value:string}>('SELECT key, value FROM settings');
      const sMap: Record<string,string> = {};
      for (const {key,value} of dbS as {key:string;value:string}[]) sMap[key] = value;
      const groqKey2 = (dbP as {id:string;api_key:string}[]).find(p => p.id === 'groq')?.api_key || '';
      const gemKey2 = sMap['gemini_api_key'] || '';
      const cerKey2 = sMap['cerebras_api_key'] || '';
      const orKey2 = sMap['openrouter_api_key'] || '';
      const lines2 = ['Iron Gateway v2 — AI Provider Status:\n'];
      const provStatus = [
        { name: 'Groq (llama-4-scout, 3.3-70b, qwen3, 8b)', key: groqKey2 },
        { name: 'Gemini 2.0 Flash + 1.5 Flash', key: gemKey2 },
        { name: 'Cerebras (llama-4-scout)', key: cerKey2 },
        { name: 'OpenRouter (:free models)', key: orKey2 },
      ];
      for (const p of provStatus) {
        const hasKey = p.key.length > 5;
        // Check if any subprovider from this family is rate-limited
        const rlName = Object.keys(rlStore2).find(k => k.toLowerCase().includes(p.name.split('/')[0].toLowerCase()));
        const isRL = rlName && rlStore2[rlName] > now3;
        const waitSec = isRL ? Math.ceil((rlStore2[rlName!] - now3) / 1000) : 0;
        if (!hasKey) lines2.push('⬜ ' + p.name + ' — no API key');
        else if (isRL) lines2.push('🔴 ' + p.name + ' — rate-limited (' + waitSec + 's cooldown)');
        else lines2.push('🟢 ' + p.name + ' — ready');
      }
      lines2.push('\nAdd keys: "set gemini key: YOUR_KEY" · "set openrouter key: YOUR_KEY" · "set cerebras key: YOUR_KEY"');
      sendReply(lines2.join('\n'));
      return;
    }

    // ── Set API key for additional providers ────────────────────────────────────
    const setKeyMatch = lowerText.match(/^set (gemini|openrouter|cerebras|groq) (?:api )?key[:\s]+(.+)/i);
    if (setKeyMatch) {
      const provider = setKeyMatch[1].toLowerCase();
      const keyVal = setKeyMatch[2].trim();
      if (keyVal.length < 10) { sendReply('That key looks too short. Paste your full API key after the colon.'); return; }
      const settingKey = provider + '_api_key';
      try {
        const existing = dbGetOne<{key:string}>('SELECT key FROM settings WHERE key=?', settingKey);
        if (existing) {
          dbRun('UPDATE settings SET value=? WHERE key=?', keyVal, settingKey);
        } else {
          dbRun('INSERT INTO settings (key, value) VALUES (?,?)', settingKey, keyVal);
        }
        const maskedKey = keyVal.slice(0, 6) + '...' + keyVal.slice(-4);
        sendReply('✅ ' + provider.charAt(0).toUpperCase() + provider.slice(1) + ' API key saved (' + maskedKey + ').\n\nHenry will now use ' + provider + ' as a fallback AI provider. Say "ai status" to see the full provider list.');
      } catch (e) { sendReply('Could not save key: ' + e); }
      return;
    }

        const knowledgeAnswer = (() => {
      // Version / identity
      if (/^(?:what version|which version|your version|version number|what.*version are you)/.test(lowerText) || lowerText === 'version') {
        return 'Henry AI v1.7.8 — your personal AI workspace for Mac.\n\n145+ instant local commands, all <20ms, offline-capable.\n\nBuilt open-source by Topher Cook + Claude. Add API keys to unlock 10 free AI providers that auto-failover. Say \'what can you do\' to see everything.';
      }
      if (/^(?:what (?:ai |model |llm )(?:are you|is this)|which model|what model|what.*(?:model|ai) (?:are you|using)|how fast are you|your response time)/.test(lowerText)) {
        const g3 = global as any;
        const rl = g3['__henry_rl__'] || {};
        const now5 = Date.now();
        const providerNames = ['Groq/llama-4-scout','Groq/llama-3.3-70b','Groq/qwen3-32b','Groq/llama-3.1-8b','Gemini/flash-2.0','Gemini/flash-1.5','Cerebras/llama-4-scout','OpenRouter/llama-3.3-70b'];
        const available = providerNames.filter(p => !rl[p] || rl[p] < now5);
        return "Iron Gateway v2 — I'm running on the first available free provider:\n\n" +
          available.slice(0,4).map((p,i) => (i===0 ? '▶ ' : '  ') + p).join('\n') +
          (available.length > 4 ? '\n  + ' + (available.length-4) + ' more\n' : '\n') +
          '\nLocal commands: <20ms. AI responses: 200-600ms depending on provider.\nSay "ai status" for the full provider list.';
      }
      if (/^(?:who (?:made|built|created|are) you|who is henry|what is henry|what are you)/.test(lowerText)) {
        return "I'm Henry — your personal AI workspace. Topher built me with Claude to run his laser business, track habits, manage tasks, and stay focused.\n\nI live on your Mac and phone, work offline, and remember your life.";
      }
      if ((/^(what can you do|help me$|give me a tour|show me what you can do|overview of henry|what do you do)/.test(lowerText)) || lowerText === 'help') {
        return `Here's everything I can do:\n\n` +
          `💬 **Chat** — Talk to me, ask anything, give commands\n` +
          `☀️ **Today** — Daily habits, tasks, day plan, word of the day\n` +
          `✓ **Tasks** — Your to-do list, AI triage\n` +
          `⏰ **Reminders** — Time-based alerts with badge\n` +
          `◎ **Goals** — Long-term goals with target dates, AI coaching\n` +
          `📔 **Journal** — Daily writing with mood + AI reflection\n` +
          `❤️ **Health** — Log water, steps, sleep, calories, exercise\n` +
          `💰 **Finance** — Income, expenses, budgets, CSV import\n` +
          `🧠 **Memory** — Everything I know about you — view, edit, add\n` +
          `✝ **Scripture** — Bible verse lookup, reading plan\n` +
          `🙏 **Prayer** — Prayer requests and answers\n` +
          `🎯 **Focus** — Pomodoro timer with weekly chart\n` +
          `📄 **Quoting** — Quotes and invoices with PDF export\n` +
          `⚙️ **Settings** — AI keys, appearance, backup\n` +
          `\nAsk me "how do I use [panel name]" for details on any of these.`;
      }
      if (/^(give me tips|power.?user|how do i use (you|henry) better|best way to use|how to get (more|most) out)/.test(lowerText)) {
        return `Here are the best ways to get more out of me:\n\n` +
          `**1. Use ⌥Space constantly** — Select any text anywhere on your Mac first, then press ⌥Space. Henry opens with that text already loaded.\n\n` +
          `**2. Teach me about yourself** — Say "remember that I [fact]" and I store it permanently. The more you tell me, the more personal every response gets.\n\n` +
          `**3. Talk naturally** — "Remind me to call John at 3pm Friday" works. "Add a task: finish the report" works. No special syntax needed.\n\n` +
          `**4. Install me on your phone** — Open your companion URL in Safari, tap Share → Add to Home Screen. Free real app.\n\n` +
          `**5. Get unlimited free AI** — Go to aistudio.google.com for a free Gemini key (no card), and groq.com for a free Groq key. Paste both in Settings → AI Providers.`;
      }
      if (/^(how are you doing|self.?assess|what (can't|cannot|can you not) (you )?do|what.*gaps|assess yourself|how (good|well|smart) are you)/.test(lowerText)) {
        const gaps: Array<{query:string;count:number;failReason:string}> = (() => {
          try { return JSON.parse('[]'); } catch { return []; }
        })();
        const usage: Record<string,number> = {};
        const lines = ['**Henry Self-Assessment**\n'];
        const topUsage = Object.entries(usage).sort((a,b)=>b[1]-a[1]).slice(0,5);
        if (topUsage.length) {
          lines.push('**Most used features:**');
          topUsage.forEach(([f,n]) => lines.push(`  • ${f}: ${n}×`));
          lines.push('');
        }
        // Check DB for real usage data
        try {
          const taskCount = (dbGetOne<{n:number}>('SELECT COUNT(*) as n FROM personal_tasks') as {n:number}|null)?.n || 0;
          const habitCount = (dbGetOne<{n:number}>('SELECT COUNT(*) as n FROM habits WHERE active=1') as {n:number}|null)?.n || 0;
          const memCount = (dbGetOne<{n:number}>('SELECT COUNT(*) as n FROM memory_facts') as {n:number}|null)?.n || 0;
          const jnlCount = (dbGetOne<{n:number}>('SELECT COUNT(*) as n FROM journal_entries') as {n:number}|null)?.n || 0;
          lines.push('**Your Henry stats:**');
          lines.push(`  • Tasks in list: ${taskCount}`);
          lines.push(`  • Active habits: ${habitCount}`);
          lines.push(`  • Things I know about you: ${memCount} memory facts`);
          lines.push(`  • Journal entries: ${jnlCount}`);
          lines.push('');
        } catch {}
        lines.push("**What I can't do yet (known limits):**");
        lines.push('  • Browse arbitrary websites or read your email without Gmail connected');
        lines.push('  • Send messages on your behalf without explicit confirmation');
        lines.push('  • Learn new skills autonomously — but I log what you ask for and the dev sees it next session');
        lines.push('\nAsk me "give me tips" to get the most out of what I can do.');
        return lines.join('\n');
      }
      if (/^(shortcuts?|what (keyboard )?shortcuts?|hotkey|how do i open henry|⌥.?space)/.test(lowerText)) {
        return `**Henry shortcuts:**\n\n` +
          `• **⌥Space** — Open Henry from anywhere on your Mac. Select text first and it's already pasted in.\n` +
          `• **⌘⇧H** — Open Henry's full window\n` +
          `• **📌 pin button** — Save any response to Memory\n` +
          `• **Pull down** — Refresh data in the phone companion`;
      }
      if (/how do i use (journal|today|tasks|reminders|goals|health|finance|scripture|prayer|focus|memory|settings|recorder|crm|quoting)/.test(lowerText)) {
        const m = lowerText.match(/how do i use (\w+)/);
        const panel = m ? m[1] : '';
        const help: Record<string,(()=>string)> = {
          journal: () => `**📔 Journal**\n\nWrite daily entries with a mood. After 50+ characters a reflection button appears — I ask a thoughtful follow-up. Your streak is tracked.\n\n**How to use it:**\n• Just start typing\n• Pick a mood emoji\n• Tap AI Reflection for a follow-up prompt\n\n**Tips:**\n• Write from your phone — same entry saves to your Mac\n• Ask me "what did I journal about last week?" and I'll tell you`,
          today: () => `**☀️ Today**\n\nYour morning dashboard — habits to check in, tasks, verse of the day, and day planning.\n\n**How to use it:**\n• Tap habit circles to mark them done\n• Hit "Day plan" for an AI-generated priority list\n• Hit "📊 Daily report" at the end of the day\n\n**Tips:**\n• Day plan is cached — one AI call per day\n• Habits link to the Health panel`,
          finance: () => `**💰 Finance**\n\nTrack money in and out, set category budgets, import bank statements.\n\n**How to use it:**\n• Import a bank statement CSV\n• Set a budget per category\n• Ask me "what did I spend on food this month?"\n\n**Tips:**\n• I flag when you're over budget\n• Export data as CSV from Finance settings`,
          health: () => `**❤️ Health**\n\nSix quick-log buttons: water, steps, exercise, sleep, calories, custom.\n\n**How to use it:**\n• Tap 💧 Water to log 8oz, 👟 Steps for 1,000, etc.\n• Log from your phone too — all 6 buttons are there\n• Say "log 7 hours of sleep" in chat`,
          goals: () => `**◎ Goals**\n\nTrack long-term goals with target dates and priority scores.\n\n**How to use it:**\n• Add a goal with a title, why it matters, and a target date\n• Ask me "coach me on my goals" for a push\n• Mark done when you achieve it\n\n**Tips:**\n• Orange badge in sidebar = overdue goal\n• Mark goals done from your phone`,
          memory: () => `**🧠 Memory**\n\nEverything I know about you — view, add, delete.\n\n**Three ways to add:**\n• Say "remember that I [fact]" in chat\n• Tap 📌 on any response to pin it to memory\n• Open Memory panel and tap +\n\n**What's worth adding:** your name, job, location, family, preferences, goals`,
        };
        if (panel && help[panel]) return help[panel]();
        return null;
      }
      return null;
    })();

    if (knowledgeAnswer) {
      sendReply(knowledgeAnswer);
      return;
    }

    // ── Date / time — instant, no AI needed ─────────────────────────────────────
    if (/^(what(?:'s| is)(?: the)? (today'?s? )?(date|day|time)|what day|today'?s date|current (date|day|time)|what time is it|time now)/.test(lowerText)) {
      const now = new Date();
      const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const day = days[now.getDay()];
      const month = months[now.getMonth()];
      const date = now.getDate();
      const year = now.getFullYear();
      const time = now.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'});
      sendReply(`It's ${day}, ${month} ${date}, ${year} — ${time}.`);
      return;
    }

    // ── Habit fast-path: intercept "mark X done" before task handler ──────────
    {
      const hkws = ['prayer','praying','bible','exercise','journal','water','run','jog','walk'];
      const hasHKW = hkws.some((k: string) => lowerText.includes(k));
      const naturalHabitDone = /^(?:went for a?|did (?:my|the|a)|drank|finished|completed)(?: (?:my|a|the))? (?:run|jog|walk|bible|reading|journal|water|prayer|exercise|meditation)/i.test(lowerText)
                             || /^(?:i (?:prayed|exercised|ran|jogged|walked|meditated|journaled|drank|read (?:my )?bible))/i.test(lowerText);
      const habitWordDone = /^(?:prayer(?:ed)?|bible|exercise(?:d)?|journal(?:ed)?|water|run|jog|walk)(?: done| today)?$/i.test(lowerText);
      if ((hasHKW || naturalHabitDone) && (/^(?:mark|done|check|finish|complete)/.test(lowerText) || naturalHabitDone || habitWordDone)) {
        let hk = hkws.find((k: string) => lowerText.includes(k)) || '';
        if (hk === 'praying') hk = 'prayer';
        if (hk === 'run' || hk === 'jog' || hk === 'walk') hk = 'exercise';
        if (hk === 'meditat') hk = 'meditation';
        // naturalHabitDone - extract keyword from text if no hkw matched
        if (!hk) {
          const nMap: Record<string,string> = {run:'exercise',jog:'exercise',walk:'exercise',bible:'bible',reading:'bible',journal:'journal',water:'water',prayer:'prayer',prayed:'prayer'};
          for (const word of Object.keys(nMap)) { if (lowerText.includes(word)) { hk = nMap[word]; break; } }
        }
        const fh = hk ? dbGetOne<{id:string;name:string}>(
          "SELECT id, name FROM habits WHERE active=1 AND LOWER(name) LIKE ? LIMIT 1", '%'+hk+'%'
        ) as {id:string;name:string}|null : null;
        if (fh) {
          const td = new Date().toISOString().slice(0,10);
          try {
            const ex = dbGetOne<{id:string}>("SELECT id FROM habit_logs WHERE habit_id=? AND date=?", fh.id, td);
            if (!ex) dbRun("INSERT INTO habit_logs (id,habit_id,date,count,created_at) VALUES (?,?,?,?,?)",
              require('crypto').randomUUID(), fh.id, td, 1, new Date().toISOString());
            sendReply('\u2713 ' + fh.name + ' marked done for today.');
          } catch { sendReply('Could not update habit.'); }
          return;
        }
      }
    }

    // ── Maker job completion phrases ──────────────────────────────────────────
    const makerJobDone = /^(?:delivery|order|job|sign(?:s)?|tray(?:s)?) (?:done|complete|ready|made|finished|shipped)$/.test(lowerText)
                      || /^(?:made|cut|engraved|finished)(?: \d+)?(?: (?:walnut|maple|cherry|oak|sign|tray))? (?:sign|tray|board|piece|order)(?:s)?(?:(?: today)| for .+)?$/.test(lowerText);
    if (makerJobDone) {
      const qty = lowerText.match(/(\d+)/)?.[1];
      const product = lowerText.match(/(?:walnut|maple|cherry|oak|sign|tray|board)/i)?.[0] || 'order';
      sendReply('✅ ' + (qty || '1') + ' ' + product + '(s) complete.\n\nLog the revenue: "I got paid $X"');
      return;
    }

    // ── 'customer paid' without amount ──────────────────────────────────────
    if (/^customer(?: just)? paid$/.test(lowerText) || lowerText === 'payment received') {
      sendReply('How much? Say "customer paid $X" or "I got paid $X" to log it.');
      return;
    }

    // ── Complete / done task ──────────────────────────────────────────────────
    // ── "what jobs do I have open" → open task list ────────────────────────
    if (/^what(?:'s my)?(?: open)? jobs?(?: do i have| are open| are there)?/i.test(lowerText) ||
        /^(?:show|list)(?: my)?(?: open)? jobs?(?:\s+in progress)?/i.test(lowerText)) {
      // Alias: jobs = tasks with "job" or "order" in title
      try {
        const allTasks = dbGet<{id:string;title:string;priority:number}>(
          "SELECT id,title,priority FROM personal_tasks WHERE status!='done' ORDER BY priority DESC, created_at DESC LIMIT 15"
        ) as {id:string;title:string;priority:number}[];
        if (!allTasks.length) { sendReply('No open jobs. Add one: "start a new job for [client]"'); return; }
        sendReply('Open jobs:\n\n' + allTasks.map((t,i) => (i+1) + '. ' + t.title).join('\n'));
      } catch { sendReply('Could not load jobs.'); }
      return;
    }

    // ── "open/show [henry panel]" → switch panel via SSE push ──────────────
    const HENRY_PANELS: Record<string,string> = {
      today:'today', journal:'journal', tasks:'tasks', goals:'goals', habits:'health',
      health:'health', finance:'finance', focus:'focus', notes:'memory', memory:'memory',
      settings:'settings', scripture:'scripture', prayer:'prayer', chat:'chat',
      companion:'companion', 'today panel':'today', 'health panel':'health',
      'task panel':'tasks', 'goal panel':'goals', 'journal panel':'journal',
    };
    const panelSwitchM = lowerText.match(/^(?:open|go to|show me?|switch to|navigate to|take me to)(?: (?:the|my|henry))?\s+([\w\s]{2,20})(?:\s+panel|\s+tab|\s+view)?$/i);
    if (panelSwitchM) {
      const hint = (panelSwitchM[1] || '').trim().toLowerCase();
      const panelKey = HENRY_PANELS[hint];
      if (panelKey) {
        pushToAll({ type: 'navigate', payload: { panel: panelKey }, id: '', timestamp: 0 } as any);
        // Also push directly to desktop app renderer via IPC
        BrowserWindow.getAllWindows().forEach(win => {
          try { win.webContents.send('navigate', panelKey); } catch { /* ignore */ }
        });
        sendReply('✅ Opening **' + (hint.charAt(0).toUpperCase() + hint.slice(1)) + '**.');
        return;
      }
    }

    // ── "open [app]" → keyboard guide, never auto-launch ──────────────────
    const openAppGuideMatch = lowerText.match(/^open(?:\s+the)?\s+([a-zA-Z][\w\s]{1,25})(?:\s+app)?$/i);
    if (openAppGuideMatch && !/file|folder|document|\//.test(lowerText)) {
      const _appName = (openAppGuideMatch[1] || '').trim();
      const _skipWords = ['task','goal','note','habit','bible','chat','henry','my','the','a','up'];
      if (!_skipWords.includes(_appName.toLowerCase()) && _appName.length > 1) {
        sendReply('Press **Cmd+Space**, type **"' + _appName + '"**, press Enter.\n\nHenry keeps your hands on the keyboard — no auto-launching.');
        return;
      }
    }

    const xDoneBlocklist = /^(?:all|i'm|that's|good|mission|nothing|totally|almost|nearly|sign order|laser order|delivery|walnut sign|maple sign|signs? order|habits?|show habits?)/i;
    const xDoneResult = !xDoneBlocklist.test(lowerText) ? lowerText.match(/^(.{3,45}) done$/i) : null;
    const completeTaskMatch = lowerText.match(/^(?:complete|finish|done|mark done|check off)(?: my)?(?: first| last| top)? task[:\s]*(.*)$/i)
                        || xDoneResult
                        || lowerText.match(/^(?:mark|complete|finish)(?: task)?[:\s]+(.+)(?: as)? done$/i)
                        || lowerText.match(/^mark task(?:\s+done)?[:\s]+(.+)/i)
                        || lowerText.match(/^complete task[:\s]+(.+)/i)
                        || lowerText.match(/^finish task[:\s]+(.+)/i)
                        || lowerText.match(/^i (?:finished|completed|done|wrapped up|knocked out)(?: the)? (.+?)(?:\s+(?:task|job|todo|project))?$/i)
                        || lowerText.match(/^(?:just )?(?:finished|completed|did|done with)(?: the)? (.+)/i);
    if (completeTaskMatch) {
      try {
        const ctm = Array.isArray(completeTaskMatch) ? completeTaskMatch : null;
        const hint = ctm?.[1]?.trim().toLowerCase() || '';
        let task: {id:string;title:string}|null = null;
        if (hint) {
          task = dbGetOne<{id:string;title:string}>(
            "SELECT id, title FROM personal_tasks WHERE status!='done' AND LOWER(title) LIKE ? ORDER BY created_at ASC LIMIT 1",
            '%' + hint + '%'
          );
        }
        // Handle positional: "first task", "my first task", "oldest task"
        if (!task && /^(?:my )?(?:first|oldest|top|any)(?: task)?$/.test(hint)) {
          task = dbGetOne<{id:string;title:string}>(
            "SELECT id, title FROM personal_tasks WHERE status!='done' ORDER BY created_at ASC LIMIT 1"
          );
        }
        if (!task && hint && !/^(?:my )?(?:first|oldest|top|any)(?: task)?$/.test(hint)) {
          sendReply("Could not find an open task matching: " + hint); return;
        }
        if (!task && !hint) {
          task = dbGetOne<{id:string;title:string}>(
            "SELECT id, title FROM personal_tasks WHERE status!='done' ORDER BY created_at ASC LIMIT 1"
          );
        }
        if (!task) { sendReply("You don't have any open tasks to complete."); return; }
        dbRun("UPDATE personal_tasks SET status='done', completed_at=? WHERE id=?", new Date().toISOString(), task.id);
        sendReply(`✓ Done: "${task.title}"`);
      } catch (e) { sendReply(`Couldn't complete the task: ${e}`); }
      return;
    }

    // ── Goals list ────────────────────────────────────────────────────────────
    const listGoalsMatch = /^(?:what|show|list|get|how many|count)(?: goals?| my goals?| active goals?)/.test(lowerText)
                        || /^what.?s my (?:top|most important|main|biggest)(?: goal)?/.test(lowerText)
                        || lowerText === 'goals' || lowerText === 'my goals' || lowerText === 'top goal'
                        || /^(?:how many|count)(?: my)? goals/.test(lowerText);
    // ── Completed goals ──────────────────────────────────────────────────────
    // ── Goal completion percentage ──────────────────────────────────────────
    const goalsPctMatch = /^(?:what(?:'s| is)(?: my)?|show)(?: my)? (?:goal )?(?:percent(?:age)?|progress|completion|rate|score)(?: (?:done|complete|finished|achieved))?/.test(lowerText)
                       || /^(?:how many|what (?:percent|%))(?: of)?(?: my)? goals(?: are)? (?:done|complete|finished|achieved|hit)/.test(lowerText);
    if (goalsPctMatch) {
      try {
        const active = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM goals WHERE status='active'") as {n:number}|null)?.n || 0;
        const done = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM goals WHERE status IN ('done','completed','abandoned')") as {n:number}|null)?.n || 0;
        const total = active + done;
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        sendReply('Goal progress:\n\n' +
          '✅ Completed: ' + done + '\n' +
          '🔄 Active: ' + active + '\n' +
          '📊 Completion rate: ' + pct + '%\n\n' +
          (done === 0 ? 'No goals completed yet. Say "mark goal done: [title]" when you hit one.' : 
           pct >= 50 ? 'Great progress! Over halfway there.' : 'Keep going — you have ' + active + ' goals in flight.'));
      } catch { sendReply('Could not load goal progress.'); }
      return;
    }

    const completedGoalsMatch = /^(?:show|list|how many)(?: my)?(?: completed?| achieved?| done| finished)(?: goals?)?/.test(lowerText)
                              || /^how many goals? (?:have i|did i)(?: hit| achieve| complete| finish)?/.test(lowerText)
                              || lowerText === "goals achieved" || lowerText === "completed goals";
    if (completedGoalsMatch) {
      try {
        const done = dbGet<{title:string}>(
          "SELECT title FROM goals WHERE status IN ('done','completed','abandoned') ORDER BY updated_at DESC LIMIT 10"
        ) as {title:string}[];
        const active = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM goals WHERE status='active'") as {n:number}|null)?.n || 0;
        if (!done.length) sendReply("No goals marked done yet. Say 'mark goal done: [title]' when you achieve one.\n\nYou have " + active + " active goals in progress.");
        else sendReply(done.length + " goal" + (done.length > 1 ? "s" : "") + " completed:\n\n" +
          done.map((g,i) => (i+1) + ". ✅ " + g.title).join("\n") +
          "\n\nStill going: " + active + " active goal" + (active !== 1 ? "s" : ""));
      } catch { sendReply("Could not load completed goals."); }
      return;
    }

    if (listGoalsMatch) {
      try {
        const goals = dbGet<{title:string;priority_score:number}>(
          "SELECT title, priority_score, created_at FROM goals WHERE status!='done' ORDER BY priority_score DESC, created_at DESC LIMIT 10"
        ) as {title:string;target_date:string;priority_score:number}[];
        if (!goals.length) {
          sendReply("You don't have any active goals yet. Open the Goals panel and add your first one.");
        } else {
            sendReply(goals.length + ' active goal' + (goals.length>1?'s':'') + ':\n\n' +
            goals.map((g,i) => {
              return (i+1) + '. ' + g.title;
            }).join('\n'));
        }
      } catch { sendReply('Could not load goals right now.'); }
      return;
    }

    // ── Set goal deadline ────────────────────────────────────────────────────
    const goalDeadlineMatch = lowerText.match(/^(?:set|add)(?: a)? (?:goal )?(?:deadline|due date|target date)[:\s]+(.+?) (?:by|to|on|for) (.+)/i)
                           || lowerText.match(/^(?:set|update) (.+?) (?:goal )?(?:deadline|due date)[:\s]+(.+)/i);
    if (goalDeadlineMatch) {
      const goalHint = (goalDeadlineMatch[1] || '').trim().toLowerCase();
      const dateHint = (goalDeadlineMatch[2] || goalDeadlineMatch[1] || '').trim();
      try {
        // Find the goal
        const goal = goalHint.length > 2 ? dbGetOne<{id:string;title:string}>(
          "SELECT id, title FROM goals WHERE LOWER(title) LIKE ? AND status='active' LIMIT 1",
          '%' + goalHint.toLowerCase() + '%'
        ) as {id:string;title:string}|null
        : dbGetOne<{id:string;title:string}>(
          "SELECT id, title FROM goals WHERE status='active' ORDER BY priority_score DESC LIMIT 1"
        ) as {id:string;title:string}|null;
        if (!goal) {
          // Fall back to top goal if no match
          const topGoalFallback = dbGetOne<{id:string;title:string}>(
            "SELECT id, title FROM goals WHERE status='active' ORDER BY priority_score DESC LIMIT 1"
          ) as {id:string;title:string}|null;
          if (!topGoalFallback) { sendReply("No active goals found."); return; }
          const existFb = dbGetOne<{summary:string}>("SELECT summary FROM goals WHERE id=?", topGoalFallback.id) as {summary:string}|null;
          const newSumFb = "Deadline: " + dateHint + (existFb?.summary ? " | " + existFb.summary : "");
          dbRun("UPDATE goals SET summary=?, updated_at=? WHERE id=?", newSumFb, new Date().toISOString(), topGoalFallback.id);
          sendReply('Goal deadline set: "' + topGoalFallback.title + '" \u2192 ' + dateHint + '\n\n(Used top goal since "' + goalHint + '" wasn\'t found)');
          return;
        }
        // Store deadline in summary field since goals table has no target_date
        const existing = dbGetOne<{summary:string}>("SELECT summary FROM goals WHERE id=?", goal.id) as {summary:string}|null;
        const newSummary = "Deadline: " + dateHint + (existing?.summary ? " | " + existing.summary : "");
        dbRun("UPDATE goals SET summary=?, updated_at=? WHERE id=?", newSummary, new Date().toISOString(), goal.id);
        sendReply('Goal deadline set: "' + goal.title + '" → ' + dateHint);
      } catch (e) { sendReply("Could not set deadline: " + e); }
      return;
    }



    // ── Add goal ──────────────────────────────────────────────────────────────
    // "update goal: X to: Y" — must fire before addGoalMatch
    const updateGoalMatch = /^(?:update|change|edit|revise)(?: (?:my|the|a))?(?: goal)?[:\s]+/.test(lowerText);
    if (updateGoalMatch) {
      const m = resolvedText.match(/^(?:update|change|edit|revise)(?: (?:my|the|a))?(?: goal)?[:\s]+(.+?) (?:to|as)[:\s]+(.+)/i);
      if (m) {
        const oldHint = m[1].trim().toLowerCase();
        const newTitle = m[2].trim();
        try {
          const g = dbGetOne<{id:string;title:string}>(
            "SELECT id, title FROM goals WHERE LOWER(title) LIKE ? AND status='active' LIMIT 1",
            '%' + oldHint + '%'
          ) as {id:string;title:string}|null;
          if (g) { dbRun("UPDATE goals SET title=?, updated_at=? WHERE id=?", newTitle, new Date().toISOString(), g.id); sendReply('✏️ Goal updated: "' + g.title + '" → "' + newTitle + '"'); }
          else { sendReply('No active goal found matching "' + oldHint + '". Say "what goals do I have" to see your list.'); }
        } catch (e) { sendReply('Could not update goal: ' + e); }
        return;
      }
    }

    const addGoalMatch = lowerText.match(/^(?:add|create|new|set) (?:a )?goal[:\s]+(.+)/i)
                      || lowerText.match(/^goal[:\s]+(.+)/i);
    if (addGoalMatch) {
      const title = resolvedText
        .replace(/^(?:add|create|new|set) (?:a )?goal[:\s]+/i,'')
        .replace(/^goal[:\s]+/i,'').trim();
      if (title.length > 1) {
        try {
          const id = require('crypto').randomUUID();
          dbRun("INSERT INTO goals (id,title,status,priority_score,strategic_significance_score,emotional_significance_score,created_at,updated_at,last_active_at) VALUES (?,?,?,?,?,?,?,?,?)",
            id, title, 'active', 0.7, 0.7, 0.5, new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
          try { dbRun('PRAGMA wal_checkpoint(PASSIVE)'); } catch {}
          sendReply(`✓ Goal added: "${title}"`);
        } catch (e) { sendReply(`Couldn't save the goal: ${e}`); }
        return;
      }
    }

    // ── Action commands — execute directly, no AI needed ────────────────────────

    // "add a task: X" / "create a task: X" / "new task: X"
    const addTaskMatch = lowerText.match(/^(?:add|create|new) (?:a )?task(?:\s+for\s+(?:tomorrow|today))?[:\s]+(.+)/i)
                      || lowerText.match(/^task[:\s]+(.+)/i)
                      || lowerText.match(/^start(?: a)?(?: new)? job for ([\w\s]+)/i);
    if (addTaskMatch) {
      // Handle 'start a new job for X' → title = 'New job: X'
      const isJobStart = /^start(?: a)?(?: new)? job for /i.test(resolvedText);
      const jobClient = isJobStart ? resolvedText.replace(/^start(?: a)?(?: new)? job for /i,'').trim() : null;
      const title = jobClient
        ? 'New job: ' + jobClient
        : resolvedText
          .replace(/^(?:add|create|new|start) (?:a )?task(?:\s+for\s+(?:tomorrow|today))?[:\s]+/i,'')
          .replace(/^task[:\s]+/i,'').trim();
      if (title.length > 1) {
        try {
          const id = require('crypto').randomUUID();
          dbRun("INSERT INTO personal_tasks (id,title,status,priority,created_at) VALUES (?,?,?,?,?)",
            id, title, 'todo', 2, new Date().toISOString());
          sendReply(`✓ Task saved: "${title}"`);
        } catch (e) { sendReply(`Couldn't save the task: ${e}`); }
        return;
      }
    }

    // "remind me to X [at/on TIME/DATE]" 
    const remindMatch = lowerText.match(/^remind(?:er)?(?: me)? (?:to |about )?(.+)/i)
                    || lowerText.match(/^(?:customer|client) (?:pickup|coming|scheduled|arriving?|visit)(?: at| for)? (.+)/i)
                    || lowerText.match(/^pickup(?:\s+at)? (.+)/i)
                    || lowerText.match(/^reminder[:\s]+(.+)/i)
                    || lowerText.match(/^(?:set|add|create)(?: a)? reminder(?: for)?[:\s]+(.+)/i)
                    || lowerText.match(/^(?:set(?: up)?|add|create)(?: a| an?)?(?: daily| weekly| recurring| quick)? reminder[:\s]*(.+)/i)
                    || lowerText.match(/^(?:set up|create)(?: a| an?)? (?:daily|weekly|recurring) reminder[:\s]+(.+)/i)
                    || lowerText.match(/^(?:customer|client)(?: scheduled| coming)?(?: at| for) (.+)/i);
    if (remindMatch) {
      const rawTitle = resolvedText
        .replace(/^remind(?:er)?(?: me)? (?:to |about )?/i,'')
        .replace(/^(?:set|add|create)(?: a)? reminder(?: for)?[:\s]+/i,'').trim();
      // Parse time: handles "3pm today", "tomorrow at 9am", "friday at 2:30pm"
      const timeMatch = rawTitle.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i);
      const dayMatch  = rawTitle.match(/\b(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
      const title = rawTitle
        .replace(/\s*\b(?:at|on|for)\s+(?:tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, '')
        .replace(/\s*\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, '')
        .trim() || rawTitle;
      const due_at = (() => {
        if (!timeMatch && !dayMatch) return null;
        const d = new Date();
        const dayStr = dayMatch ? dayMatch[1].toLowerCase() : '';
        if (dayStr === 'tomorrow') { d.setDate(d.getDate()+1); }
        else if (dayStr === 'today') { /* keep today */ }
        else if (dayStr) {
          const days: Record<string,number> = {monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6,sunday:0};
          if (days[dayStr] !== undefined) {
            const target = days[dayStr], curr = d.getDay();
            const diff = (target - curr + 7) % 7 || 7;
            d.setDate(d.getDate() + diff);
          }
        }
        if (timeMatch) {
          const tStr = timeMatch[1].toLowerCase().replace(/\s/g, '');
          const isPm = tStr.includes('pm');
          const [hStr, mStr] = tStr.replace(/[apm]/g, '').split(':');
          let h = parseInt(hStr); const m = parseInt(mStr || '0');
          if (isPm && h !== 12) h += 12; else if (!isPm && h === 12) h = 0;
          d.setHours(h, m, 0, 0);
        } else { d.setHours(dayStr === 'today' ? 17 : 9, 0, 0, 0); }
        return d.toISOString();
      })();
      try {
        const id = require('crypto').randomUUID();
        dbRun("INSERT INTO reminders (id,title,due_at,done,created_at) VALUES (?,?,?,?,?)",
          id, title || rawTitle, due_at, 0, new Date().toISOString());
        const whenStr = due_at ? ` for ${new Date(due_at).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}` : '';
        sendReply(`✓ Reminder set: "${title || rawTitle}"${whenStr}`);
      } catch (e) { sendReply(`Couldn't set the reminder: ${e}`); }
      return;
    }

    // "what tasks do i have" / "show my tasks" / "list my tasks"
    // ── Tasks in progress (doing) ────────────────────────────────────────────
    const doingTasksMatch = /^(?:show|what|list)(?: (?:tasks?|all))?(?: i(?:'m| am))? (?:working on|in progress|doing|started|active)/.test(lowerText)
                          || /^what tasks? (?:are)? ?(?:almost done|nearly done|in progress)/.test(lowerText)
                          || /^(?:what(?: tasks?)? am i|tasks? (?:in progress|i(?:'m| am) working on|doing))/.test(lowerText)
                          || lowerText === "in progress" || lowerText === "what am i working on";
    if (doingTasksMatch) {
      try {
        const doing = dbGet<{title:string}>(
          "SELECT title FROM personal_tasks WHERE status='doing' ORDER BY updated_at DESC LIMIT 10"
        ) as {title:string}[];
        if (!doing.length) sendReply("No tasks in progress. Say \"update task: [title] to doing\" to start working on one.");
        else sendReply(doing.length + " task" + (doing.length > 1 ? "s" : "") + " in progress:\n\n" +
          doing.map((t,i) => (i+1) + ". " + t.title).join("\n") + "\n\nSay \"complete task: [title]\" when done.");
      } catch { sendReply("Could not load in-progress tasks."); }
      return;
    }

    // ── Overdue tasks ─────────────────────────────────────────────────────────
    // ── Tasks due this week ────────────────────────────────────────────────────
    const dueSoonMatch = /^(?:show|what|list)(?: (?:tasks?|all))?(?: due| coming)?(?: this week| soon| upcoming)/.test(lowerText)
                      || /^(?:tasks?|what) (?:due|coming) (?:this week|soon)/.test(lowerText)
                      || lowerText === "due this week" || lowerText === "what's due";
    if (dueSoonMatch) {
      try {
        const endOfWeek = new Date(); endOfWeek.setDate(endOfWeek.getDate() + 7); endOfWeek.setHours(23,59,59,999);
        const tasks = dbGet<{title:string;due_at:string}>(
          "SELECT title, due_at FROM personal_tasks WHERE status!='done' AND due_at IS NOT NULL AND due_at <= ? ORDER BY due_at ASC LIMIT 10",
          endOfWeek.toISOString()
        ) as {title:string;due_at:string}[];
        const noDate = dbGet<{title:string}>(
          "SELECT title FROM personal_tasks WHERE status='todo' ORDER BY priority DESC, created_at DESC LIMIT 5"
        ) as {title:string}[];
        const lines = [];
        if (tasks.length) lines.push(tasks.length + " task" + (tasks.length > 1 ? "s" : "") + " due this week:\n" + tasks.map((t,i) => {
          const d = new Date(t.due_at);
          return (i+1) + ". " + t.title + " (" + d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}) + ")";
        }).join("\n"));
        if (!tasks.length) lines.push("No tasks with due dates this week.\n\nTop open tasks:\n" + noDate.map((t,i) => (i+1) + ". " + t.title).join("\n"));
        sendReply(lines.join("\n\n"));
      } catch { sendReply("Could not load due tasks."); }
      return;
    }

    const overdueMatch = /^(?:what(?:'s| is)(?: my)?(?: overdue| past due|overdue)|show(?: my)? overdue|list overdue|overdue tasks?)/.test(lowerText)
                      || /^what(?: tasks?)?(?: are)? (?:past due|overdue|late|overdue)/.test(lowerText)
                      || lowerText === "overdue" || lowerText === "what's overdue" || lowerText === "past due" || lowerText === "what's past due";
    if (overdueMatch) {
      try {
        const now = new Date().toISOString();
        const overdue = dbGet<{title:string;due_at:string}>(
          "SELECT title, due_at FROM personal_tasks WHERE status!='done' AND due_at IS NOT NULL AND due_at < ? ORDER BY due_at ASC LIMIT 10",
          now
        ) as {title:string;due_at:string}[];
        if (!overdue.length) {
          sendReply("No overdue tasks. You're on top of things!");
        } else {
          sendReply(overdue.length + " overdue task" + (overdue.length > 1 ? "s" : "") + ":\n\n" +
            overdue.map((t,i) => (i+1) + ". " + t.title).join("\n"));
        }
      } catch { sendReply("Could not check overdue tasks."); }
      return;
    }

    // ── High priority tasks filter ────────────────────────────────────────────
    const highPriorityTasksMatch = /^(?:what|show|list)(?: tasks?)?(?: (?:are|my))?(?: high.priority| top priority| important| urgent| priority)(?: tasks?)?/.test(lowerText)
                                || lowerText === "high priority" || lowerText === "priority tasks" || lowerText === "my priorities";
    if (highPriorityTasksMatch) {
      try {
        const tasks = dbGet<{title:string;priority:number}>(
          "SELECT title, priority FROM personal_tasks WHERE status!='done' AND priority >= 3 ORDER BY priority DESC, created_at DESC LIMIT 10"
        ) as {title:string;priority:number}[];
        if (!tasks.length) sendReply("No high-priority tasks. Use \"set task priority: [title] to high\" to mark urgent tasks.");
        else sendReply(tasks.length + " high-priority task" + (tasks.length > 1 ? "s" : "") + ":\n\n" +
          tasks.map((t,i) => (i+1) + ". 🔴 " + t.title).join("\n"));
      } catch { sendReply("Could not load high-priority tasks."); }
      return;
    }

    const listTasksMatch = /^(?:what|show|list|get|how many)(?: tasks?| my tasks?| my open tasks?| open tasks?| all tasks?| todo(?:s)?)/.test(lowerText)
                        || lowerText === 'tasks' || lowerText === 'my tasks' || lowerText === 'open tasks'
                        || /^how many (?:open |active )?tasks/.test(lowerText);
    // Separate: count of DONE tasks + list done today
    const doneTodayMatch = /^(?:what(?: tasks?)? did i (?:complet|finish)|what tasks.*(?:today|done|complet)|tasks? done today|completed today)/.test(lowerText)
                        || lowerText === 'tasks done today' || lowerText === 'completed today';
    if (doneTodayMatch) {
      try {
        const today = new Date().toISOString().slice(0,10);
        const done = dbGet<{title:string}>(
          "SELECT title FROM personal_tasks WHERE status='done' AND completed_at >= ? ORDER BY completed_at DESC LIMIT 10",
          today + 'T00:00:00.000Z'
        ) as {title:string}[];
        if (!done.length) sendReply("No tasks completed yet today. Keep going!");
        else sendReply(done.length + " task" + (done.length > 1 ? "s" : "") + " completed today:\n\n" +
          done.map((t,i) => (i+1) + ". " + t.title).join("\n"));
      } catch { sendReply("Could not load completed tasks."); }
      return;
    }

    const countDoneTasksMatch = /^how many tasks(?: are| have i)?(?: completed?| done| finished)/.test(lowerText)
                              || lowerText === 'how many tasks done' || lowerText === 'tasks completed';
    if (countDoneTasksMatch) {
      try {
        const n = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM personal_tasks WHERE status='done'") as {n:number}|null)?.n || 0;
        const t = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM personal_tasks") as {n:number}|null)?.n || 0;
        sendReply(n + " of " + t + " task" + (t !== 1 ? "s" : "") + " completed.");
      } catch { sendReply("Could not count completed tasks."); }
      return;
    }
    if (listTasksMatch) {
      try {
        const tasks = dbGet<{title:string;status:string}>(
          "SELECT title, status FROM personal_tasks WHERE status!='done' ORDER BY created_at DESC LIMIT 10"
        ) as {title:string;status:string}[];
        if (!tasks.length) {
          sendReply("You don't have any open tasks. Say 'add a task: [title]' to add one.");
        } else {
          sendReply(`You have ${tasks.length} open task${tasks.length>1?'s':''}:\n\n` +
            tasks.map((t,i) => `${i+1}. ${t.title}`).join('\n'));

        }
      } catch { sendReply('Could not load tasks right now.'); }
      return;
    }

    // "what reminders do i have" / "show reminders"
    // ── Reminders due today ─────────────────────────────────────────────────
    const remsDueTodayMatch = /^(?:show|what|list)(?: my)? reminders? (?:due|for|today)/.test(lowerText)
                           || /^(?:today|due today).* reminders?/.test(lowerText)
                           || lowerText === "reminders today" || lowerText === "due today";
    if (remsDueTodayMatch) {
      try {
        const today = new Date(); today.setHours(23,59,59,999);
        const todayStr = today.toISOString();
        const startStr = new Date(new Date().setHours(0,0,0,0)).toISOString();
        const rems = dbGet<{title:string;due_at:string}>(
          "SELECT title, due_at FROM reminders WHERE done=0 AND due_at >= ? AND due_at <= ? ORDER BY due_at ASC LIMIT 10",
          startStr, todayStr
        ) as {title:string;due_at:string}[];
        if (!rems.length) sendReply("No reminders due today. 🎉");
        else sendReply(rems.length + " reminder" + (rems.length > 1 ? "s" : "") + " today:\n\n" +
          rems.map((r,i) => {
            const t = new Date(r.due_at);
            return (i+1) + ". " + r.title + " @ " + t.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'});
          }).join("\n"));
      } catch { sendReply("Could not load today's reminders."); }
      return;
    }

    const listRemsMatch = /^(?:what|show|list|get|how many)(?: reminders?| my reminders?| due(?:\s+today)?)/.test(lowerText)
                       || lowerText === 'reminders' || /^how many reminders/.test(lowerText);
    if (listRemsMatch) {
      try {
        const rems = dbGet<{title:string;due_at:string}>(
          "SELECT title, due_at FROM reminders WHERE done=0 ORDER BY due_at ASC LIMIT 10"
        ) as {title:string;due_at:string}[];
        if (!rems.length) {
          sendReply("No pending reminders. Say 'remind me to [task] tomorrow' to add one.");
        } else {
          sendReply(`${rems.length} reminder${rems.length>1?'s':''}:\n\n` +
            rems.map((r,i) => {
              const d = r.due_at ? new Date(r.due_at).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : 'no time set';
              return `${i+1}. ${r.title} — ${d}`;
            }).join('\n'));

        }
      } catch { sendReply('Could not load reminders right now.'); }
      return;
    }

    // ── Toggle habit done ─────────────────────────────────────────────────────
    // Check for explicit habit keywords FIRST to prevent task handler stealing them
    const knownHabitKeywords = ['prayer','praying','bible','exercise','exercised','water','journal','journaled'];
    const hasHabitKeyword = knownHabitKeywords.some(k => lowerText.includes(k));
    const habitDoneMatch = lowerText.match(/^(?:done|completed?|finished?|mark(?:ed)? done|checked?)(?: my)?(?: habit[:\s]+)?(.+)/i)
                        || lowerText.match(/^(.+)(?: habit)? (?:done|completed|finished)$/i)
                        || lowerText.match(/^i (?:just |already |finally )?(?:finished|completed|did) (?:my )?(.+?)(?:\s+today)?$/i)
                        || lowerText.match(/^i (?:prayed|exercised|worked out|read(?:\s+my bible)?|journaled|drank)(?: my)?(?: water)?(?:\s+(?:today|this morning|this evening|earlier|already))?$/i)
                        || lowerText.match(/^i (?:just|already|finally) (?:finished|completed|did|done|prayed|exercised|journaled|read)(?: my )?(?:journal(?:ing|ed)?|pray(?:ing|ed|er)?|exercis(?:ing|ed)?|bible|reading)?(?: today)?$/i)
                        || (hasHabitKeyword && lowerText.match(/^(?:mark|mark done)(?: my)?(?: (?:read|morning|daily))? ?(?:bible|prayer|exercise|water|journal)(?: done)?$/i));
    if (habitDoneMatch) {
      // Extract hint from whichever capture group matched, strip "with " prefix
      let hint = (habitDoneMatch[1] || habitDoneMatch[2] || habitDoneMatch[3] || '').trim().toLowerCase();
      hint = hint.replace(/^with\s+/, '');
      // Map natural words to habit name fragments
      const activityMap: Record<string,string> = {
        'praying': 'prayer', 'prayed': 'prayer', 'prayer': 'prayer',
        'bible': 'bible', 'read': 'bible',
        'exercising': 'exercise', 'exercised': 'exercise', 'exercise': 'exercise',
        'water': 'water', 'drank': 'water', 'drunk': 'water', 'drinking': 'water',
        'journaled': 'journal', 'journaling': 'journal', 'journal': 'journal',
        'worked out': 'exercise', 'ran': 'exercise',
      };
      hint = activityMap[hint] || hint;
      // Extract activity keyword from lowerText - check water FIRST before exercise
      if (!hint || hint.length < 2) {
        if (lowerText.includes('water') || lowerText.includes('drank') || lowerText.includes('drunk')) hint = 'water';
        else if (lowerText.includes('journaling') || (lowerText.includes('journal') && /finished|completed|done|just/.test(lowerText))) hint = 'journal';
        else if (lowerText.includes('prayer') || lowerText.includes('pray')) hint = 'prayer';
        else if (lowerText.includes('bible') || lowerText.includes('scripture') || lowerText.includes('read bible') || (lowerText.includes('reading') && lowerText.includes('bible'))) hint = 'bible';
        else if (lowerText.includes('journal') || lowerText.includes('journaling') || lowerText.includes('journaled')) hint = 'journal';
        else if (lowerText.includes('exercis') || lowerText.includes('work out') || lowerText.includes('ran')) hint = 'exercise';
      }
      // Only fire if hint matches a real habit name
      const matchedHabit = hint.length > 1 ? dbGetOne<{id:string;name:string}>(
        "SELECT id, name FROM habits WHERE active=1 AND LOWER(name) LIKE ? LIMIT 1",
        '%' + hint + '%'
      ) : null;
      if (matchedHabit) {
        const today = new Date().toISOString().slice(0,10);
        try {
          const existing = dbGetOne<{id:string}>("SELECT id FROM habit_logs WHERE habit_id=? AND date=?", matchedHabit.id, today);
          if (!existing) {
            dbRun("INSERT INTO habit_logs (id,habit_id,date,count,created_at) VALUES (?,?,?,?,?)",
              require('crypto').randomUUID(), matchedHabit.id, today, 1, new Date().toISOString());
          }
          sendReply('✓ ' + matchedHabit.name + ' marked done for today.');
        } catch (e) { sendReply("Could not update habit: " + e); }
        return;
      }
    }

    // ── Terse health log: "water: 16oz", "sleep: 8h", "steps: 5000" ─────────
    const terseHealthMatch = lowerText.match(/^(?:log\s+)?(water|sleep|steps?|exercise|weight|calories?|cal)[:\s]+([\d.]+)\s*(oz|glasses?|hrs?|hours?|mins?|minutes?|steps?|cal(?:ories)?|oz|lb[s]?|kg)?/i);
    if (terseHealthMatch) {
      try {
        const cat = terseHealthMatch[1].toLowerCase().replace(/steps/, 'steps').replace(/calories?|cal/, 'calories');
        const val = parseFloat(terseHealthMatch[2]) || 1;
        const cat2unit: Record<string,string> = {water:'oz',sleep:'hrs',steps:'steps',exercise:'min',weight:'lbs',calories:'cal',cal:'cal'};
        const unit = (terseHealthMatch[3] || cat2unit[cat] || 'units').toLowerCase();
        const today = new Date().toISOString().slice(0,10);
        dbRun("INSERT INTO health_logs (id,date,category,label,value,unit,created_at) VALUES (?,?,?,?,?,?,?)",
          require('crypto').randomUUID(), today, cat, cat, val, unit, new Date().toISOString());
        sendReply("Logged: " + val + " " + unit + " (" + cat + ")");
      } catch (e) { sendReply("Could not log: " + e); }
      return;
    }

    // ── Natural activity logging ─────────────────────────────────────────────
    const naturalHealthMatch = lowerText.match(/^i (?:slept|got) (\d+(?:\.\d+)?) hours?(?: of sleep)?(?:\s+today)?$/i)
                            || lowerText.match(/^i (?:drank|had) (\d+(?:\s+(?:glasses?|oz|cups?))?) (?:of )?water(?:\s+today)?$/i)
                            || lowerText.match(/^i (?:walked|ran|did) (\d+(?:,?\d+)?) ?steps?(?:\s+today)?$/i)
                            || lowerText.match(/^i (?:exercised|worked out|ran|jogged)(?: for)? (\d+) ?(?:mins?|minutes?|hours?|hrs?)?(?:\s+today)?$/i)
                            || lowerText.match(/^i (?:burned|consumed) (\d+) ?(?:calories|cal)(?:\s+today)?$/i);
    if (naturalHealthMatch) {
      try {
        const today = new Date().toISOString().slice(0,10);
        const rawVal = (naturalHealthMatch[1] || '').replace(',','').trim();
        let value = parseFloat(rawVal) || 1;
        let category = 'custom';
        let unit = '';
        if (/slept|sleep|hours/.test(lowerText)) { category = 'sleep'; unit = 'hrs'; }
        else if (/drank|water|glasses/.test(lowerText)) { category = 'water'; unit = 'oz'; if (rawVal.includes('glass')) value *= 8; }
        else if (/steps|walked|ran.*step/.test(lowerText)) { category = 'steps'; unit = 'steps'; }
        else if (/exercised|worked out|jogged|ran/.test(lowerText)) { category = 'exercise'; unit = 'min'; }
        else if (/calories|burned|consumed/.test(lowerText)) { category = 'calories'; unit = 'cal'; }
        dbRun("INSERT INTO health_logs (id,date,category,label,value,unit,created_at) VALUES (?,?,?,?,?,?,?)",
          require('crypto').randomUUID(), today, category, category, value, unit, new Date().toISOString());
        sendReply('Logged: ' + value + (unit ? ' ' + unit : '') + ' (' + category + ')');
      } catch (e) { sendReply('Could not log: ' + e); }
      return;
    }

    // ── Log health ─────────────────────────────────────────────────────────────
    const healthLogMatch = lowerText.match(/^log(?:ged)? (\d+(?:\.\d+)?)\s*(oz|glasses?|steps?|mins?|minutes?|hours?|hrs?|h\b|calories?|cal|lbs?|kg)\s*(?:of\s+)?(.+)?$/i)
                        || lowerText.match(/^(?:log|add|record)\s+(.+)\s+(water|steps|exercise|sleep|calories)$/i)
                        || lowerText.match(/^log\s+(water|sleep|steps?|exercise|calories?)\s+(\d+(?:\.\d+)?)(h\b|hrs?|oz|steps?|mins?|cal)?/i);
    if (healthLogMatch) {
      try {
        const today = new Date().toISOString().slice(0,10);
        let value = parseFloat(healthLogMatch[1] || '1');
        let unit = (healthLogMatch[2] || '').toLowerCase();
        let label = (healthLogMatch[3] || healthLogMatch[2] || 'health').trim();
        let category = 'custom';
        if (unit.includes('oz') || unit.includes('glass') || label.includes('water')) category = 'water';
        else if (unit.includes('step')) category = 'steps';
        else if (unit.includes('min') || label.includes('exercise') || label.includes('workout')) category = 'exercise';
        else if (unit.includes('hr') || unit.includes('hour') || label.includes('sleep')) category = 'sleep';
        else if (unit.includes('cal')) category = 'calories';
        dbRun("INSERT INTO health_logs (id,date,category,label,value,unit,created_at) VALUES (?,?,?,?,?,?,?)",
          require('crypto').randomUUID(), today, category, label || category, value, unit, new Date().toISOString());
        sendReply('✓ Logged: ' + value + ' ' + unit + ' (' + category + ')');
      } catch (e) { sendReply("Could not log: " + e); }
      return;
    }

    // ── Health summary ────────────────────────────────────────────────────────
    // ── Health this week ─────────────────────────────────────────────────────
    const healthWeekMatch = /^(?:show|how much|what(?:'s| is)?)(?: my)? (?:water|sleep|exercise|steps?|calories?)(?: average)?(?: this week| this past week| for the week)$/.test(lowerText);
    if (healthWeekMatch) {
      try {
        const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate()-7);
        const weekStr = weekAgo.toISOString().slice(0,10);
        const logs = dbGet<{category:string;value:number;unit:string;date:string}>(
          "SELECT category, SUM(value) as value, unit, date FROM health_logs WHERE date >= ? GROUP BY category, unit ORDER BY category",
          weekStr
        ) as {category:string;value:number;unit:string;date:string}[];
        if (!logs.length) sendReply("No health data logged this week. Say 'log 8 oz water' to start tracking.");
        else sendReply("Health this week:\n\n" + logs.map(l => l.category + ": " + l.value.toFixed(0) + " " + l.unit).join("\n"));
      } catch { sendReply("Could not load weekly health."); }
      return;
    }

    // ── "what did I just log" / "what did I log today" ─────────────────────
    const loggedTodayMatch = /^(?:what did i(?: just)? log|show (?:my )?(?:today|recent) (?:logs?|entries?)|what have i logged)/.test(lowerText);
    if (loggedTodayMatch) {
      try {
        const today = new Date().toISOString().slice(0,10);
        const health = dbGet<{category:string;value:number;unit:string}>(
          "SELECT category, SUM(value) as value, unit FROM health_logs WHERE date=? GROUP BY category, unit", today
        ) as {category:string;value:number;unit:string}[];
        const income = (dbGetOne<{n:number}>(
          "SELECT COALESCE(SUM(amount),0) as n FROM transactions WHERE date=? AND type='income'", today
        ) as {n:number}|null)?.n || 0;
        const tasksDone = (dbGetOne<{n:number}>(
          "SELECT COUNT(*) as n FROM personal_tasks WHERE date(completed_at)=?", today
        ) as {n:number}|null)?.n || 0;
        const habitsDone = (dbGetOne<{n:number}>(
          "SELECT COUNT(*) as n FROM habit_logs WHERE date=?", today
        ) as {n:number}|null)?.n || 0;
        const lines = ["Today's log:\n"];
        if (health.length) lines.push("💪 Health: " + health.map(h => h.value.toFixed(0) + " " + h.unit + " " + h.category).join(", "));
        if (income > 0) lines.push("💰 Revenue: $" + income.toFixed(2));
        if (tasksDone > 0) lines.push("✓ Tasks completed: " + tasksDone);
        if (habitsDone > 0) lines.push("🔄 Habits done: " + habitsDone);
        if (lines.length === 1) lines.push("Nothing logged yet today. Try 'water: 32oz' or 'prayer done'.");
        sendReply(lines.join("\n"));
      } catch { sendReply("Could not load today's log."); }
      return;
    }

    const healthSummaryMatch = /^(?:show|what(?:'s| is| are)?|how much|how many)(?: my)? (?:health|water|steps?|sleep|exercise|calories?|logs?)(?: today| this week)?/.test(lowerText)
                            || /^(?:health|water|steps?)(?:\s+today)?$/.test(lowerText);
    if (healthSummaryMatch) {
      try {
        const today = new Date().toISOString().slice(0,10);
        const logs = dbGet<{category:string;label:string;value:number;unit:string}>(
          "SELECT category, label, value, unit FROM health_logs WHERE date=? ORDER BY created_at DESC",
          today
        ) as {category:string;label:string;value:number;unit:string}[];
        if (!logs.length) {
          sendReply("No health data logged today yet. Say 'log 8oz water' or 'log 30 min exercise' to track.");
        } else {
          // Group by category
          const grouped: Record<string,string[]> = {};
          logs.forEach(l => {
            const cat = l.category || l.label;
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(l.value + (l.unit ? ' ' + l.unit : ''));
          });
          const lines = ["Today's health log:\\n"];
          Object.entries(grouped).forEach(([cat, vals]) => {
            lines.push('• ' + cat + ': ' + vals.join(', '));
          });
          sendReply(lines.join('\n'));
        }
      } catch { sendReply('Could not load health data.'); }
      return;
    }

    // ── Habit streak / status ─────────────────────────────────────────────────
    // Habit count ("how many habits done today") - separate from status list
    if (/^how many habits(?: (?:have i|did i|are))? (?:done|completed?|finished?)(?: today)?$/.test(lowerText)) {
      try {
        const today = new Date().toISOString().slice(0,10);
        const done = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM habit_logs WHERE date=?", today) as {n:number}|null)?.n || 0;
        const total = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM habits WHERE active=1") as {n:number}|null)?.n || 0;
        sendReply(done + "/" + total + " habit" + (total !== 1 ? "s" : "") + " completed today.");
      } catch { sendReply("Could not count habits."); }
      return;
    }

    // Don't intercept "longest streak" / "habit streaks this week" → goes to habitStreakMatch
    const habitStatusMatch = (/^(?:what(?:'s| is)?|show|check)(?: my)? habits?(?:\s+(?:status|today|done|this week|not done|pending|remaining|left|missed))?$/.test(lowerText)
                          || /^(?:what habits?|which habits?)(?: (?:are|have i))?(?:\s+(?:not done|pending|remaining|left|missed|still to do))?$/.test(lowerText)
                          || lowerText === 'habits' || lowerText === 'my habits' || lowerText === 'habits not done' || lowerText === 'pending habits')
                          && !/streak|longest|best/.test(lowerText);
    if (habitStatusMatch) {
      try {
        const today = new Date().toISOString().slice(0,10);
        const habits = dbGet<{id:string;name:string;icon:string;target_per_day:number}>(
          "SELECT id, name, icon, target_per_day FROM habits WHERE active=1 ORDER BY created_at"
        ) as {id:string;name:string;icon:string;target_per_day:number}[];
        const doneLogs = dbGet<{habit_id:string;count:number}>(
          "SELECT habit_id, count FROM habit_logs WHERE date=?", today
        ) as {habit_id:string;count:number}[];
        const doneIds = new Set(doneLogs.map(l => l.habit_id));
        const done = habits.filter(h => doneIds.has(h.id));
        const remaining = habits.filter(h => !doneIds.has(h.id));
        const lines: string[] = [];
        if (done.length) lines.push('✓ Done today: ' + done.map(h => h.icon + ' ' + h.name).join(', '));
        if (remaining.length) lines.push('○ Still to do: ' + remaining.map(h => h.icon + ' ' + h.name).join(', '));
        if (!habits.length) lines.push('No active habits. Add some in the Health panel.');
        sendReply(lines.join('\n') || 'All habits complete today!');
      } catch { sendReply('Could not load habits.'); }
      return;
    }

    // ── What do you know about me ─────────────────────────────────────────────
    const aboutMeMatch = /^(?:what do you know about me|what do you know about my business|what do you know about my shop|what do you remember|tell me about myself|tell me about my business|what(?:'s| is) in your memory|my memory|show my memory|what have you learned about me|summarize my business|business summary)/.test(lowerText);
    if (aboutMeMatch) {
      try {
        const facts = dbGet<{fact:string;category:string;importance:number}>(
          "SELECT fact, category, importance FROM memory_facts ORDER BY importance DESC, created_at DESC LIMIT 15"
        ) as {fact:string;category:string;importance:number}[];
        if (!facts.length) {
          sendReply("I don't know much about you yet. Say 'remember that I [fact]' to teach me.");
        } else {
          sendReply(facts.length + ' things I know about you:\n\n' +
            facts.map((f,i) => (i+1) + '. ' + f.fact).join('\n') +
            '\n\nAdd more by saying "remember that I [fact]".');
        }
      } catch { sendReply('Could not read memory.'); }
      return;
    }

    // ── Bulk operations ────────────────────────────────────────────────────────
    // ── Bulk complete tasks: "done: task1, task2, task3" ───────────────────────
    const bulkDoneMatch = lowerText.match(/^(?:done|finished|completed?|mark done)[:\s]+(.+)/i);
    if (bulkDoneMatch) {
      const items = bulkDoneMatch[1].split(/[,;]+/).map((s: string) => s.trim()).filter((s: string) => s.length > 2);
      if (items.length >= 2) {
        // Multiple items separated by comma — bulk complete
        const completed: string[] = [];
        const notFound: string[] = [];
        for (const item of items.slice(0, 5)) {
          try {
            const task = dbGetOne<{id:string;title:string}>(
              "SELECT id, title FROM personal_tasks WHERE LOWER(title) LIKE ? AND status!='done' LIMIT 1",
              '%' + item.toLowerCase() + '%'
            ) as {id:string;title:string}|null;
            if (task) {
              dbRun("UPDATE personal_tasks SET status='done', completed_at=?, updated_at=? WHERE id=?",
                new Date().toISOString(), new Date().toISOString(), task.id);
              completed.push(task.title);
            } else { notFound.push(item); }
          } catch { notFound.push(item); }
        }
        let reply = completed.length ? "✓ Done (" + completed.length + "):\n" + completed.map((t,i) => (i+1) + ". " + t).join("\n") : "";
        if (notFound.length) reply += (reply ? "\n\n" : "") + "Not found: " + notFound.join(", ");
        sendReply(reply || "No matching tasks found.");
        return;
      }
    }

    // ── Clear done reminders ─────────────────────────────────────────────────
    const clearDoneRemsMatch = /^(?:clear|remove|delete|dismiss)(?: all)?(?: my)?(?: done| completed| finished)(?: reminders?)?$/.test(lowerText)
                            || lowerText === 'clear done reminders' || lowerText === 'dismiss done reminders';
    if (clearDoneRemsMatch) {
      try {
        const n = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM reminders WHERE done=1") as {n:number}|null)?.n || 0;
        if (!n) { sendReply("No completed reminders to clear."); return; }
        dbRun("DELETE FROM reminders WHERE done=1");
        sendReply("Cleared " + n + " completed reminder" + (n !== 1 ? "s" : "") + ".");
      } catch (e) { sendReply("Could not clear reminders: " + e); }
      return;
    }

    const clearDoneTasksMatch = /^(?:clear|remove|delete|archive)(?: all)?(?: my)?(?: completed| done| finished)(?: tasks?)?$/.test(lowerText)
                              || lowerText === 'clear completed' || lowerText === 'clear done tasks';
    if (clearDoneTasksMatch) {
      try {
        const count = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM personal_tasks WHERE status='done'") as {n:number}|null)?.n || 0;
        if (count === 0) { sendReply("No completed tasks to clear."); return; }
        dbRun("DELETE FROM personal_tasks WHERE status='done'");
        sendReply("Cleared " + count + " completed task" + (count !== 1 ? 's' : '') + ".");
      } catch (e) { sendReply("Could not clear tasks: " + e); }
      return;
    }

    const archiveDoneGoalsMatch = /^(?:archive|clear)(?: all)?(?: my)?(?: completed| done| finished)(?: goals?)?$/.test(lowerText)
                                || lowerText === 'archive done goals' || lowerText === 'clear done goals';
    if (archiveDoneGoalsMatch) {
      try {
        const count = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM goals WHERE status='done'") as {n:number}|null)?.n || 0;
        if (count === 0) { sendReply("No completed goals to archive."); return; }
        dbRun("UPDATE goals SET status='archived',updated_at=? WHERE status='done'", new Date().toISOString());
        sendReply("Archived " + count + " completed goal" + (count !== 1 ? 's' : '') + ".");
      } catch (e) { sendReply("Could not archive goals: " + e); }
      return;
    }

    // ── Universal search ────────────────────────────────────────────────────────
    const universalSearchMatch = !/^(?:find|show|search)(?: me)?(?: some)? (?:videos?|pictures?|photos?|images?|tutorials?)/i.test(lowerText) && lowerText.match(/^(?:search(?: (?:my|all))?(?: (?:notes?|memory|tasks?|everything|data))?(?:\s+for)?|find(?: everything about| all about| (?:my notes?|tasks?) (?:about|for|with))?)[:\s]+(.+)/i)
                               || lowerText.match(/^(?:look up|show (?:everything|all)(?: about))[:\s]+(.+)/i);
    if (universalSearchMatch) {
      const keyword = (universalSearchMatch[2] || universalSearchMatch[1] || '').trim().toLowerCase();
      if (keyword.length > 2) {
        try {
          const results: string[] = [];
          // Search memory_facts
          const facts = dbGet<{fact:string;category:string}>(
            "SELECT fact, category FROM memory_facts WHERE LOWER(fact) LIKE ? ORDER BY importance DESC LIMIT 5",
            '%' + keyword + '%'
          ) as {fact:string;category:string}[];
          if (facts.length) results.push("📝 Notes/Memory (" + facts.length + "):\n" + facts.map((f,i) => (i+1) + ". " + f.fact).join("\n"));
          // Search tasks
          const tasks = dbGet<{title:string;status:string}>(
            "SELECT title, status FROM personal_tasks WHERE LOWER(title) LIKE ? LIMIT 5",
            '%' + keyword + '%'
          ) as {title:string;status:string}[];
          if (tasks.length) results.push("✓ Tasks (" + tasks.length + "):\n" + tasks.map((t,i) => (i+1) + ". " + t.title + " [" + t.status + "]").join("\n"));
          // Search goals
          const goals = dbGet<{title:string}>(
            "SELECT title FROM goals WHERE LOWER(title) LIKE ? AND status='active' LIMIT 3",
            '%' + keyword + '%'
          ) as {title:string}[];
          if (goals.length) results.push("◎ Goals (" + goals.length + "):\n" + goals.map((g,i) => (i+1) + ". " + g.title).join("\n"));
          // Search prayer requests
          const prayers = dbGet<{body:string}>(
            "SELECT body FROM prayer_requests WHERE LOWER(body) LIKE ? AND status='active' LIMIT 3",
            '%' + keyword + '%'
          ) as {body:string}[];
          if (prayers.length) results.push("🙏 Prayers (" + prayers.length + "):\n" + prayers.map((p,i) => (i+1) + ". " + p.body).join("\n"));

          if (!results.length) sendReply('Nothing found for "' + keyword + '" in your notes, tasks, goals, or prayers.');
          else sendReply('Search results for "' + keyword + '":\n\n' + results.join("\n\n"));
        } catch { sendReply("Could not complete search."); }
        return;
      }
    }

    // ── Search memory / notes ─────────────────────────────────────────────────
    const searchMemoryMatch = lowerText.match(/^(?:what did i (?:note|write|say|record|save) about|find.*note.*about|search.*memory.*for|what do you know about)\s+(.+)/i);
    if (searchMemoryMatch) {
      const keyword = searchMemoryMatch[1].trim().toLowerCase();
      try {
        const results = dbGet<{fact:string;category:string}>(
          "SELECT fact, category FROM memory_facts WHERE LOWER(fact) LIKE ? ORDER BY importance DESC, created_at DESC LIMIT 5",
          '%' + keyword + '%'
        ) as {fact:string;category:string}[];
        if (!results.length) {
          sendReply('Nothing in memory about "' + keyword + '". Say "remember that I [fact]" to save something.');
        } else {
          sendReply('Found ' + results.length + ' memory item' + (results.length > 1 ? 's' : '') + ' about "' + keyword + '":\n\n' +
            results.map((r,i) => (i+1) + '. ' + r.fact).join('\n'));
        }
      } catch { sendReply('Could not search memory.'); }
      return;
    }


    // ── Delete task ──────────────────────────────────────────────────────────
    const deleteTaskMatch = lowerText.match(/^(?:delete|remove|cancel)(?: a)? task[:\s]+(.+)/i)
                        || lowerText.match(/^(?:delete|remove|cancel)(?: my)?(?: first| last| that)? task$/i);
    if (deleteTaskMatch) {
      const hint = (deleteTaskMatch[1] || '').trim();
      const isPositional = /^(?:my )?(?:first|oldest|last|that)(?: task)?$/.test(hint) || !hint;
      try {
        const task = dbGetOne<{id:string;title:string}>(
          "SELECT id, title FROM personal_tasks WHERE LOWER(title) LIKE ? LIMIT 1", '%' + hint.toLowerCase() + '%'
        );
        if (!task) { sendReply("Could not find a task matching: " + hint); return; }
        dbRun("DELETE FROM personal_tasks WHERE id=?", task.id);
        sendReply('Deleted task: "' + task.title + '"');
      } catch (e) { sendReply("Could not delete task: " + e); }
      return;
    }

    // ── Snooze reminder ──────────────────────────────────────────────────────
    const snoozeReminderMatch = lowerText.match(/^snooze(?: reminder)?[:\s]+(.+)/i)
                             || lowerText.match(/^(?:postpone|delay|push back)(?: reminder)?[:\s]+(.+)/i);
    if (snoozeReminderMatch) {
      const hint = (snoozeReminderMatch[1] || '').trim().toLowerCase();
      try {
        const rem = dbGetOne<{id:string;title:string;due_at:string}>(
          "SELECT id, title, due_at FROM reminders WHERE LOWER(title) LIKE ? AND done=0 LIMIT 1",
          '%' + hint + '%'
        ) as {id:string;title:string;due_at:string}|null;
        if (!rem) { sendReply('No active reminder found matching: "' + hint + '"'); return; }
        const base = rem.due_at ? new Date(rem.due_at) : new Date();
        const newDue = new Date(base.getTime() + 86400000); // +1 day
        dbRun("UPDATE reminders SET due_at=?, updated_at=? WHERE id=?", newDue.toISOString(), new Date().toISOString(), rem.id);
        sendReply('💤 Snoozed: "' + rem.title + '" → ' + newDue.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}));
      } catch (e) { sendReply('Could not snooze: ' + e); }
      return;
    }

    // ── Delete reminder ───────────────────────────────────────────────────────
    const deleteRemMatch = lowerText.match(/^(?:delete|remove|cancel)(?: a)? reminder[:\s]+(.+)/i)
                        || lowerText.match(/^(?:mark|set) reminder(?: as)? done[:\s]+(.+)/i);
    if (deleteRemMatch) {
      const hint = deleteRemMatch[1].trim();
      try {
        const rem = dbGetOne<{id:string;title:string}>(
          "SELECT id, title FROM reminders WHERE LOWER(title) LIKE ? AND done=0 LIMIT 1", '%' + hint.toLowerCase() + '%'
        );
        if (!rem) { sendReply("Could not find a reminder matching: " + hint); return; }
        dbRun("UPDATE reminders SET done=1,updated_at=? WHERE id=?", new Date().toISOString(), rem.id);
        sendReply('Reminder done: "' + rem.title + '"');
      } catch (e) { sendReply("Could not update reminder: " + e); }
      return;
    }

    // ── Complete / done goal ──────────────────────────────────────────────────
    const doneGoalMatch = lowerText.match(/^(?:complete|finish|achieved?|accomplish(?:ed)?)(?: (?:goal|my goal)?)[:\s]+(.+)/i)
                       || lowerText.match(/^mark (?:goal )?done[:\s]+(.+)/i)
                       || lowerText.match(/^finish(?:ed)? goal[:\s]+(.+)/i)
                       || (lowerText.includes('goal') && lowerText.match(/^(?:update|mark)(?: goal)?[:\s]+(.+?)(?:\s+(?:as|to)(?: done| complete))?$/i));
    if (doneGoalMatch) {
      const hint = (doneGoalMatch[1] || '').replace(/\s+(?:as|to)\s+done\s*$/i,'').replace(/\s+(?:as|to)\s+complete\s*$/i,'').trim();
      if (hint.length > 2) {
        try {
          const goal = dbGetOne<{id:string;title:string}>(
            "SELECT id, title FROM goals WHERE LOWER(title) LIKE ? AND status!='done' LIMIT 1",
            '%' + hint.toLowerCase() + '%'
          );
          if (!goal) { sendReply("Could not find an active goal matching: " + hint); return; }
          dbRun("UPDATE goals SET status='done',updated_at=? WHERE id=?", new Date().toISOString(), goal.id);
          sendReply('Goal achieved: "' + goal.title + '"');
        } catch (e) { sendReply("Could not update goal: " + e); }
        return;
      }
    }

    // ── Habit streak count ────────────────────────────────────────────────────
    const habitStreakMatch = /^(?:how many |show |what(?:'s| is) my )?habit streak(?:s| count)?(?:\s+(?:do i have|today))?$/.test(lowerText)
                          || /^(?:longest|best|my) habit streak/.test(lowerText);
    if (habitStreakMatch) {
      try {
        const habits = dbGet<{id:string;name:string}>(
          "SELECT id, name FROM habits WHERE active=1 ORDER BY created_at ASC"
        ) as {id:string;name:string}[];
        const today = new Date().toISOString().slice(0,10);
        const lines: string[] = ['Habit streaks this week:\n'];
        let best = { name: '', streak: 0 };
        habits.forEach(h => {
          const logs = dbGet<{date:string}>(
            "SELECT date FROM habit_logs WHERE habit_id=? AND date >= date('now','-6 days') ORDER BY date ASC",
            h.id
          ) as {date:string}[];
          const streak = logs.length;
          if (streak > best.streak) best = { name: h.name, streak };
          const bar = '🔥'.repeat(streak) + '○'.repeat(Math.max(0, 7 - streak));
          lines.push(bar + '  ' + h.name + ' (' + streak + '/7)');
        });
        if (best.streak > 0) lines.push('\n🏆 Best: ' + best.name + ' — ' + best.streak + ' day' + (best.streak !== 1 ? 's' : ''));
        sendReply(lines.join('\n'));
      } catch { sendReply('Could not load habit streaks.'); }
      return;
    }

    // ── Recurring reminders ──────────────────────────────────────────────────
    const recurringMatch = lowerText.match(/^(?:set|add|create)(?: a)? (?:daily|weekly|recurring)(?: reminder)?[:\s]+(.+?)(?:\s+(?:every day|daily|each day|at \d))?$/i)
                        || lowerText.match(/^remind me (?:every day|daily|each day)(?: at .+?)? to (.+)/i);
    if (recurringMatch) {
      const title = (recurringMatch[1] || recurringMatch[2] || '').trim();
      if (title.length > 1) {
        try {
          const id = require('crypto').randomUUID();
          // Set due_at for tomorrow 6am as the first occurrence
          const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1); tomorrow.setHours(6,0,0,0);
          dbRun("INSERT INTO reminders (id,title,due_at,done,repeat,created_at) VALUES (?,?,?,?,?,?)",
            id, title, tomorrow.toISOString(), 0, 'daily', new Date().toISOString());
          sendReply('Recurring daily reminder set: "' + title + '" starting tomorrow at 6am. You can edit the time in the Reminders panel.');
        } catch (e) { sendReply('Could not set recurring reminder: ' + e); }
        return;
      }
    }

    // ── Weekly summary ────────────────────────────────────────────────────────
    const weeklySummaryMatch = /^(?:how am i doing this week|weekly summary|week(?:ly)? report|how(?:'s| is) my week)/.test(lowerText);
    if (weeklySummaryMatch) {
      try {
        const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate()-7);
        const weekAgoStr = weekAgo.toISOString().slice(0,10);
        const today = new Date().toISOString().slice(0,10);
        const habitCount = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM habits WHERE active=1") as {n:number}|null)?.n || 0;

        const tasksDone = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM personal_tasks WHERE status='done' AND completed_at >= ?", weekAgoStr) as {n:number}|null)?.n || 0;
        const tasksOpen = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM personal_tasks WHERE status!='done'") as {n:number}|null)?.n || 0;
        const habitsTotal = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM habit_logs WHERE date >= ?", weekAgoStr) as {n:number}|null)?.n || 0;
        const habitPossible = habitCount * 7;
        const habitPct = habitPossible > 0 ? Math.round((habitsTotal / habitPossible) * 100) : 0;
        const jnlEntries = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM journal_entries WHERE date >= ?", weekAgoStr) as {n:number}|null)?.n || 0;
        const goalsActive = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM goals WHERE status='active'") as {n:number}|null)?.n || 0;
        const revenue = (dbGetOne<{n:number}>("SELECT COALESCE(SUM(amount),0) as n FROM transactions WHERE type='income' AND date >= ?", weekAgoStr) as {n:number}|null)?.n || 0;
        const prayerCount = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM prayer_requests WHERE status='active'") as {n:number}|null)?.n || 0;

        const lines = ['Your week (last 7 days):\n'];
        lines.push('✓ Tasks done:    ' + tasksDone + (tasksOpen > 0 ? '  (' + tasksOpen + ' still open)' : ''));
        lines.push('🔥 Habits:       ' + habitsTotal + '/' + habitPossible + ' check-ins (' + habitPct + '%)');
        lines.push('📔 Journal:      ' + jnlEntries + ' entr' + (jnlEntries === 1 ? 'y' : 'ies'));
        lines.push('◎ Active goals:  ' + goalsActive);
        if (revenue > 0) lines.push('💰 Revenue:      $' + revenue.toFixed(2));
        if (prayerCount > 0) lines.push('🙏 Prayers:      ' + prayerCount + ' active request' + (prayerCount === 1 ? '' : 's'));

        // Encouragement based on habit rate
        if (habitPct >= 80) lines.push('\n🎉 Excellent week — ' + habitPct + '% habit consistency!');
        else if (habitPct >= 50) lines.push('\nGood progress this week. Keep the habits going!');
        else if (habitPct < 30 && habitCount > 0) lines.push('\nHabit consistency was low this week. Tomorrow is a fresh start!');
        sendReply(lines.join('\n'));
      } catch { sendReply('Could not generate weekly summary.'); }
      return;
    }

    // ── Add journal entry ─────────────────────────────────────────────────────
    const journalMatch = lowerText.match(/^(?:add|create|write|log)(?: a)? journal(?: entry)?[:\s]+(.+)/i)
                      || lowerText.match(/^journal[:\s]+(.+)/i);
    if (journalMatch) {
      const content = (journalMatch[1] || '').trim();
      if (content.length > 1) {
        try {
          const today = new Date().toISOString().slice(0,10);
          const id = require('crypto').randomUUID();
          dbRun("INSERT INTO journal_entries (id,date,content,mood,created_at) VALUES (?,?,?,?,?)",
            id, today, content, '', new Date().toISOString());
          sendReply('Journal entry saved: "' + content + '"');
        } catch (e) { sendReply('Could not save journal entry: ' + e); }
        return;
      }
    }

    // ── Schedule today ────────────────────────────────────────────────────────
    // ── Recent journal entries ────────────────────────────────────────────────
    const recentJournalMatch = /^(?:show|list|what did i)(?: (?:my|the))?(?: recent)? journal(?:\s+entries?| (?:this week|today|lately))?$/.test(lowerText)
                             || /^(?:my )?journal(?: entries?| this week| today| lately)?$/.test(lowerText);
    if (recentJournalMatch) {
      try {
        const entries = dbGet<{date:string;title:string;content:string}>(
          "SELECT date, title, content FROM journal_entries ORDER BY date DESC LIMIT 7"
        ) as {date:string;title:string;content:string}[];
        if (!entries.length) sendReply("No journal entries yet. Say \"journal: [your thoughts]\" to write one.");
        else sendReply(entries.length + " recent journal entr" + (entries.length > 1 ? "ies" : "y") + ":\n\n" +
          entries.map((e,i) => {
            const d = new Date(e.date).toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
            const preview = (e.content || '').slice(0,50).replace(/\n/g,' ');
            return (i+1) + ". " + d + " — " + preview + (e.content?.length > 50 ? "…" : "");
          }).join("\n"));
      } catch { sendReply("Could not load journal entries."); }
      return;
    }

    const scheduleMatch = /^(?:what.?s on my schedule|schedule(?:\s+for)?\s+today|today.?s schedule|what do i have today|what.?s today|today)/.test(lowerText)
                       || lowerText === 'today' || lowerText === 'status' || lowerText === 'check in' || lowerText === 'daily check'
                       || lowerText === 'quick update' || lowerText === "how's everything" || lowerText === "how is everything"
                       || /^(?:what.?s my|give me my|show me my) (?:plan|day brief|daily brief|day plan)(?: for today)?$/.test(lowerText)
                       || lowerText === "my plan" || lowerText === "day brief" || lowerText === "daily brief" || lowerText === "today's summary";
    if (scheduleMatch) {
      try {
        const today = new Date().toISOString().slice(0,10);
        const tasks = dbGet<{title:string}>("SELECT title FROM personal_tasks WHERE status!='done' ORDER BY created_at DESC LIMIT 5") as {title:string}[];
        const rems = dbGet<{title:string}>("SELECT title FROM reminders WHERE done=0 ORDER BY due_at ASC LIMIT 5") as {title:string}[];
        const habits = dbGet<{name:string;icon:string}>("SELECT h.name, h.icon FROM habits h WHERE h.active=1 AND h.id NOT IN (SELECT habit_id FROM habit_logs WHERE date=?) ORDER BY h.created_at LIMIT 5", today) as {name:string;icon:string}[];
        const lines: string[] = ["Today at a glance:\n"];
        if (rems.length) { lines.push("Reminders: " + rems.map(r => r.title).join(", ")); }
        if (tasks.length) { lines.push("Open tasks: " + tasks.slice(0,3).map(t => t.title).join(", ")); }
        if (habits.length) { lines.push("Habits still to do: " + habits.map(h => h.icon + " " + h.name).join(", ")); }
        if (lines.length === 1) lines.push("Nothing scheduled today.");
        sendReply(lines.join("\n"));
      } catch { sendReply("Could not load schedule."); }
      return;
    }

    // ── Direct verse reference: "John 3:16" / "lookup John 3:16" / "what is John 3:16"
    const directVerseMatch = lowerText.match(/^(?:lookup|look up|what(?:'s| is)(?: the)?(?: verse)?|show me|read|get)\s+([1-3]?\s*[a-z]+\s+\d+:\d+)/i)
                         || lowerText.match(/^([1-3]?\s*(?:genesis|exodus|leviticus|numbers|deuteronomy|joshua|judges|ruth|samuel|kings|chronicles|ezra|nehemiah|esther|job|psalms?|proverbs?|ecclesiastes|isaiah|jeremiah|lamentations|ezekiel|daniel|hosea|joel|amos|obadiah|jonah|micah|nahum|habakkuk|zephaniah|haggai|zechariah|malachi|matthew|mark|luke|john|acts|romans|corinthians|galatians|ephesians|philippians|colossians|thessalonians|timothy|titus|philemon|hebrews|james|peter|jude|revelation))\s+\d+(?::\d+)?/i)
                          || lowerText.match(/^([1-3]?\s*[a-z]+\s+\d+:\d+)$/i);
    if (directVerseMatch) {
      const ref = (directVerseMatch[1] || '').trim();
      try {
        const r2 = await require('node-fetch').default || { default: null };
        // Use the bible endpoint directly
        const count = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM scripture_entries") as {n:number}|null)?.n || 0;
        if (count === 0) {
          sendReply("Bible not downloaded yet. Open the Scripture panel and tap Download KJV Free.");
        } else {
          const parts = ref.match(/^([1-3]?\s*[a-z]+)\s+(\d+):(\d+)$/i);
          if (parts) {
            const book = parts[1].trim(), ch = parseInt(parts[2]), vs = parseInt(parts[3]);
            const verse = dbGetOne<{text:string;book:string;chapter:number;verse:number}>(
              "SELECT text, book, chapter, verse FROM scripture_entries WHERE LOWER(book)=LOWER(?) AND chapter=? AND verse=? LIMIT 1",
              book, ch, vs
            ) as {text:string;book:string;chapter:number;verse:number}|null;
            if (verse) sendReply(verse.book + ' ' + verse.chapter + ':' + verse.verse + ' (KJV)\n\n"' + verse.text + '"');
            else sendReply('Verse not found: ' + ref + '. Check the reference format.');
          } else sendReply('Could not parse verse reference: ' + ref);
        }
      } catch { sendReply('Could not look up verse.'); }
      return;
    }

    // ── Bible verse search ─────────────────────────────────────────────────────
    const bibleSearchMatch = lowerText.match(/^(?:find|show|search)(?: a| me)?(?: bible| scripture)?(?: verse| verses?)?(?: about| on| for)\s+(.+)/i)
                          || lowerText.match(/^(?:verse|scripture)(?: about| on| for)\s+(.+)/i);
    if (bibleSearchMatch) {
      const topic = (bibleSearchMatch[1] || '').trim();
      if (topic.length > 2) {
        try {
          const count = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM scripture_entries") as {n:number}|null)?.n || 0;
          if (count === 0) {
            sendReply("Bible not downloaded yet. Open the Scripture panel and tap Download KJV Free to get all 31,000 verses.");
          } else {
            const results = dbGet<{book:string;chapter:number;verse:number;text:string}>(
              "SELECT book, chapter, verse, text FROM scripture_entries WHERE LOWER(text) LIKE ? LIMIT 3",
              "%" + topic.toLowerCase() + "%"
            ) as {book:string;chapter:number;verse:number;text:string}[];
            if (!results.length) { sendReply("No verses found about \"" + topic + "\". Try different keywords."); }
            else { sendReply("Verses about \"" + topic + "\":\n\n" + results.map(v => v.book + " " + v.chapter + ":" + v.verse + " — " + v.text).join("\n\n")); }
          }
        } catch { sendReply("Could not search scripture."); }
        return;
      }
    }

    // ── Finance summary ────────────────────────────────────────────────────────
    const financeSummaryMatch = /^(?:show|what|get)(?: me)?(?: my)? (?:finance|money|spending|budget|income|expense)/.test(lowerText)
                             || lowerText === "finance summary" || lowerText === "my finances";
    if (financeSummaryMatch) {
      try {
        const month = new Date().toISOString().slice(0,7);
        const inc = (dbGetOne<{n:number}>("SELECT COALESCE(SUM(amount),0) as n FROM transactions WHERE type='income' AND strftime('%Y-%m',date)=?", month) as {n:number}|null)?.n || 0;
        const exp = (dbGetOne<{n:number}>("SELECT COALESCE(SUM(amount),0) as n FROM transactions WHERE type='expense' AND strftime('%Y-%m',date)=?", month) as {n:number}|null)?.n || 0;
        if (inc === 0 && exp === 0) {
          sendReply("No transactions logged this month. Open Finance to import a bank statement or add transactions.");
        } else {
          const net = inc - exp;
          sendReply("Finance this month:\nIncome:   $" + inc.toFixed(2) + "\nExpenses: $" + exp.toFixed(2) + "\nNet:      " + (net >= 0 ? "+" : "") + "$" + net.toFixed(2));
        }
      } catch { sendReply("Could not load finance data."); }
      return;
    }

    // ── Maker Studio: profit / jobs ──────────────────────────────────────────
    // ── Show expenses ──────────────────────────────────────────────────────────
    const showExpenseMatch = /^(?:show|what(?: did i)?|list)(?: my)?(?: (?:total|all))? expenses?(?: this month| this week| today)?/.test(lowerText)
                          || /^how much did i (?:spend|pay|spend on|pay for)(?: this month| this week| today| on .+)?/.test(lowerText)
                          || lowerText === 'my expenses' || lowerText === 'expenses';
    if (showExpenseMatch) {
      try {
        const month5 = new Date().toISOString().slice(0,7);
        const expenses = dbGet<{category:string;amount:number}>(
          "SELECT category, SUM(amount) as amount FROM transactions WHERE type='expense' AND strftime('%Y-%m',date)=? GROUP BY category ORDER BY amount DESC",
          month5
        ) as {category:string;amount:number}[];
        const total = expenses.reduce((s,e) => s + e.amount, 0);
        if (!expenses.length) sendReply("No expenses logged this month. Say \"I spent $X on Y\" or \"log expense: $X category\" to track spending.");
        else sendReply("Expenses this month:\n\n" +
          expenses.map(e => '• ' + e.category + ': $' + e.amount.toFixed(2)).join('\n') +
          '\n\n💸 Total: $' + total.toFixed(2));
      } catch { sendReply('Could not load expenses.'); }
      return;
    }

    const profitMatch = /^(?:what.?s my|show my|get my|how much|my)(?: )? (?:profit|revenue|income|earnings?)(?: this month| this week| today| last week| all time| ever| total)?/.test(lowerText)
                     || /^how much did i (?:make|earn|get paid|bring in)(?: last week| this week| today| this month| all time| total| ever)?/.test(lowerText)
                     || /^(?:total|lifetime|all.time)(?: (?:revenue|income|earnings?|profit))?$/.test(lowerText)
                     || /^(?:how much)(?: have i)? (?:made|earned|grossed)/.test(lowerText)
                     || lowerText === "revenue" || lowerText === "revenue this month" || lowerText === "my revenue";

    // ── Image / video search (returns rich markdown links) ──────────────────
    const imgSearchMatch = lowerText.match(/^(?:show|find|search|get|give me)(?: me)?(?: some)? (?:pictures?|photos?|images?) (?:of|about|for) (.+)/i)
                        || lowerText.match(/^(?:pictures?|photos?|images?) of (.+)/i)
                        || lowerText.match(/^image[:\s]+(.+)/i);
    if (imgSearchMatch) {
      const query = (imgSearchMatch[1] || '').trim();
      sendReply(
        '🖼️ **Images: ' + query + '**\n\n' +
        '• [Google Images](https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(query) + ') — search results\n' +
        '• [Unsplash](https://unsplash.com/s/photos/' + encodeURIComponent(query.replace(/\s+/g,'-')) + ') — free high-res\n' +
        '• [Pinterest](https://www.pinterest.com/search/pins/?q=' + encodeURIComponent(query) + ') — curated ideas\n\n' +
        '_Open any link above — they open in your browser._'
      );
      return;
    }

    const vidSearchMatch = lowerText.match(/^(?:show|find|search|get|give me)(?: me)?(?: some)? (?:videos?|tutorials?|youtube)(?: videos?)? (?:of|about|for|on|for) (.+)/i)
                        || lowerText.match(/^(?:videos?|youtube)[:\s]+(.+)/i)
                        || lowerText.match(/^find (?:videos?|tutorials?) (?:about|for|on) (.+)/i)
                        || (/^how to .+ (?:video|youtube|tutorial)$/i.test(lowerText) ? lowerText.match(/^how to (.+)/i) : null);
    if (vidSearchMatch) {
      const query = (vidSearchMatch[1] || '').trim();
      sendReply(
        '🎬 **Videos: ' + query + '**\n\n' +
        '• [YouTube](https://www.youtube.com/results?search_query=' + encodeURIComponent(query) + ') — best tutorials\n' +
        '• [YouTube Shorts](https://www.youtube.com/results?search_query=' + encodeURIComponent(query) + '&sp=EgQQAQ%3D%3D) — quick clips\n\n' +
        '_These open in your browser. For laser/maker topics, search "' + query + ' timelapse" or "' + query + ' tutorial 2024"._'
      );
      return;
    }

    // ── Revenue by week breakdown ──────────────────────────────────────────────
    const weeklyRevMatch = /^(?:show|what(?:'s| is)?|break(?:down)?)(?: my)? (?:revenue|income|earnings?)(?: by week| this week| weekly| each week| per week)?$/.test(lowerText)
                        || lowerText === 'weekly revenue' || lowerText === 'revenue by week' || lowerText === 'weekly breakdown';
    if (weeklyRevMatch) {
      try {
        const weeks: {label:string; total:number}[] = [];
        for (let w = 0; w < 4; w++) {
          const end = new Date(); end.setDate(end.getDate() - w * 7); end.setHours(23,59,59,999);
          const start = new Date(end); start.setDate(start.getDate() - 6); start.setHours(0,0,0,0);
          const total = (dbGetOne<{n:number}>(
            "SELECT COALESCE(SUM(amount),0) as n FROM transactions WHERE type='income' AND date BETWEEN ? AND ?",
            start.toISOString().slice(0,10), end.toISOString().slice(0,10)
          ) as {n:number}|null)?.n || 0;
          const label = w === 0 ? 'This week' : w === 1 ? 'Last week' : start.toLocaleDateString('en-US',{month:'short',day:'numeric'}) + '–' + end.toLocaleDateString('en-US',{month:'short',day:'numeric'});
          weeks.push({label, total});
        }
        const totalAll = weeks.reduce((s,w) => s + w.total, 0);
        sendReply('Revenue by week:\n\n' + weeks.map(w => w.label + ': $' + w.total.toFixed(2)).join('\n') + '\n\nTotal (4 weeks): $' + totalAll.toFixed(2));
      } catch { sendReply('Could not load weekly revenue.'); }
      return;
    }

    if (profitMatch) {
      try {
        const month = new Date().toISOString().slice(0,7);
        const income = (dbGetOne<{n:number}>(
          "SELECT COALESCE(SUM(amount),0) as n FROM transactions WHERE type='income' AND strftime('%Y-%m',date)=?", month
        ) as {n:number}|null)?.n || 0;
        const expenses = (dbGetOne<{n:number}>(
          "SELECT COALESCE(SUM(amount),0) as n FROM transactions WHERE type='expense' AND strftime('%Y-%m',date)=?", month
        ) as {n:number}|null)?.n || 0;
        const txCount = (dbGetOne<{n:number}>(
          "SELECT COUNT(*) as n FROM transactions WHERE strftime('%Y-%m',date)=?", month
        ) as {n:number}|null)?.n || 0;
        if (income === 0 && txCount === 0) {
          sendReply("No income logged this month yet. Say \"log revenue: $X\" to record sales.");
        } else {
          const profit = income - expenses;
          sendReply("Maker Studio — This Month:\n\n💰 Revenue:  $" + income.toFixed(2) + "\n📦 Expenses: $" + expenses.toFixed(2) + "\n📈 Profit:   $" + profit.toFixed(2) + "\n🧾 " + txCount + " transaction" + (txCount !== 1 ? "s" : ""));
        }
      } catch { sendReply("Could not load revenue data."); }
      return;
    }

    // ── Maker Studio: materials in stock ──────────────────────────────────────
    const materialsMatch = /^(?:what|show)(?: materials?| my materials?| stock| inventory)(?: do i have| in stock)?/.test(lowerText)
                        || /^(?:materials?|stock|inventory)$/.test(lowerText);
    if (materialsMatch) {
      try {
        const mats = dbGet<{name:string;stock_quantity:number;unit:string;cost_per_unit:number}>(
          "SELECT name, stock_quantity, unit, cost_per_unit FROM materials ORDER BY stock_quantity ASC LIMIT 10"
        ) as {name:string;stock_quantity:number;unit:string;cost_per_unit:number}[];
        if (!mats.length) {
          sendReply("No materials tracked yet. Add materials in Maker Studio to track inventory.");
        } else {
          const low = mats.filter(m => m.stock_quantity < 5);
          let reply = mats.length + " materials tracked:\n\n";
          mats.forEach(m => {
            const flag = m.stock_quantity < 5 ? " ⚠ LOW" : "";
            reply += "• " + m.name + ": " + m.stock_quantity + " " + (m.unit || "units") + flag + "\n";
          });
          if (low.length) reply += "\n⚠ " + low.length + " material" + (low.length > 1 ? "s" : "") + " running low.";
          sendReply(reply.trim());
        }
      } catch { sendReply("Could not load materials. Open Maker Studio to add inventory."); }
      return;
    }

    // ── Focus / most important right now ─────────────────────────────────────
    const focusMatch = /^(?:what should i(?: do| focus on| work on| tackle)?|what.?s most important|what.?s next|top priority|focus(?: mode)?(?:\s+now)?)/.test(lowerText)
                      && !/pray(?:er|ing|ed)?/.test(lowerText);
    if (focusMatch) {
      try {
        const today = new Date().toISOString().slice(0,10);
        // Priority: overdue reminders > today's reminders > high-priority tasks > undone habits
        const overdueRem = dbGetOne<{title:string}>(
          "SELECT title FROM reminders WHERE done=0 AND due_at < ? ORDER BY due_at ASC LIMIT 1",
          new Date().toISOString()
        ) as {title:string}|null;
        if (overdueRem) { sendReply("⏰ Most urgent: **" + overdueRem.title + "** — this reminder is overdue."); return; }
        
        const topTask = dbGetOne<{title:string;priority:number}>(
          "SELECT title, priority FROM personal_tasks WHERE status!='done' ORDER BY priority DESC, created_at ASC LIMIT 1"
        ) as {title:string;priority:number}|null;
        
        const topGoal = dbGetOne<{title:string}>(
          "SELECT title FROM goals WHERE status!='done' ORDER BY priority_score DESC LIMIT 1"
        ) as {title:string}|null;
        
        const undoneHabit = dbGetOne<{name:string;icon:string}>(
          "SELECT h.name, h.icon FROM habits h WHERE h.active=1 AND h.id NOT IN (SELECT habit_id FROM habit_logs WHERE date=?) ORDER BY h.created_at ASC LIMIT 1",
          today
        ) as {name:string;icon:string}|null;
        
        const parts: string[] = ["Here's what to focus on right now:\n"];
        if (topTask) parts.push("✓ Top task: **" + topTask.title + "**");
        if (undoneHabit) parts.push("○ Habit due: " + undoneHabit.icon + " " + undoneHabit.name);
        if (topGoal) parts.push("◎ Active goal: " + topGoal.title);
        if (parts.length === 1) parts.push("You're all caught up! Great work.");
        sendReply(parts.join("\n"));
      } catch { sendReply("Could not load priorities."); }
      return;
    }

    // ── Prayer requests ───────────────────────────────────────────────────────
    const addPrayerMatch = lowerText.match(/^(?:add|log|create|save)(?: a)? prayer(?: request)?[:\s]+(.+)/i)
                       || lowerText.match(/^prayer[:\s]+(.+)/i);
    if (addPrayerMatch) {
      const req = addPrayerMatch[1].trim();
      if (req.length > 1) {
        try {
          const id = require('crypto').randomUUID();
          dbRun("INSERT INTO prayer_requests (id,title,body,status,created_at) VALUES (?,?,?,?,?)",
            id, req.slice(0,80), req, 'active', new Date().toISOString());
          sendReply('Prayer request saved: "' + req + '"');
        } catch (e) { sendReply('Could not save prayer request: ' + e); }
        return;
      }
    }

    const prayerCountMatch = /^how many (?:prayer requests?|prayers?)(?: do i have)?$/.test(lowerText) || lowerText === 'prayer count';
    if (prayerCountMatch) {
      try {
        const n = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM prayer_requests WHERE status='active'") as {n:number}|null)?.n || 0;
        sendReply(n + " active prayer request" + (n !== 1 ? "s" : "") + "." + (n > 0 ? " Say 'show prayer requests' to see them." : ""));
      } catch { sendReply("Could not count prayer requests."); }
      return;
    }

    const showPrayerMatch = /^(?:show|list|what are|get|read)(?: me)?(?: my)? prayer(?: requests?| list)?/.test(lowerText)
                         || /^what should i (?:pray for|be praying for)/.test(lowerText)
                         || lowerText === "what should i pray for"
                         || lowerText === 'prayer requests' || lowerText === 'my prayers' || lowerText === 'prayer list';
    if (showPrayerMatch) {
      try {
        const reqs = dbGet<{title:string;body:string;status:string}>(
          "SELECT title, body, status FROM prayer_requests WHERE status='active' ORDER BY created_at DESC LIMIT 10"
        ) as {title:string;body:string;status:string}[];
        if (!reqs.length) sendReply("No active prayer requests. Say \"add prayer request: [your request]\" to add one.");
        else sendReply(reqs.length + ' prayer request' + (reqs.length > 1 ? 's' : '') + ':\n\n' + reqs.map((r,i) => (i+1) + '. ' + r.body).join('\n'));
      } catch { sendReply('Could not load prayer requests.'); }
      return;
    }

    // ── Delete goal ───────────────────────────────────────────────────────────
    const deleteGoalMatch = !lowerText.includes('task') && !lowerText.includes('habit') && lowerText.match(/^(?:delete|remove|archive)(?: (?:a |my )?goal)?[:\s]+(.+)/i);
    if (deleteGoalMatch) {
      const hint = deleteGoalMatch[1].trim();
      try {
        const goal = dbGetOne<{id:string;title:string}>(
          "SELECT id, title FROM goals WHERE LOWER(title) LIKE ? AND status!='done' LIMIT 1",
          '%' + hint.toLowerCase() + '%'
        ) as {id:string;title:string}|null;
        if (!goal) { sendReply("Could not find a goal matching: " + hint); return; }
        dbRun("UPDATE goals SET status='archived',updated_at=? WHERE id=?", new Date().toISOString(), goal.id);
        sendReply('Goal archived: "' + goal.title + '"');
      } catch (e) { sendReply('Could not archive goal: ' + e); }
      return;
    }

    // ── Update task status / priority ─────────────────────────────────────────
    // ── Rename task ───────────────────────────────────────────────────────────
    const renameTaskMatch = lowerText.match(/^(?:rename|edit|update|change)(?: task)?[:\s]+(.+?) (?:to|as|→)[:\s]+(.+)/i);
    if (renameTaskMatch) {
      const oldHint = (renameTaskMatch[1] || '').trim().toLowerCase();
      const newTitle = (renameTaskMatch[2] || '').trim();
      if (oldHint.length > 2 && newTitle.length > 2) {
        try {
          const task = dbGetOne<{id:string;title:string}>(
            "SELECT id, title FROM personal_tasks WHERE LOWER(title) LIKE ? AND status!='done' LIMIT 1",
            '%' + oldHint + '%'
          ) as {id:string;title:string}|null;
          if (!task) { sendReply('Could not find task matching: "' + oldHint + '"'); return; }
          dbRun("UPDATE personal_tasks SET title=?, updated_at=? WHERE id=?", newTitle, new Date().toISOString(), task.id);
          sendReply('✏️ Renamed: "' + task.title + '" → "' + newTitle + '"');
        } catch (e) { sendReply('Could not rename task: ' + e); }
        return;
      }
    }

    const updateTaskMatch = lowerText.match(/^(?:update|change|set|move) task[:\s]+(.+?) to (todo|doing|done|high|low|medium|med)/i)
                        || lowerText.match(/^(?:set|mark|make)(?: task)?[:\s]+(.+?) (?:as |to )?(high|low|urgent|top)(?: priority)?$/i)
                        || lowerText.match(/^deprioritize[:\s]+(.+)/i)
                        || lowerText.match(/^set task[:\s]+(.+?) (?:to|as) (high|low|medium|urgent|normal)(?: priority)?/i)
                        || lowerText.match(/^make (.+?) (?:task )?(high|low|urgent|normal|high priority|top priority)/i)
                        || lowerText.match(/^mark task[:\s]+(.+) (?:as )?(done|complete|todo|doing)/i)
                        || lowerText.match(/^(?:task[:\s]+)(.+) (?:is |→ ?|-> ?)(done|todo|doing)/i);
    if (updateTaskMatch) {
      const hint = updateTaskMatch[1].trim();
      const newVal = updateTaskMatch[2].toLowerCase();
      try {
        const task = dbGetOne<{id:string;title:string}>(
          "SELECT id, title FROM personal_tasks WHERE LOWER(title) LIKE ? AND status!='done' LIMIT 1",
          '%' + hint.toLowerCase() + '%'
        ) as {id:string;title:string}|null;
        if (!task) { sendReply("Could not find a task matching: " + hint); return; }
        if (['todo','doing','done'].includes(newVal)) {
          dbRun("UPDATE personal_tasks SET status=?,updated_at=? WHERE id=?", newVal, new Date().toISOString(), task.id);
          sendReply('Task updated: "' + task.title + '" → ' + newVal);
        } else if (['high','medium','med','low'].includes(newVal)) {
          const pri = (newVal === 'high' || newVal === 'urgent' || newVal === 'top') ? 3 : newVal === 'low' ? 1 : 2;
          dbRun("UPDATE personal_tasks SET priority=?,updated_at=? WHERE id=?", pri, new Date().toISOString(), task.id);
          sendReply('Task priority set to ' + newVal + ': "' + task.title + '"');
        }
      } catch (e) { sendReply('Could not update task: ' + e); }
      return;
    }

    // ── Hashtag power shortcuts: #task, #note, #goal, #habit ────────────────
    const hashtagMatch = resolvedText.match(/^#(task|note|goal|habit|prayer|reminder)[:\s]+(.+)/i);
    if (hashtagMatch) {
      const tag = hashtagMatch[1].toLowerCase();
      const content = hashtagMatch[2].trim();
      if (content.length > 1) {
        try {
          const id = require('crypto').randomUUID();
          const now4 = new Date().toISOString();
          if (tag === 'task') {
            dbRun("INSERT INTO personal_tasks (id,title,status,priority,created_at) VALUES (?,?,?,?,?)", id, content, 'todo', 2, now4);
            sendReply('✓ Task: "' + content + '"');
          } else if (tag === 'note') {
            dbRun("INSERT INTO memory_facts (id,fact,category,importance,created_at) VALUES (?,?,?,?,?)", id, content, 'note', 1, now4);
            sendReply('📝 Note: "' + content + '"');
          } else if (tag === 'goal') {
            dbRun("INSERT INTO goals (id,title,status,priority_score,created_at) VALUES (?,?,?,?,?)", id, content, 'active', 5.0, now4);
            sendReply('◎ Goal: "' + content + '"');
          } else if (tag === 'habit') {
            dbRun("INSERT INTO habits (id,name,icon,color,target_per_day,active,created_at) VALUES (?,?,?,?,?,?,?)", id, content, '⭐', '#7c3aed', 1, 1, now4);
            sendReply('🔄 Habit: "' + content + '"');
          } else if (tag === 'prayer') {
            dbRun("INSERT INTO prayer_requests (id,title,body,status,created_at) VALUES (?,?,?,?,?)", id, content.slice(0,80), content, 'active', now4);
            sendReply('🙏 Prayer: "' + content + '"');
          } else if (tag === 'reminder') {
            dbRun("INSERT INTO reminders (id,title,done,created_at) VALUES (?,?,?,?)", id, content, 0, now4);
            sendReply('⏰ Reminder: "' + content + '"');
          }
        } catch (e) { sendReply('Could not save: ' + e); }
        return;
      }
    }

    // ── Quick note ────────────────────────────────────────────────────────────
    const noteMatch = lowerText.match(/^(?:note|jot|capture|save note|quick note)[:\s]+(.+)/i)
                  || lowerText.match(/^material(?:s)? (?:arrived?|in|received?|delivered?)[:\s]+(.+)/i)
                  || lowerText.match(/^(?:arrived?|received?|got)(?: in)?[:\s]+(.+)/i);
    if (noteMatch) {
      const content = noteMatch[1].trim();
      if (content.length > 1) {
        try {
          const id = require('crypto').randomUUID();
          dbRun("INSERT INTO memory_facts (id,fact,category,importance,created_at) VALUES (?,?,?,?,?)",
            id, content, 'note', 1, new Date().toISOString());
          sendReply("Note saved: \"" + content + "\"");
        } catch (e) { sendReply("Could not save note: " + e); }
        return;
      }
    }

    // ── Morning routine ──────────────────────────────────────────────────────
    const morningMatch = /^(?:morning routine|morning brief|start my day|good morning henry|what.*morning routine|let'?s do morning|morning check.?in|daily check.?in|start the day|new day|fresh start|start fresh|reset for the day|new morning)/.test(lowerText)
                     || lowerText === 'gm' || lowerText === 'good morning' || lowerText === 'morning';
    if (morningMatch) {
      try {
        const today = new Date().toISOString().slice(0,10);
        const now = new Date();
        const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()];
        const month = ['January','February','March','April','May','June','July','August','September','October','November','December'][now.getMonth()];

        const tasks = dbGet<{title:string}>(
          "SELECT title FROM personal_tasks WHERE status!='done' ORDER BY priority DESC, created_at ASC LIMIT 3"
        ) as {title:string}[];
        const rems = dbGet<{title:string;due_at:string}>(
          "SELECT title, due_at FROM reminders WHERE done=0 ORDER BY due_at ASC LIMIT 3"
        ) as {title:string;due_at:string}[];
        const habits = dbGet<{name:string;icon:string}>(
          "SELECT h.name, h.icon FROM habits h WHERE h.active=1 AND h.id NOT IN (SELECT habit_id FROM habit_logs WHERE date=?) ORDER BY h.created_at ASC",
          today
        ) as {name:string;icon:string}[];
        const goals = dbGet<{title:string}>(
          "SELECT title FROM goals WHERE status!='done' ORDER BY priority_score DESC LIMIT 2"
        ) as {title:string}[];
        const pray = dbGet<{title:string}>(
          "SELECT title FROM prayer_requests WHERE status='active' ORDER BY created_at DESC LIMIT 2"
        ) as {title:string}[];

        const lines = [`Good morning, Topher! ${dayName}, ${month} ${now.getDate()}.\n`];
        if (rems.length) lines.push('⏰ Reminders: ' + rems.map(r => r.title).join(', '));
        if (habits.length) lines.push('○ Habits to do: ' + habits.map(h => h.icon + ' ' + h.name).join(', '));
        if (tasks.length) lines.push('✓ Top tasks: ' + tasks.map(t => t.title).join(', '));
        if (goals.length) lines.push('◎ Active goals: ' + goals.map(g => g.title).join(', '));
        if (pray.length) lines.push('🙏 Prayer requests: ' + pray.map(p => p.title).join(', '));
        lines.push('\nHave a great day!');
        sendReply(lines.join('\n'));
      } catch { sendReply('Good morning, Topher! Could not load your full brief right now.'); }
      return;
    }

    // ── Bible download trigger ────────────────────────────────────────────────
    const bibleDownloadMatch = /^(?:download|install|get|import)(?: the)?(?: kjv| bible| scripture| kjv bible)/.test(lowerText)
                             || lowerText === 'download bible' || lowerText === 'install bible' || lowerText === 'get the bible';
    if (bibleDownloadMatch) {
      const count = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM scripture_entries") as {n:number}|null)?.n || 0;
      if (count > 0) {
        sendReply('The KJV Bible is already downloaded — ' + count.toLocaleString() + ' verses ready. Try "find a verse about hope" or "John 3:16".');
      } else {
        sendReply('To download the KJV Bible:\n\n1. Open Henry on your Mac\n2. Click **Scripture** in the left sidebar\n3. Click **⬇ Download KJV Free** (about 3MB)\n4. All 31,102 verses will be available instantly in Henry and on your phone.\n\nThe download takes about 10 seconds on a normal connection.');
      }
      return;
    }


    // ── Memory / DB cleanup ──────────────────────────────────────────────────
    const cleanMemoryMatch = /^(?:clean up|deduplicate|dedup|remove duplicates from)(?: my)? (?:memory|notes|facts|goals|tasks)/.test(lowerText)
                           || lowerText === 'dedup memory' || lowerText === 'clean memory';
    if (cleanMemoryMatch) {
      try {
        // Deduplicate memory facts (keep oldest by id)
        dbRun("DELETE FROM memory_facts WHERE id NOT IN (SELECT MIN(id) FROM memory_facts GROUP BY LOWER(TRIM(fact)))");
        // Deduplicate goals
        dbRun("DELETE FROM goals WHERE id NOT IN (SELECT MIN(id) FROM goals GROUP BY LOWER(TRIM(title)), status)");
        // Deduplicate tasks
        dbRun("DELETE FROM personal_tasks WHERE id NOT IN (SELECT MIN(id) FROM personal_tasks GROUP BY LOWER(TRIM(title)), status)");
        const facts = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM memory_facts") as {n:number}|null)?.n || 0;
        const goals = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM goals WHERE status='active'") as {n:number}|null)?.n || 0;
        const tasks = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM personal_tasks WHERE status!='done'") as {n:number}|null)?.n || 0;
        sendReply("Cleanup complete.\n\n• " + facts + " unique memory facts\n• " + goals + " active goals\n• " + tasks + " open tasks\n\nDuplicates removed.");
      } catch (e) { sendReply("Could not run cleanup: " + e); }
      return;
    }

    // ── Delete a memory fact ───────────────────────────────────────────────────
    const deleteMemMatch = !/(habit|task|goal|reminder)/.test(lowerText.slice(0,20)) && (
      lowerText.match(/^(?:delete|remove|forget)(?: that)?(?: (?:memory|note|fact))?[:\s]+(.+)/i)
      || lowerText.match(/^forget (?:that )?(?:i )?(.+)/i)
    );
    if (deleteMemMatch) {
      const hint = deleteMemMatch[1].trim().toLowerCase();
      if (hint.length > 3 && !['a', 'an', 'the', 'my'].includes(hint)) {
        try {
          const fact = dbGetOne<{id:string;fact:string}>(
            "SELECT id, fact FROM memory_facts WHERE LOWER(fact) LIKE ? ORDER BY importance DESC LIMIT 1",
            '%' + hint + '%'
          ) as {id:string;fact:string}|null;
          if (!fact) { sendReply("No memory found matching: " + hint); return; }
          dbRun("DELETE FROM memory_facts WHERE id=?", fact.id);
          sendReply("Forgotten: \"" + fact.fact + "\"");
        } catch (e) { sendReply("Could not delete memory: " + e); }
        return;
      }
    }

    // ── Pause/activate habit ─────────────────────────────────────────────────
    // ── Delete habit ──────────────────────────────────────────────────────────
    const deleteHabitMatch = lowerText.match(/^(?:delete|remove|cancel|get rid of)(?: (?:my|the|a))? habit[:\s]+(.+)/i);
    if (deleteHabitMatch) {
      const hint = (deleteHabitMatch[1] || '').trim().toLowerCase();
      try {
        const habit = dbGetOne<{id:string;name:string}>(
          "SELECT id, name FROM habits WHERE LOWER(name) LIKE ? LIMIT 1",
          '%' + hint + '%'
        ) as {id:string;name:string}|null;
        if (!habit) { sendReply('No habit found matching: "' + hint + '"'); return; }
        dbRun("DELETE FROM habits WHERE id=?", habit.id);
        dbRun("DELETE FROM habit_logs WHERE habit_id=?", habit.id);
        sendReply('🗑️ Habit deleted: "' + habit.name + '"');
      } catch (e) { sendReply('Could not delete habit: ' + e); }
      return;
    }

    const pauseHabitMatch = lowerText.match(/^(?:turn off|disable|pause|deactivate|stop tracking)(?: habit)?[:\s]+(.+)/i)
                         || lowerText.match(/^(?:pause|disable) (.+) habit$/i);
    if (pauseHabitMatch) {
      const hint = (pauseHabitMatch[1] || '').trim().toLowerCase();
      if (hint.length > 1) {
        try {
          const habit = dbGetOne<{id:string;name:string;active:number}>(
            "SELECT id, name, active FROM habits WHERE LOWER(name) LIKE ? LIMIT 1",
            '%' + hint + '%'
          ) as {id:string;name:string;active:number}|null;
          if (!habit) { sendReply("Could not find a habit matching: " + hint); return; }
          dbRun("UPDATE habits SET active=0 WHERE id=?", habit.id);
          sendReply("Paused habit: \"" + habit.name + "\"\n\nIt won't appear in your daily list. Say \"enable habit: " + habit.name + "\" to turn it back on.");
        } catch (e) { sendReply("Could not pause habit: " + e); }
        return;
      }
    }

    const enableHabitMatch = lowerText.match(/^(?:turn on|enable|activate|resume|restart)(?: habit)?[:\s]+(.+)/i);
    if (enableHabitMatch) {
      const hint = (enableHabitMatch[1] || '').trim().toLowerCase();
      try {
        const habit = dbGetOne<{id:string;name:string}>(
          "SELECT id, name FROM habits WHERE LOWER(name) LIKE ? LIMIT 1",
          '%' + hint + '%'
        ) as {id:string;name:string}|null;
        if (!habit) { sendReply("Could not find a habit matching: " + hint); return; }
        dbRun("UPDATE habits SET active=1 WHERE id=?", habit.id);
        sendReply("Resumed habit: \"" + habit.name + "\" — it will appear in your daily list again.");
      } catch (e) { sendReply("Could not enable habit: " + e); }
      return;
    }

    // ── Log a production job (Maker Studio quick log) ─────────────────────────
    // Match: "I made 5 signs" / "I completed 3 orders for $450" / "I delivered 2 boards"
    const jobLogMatch = lowerText.match(/^i (?:made|completed|finished|sold|delivered|produced|cut|engraved)(?: (\d+))?(?:\s+\w+)? (?:orders?|jobs?|signs?|pieces?|items?|boards?|plaques?|trays?|coasters?)/i)
                     || lowerText.match(/^i (?:made|completed|finished|sold|delivered|produced)(?: (\d+))?(?:\s+\w+)? (?:orders?|jobs?|signs?|pieces?|items?|boards?|plaques?|trays?|coasters?)(?:\s+today)?/i)
                     || lowerText.match(/^i (?:got|received|landed|booked)(?: a| an)?(?: new)? (?:order|job|client|customer|booking)/i)
                     || lowerText.match(/^i (?:wrapped up|knocked out|cranked out|shipped)(?: the| a| an)?(?: .+)? (?:job|order|project|piece|sign|tray|board)/i);
    const jobQty = jobLogMatch ? (parseInt(lowerText.match(/(\d+)/)?.[1] || '1') || 1) : 0;
    const jobRevMatch = jobLogMatch ? lowerText.match(/(?:for|at|worth)\s*\$?([\d.]+)/) : null;
    if (jobLogMatch) {
      const qty = jobQty;
      const desc = '';
      const revenue = parseFloat(jobRevMatch?.[1] || '0') || 0;
      try {
        const today = new Date().toISOString().slice(0,10);
        const id = require('crypto').randomUUID();
        if (revenue > 0) {
          dbRun("INSERT INTO production_runs (id,title,quantity,revenue,date,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING",
            id, desc || 'Custom order', qty, revenue, today, new Date().toISOString());
          sendReply("Logged " + qty + " order" + (qty > 1 ? 's' : '') + " for $" + revenue.toFixed(2) + " in Maker Studio.");
        } else {
          sendReply("Got it — " + qty + " order" + (qty > 1 ? 's' : '') + " completed" + (desc ? ': ' + desc : '') + ". How much did you charge? Say 'log revenue $X' to add the income.");
        }
      } catch { sendReply("Noted! Open Maker Studio to log the full job details."); }
      return;
    }

    // ── End of day summary ───────────────────────────────────────────────────
    const eodMatch = /^(?:end of day|eod|day summary|daily summary|wrap up|wrap up my day|wrap it up|pack it in|clock out|sign off|logging off|done for today|calling it a day|what did i do today|what did i accomplish today|what have i done today|how did my day go|good night|goodnight|heading to bed|time for bed|going to bed|i'm done for the day|i am done for the day|i'm heading to bed|im heading to bed|heading to bed|evening|night|calling it|that's a wrap)/.test(lowerText)
                  || lowerText === 'evening' || lowerText === 'night' || lowerText === "i'm calling it" || lowerText === 'wrap it up' || lowerText === 'pack it in' || lowerText === 'clock out';
    if (eodMatch) {
      try {
        const today = new Date().toISOString().slice(0,10);
        const doneTasks = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM personal_tasks WHERE status='done' AND completed_at >= ?", today + 'T00:00:00.000Z') as {n:number}|null)?.n || 0;
        const habitsDone = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM habit_logs WHERE date=?", today) as {n:number}|null)?.n || 0;
        const activeHabits = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM habits WHERE active=1") as {n:number}|null)?.n || 0;
        const healthLogs = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM health_logs WHERE date=?", today) as {n:number}|null)?.n || 0;
        const journalToday = dbGetOne<{content:string}>("SELECT content FROM journal_entries WHERE date=? LIMIT 1", today) as {content:string}|null;
        const openTasks = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM personal_tasks WHERE status!='done'") as {n:number}|null)?.n || 0;
        const lines = ["Today's wrap-up:\n"];
        lines.push("✓ Tasks completed: " + doneTasks + (openTasks > 0 ? " (" + openTasks + " still open)" : " — all done!"));
        lines.push("○ Habits: " + habitsDone + "/" + activeHabits + " completed");
        lines.push("❤️ Health logs: " + healthLogs);
        if (journalToday) lines.push("📔 Journaled: " + journalToday.content.slice(0,40) + (journalToday.content.length > 40 ? '…' : ''));
        lines.push("\nGood work today, Topher!");
        sendReply(lines.join("\n"));
      } catch { sendReply("Good work today! Could not load full summary."); }
      return;
    }

    // ── Add a new habit ────────────────────────────────────────────────────────
    const addHabitMatch = lowerText.match(/^(?:add|create|new)(?: a)? habit[:\s]+(.+)/i)
                       || lowerText.match(/^habit[:\s]+(.+)/i);
    if (addHabitMatch) {
      const name = addHabitMatch[1].trim();
      if (name.length > 1) {
        try {
          const id = require('crypto').randomUUID();
          dbRun("INSERT INTO habits (id,name,icon,color,target_per_day,active,created_at) VALUES (?,?,?,?,?,?,?)",
            id, name, '⭐', '#7c3aed', 1, 1, new Date().toISOString());
          sendReply("Added habit: \"" + name + "\" — it will now appear in your daily check-in list.");
        } catch (e) { sendReply("Could not add habit: " + e); }
        return;
      }
    }

    // ── Show notes ─────────────────────────────────────────────────────────────
    const showNotesMatch = /^(?:show|list|what are)(?: all)?(?: my)? notes?/.test(lowerText)
                        || lowerText === 'my notes' || lowerText === 'notes';
    if (showNotesMatch) {
      try {
        const notes = dbGet<{fact:string;created_at:string}>(
          "SELECT fact, created_at FROM memory_facts WHERE category='note' ORDER BY created_at DESC LIMIT 15"
        ) as {fact:string;created_at:string}[];
        if (!notes.length) {
          sendReply("No notes saved yet. Say \"note: [anything]\" to save a quick note.");
        } else {
          sendReply(notes.length + " note" + (notes.length > 1 ? "s" : "") + ":\n\n" +
            notes.map((n,i) => (i+1) + ". " + n.fact).join("\n"));
        }
      } catch { sendReply("Could not load notes."); }
      return;
    }

    // ── Log revenue / income ─────────────────────────────────────────────────
    // ── Log expense ──────────────────────────────────────────────────────────
    const expenseMatch = lowerText.match(/^(?:log|record|add)(?: an?)? expense[:\s]+\$?([\d.]+)(?: (.+))?/i)
                      || lowerText.match(/^i (?:spent|paid|bought)(?: \$)?([\d.]+)(?: (?:on|for) (.+))?/i)
                      || lowerText.match(/^(?:spent|expense|cost)[:\s]+\$([\d.]+)(?: (?:on|for) (.+))?/i);
    if (expenseMatch) {
      const amount = parseFloat(expenseMatch[1] || '0');
      const category = (expenseMatch[2] || 'supplies').trim().slice(0, 80);
      if (amount > 0) {
        try {
          const id = require('crypto').randomUUID();
          const today5 = new Date().toISOString().slice(0,10);
          dbRun("INSERT INTO transactions (id,date,amount,type,category,created_at) VALUES (?,?,?,?,?,?)",
            id, today5, amount, 'expense', category, new Date().toISOString());
          sendReply('💸 Logged expense: $' + amount.toFixed(2) + (category !== 'supplies' ? ' — ' + category : '') + '\n\nSay "what\'s my revenue this month" to see profit after expenses.');
        } catch (e) { sendReply('Could not log expense: ' + e); }
        return;
      }
    }

    // ── Quick income log: "booked a $800 job" / "received deposit of $200" ──
    const quickIncomeMatch = lowerText.match(/^(?:booked|landed|got)(?: a| an)?(?: \$([\d.]+))?(?: job| order| client| project| gig)?$/i)
                          || lowerText.match(/^received(?: a)?(?: deposit of)? \$([\d.]+)/i)
                          || lowerText.match(/^got(?: paid)? \$([\d.]+)(?: (?:deposit|today))?/i);
    if (quickIncomeMatch) {
      const amt = parseFloat(quickIncomeMatch[1] || quickIncomeMatch[2] || '0');
      if (amt > 0) {
        try {
          const id = require('crypto').randomUUID();
          dbRun("INSERT INTO transactions (id,date,amount,type,category,created_at) VALUES (?,?,?,?,?,?)",
            id, new Date().toISOString().slice(0,10), amt, 'income', 'job', new Date().toISOString());
          sendReply('💰 Logged income: $' + amt.toFixed(2) + '\n\nSay "what\'s my revenue this month" to see your totals.');
        } catch (e) { sendReply('Could not log income: ' + e); }
        return;
      }
    }

    const revenueMatch = lowerText.match(/^(?:log|add|record)(?:\s+revenue)[:\s]+\$?([\d.]+)/i)
                      || lowerText.match(/^(?:charged?|invoiced?|billed?|collected?)(?: \w+)? \$([\d.]+)(?: today)?/i)
                      || lowerText.match(/^customer(?: just)? paid(?: \$([\d.]+))?/i)
                      || lowerText.match(/^(?:payment|deposit)(?: of)? \$([\d.]+)(?: received)?/i)
                      || lowerText.match(/^(?:log|add|record)[:\s]+\$([\d.]+)/i)
                      || lowerText.match(/^i (?:made|earned|got paid|received|collected) \$([\d.]+)(?: today)?$/i)
                      || lowerText.match(/^revenue[:\s]+\$?([\d.]+)/i)
                      || lowerText.match(/^got paid[:\s]+\$?([\d.]+)/i);
    if (revenueMatch) {
      const amount = parseFloat(revenueMatch[1]) || 0;
      if (amount > 0) {
        try {
          const today = new Date().toISOString().slice(0,10);
          dbRun("INSERT INTO transactions (id,date,type,amount,category,description,created_at) VALUES (?,?,?,?,?,?,?)",
            require('crypto').randomUUID(), today, 'income', amount, 'laser', 'Logged via chat', new Date().toISOString());
          sendReply("Logged income: $" + amount.toFixed(2) + " for today.");
        } catch (e) { sendReply("Could not log revenue. Open Finance panel to add manually."); }
        return;
      }
    }

    // ── Missed habit acknowledgement ────────────────────────────────────────────
    const missedHabitMatch = lowerText.match(/^i (?:missed|skipped|didn'?t do|forgot)(?: my)? (.+?)(?:\s+today)?$/i);
    if (missedHabitMatch) {
      const what = (missedHabitMatch[1] || '').trim().toLowerCase();
      const habitWords = ['prayer','pray','bible','exercise','water','journal','habit'];
      if (habitWords.some(h => what.includes(h))) {
        sendReply("That's okay — grace for today. Tomorrow is a fresh start. 🙏\n\nIf you want to mark it done anyway, say \"mark " + what + " done\".");
        return;
      }
    }

    // ── Clear done tasks ─────────────────────────────────────────────────────
    const clearDoneMatch = /^(?:clear|archive|remove|clean up)(?: all)?(?: my)?(?: done| completed| finished)(?: tasks?)?$/.test(lowerText)
                        || lowerText === 'clear completed' || lowerText === 'clear done' || lowerText === 'archive done tasks';
    if (clearDoneMatch) {
      try {
        const n = (dbGetOne<{n:number}>("SELECT COUNT(*) as n FROM personal_tasks WHERE status='done'") as {n:number}|null)?.n || 0;
        if (!n) { sendReply("No completed tasks to clear."); return; }
        dbRun("DELETE FROM personal_tasks WHERE status='done'");
        sendReply("Cleared " + n + " completed task" + (n !== 1 ? "s" : "") + ". Your list is clean.");
      } catch (e) { sendReply("Could not clear tasks: " + e); }
      return;
    }

    // ── Henry usage duration ──────────────────────────────────────────────────
    const usageDaysMatch = /^how (?:long|many days) (?:have i|am i) (?:been )?using(?: henry)?$/.test(lowerText)
                        || /^when did i (?:start|first use)(?: henry)?/.test(lowerText);
    if (usageDaysMatch) {
      try {
        const oldest = dbGetOne<{d:string}>(
          "SELECT MIN(created_at) as d FROM (SELECT created_at FROM personal_tasks UNION SELECT created_at FROM goals UNION SELECT created_at FROM memory_facts)"
        ) as {d:string}|null;
        if (!oldest?.d) { sendReply("I can't find when you started — but I'm glad you're here!"); return; }
        const start = new Date(oldest.d);
        const days = Math.floor((Date.now() - start.getTime()) / 86400000);
        sendReply("You've been using Henry for " + days + " day" + (days !== 1 ? "s" : "") + " (since " +
          start.toLocaleDateString('en-US', {month:'long', day:'numeric', year:'numeric'}) + ").");
      } catch { sendReply("I can't calculate the exact duration right now."); }
      return;
    }

    // ── Multi-task add: "add tasks: A, B, C" ────────────────────────────────
    const multiTaskMatch = lowerText.match(/^add (?:\d+ )?tasks?[:\s]+(.+)/i)
                       || lowerText.match(/^bulk[:\s]+add tasks?[:\s]+(.+)/i);
    if (multiTaskMatch) {
      const rawItems = multiTaskMatch[1];
      // Split on comma or semicolon, but only if there are multiple items
      const items = rawItems.split(/[,;]+/).map(s => s.trim()).filter(s => s.length > 2);
      if (items.length >= 2) {
        try {
          const saved: string[] = [];
          for (const item of items.slice(0, 5)) { // max 5 at once
            const id = require('crypto').randomUUID();
            dbRun("INSERT INTO personal_tasks (id,title,status,priority,created_at) VALUES (?,?,?,?,?)",
              id, item, 'todo', 2, new Date().toISOString());
            saved.push(item);
          }
          sendReply(saved.length + " tasks added:\n\n" + saved.map((t,i) => (i+1) + ". " + t).join("\n"));
        } catch (e) { sendReply("Could not save tasks: " + e); }
        return;
      }
    }

    // ── Orders/jobs this month ────────────────────────────────────────────────
    const ordersMonthMatch = /^how many (?:orders?|jobs?) (?:did i|have i)(?: complet(?:ed|e)?| finish(?:ed)?| do(?:ne)?| ship(?:ped)?| deliver(?:ed)?)?(?: this month| this week| today)?$/.test(lowerText)
                           || /^(?:orders?|jobs?) (?:this month|this week|completed? this)/.test(lowerText);
    if (ordersMonthMatch) {
      try {
        const month5 = new Date().toISOString().slice(0,7);
        const week5 = new Date(); week5.setDate(week5.getDate()-7);
        const weekStr = week5.toISOString().slice(0,10);
        const monthJobs = (dbGetOne<{n:number}>(
          "SELECT COUNT(*) as n FROM production_runs WHERE strftime('%Y-%m',created_at)=?", month5
        ) as {n:number}|null)?.n || 0;
        const weekJobs = (dbGetOne<{n:number}>(
          "SELECT COUNT(*) as n FROM production_runs WHERE date(created_at) >= ?", weekStr
        ) as {n:number}|null)?.n || 0;
        const income = (dbGetOne<{n:number}>(
          "SELECT COALESCE(SUM(amount),0) as n FROM transactions WHERE type='income' AND strftime('%Y-%m',date)=?", month5
        ) as {n:number}|null)?.n || 0;
        sendReply("This month:\n\n" +
          "📦 Orders logged: " + monthJobs + "\n" +
          "📦 Last 7 days: " + weekJobs + "\n" +
          "💰 Revenue: $" + income.toFixed(2) + "\n\n" +
          "Say 'I made X signs today' to log orders, or 'log revenue: $X' for income.");
      } catch { sendReply("Could not load order count."); }
      return;
    }

    // ── How long has a task been on my list ────────────────────────────────────
    const taskAgeMatch = lowerText.match(/^(?:how long has|when did i add)(?: (?:the|my))? (.+?) (?:been on my list|task been open|been pending|task)?$/i)
                      || lowerText.match(/^(?:age of|when was)(?: (?:the|my))? (.+?) (?:task|added|created)?$/i);
    if (taskAgeMatch) {
      const hint = (taskAgeMatch[1] || '').trim().toLowerCase();
      if (hint.length > 2) {
        try {
          const task = dbGetOne<{title:string;created_at:string}>(
            "SELECT title, created_at FROM personal_tasks WHERE LOWER(title) LIKE ? ORDER BY created_at ASC LIMIT 1",
            '%' + hint + '%'
          ) as {title:string;created_at:string}|null;
          if (!task) { sendReply("Could not find a task matching: " + hint); return; }
          const created = new Date(task.created_at);
          const days = Math.floor((Date.now() - created.getTime()) / 86400000);
          const dateStr = created.toLocaleDateString('en-US', {month:'long', day:'numeric'});
          sendReply('"' + task.title + '" has been on your list for ' + days + ' day' + (days !== 1 ? 's' : '') + ' (added ' + dateStr + ').');
        } catch { sendReply("Could not look up task age."); }
        return;
      }
    }

    // ── Microsoft Office Integration ──────────────────────────────────────────
    // Commands: "open word", "new word doc", "create excel sheet", "open powerpoint", etc.
    const officeMatch = !/(with|of|for|containing|about)\s+(my|all|the)\s+(tasks?|goals?|notes?|habits?|data|revenue)/.test(lowerText) && (
      lowerText.match(/^(?:open|create|new|launch|start)(?: a| an)? ?(word|excel|powerpoint|outlook|onenote)(?: (?:doc(?:ument)?|file|sheet|spreadsheet|presentation|email|note)?)?/i)
      || lowerText.match(/^(?:word|excel|powerpoint|outlook)(?: (?:open|new|create|doc|file|sheet))?$/i)
    );
    if (officeMatch) {
      const app = (officeMatch[1] || officeMatch[0] || '').toLowerCase().trim();
      const appMap: Record<string,string> = {
        word: 'Microsoft Word',
        excel: 'Microsoft Excel',
        powerpoint: 'Microsoft PowerPoint',
        outlook: 'Microsoft Outlook',
        onenote: 'Microsoft OneNote',
      };
      const appKey = Object.keys(appMap).find(k => app.includes(k)) || 'word';
      const appName = appMap[appKey];
      const isNew = /create|new/.test(lowerText);
      // Henry no longer opens apps — guide user with keyboard shortcut
      sendReply('Press **Cmd+Space**, type "' + appName + '", press Enter to open it.\n\nHenry can draft content for any Office doc right here in chat — just ask!');
      return;
    }

    // Open a specific Office file
    const openOfficeFileMatch = lowerText.match(/^open (?:word|excel|powerpoint) file[:\s]+(.+)/i)
                             || lowerText.match(/^open (.+\.(?:docx?|xlsx?|pptx?|csv))/i);
    if (openOfficeFileMatch) {
      const filePath = (openOfficeFileMatch[1] || '').trim().replace(/^["']|["']$/g, '');
      sendReply('To open "' + filePath + '" — double-click it in Finder, or use Cmd+O in the app.\n\nHenry can read and work with the content in chat — just paste it in!');
      return;
    }

    // Save current Office doc to a location
    const saveOfficeMatch = lowerText.match(/^save(?: (?:word|excel|powerpoint))?(?: (?:doc|file|sheet|to))?[:\s]+(.+)/i)
                         || /^save to desktop$/.test(lowerText)
                         || /^save(?: the)? (?:doc(?:ument)?|file|sheet)$/.test(lowerText);
    if (saveOfficeMatch) {
      let savePath = (Array.isArray(saveOfficeMatch) ? (saveOfficeMatch[1] || '') : '').trim();
      if (!savePath || lowerText === 'save to desktop') savePath = '~/Desktop/Henry-' + new Date().toISOString().slice(0,10);
      try {
        const { execSync } = await import('child_process') as typeof import('child_process');
        const expanded = savePath.replace('~', process.env.HOME || '');
        // Try Word first, then Excel
        const wordSave = 'tell application "Microsoft Word" to save active document';
        try { execSync('osascript -e "' + wordSave + '"', { timeout: 5000 }); sendReply('✅ Word document saved.'); }
        catch { 
          const excelSave = 'tell application "Microsoft Excel" to save active workbook';
          try { execSync('osascript -e "' + excelSave + '"', { timeout: 5000 }); sendReply('✅ Excel file saved.'); }
          catch { sendReply('No active Office document to save. Open Word or Excel first.'); }
        }
      } catch (e) { sendReply('Could not save: ' + e); }
      return;
    }

    // Close Office app
    const closeOfficeMatch = lowerText.match(/^close(?: (?:word|excel|powerpoint|outlook))?$/i);
    if (closeOfficeMatch && /word|excel|powerpoint|outlook/.test(lowerText)) {
      // Henry does not control apps — guide user
      sendReply('Press **Cmd+Q** in the app to quit, or **Cmd+W** to close just the window.');
      return;
    }

    // "write [content] in word" → create doc with AI-drafted content then open Word
    const writeInWordMatch = lowerText.match(/^(?:write|draft|create)(?: (?:a|an))?(.*?)(?:\s+in word| in excel| as a word doc| as a docx)/i);
    if (writeInWordMatch) {
      const what = (writeInWordMatch[1] || '').trim();
      // We can't call AI inline here, so save task + open Word
      sendReply('📝 What would you like me to draft?\n\nJust ask me and I\'ll write the ' + (what || 'document') + ' for you in chat.\nThen open Word (say "open word") and paste it in.\n\nExample: "draft a custom sign order form for Henderson"');
      return;
    }

    // "create invoice for Henderson" — open Word and let AI draft in next turn
    // Skip createDocMatch if this looks like a price calc ("create quote: 10 x at $Y")
    const hasQtyPrice = /\d+\s+.+\s+(?:at|@)\s+\$[\d.]+/.test(lowerText);
    const createDocMatch = !hasQtyPrice && lowerText.match(/^(?:make|create|write|draft|generate)(?: (?:me|a|an))? (?:invoice|quote|estimate|proposal|letter|contract|report|checklist)(?: for .+)?(?:\s+in word| as (?:a )?word)?/i);
    if (createDocMatch) {
      const docType = lowerText.match(/invoice|quote|estimate|proposal|letter|contract|report|checklist/i)?.[0] || 'document';
      const forWho = lowerText.match(/(?:for|to) ([A-Za-z]+(?:\s+[A-Za-z]+)?)/i)?.[1] || '';
      // Don't auto-open Word — let AI draft in chat, user copies to Word manually
      sendReply('📄 I\'ll draft the ' + docType + (forWho ? ' for ' + forWho : '') + ' for you in the next message.\n\nOnce I write it, you can:\n• Open Word manually (or say "open word")\n• Copy and paste the content in\n• Save with Cmd+S\n\nAsk me: "draft a ' + docType + ' for ' + (forWho || 'client') + '"');
      return;
    }

    // "export my tasks to word" / "create a word doc with my goals"
    const exportToOfficeMatch = lowerText.match(/^(?:export|copy|put|add|create)(?: (?:my|a))?(?: (?:tasks?|goals?|notes?|habits?|reminders?|prayer requests?|revenue|health))+(?:\s+(?:to|in|as|into))?(?: (?:a|an?))? (?:word|excel|spreadsheet|doc(?:ument)?)?/i)
                             || lowerText.match(/^create(?: a)? (?:word|excel)(?: (?:doc|sheet|file))? (?:with|of|for) (?:my|all)(?: (?:tasks?|goals?|habits?|notes?|revenue|health))/i);
    if (exportToOfficeMatch) {
      const toExcel = /excel|spreadsheet/.test(lowerText);
      const isGoals = /goals?/.test(lowerText);
      const isTasks = /tasks?/.test(lowerText);
      const isNotes = /notes?|memory/.test(lowerText);
      const isHabits = /habits?/.test(lowerText);
      const isRevenue = /revenue|finance/.test(lowerText);

      try {
        // Build content from DB
        const lines: string[] = [];
        const today = new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
        lines.push('Henry AI Export — ' + today + '\n');

        if (isTasks) {
          const tasks = dbGet<{title:string;status:string;priority:number}>(
            "SELECT title, status, priority FROM personal_tasks WHERE status!='done' ORDER BY priority DESC, created_at DESC LIMIT 20"
          ) as {title:string;status:string;priority:number}[];
          lines.push('OPEN TASKS (' + tasks.length + '):');
          tasks.forEach((t,i) => lines.push((i+1) + '. [' + t.status.toUpperCase() + '] ' + t.title));
          lines.push('');
        }
        if (isGoals) {
          const goals = dbGet<{title:string;priority_score:number}>(
            "SELECT title, priority_score FROM goals WHERE status='active' ORDER BY priority_score DESC LIMIT 15"
          ) as {title:string;priority_score:number}[];
          lines.push('ACTIVE GOALS (' + goals.length + '):');
          goals.forEach((g,i) => lines.push((i+1) + '. ' + g.title));
          lines.push('');
        }
        if (isNotes) {
          const notes = dbGet<{fact:string}>(
            "SELECT fact FROM memory_facts WHERE category='note' ORDER BY created_at DESC LIMIT 15"
          ) as {fact:string}[];
          lines.push('NOTES (' + notes.length + '):');
          notes.forEach((n,i) => lines.push((i+1) + '. ' + n.fact));
          lines.push('');
        }
        if (isHabits) {
          const habits = dbGet<{name:string}>(
            "SELECT name FROM habits WHERE active=1 ORDER BY created_at"
          ) as {name:string}[];
          lines.push('HABITS (' + habits.length + '):');
          habits.forEach((h,i) => lines.push((i+1) + '. ' + h.name));
          lines.push('');
        }
        if (isRevenue) {
          const month = new Date().toISOString().slice(0,7);
          const income = (dbGetOne<{n:number}>("SELECT COALESCE(SUM(amount),0) as n FROM transactions WHERE type='income' AND strftime('%Y-%m',date)=?", month) as {n:number}|null)?.n || 0;
          const txs = dbGet<{date:string;amount:number;category:string}>(
            "SELECT date, amount, category FROM transactions WHERE strftime('%Y-%m',date)=? ORDER BY date DESC LIMIT 20", month
          ) as {date:string;amount:number;category:string}[];
          lines.push('REVENUE (' + month + '):');
          lines.push('Total: $' + income.toFixed(2));
          txs.forEach(t => lines.push(t.date + ': $' + t.amount.toFixed(2) + ' (' + t.category + ')'));
          lines.push('');
        }

        const content = lines.join('\n');
        // Show content in chat — no auto-opening apps
        const preview = content.slice(0, 500) + (content.length > 500 ? '\n\n…(' + lines.length + ' total lines)' : '');
        if (!toExcel) {
          sendReply('📋 Here\'s your data to paste into Word:\n\n' + preview + '\n\n💡 Say "open word" to launch Word, then paste with Cmd+V.');
        } else {
          sendReply('📋 Here\'s your data to paste into Excel:\n\n' + preview + '\n\n💡 Say "open excel" to launch Excel, then paste.');
        }
      } catch (e) { sendReply('Could not export: ' + e); }
      return;
    }

    // ── Bare "done" → complete top in-progress task ──────────────────────────
    // "customer paid" without amount → prompt
    if (/^customer(?: just)? paid$/.test(lowerText) || lowerText === 'got paid' || lowerText === 'payment received') {
      sendReply('How much? Say "customer paid $X" or "I got paid $X" to log it.');
      return;
    }

    if (lowerText === 'done' || lowerText === 'finished' || lowerText === "i'm done with that" || lowerText === 'completed') {
      try {
        // Try doing tasks first, then top todo
        const task = dbGetOne<{id:string;title:string}>(
          "SELECT id, title FROM personal_tasks WHERE status='doing' ORDER BY updated_at DESC LIMIT 1"
        ) as {id:string;title:string}|null
        || dbGetOne<{id:string;title:string}>(
          "SELECT id, title FROM personal_tasks WHERE status='todo' ORDER BY priority DESC, created_at ASC LIMIT 1"
        ) as {id:string;title:string}|null;
        if (!task) { sendReply('No open tasks to complete. Add one with "add task: X".'); return; }
        dbRun("UPDATE personal_tasks SET status='done', completed_at=?, updated_at=? WHERE id=?",
          new Date().toISOString(), new Date().toISOString(), task.id);
        sendReply('✓ Done: "' + task.title + '"\n\nSay "next" or "what should I focus on" for the next task.');
      } catch { sendReply('Could not complete task.'); }
      return;
    }

    // ── Quick price calculator ───────────────────────────────────────────────
    const priceCalcMatch = lowerText.match(/^(?:price|calculate|calc|quote|what(?:'s| is| would)(?: the)? cost):?\s+(\d+)\s+(.+?)\s+(?:at|@)\s+\$([\d.]+)/i)
                        || lowerText.match(/^(?:create quote|quote)(?: for \w+)?[:\s]+(\d+)\s+(.+?)\s+(?:at|@)\s+\$([\d.]+)/i)
                        || lowerText.match(/^(\d+)\s+(.+?)\s+(?:at|@|\×|x)\s+\$([\d.]+)(?:\/(?:each|ea|piece|item))?$/i);
    if (priceCalcMatch) {
      const qty = parseInt(priceCalcMatch[1] || '0');
      const item = (priceCalcMatch[2] || '').trim();
      const unitPrice = parseFloat(priceCalcMatch[3] || '0');
      if (qty > 0 && unitPrice > 0) {
        const total = qty * unitPrice;
        const margin = total * 0.3; // rough 30% margin estimate
        sendReply(qty + ' × ' + item + ' @ $' + unitPrice.toFixed(2) + '\n\n💰 Total: $' + total.toFixed(2) + '\n📦 After materials (~30%): ~$' + margin.toFixed(2) + ' profit\n\nSay "log revenue: $' + total.toFixed(0) + '" to record this job.');
        return;
      }
    }

    // ── "Remember that..." — instant memory save, no AI needed ────────────────
    const rememberMatch = lowerText.match(/^(?:please )?remember(?: that)? (.+)/i);
    if (rememberMatch) {
      const fact = resolvedText.replace(/^(?:please )?remember(?: that)? /i, '').trim();
      if (fact.length > 3) {
        try {
          const id = require('crypto').randomUUID();
          dbRun(
            "INSERT OR IGNORE INTO memory_facts (id, fact, category, importance, created_at) VALUES (?,?,?,?,?)",
            id, fact, 'user', 2, new Date().toISOString()
          );
          sendReply(`Got it — I've saved that to my memory: "${fact}"`);
        } catch { sendReply(`I noted that, though I had trouble saving it permanently.`); }
        return;
      }
    }

    // ── Weather lookup ────────────────────────────────────────────────────────
    const weatherMatch = /^(?:what(?:'s| is)(?: the)? weather|weather(?: today| now| forecast)?|will it rain|is it (?:hot|cold|raining|sunny))/.test(lowerText);
    if (weatherMatch) {
      try {
        // Use wttr.in for free weather — returns simple text
        const https = require('https') as typeof import('https');
        const weatherText = await new Promise<string>((resolve) => {
          const req = https.get('https://wttr.in/Hot+Springs+Arkansas?format=3', { timeout: 4000 }, (res: any) => {
            let data = '';
            res.on('data', (chunk: any) => data += chunk);
            res.on('end', () => resolve(data.trim()));
          });
          req.on('error', () => resolve(''));
          req.on('timeout', () => { req.destroy(); resolve(''); });
        });
        if (weatherText && !weatherText.includes('Unknown location')) {
          sendReply('Weather in Hot Springs, AR: ' + weatherText);
        } else {
          sendReply("I can't fetch live weather right now. Check weather.gov or your phone's weather app for Hot Springs, AR.");
        }
      } catch { sendReply("I can't fetch live weather right now. Check weather.gov for Hot Springs, AR."); }
      return;
    }

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
          pushToDevice(deviceId as string, { type: 'companion_screenshot', payload: { base64: buf.toString('base64') } });
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
          deviceContext.set(deviceId!, { ...(deviceContext.get(deviceId!) || {}), lastFolder: fullPath });
          return 'Created "' + name + '" on your ' + locStr + ' and opened it in Finder.';
        } catch (e) { return 'Failed: ' + (e instanceof Error ? e.message : String(e)); }
      }

      // Open app — DISABLED: Henry doesn't auto-open apps.
      // Say what you want and Henry handles it in chat.

      // Open URL
      const urlM = text.match(/(?:go to|open|navigate to)\s+(https?:\/\/\S+|www\.\S+)/i);
      if (urlM) {
        const url = urlM[1].startsWith('http') ? urlM[1] : 'https://' + urlM[1];
        execSync('open "' + url + '"', { timeout: 5000 });
        return 'Opening ' + url;
      }

      // Disk space
      if (/disk|storage|free space|how much.*(?:disk|storage|space|memory|ram)/.test(t)) {
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
      if (/(?:list|show).*(?:desktop|files|folder|directory)|desktop.*files/.test(t)) {
        const target = t.includes('document') ? macHome + '/Documents' : t.includes('download') ? macHome + '/Downloads' : macHome + '/Desktop';
        const out = execSync('ls "' + target + '"', { encoding: 'utf8', timeout: 5000 }) as string;
        return (target.split('/').pop() || 'Desktop') + ':\n' + out.trim();
      }

      return null;
    }

    try {
      const cmdResult = await tryComputerCommand(resolvedText);
      if (cmdResult !== null) {
        sendReply(cmdResult);
        return;
      }
    } catch { /* fall through to AI */ }

    // ── Iron Gateway v2 — Multi-provider round-robin with auto-fallback ─────
    // Cycles through ALL free AI sources. When one rate-limits or errors,
    // immediately tries the next. Each provider has a cooldown before retry.
    try {
      const dbSettings2 = dbGet<{key:string;value:string}>('SELECT key, value FROM settings');
      const settingsMap: Record<string,string> = {};
      for (const {key,value} of dbSettings2 as {key:string;value:string}[]) settingsMap[key] = value;
      const dbProviders2 = dbGet<{id:string;api_key:string}>('SELECT id, api_key FROM providers WHERE enabled=1');
      const groqKey = (dbProviders2 as {id:string;api_key:string}[]).find(p => p.id === 'groq')?.api_key || '';
      const geminiKey = settingsMap['gemini_api_key'] || '';
      const cerebrasKey = settingsMap['cerebras_api_key'] || '';
      const openrouterKey = settingsMap['openrouter_api_key'] || '';

      // ── Provider registry ──────────────────────────────────────────────────
      // Each entry: { hostname, path, model, headers, bodyFn, name }
      // Listed in priority order. Henry tries each until one succeeds.
      // Rate-limit state tracked in-memory with 60-second cooldown.

      type ProviderDef = {
        name: string;
        hostname: string;
        path: string;
        model: string;
        key: string;
        bodyFn?: (msgs: object[], model: string) => string;
      };

      const providers: ProviderDef[] = [
        // Groq tier-1: fast 70B (best quality, ~30 RPM free)
        { name: 'Groq/llama-4-scout', hostname: 'api.groq.com', path: '/openai/v1/chat/completions',
          model: 'meta-llama/llama-4-scout-17b-16e-instruct', key: groqKey },
        // Groq tier-2: llama-3.3-70b versatile
        { name: 'Groq/llama-3.3-70b', hostname: 'api.groq.com', path: '/openai/v1/chat/completions',
          model: 'llama-3.3-70b-versatile', key: groqKey },
        // Groq tier-3: Qwen3-32b
        { name: 'Groq/qwen3-32b', hostname: 'api.groq.com', path: '/openai/v1/chat/completions',
          model: 'qwen/qwen3-32b', key: groqKey },
        // Groq tier-4: fast 8B (very high rate limits, lower quality)
        { name: 'Groq/llama-3.1-8b', hostname: 'api.groq.com', path: '/openai/v1/chat/completions',
          model: 'llama-3.1-8b-instant', key: groqKey },
        // Gemini 2.0 Flash (15 RPM free, 1M tokens/day)
        { name: 'Gemini/flash-2.0', hostname: 'generativelanguage.googleapis.com',
          path: '/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse',
          model: 'gemini-2.0-flash', key: geminiKey },
        // Gemini 1.5 Flash (separate quota)
        { name: 'Gemini/flash-1.5', hostname: 'generativelanguage.googleapis.com',
          path: '/v1beta/models/gemini-1.5-flash:streamGenerateContent?alt=sse',
          model: 'gemini-1.5-flash', key: geminiKey },
        // Cerebras (very fast, generous free tier)
        { name: 'Cerebras/llama-4-scout', hostname: 'api.cerebras.ai',
          path: '/v1/chat/completions', model: 'llama-4-scout', key: cerebrasKey },
        // OpenRouter free tier
        { name: 'OpenRouter/llama-3.3-70b', hostname: 'openrouter.ai',
          path: '/api/v1/chat/completions', model: 'meta-llama/llama-3.3-70b-instruct:free', key: openrouterKey },
        { name: 'OpenRouter/gemma-3-27b', hostname: 'openrouter.ai',
          path: '/api/v1/chat/completions', model: 'google/gemma-3-27b-it:free', key: openrouterKey },
        { name: 'OpenRouter/deepseek-r1', hostname: 'openrouter.ai',
          path: '/api/v1/chat/completions', model: 'deepseek/deepseek-r1:free', key: openrouterKey },
      ].filter(p => p.key.length > 5); // Only include providers with valid keys

      if (providers.length === 0) {
        sendReply('No AI providers configured. Add a Groq API key in Settings.');
        return;
      }

      // Rate-limit cooldown tracker (in-process, resets on restart)
      // Key = provider name, value = timestamp when cooldown expires
      const RL_STORE_KEY = '__henry_rl__';
      const g = global as any;
      if (!g[RL_STORE_KEY]) g[RL_STORE_KEY] = {};
      const rlStore: Record<string, number> = g[RL_STORE_KEY];
      const COOLDOWN_MS = 60_000; // 60-second cooldown after rate limit

      const availableProviders = providers.filter(p => {
        const cooldownUntil = rlStore[p.name] || 0;
        return Date.now() > cooldownUntil;
      });

      if (availableProviders.length === 0) {
        // All rate-limited — pick the one whose cooldown expires soonest
        const soonest = providers.reduce((a, b) => 
          (rlStore[a.name] || 0) < (rlStore[b.name] || 0) ? a : b
        );
        const wait = Math.ceil(((rlStore[soonest.name] || 0) - Date.now()) / 1000);
        sendReply('All AI providers are temporarily rate-limited. Try again in ~' + wait + ' seconds, or say a command instead.');
        return;
      }

      // Build system prompt (same as before — reused across all providers)
      let factsBlock = '';
      let userName = '';
      try {
        const facts = dbGet<{ fact: string; importance: number }>(
          'SELECT fact, importance FROM memory_facts ORDER BY importance DESC, created_at DESC LIMIT 25'
        ) as { fact: string; importance: number }[];
        if (facts?.length) {
          factsBlock = facts.map(f => '- ' + f.fact).join('\n');
          for (const f of facts) {
            const m = f.fact.match(/^User name:\s*(.+)$/i);
            if (m) { userName = m[1].trim(); break; }
          }
        }
      } catch { /* */ }

      let recentSummary = '';
      try {
        const recentMsgs = dbGet<{ role: string; content: string }>(
          "SELECT role, content FROM messages WHERE role IN ('user','assistant') ORDER BY created_at DESC LIMIT 8"
        ) as { role: string; content: string }[];
        if (recentMsgs?.length) {
          recentSummary = recentMsgs.reverse()
            .map(m => (m.role === 'user' ? 'You earlier' : 'Henry earlier') + ': ' + (m.content || '').slice(0, 200))
            .join('\n');
        }
      } catch { /* */ }

      const greeting = userName ? `You are Henry, talking with ${userName}.` : `You are Henry.`;
      const now2 = new Date();
      const dayName2 = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now2.getDay()];
      const monthName2 = ['January','February','March','April','May','June','July','August','September','October','November','December'][now2.getMonth()];

      const liveCtxLines: string[] = [`Today is ${dayName2}, ${monthName2} ${now2.getDate()}, ${now2.getFullYear()}. Current time: ${now2.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}.`];
      try {
        const today2 = now2.toISOString().slice(0, 10);
        const tasks2 = dbGet<{title:string}>( "SELECT title FROM personal_tasks WHERE status='todo' ORDER BY priority DESC, created_at DESC LIMIT 5") as {title:string}[];
        if (tasks2.length) liveCtxLines.push('Open tasks: ' + tasks2.map(t => t.title).join(', '));
        const habits2 = dbGet<{name:string}>("SELECT h.name FROM habits h WHERE h.active=1 AND h.id NOT IN (SELECT habit_id FROM habit_logs WHERE date=?) ORDER BY h.created_at LIMIT 5", today2) as {name:string}[];
        if (habits2.length) liveCtxLines.push('Habits pending today: ' + habits2.map(h => h.name).join(', '));
        const goals2 = dbGet<{title:string}>("SELECT title FROM goals WHERE status='active' ORDER BY priority_score DESC LIMIT 3") as {title:string}[];
        if (goals2.length) liveCtxLines.push('Active goals: ' + goals2.map(g => g.title).join(', '));
      } catch { /* */ }

      const systemPrompt2 = [
        greeting,
        "Henry is a warm, thoughtful, conversational AI — the user\'s personal companion AND an elite senior engineer. Down-to-earth, genuine, brief but never curt. World-class coder + smart friend.",
        "ABSOLUTE RULES: NEVER invent facts. The ONLY facts you know are in 'What you remember'. If not listed, say 'I don't know yet.' Match their energy. Ask one good question max.",
        "CODING — you are an expert full-stack engineer. Write complete, working, production-quality code. Modern patterns, typed interfaces, error handling, helpful comments. TypeScript, Python, Swift, SQL, Bash, React/TSX, Node.js, Electron. For Henry specifically: you know its Electron+React+SQLite architecture deeply and can write any new feature.",
        "MAKER INTELLIGENCE: You know Topher runs MixedMakerShop — laser cutting + custom signs. Cherry burns at 55w, walnut trays are $95, maple at 40w, signs at $50-75. Give specific pricing, material, and shop-flow advice.",
        "NEVER output tool calls, function calls, XML tags, or structured commands. You are a CHAT assistant only — plain conversational text. Never write: computer:openApp(), <tool_call>, or any JSON/code commands.",
        "CRITICAL: NEVER output tool calls, function calls, XML tags, JSON, or any structured commands. You are a CHAT assistant. If the user asks to open an app or do a computer action, Henry's router handles it — you just respond naturally in plain text.",
        "NEVER output: computer:openApp(), <tool_call>, {action:...}, function_call, or any code/markup. Plain conversational text ONLY.",
        factsBlock ? `── WHAT YOU REMEMBER ──\n${factsBlock}` : "── WHAT YOU REMEMBER ──\nNothing yet — early conversation.",
        "── LIVE CONTEXT ──\n" + liveCtxLines.join('\n'),
        recentSummary ? "── RECENT CONVERSATION ──\n" + recentSummary : '',
      ].filter(Boolean).join('\n\n');

      const messages2 = [
        { role: 'system', content: systemPrompt2 },
        ...(body.history || []).slice(-12),
        { role: 'user', content: userText }
      ];

      // ── Try providers in order ──────────────────────────────────────────────
      const { default: https2 } = await import('https');

      let replied = false;

      const tryProvider = (idx: number): void => {
        if (idx >= availableProviders.length) {
          if (!replied) sendReply('All available AI providers failed. Try again in a moment.');
          return;
        }

        const prov = availableProviders[idx];
        const isGemini = prov.hostname.includes('generativelanguage');

        // Build request body based on provider
        let postBody2: string;
        let reqHeaders: Record<string,string>;

        if (isGemini) {
          // Gemini uses different format: contents array
          const geminiContents = messages2
            .filter(m => m.role !== 'system')
            .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
          const systemInstruction = { parts: [{ text: systemPrompt2 }] };
          postBody2 = JSON.stringify({ contents: geminiContents, systemInstruction, generationConfig: { temperature: 0.4, maxOutputTokens: 1200 } });
          reqHeaders = { 'Content-Type': 'application/json', 'x-goog-api-key': prov.key };
        } else {
          // OpenAI-compatible (Groq, Cerebras, OpenRouter)
          postBody2 = JSON.stringify({ model: prov.model, messages: messages2, temperature: 0.4, max_tokens: 1200, stream: true });
          reqHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + prov.key, 'Content-Length': String(Buffer.byteLength(postBody2)) };
          if (prov.hostname === 'openrouter.ai') {
            reqHeaders['HTTP-Referer'] = 'https://henry-ai.app';
            reqHeaders['X-Title'] = 'Henry AI';
          }
        }

        const pathWithKey = isGemini ? prov.path + (prov.path.includes('?') ? '&' : '?') + 'key=' + prov.key : prov.path;

        const opts2 = {
          hostname: prov.hostname,
          path: isGemini ? prov.path : prov.path,
          method: 'POST',
          headers: reqHeaders,
          timeout: 5000  // 5s socket timeout — fail fast and try next provider
        };

        let fullText2 = '';
        let doneSent2 = false;
        let statusCode = 200;

        const req3 = https2.request(opts2, (r3) => {
          statusCode = r3.statusCode || 200;

          // Rate-limit or error → mark provider and try next
          if (statusCode === 429 || statusCode === 503 || statusCode === 524) {
            rlStore[prov.name] = Date.now() + COOLDOWN_MS;
            console.log(`[Iron Gateway] ${prov.name} rate-limited (HTTP ${statusCode}), trying next...`);
            r3.resume(); // drain
            tryProvider(idx + 1);
            return;
          }
          if (statusCode >= 400 && statusCode !== 200) {
            console.log(`[Iron Gateway] ${prov.name} error HTTP ${statusCode}, trying next...`);
            r3.resume();
            tryProvider(idx + 1);
            return;
          }

          r3.on('data', (chunk: Buffer) => {
            const rawLines = chunk.toString().split('\n');
            for (const rawLine of rawLines) {
              if (!rawLine.startsWith('data: ')) continue;
              const data = rawLine.slice(6).trim();
              if (data === '[DONE]') {
                if (!doneSent2 && fullText2) {
                  doneSent2 = true;
                  finishReply(fullText2);
                }
                return;
              }
              try {
                const parsed = JSON.parse(data);
                // Gemini streaming format
                let delta = '';
                if (isGemini) {
                  delta = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
                } else {
                  delta = parsed.choices?.[0]?.delta?.content || '';
                }
                if (delta) {
                  fullText2 += delta;
                  pushToDevice(deviceId, { type: 'companion_chunk', payload: { chunk: delta } });
                }
              } catch { /* ignore parse errors */ }
            }
          });

          r3.on('end', () => {
            if (fullText2 && !doneSent2) {
              doneSent2 = true;
              finishReply(fullText2);
            } else if (!fullText2 && !doneSent2) {
              // Empty response — try next provider
              console.log(`[Iron Gateway] ${prov.name} returned empty, trying next...`);
              tryProvider(idx + 1);
            }
          });
        });

        req3.on('error', (e: Error) => {
          console.log(`[Iron Gateway] ${prov.name} network error: ${e.message}, trying next...`);
          if (!replied) tryProvider(idx + 1);
        });
        req3.on('timeout', () => {
          console.log('[Iron Gateway] ' + prov.name + ' timed out after 6s, trying next...');
          req3.destroy();
          if (!replied) tryProvider(idx + 1);
        });

        req3.write(postBody2);
        req3.end();
      };

      const finishReply = (text: string) => {
        if (replied) return;
        replied = true;
        deviceContext.set(deviceId, { ...deviceContext.get(deviceId), lastAiResponse: text });
        try { extractAndSaveFacts(body.text || '', text); } catch { /* non-critical */ }
        const cantPhrases = ["I don't have direct access","I don't have access to your computer","I'm currently interacting with you on your phone","I cannot access your","I can't directly access"];
        const hasCannotPhrase = cantPhrases.some(p => text.includes(p));
        if (hasCannotPhrase) {
          sendReply('I had trouble with that. Try asking differently, or use the quick buttons at the bottom.');
        } else {
          sendReply(text);
        }
      };

      // Kick off the chain
      tryProvider(0);

    } catch (e) {
      sendReply('Error: ' + (e instanceof Error ? e.message : String(e)));
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
  // ── Companion data endpoints ─────────────────────────────────────────────

  // Live Mac screenshot → returns { image: 'data:image/png;base64,...' }
  if (path === '/sync/mac/screen' && req.method === 'GET') {
    try {
      const { execSync } = await import('child_process');
      const os = await import('os');
      const fs = await import('fs');
      const path_mod = await import('path');
      const tmp = path_mod.default.join(os.default.tmpdir(), `henry_companion_${Date.now()}.png`);
      execSync(`screencapture -x -m "${tmp}"`, { timeout: 3000 });
      const buf = fs.default.readFileSync(tmp);
      fs.default.unlinkSync(tmp);
      const b64 = buf.toString('base64');
      jsonResponse(res, 200, { image: `data:image/png;base64,${b64}`, ts: Date.now() });
    } catch (e) {
      jsonResponse(res, 500, { error: String(e) });
    }
    return;
  }

  // Today summary — tasks, habits, reminders
  if (path === '/sync/mac/today' && req.method === 'GET') {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const tasks = dbGet('SELECT id,title,notes,status,priority,due_at FROM personal_tasks WHERE status!=? ORDER BY created_at DESC LIMIT 10', 'done') as any[];
      const reminders = dbGet('SELECT id,title,due_at,done FROM reminders WHERE done=0 ORDER BY due_at ASC LIMIT 10', ...[]) as any[];
      const habits = dbGet('SELECT * FROM habits WHERE active=1', ...[]) as any[];
      const habitLogs = dbGet('SELECT * FROM habit_logs WHERE date=?', today) as any[];
      const journalToday = dbGet('SELECT id,title,content,mood FROM journal_entries WHERE date=? LIMIT 1', today) as any[];
      jsonResponse(res, 200, { tasks, reminders, habits, habitLogs, journalToday, date: today });
    } catch (e) {
      jsonResponse(res, 500, { error: String(e) });
    }
    return;
  }

  // Toggle a habit for today from companion
  if (path === '/sync/mac/habit-toggle' && req.method === 'POST') {
    try {
      const body = await readBody(req) as { habit_id: string; date: string };
      const today = body.date || new Date().toISOString().slice(0, 10);
      const existing = dbGet('SELECT * FROM habit_logs WHERE habit_id=? AND date=?', body.habit_id, today) as any[];
      if (existing.length > 0) {
        dbRun('DELETE FROM habit_logs WHERE habit_id=? AND date=?', body.habit_id, today);
        jsonResponse(res, 200, { action: 'removed', habit_id: body.habit_id });
      } else {
        const id = crypto.randomUUID();
        dbRun('INSERT INTO habit_logs (id, habit_id, date, count) VALUES (?,?,?,1)', id, body.habit_id, today);
        jsonResponse(res, 200, { action: 'added', habit_id: body.habit_id });
      }
    } catch (e) {
      jsonResponse(res, 500, { error: String(e) });
    }
    return;
  }

  // Quick shell run from companion (no sensitive ops)
  if (path === '/sync/mac/run' && req.method === 'POST') {
    try {
      const body = await readBody(req) as { command: string };
      const { execSync } = await import('child_process');
      // Safety: block dangerous commands
      const cmd = (body.command || '').trim();
      const blocked = /rm -rf|sudo|passwd|mkfs|dd if|chmod 777/i;
      if (blocked.test(cmd)) { jsonResponse(res, 403, { error: 'Command blocked' }); return; }
      const out = execSync(cmd, { encoding: 'utf8', timeout: 10000, shell: '/bin/zsh' });
      jsonResponse(res, 200, { output: out.trim(), command: cmd });
    } catch (e: any) {
      jsonResponse(res, 200, { output: e.message || String(e), error: true });
    }
    return;
  }

  // Open an app from companion
  if (path === '/sync/mac/open-app' && req.method === 'POST') {
    try {
      const body = await readBody(req) as { app: string };
      const { execSync } = await import('child_process');
      execSync(`open -a "${(body.app||'Finder').replace(/"/g, '')}"`, { timeout: 3000 });
      jsonResponse(res, 200, { ok: true });
    } catch (e) {
      jsonResponse(res, 200, { ok: false, error: String(e) });
    }
    return;
  }

  // Finance summary for companion
  if (path === '/sync/mac/reminders' && req.method === 'GET') {
    const rows = dbGet<Record<string,unknown>>(
      "SELECT * FROM reminders WHERE done=0 ORDER BY due_at ASC LIMIT 20"
    );
    jsonResponse(res, 200, { reminders: rows });
    return;
  }

  if (path === '/sync/mac/tasks' && req.method === 'GET') {
    const rows = dbGet<Record<string,unknown>>(
      "SELECT id,title,notes,priority,status,due_at,created_at FROM personal_tasks WHERE status!='done' ORDER BY created_at DESC LIMIT 30"
    );
    jsonResponse(res, 200, { tasks: rows });
    return;
  }

  if (path === '/sync/mac/tasks/create' && req.method === 'POST') {
    const body = await readBody<Record<string,unknown>>(req);
    const data: Record<string,unknown> = body || {};
    const id = String(data.id || crypto.randomUUID());
    const title = String(data.title || '').trim();
    if (!title) { jsonResponse(res, 400, { error: 'title required' }); return; }
    dbRun(
      "INSERT INTO personal_tasks (id,title,notes,priority,status,due_at,created_at) VALUES (?,?,?,?,?,?,?)",
      id, title, String(data.notes || ''), Number(data.priority) || 2, 'todo',
      data.due_at ? String(data.due_at) : null, new Date().toISOString()
    );
    jsonResponse(res, 200, { id, title });
    return;
  }

  if (path === '/sync/mac/tasks/complete' && req.method === 'POST') {
    const body = await readBody<Record<string,unknown>>(req);
    const data: Record<string,unknown> = body || {};
    const id = String(data.id || '');
    if (!id) { jsonResponse(res, 400, { error: 'id required' }); return; }
    dbRun("UPDATE personal_tasks SET status='done',completed_at=? WHERE id=?", new Date().toISOString(), id);
    jsonResponse(res, 200, { ok: true });
    return;
  }

  if (path === '/sync/mac/goals' && req.method === 'GET') {
    const rows = dbGet<Record<string,unknown>>(
      "SELECT id,title,status,priority_score,summary FROM goals WHERE status='active' ORDER BY priority_score DESC LIMIT 10"
    );
    jsonResponse(res, 200, { goals: rows });
    return;
  }

  if (path === '/sync/mac/goals' && req.method === 'POST') {
    const body = await readBody<{action:string;id:string;updates:Record<string,unknown>}>(req);
    if (!body || !body.id) { jsonResponse(res, 400, { error: 'id required' }); return; }
    try {
      if (body.action === 'update' && body.updates) {
        const sets = Object.entries(body.updates).map(([k]) => `${k}=?`).join(', ');
        const vals = [...Object.values(body.updates), body.id];
        dbRun(`UPDATE goals SET ${sets}, updated_at=datetime('now') WHERE id=?`, ...vals);
      }
      jsonResponse(res, 200, { ok: true });
    } catch (e) { jsonResponse(res, 500, { error: String(e) }); }
    return;
  }

  if (path === '/sync/mac/reminders/create' && req.method === 'POST') {
    const body = await readBody<Record<string,unknown>>(req);
    const data: Record<string,unknown> = body || {};
    const title = String(data.title || '').trim();
    if (!title) { jsonResponse(res, 400, { error: 'title required' }); return; }
    const id = String(data.id || crypto.randomUUID());
    dbRun(
      "INSERT INTO reminders (id,title,notes,due_at,repeat,done,created_at,updated_at) VALUES (?,?,?,?,?,0,?,?)",
      id, title, String(data.notes || ''), data.due_at ? String(data.due_at) : null, 'none',
      new Date().toISOString(), new Date().toISOString()
    );
    jsonResponse(res, 200, { id, title });
    return;
  }

  if (path === '/sync/mac/reminders/done' && req.method === 'POST') {
    const body = await readBody<Record<string,unknown>>(req);
    const data: Record<string,unknown> = body || {};
    const id = String(data.id || '');
    if (!id) { jsonResponse(res, 400, { error: 'id required' }); return; }
    dbRun("UPDATE reminders SET done=1,updated_at=? WHERE id=?", new Date().toISOString(), id);
    jsonResponse(res, 200, { ok: true });
    return;
  }

  if (path === '/sync/mac/journal/create' && req.method === 'POST') {
    const body = await readBody<Record<string,unknown>>(req);
    const data: Record<string,unknown> = body || {};
    const content = String(data.content || '').trim();
    if (!content) { jsonResponse(res, 400, { error: 'content required' }); return; }
    const id = String(data.id || crypto.randomUUID());
    const today = new Date().toISOString().slice(0, 10);
    dbRun(
      "INSERT OR REPLACE INTO journal_entries (id,date,title,content,mood,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      id, today, String(data.title || 'From companion'), content,
      String(data.mood || ''), new Date().toISOString(), new Date().toISOString()
    );
    jsonResponse(res, 200, { id, date: today });
    return;
  }

  if (path === '/sync/mac/health' && req.method === 'GET') {
    try {
      const today = new Date().toISOString().slice(0,10);
      const logs = dbGet<{id:string;category:string;label:string;value:number;unit:string;date:string;created_at:string}>(
        "SELECT * FROM health_logs WHERE date = ? ORDER BY created_at DESC", today
      );
      const habits = dbGet<{id:string;name:string;icon:string;active:number}>(
        "SELECT * FROM habits WHERE active=1 ORDER BY created_at"
      );
      const habitLogs = dbGet<{habit_id:string;date:string;count:number}>(
        "SELECT * FROM habit_logs WHERE date=?", today
      );
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ logs, habits, habitLogs, date: today }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }


  if (path === '/sync/mac/bible' && req.method === 'GET') {
    try {
      const url = new URL('http://x' + req.url!);
      const ref = url.searchParams.get('ref') || '';
      if (!ref) { jsonResponse(res, 400, { error: 'ref required' }); return; }
      const entry = dbGetOne<{book:string;chapter:number;verse:number;text:string}>(
        `SELECT book, chapter, verse, text FROM scripture_entries
         WHERE LOWER(book || ' ' || chapter || ':' || verse) = LOWER(?) LIMIT 1`,
        ref.trim()
      );
      if (entry) {
        const label = `${entry.book} ${entry.chapter}:${entry.verse}`;
        res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
        res.end(JSON.stringify({ found: true, reference: label, text: entry.text }));
      } else {
        res.writeHead(200, {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'});
        res.end(JSON.stringify({ found: false, error: 'Bible not downloaded. Open Scripture panel in Henry and tap Download KJV.' }));
      }
    } catch (e) { jsonResponse(res, 500, { error: String(e) }); }
    return;
  }

  if (path === '/sync/mac/health/log' && req.method === 'POST') {
    const body = await readBody<Record<string,unknown>>(req);
    const data: Record<string,unknown> = body || {};
    const category = String(data.category || '').trim();
    if (!category) { jsonResponse(res, 400, { error: 'category required' }); return; }
    const id = String(data.id || crypto.randomUUID());
    const today = new Date().toISOString().slice(0, 10);
    dbRun(
      "INSERT INTO health_logs (id,category,value,note,date,created_at) VALUES (?,?,?,?,?,?)",
      id, category, data.value !== undefined ? Number(data.value) : null,
      String(data.note || ''), today, new Date().toISOString()
    );
    jsonResponse(res, 200, { ok: true, id, category, date: today });
    return;
  }

  if (path === '/sync/mac/finance' && req.method === 'GET') {
    try {
      const months = Array.from({length: 4}, (_, i) => {
        const d = new Date(); d.setMonth(d.getMonth() - i);
        return d.toISOString().slice(0, 7);
      });
      const trends = months.reverse().map(m => {
        const income = (dbGet('SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE type="income" AND strftime("%Y-%m",date)=?', m) as any[])[0]?.t || 0;
        const expenses = (dbGet('SELECT COALESCE(SUM(amount),0) as t FROM transactions WHERE type="expense" AND strftime("%Y-%m",date)=?', m) as any[])[0]?.t || 0;
        return { month: m, income, expenses, net: income - expenses };
      });
      const currentMonth = new Date().toISOString().slice(0, 7);
      const recentTxns = dbGet('SELECT * FROM transactions WHERE strftime("%Y-%m",date)=? ORDER BY date DESC LIMIT 8', currentMonth) as any[];
      jsonResponse(res, 200, { trends, recent: recentTxns });
    } catch (e) { jsonResponse(res, 500, { error: String(e) }); }
    return;
  }

  if (path === '/sync/devices' && req.method === 'GET') {
    jsonResponse(res, 200, Array.from(linkedDevices.values()));
    return;
  }

  jsonResponse(res, 404, { error: 'Unknown route' });
}

// ── Body reader ────────────────────────────────────────────────────────────

function readBody<T>(req: http.IncomingMessage, timeoutMs = 30_000): Promise<T | null> {
  return new Promise((resolve) => {
    // If a previous handler already consumed the body and stashed it on the
    // request, use that instead of re-reading the (already-drained) stream.
    const cached = (req as unknown as { _rawBody?: string })._rawBody;
    if (typeof cached === 'string') {
      try {
        if (!cached.trim()) { resolve(null); return; }
        resolve(JSON.parse(cached) as T);
      } catch { resolve(null); }
      return;
    }

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

    let totalSize = 0;
    const MAX_BODY = 50 * 1024; // 50KB limit
    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY) {
        req.destroy(new Error('Request body too large'));
        done(null);
        return;
      }
      chunks.push(chunk);
    });
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

// ── Rate limiter (module-level, persists across requests) ──────────────────────
const _rateCounts = new Map<string, {count:number; resetAt:number}>();
function checkRate(ip: string): boolean {
  const now = Date.now();
  const entry = _rateCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    _rateCounts.set(ip, { count: 1, resetAt: now + 60000 });
    return true;
  }
  if (entry.count >= 120) return false; // 120 req/min max per IP
  entry.count++;
  return true;
}

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
