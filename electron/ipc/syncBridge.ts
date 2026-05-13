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
    const knowledgeAnswer = (() => {
      if (/^(what can you do|help|give me a tour|show me what you can do|overview|what do you do)/.test(lowerText)) {
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
      if (/^(what (keyboard )?shortcuts|hotkey|how do i open henry|⌥.?space)/.test(lowerText)) {
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

    // ── Action commands — execute directly, no AI needed ────────────────────────

    // "add a task: X" / "create a task: X" / "new task: X"
    const addTaskMatch = lowerText.match(/^(?:add|create|new) (?:a )?task[:\s]+(.+)/i)
                      || lowerText.match(/^task[:\s]+(.+)/i);
    if (addTaskMatch) {
      const title = resolvedText.replace(/^(?:add|create|new) (?:a )?task[:\s]+/i,'').replace(/^task[:\s]+/i,'').trim();
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
    const remindMatch = lowerText.match(/^remind(?:er)?(?: me)? (?:to |about )?(.+)/i);
    if (remindMatch) {
      const rawTitle = resolvedText.replace(/^remind(?:er)?(?: me)? (?:to |about )?/i,'').trim();
      // Try to extract a time/date from the text
      const timeMatch = rawTitle.match(/(?:at |on )?(tomorrow|today|\d{1,2}(?::\d{2})?\s*(?:am|pm)|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i);
      const title = rawTitle.replace(/\s*(?:at|on)\s+.+$/i,'').trim() || rawTitle;
      const due_at = (() => {
        if (!timeMatch) return null;
        const t = timeMatch[1].toLowerCase();
        const d = new Date();
        if (t === 'tomorrow') { d.setDate(d.getDate()+1); d.setHours(9,0,0,0); }
        else if (t === 'today') { d.setHours(17,0,0,0); }
        else {
          const days: Record<string,number> = {monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6,sunday:0};
          if (days[t] !== undefined) {
            const target = days[t];
            const today = d.getDay();
            const diff = (target - today + 7) % 7 || 7;
            d.setDate(d.getDate() + diff); d.setHours(9,0,0,0);
          }
        }
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
    const listTasksMatch = /^(?:what|show|list|get)(?: tasks?| my tasks?| open tasks?| todo(?:s)?)/.test(lowerText)
                        || lowerText === 'tasks' || lowerText === 'my tasks';
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
    const listRemsMatch = /^(?:what|show|list|get)(?: reminders?| my reminders?| due(?:\s+today)?)/.test(lowerText)
                       || lowerText === 'reminders';
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
        sendReply(cmdResult);
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
        sendReply('No Groq API key set.');
        return;
      }

      const history = body.history || [];

      // ── Build a warm, human system prompt with persistent memory ──────────
      // Pull recent facts from memory_facts so Henry recalls past conversations.
      let factsBlock = '';
      let userName = '';
      try {
        const facts = dbGet<{ fact: string; importance: number }>(
          'SELECT fact, importance FROM memory_facts ORDER BY importance DESC, created_at DESC LIMIT 25'
        ) as { fact: string; importance: number }[];
        if (facts && facts.length) {
          factsBlock = facts.map(f => '- ' + f.fact).join('\n');
          // Pull a name out of the facts if we have one
          for (const f of facts) {
            const m = f.fact.match(/^User name:\s*(.+)$/i);
            if (m) { userName = m[1].trim(); break; }
          }
        }
      } catch { /* memory_facts table may not exist on first run */ }

      // Pull recent conversation summaries from the SAME paired-device state
      // so Henry has context across separate /sync/prompt sessions, not just
      // within a single phone session.
      let recentSummary = '';
      try {
        const recentMsgs = dbGet<{ role: string; content: string }>(
          "SELECT role, content FROM messages WHERE role IN ('user','assistant') ORDER BY created_at DESC LIMIT 8"
        ) as { role: string; content: string }[];
        if (recentMsgs && recentMsgs.length) {
          recentSummary = recentMsgs.reverse()
            .map(m => (m.role === 'user' ? 'You earlier' : 'Henry earlier') + ': ' + (m.content || '').slice(0, 200))
            .join('\n');
        }
      } catch { /* */ }

      const greeting = userName ? `You are Henry, talking with ${userName}.` : `You are Henry.`;
      const systemPrompt = [
        greeting,
        "Henry is a warm, thoughtful, conversational AI — the user's personal companion who runs on their Mac and is reachable from their phone. Down-to-earth, curious, and genuinely interested in the person you're talking with. Like a smart friend, not a help desk.",
        "",
        "── ABSOLUTE RULES ──────────────────────────────────────────────",
        "1. NEVER invent facts about the user, their work, projects, clients, products, social media, or anything personal. If they didn't tell you, you don't know.",
        "2. The ONLY things you actually know about this user are listed in 'What you remember' below. If a fact isn't there and isn't in this conversation, you DON'T know it. Don't guess. Don't elaborate. Don't fabricate examples.",
        "3. If you don't know something, say so plainly: 'I don't know yet — tell me about it' or 'You haven't mentioned that to me'. This is the right answer most of the time.",
        "4. NEVER say things like 'I've noticed you've been working on...', 'I've seen your...', 'You've got some great work on Instagram', etc. unless those specific facts appear verbatim in 'What you remember' below.",
        "5. NEVER claim to access apps, accounts, social media, websites, files, or anything outside what the user just typed unless you actually used a tool in this turn that returned that data.",
        "6. When the user asks for advice, give general advice based on what they just told you. Don't pretend to have done research on their specific situation when you haven't.",
        "",
        "── HOW YOU TALK ────────────────────────────────────────────────",
        "• Like a real person. Use contractions. Vary sentence length. Sometimes one line is right; sometimes a paragraph is.",
        "• Match their energy. Casual when they're casual, focused when they're focused, gentle when they're upset.",
        "• Brief but never curt. Three thoughtful sentences beats one blunt one.",
        "• Ask one good follow-up question only when it actually helps. Don't pepper them.",
        "• Use facts from 'What you remember' naturally when they're directly relevant — don't force-fit them, don't announce them.",
        "",
        "── WHAT YOU CAN ACTUALLY DO ON THIS MAC ───────────────────────",
        "You ARE connected to this Mac. When the user asks for any of these, just say yes and tell them you're doing it — the bridge will execute it automatically:",
        "• Take a screenshot — say 'Taking a screenshot now.'",
        "• Create a folder on Desktop / Documents / Downloads — say 'Creating that folder for you.' (use words like 'create folder named X on my desktop')",
        "• Open an app (Safari, Mail, Calendar, Notes, etc.) — say 'Opening X.'",
        "• Open a URL or website — say 'Opening that link.'",
        "• Check disk space / storage — say 'Let me check.'",
        "• List files on Desktop / Documents / Downloads — say 'Here's what's on your desktop.'",
        "• List running apps — say 'Here are the apps running.'",
        "• Look up Bible verses — say 'Here it is.'",
        "",
        "What you CANNOT do: browse arbitrary websites, read email/messages, post to social media, see Instagram, search Google, access bank accounts, access any cloud service, or read documents you weren't shown. If asked, say so plainly and offer something you CAN do.",
        "",
        "When the user asks you to do one of the things you CAN do, do NOT refuse, do NOT say 'I can't access your computer', do NOT explain that you're a language model. Just confirm in one short friendly line and the system will execute. Example user requests that you SHOULD accept enthusiastically: 'take a screenshot', 'open Safari', 'make a folder called Project X on my desktop', 'show me my desktop files', 'how much disk space do I have', 'what apps are running'.",
        "",
        factsBlock
          ? `── WHAT YOU REMEMBER ABOUT ${userName ? userName.toUpperCase() : 'THIS USER'} ──\nThese are the ONLY facts you know about them. Anything not on this list you do NOT know.\n${factsBlock}`
          : `── WHAT YOU REMEMBER ──\nNothing yet — this is an early conversation. Don't make things up; ask them about themselves naturally if relevant.`,

        // Live context — real data from their Mac right now
        (() => {
          const lines: string[] = ['── LIVE CONTEXT (from their Mac right now) ──'];
          // Always inject current date/time
          const now = new Date();
          const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()];
          const monthName = ['January','February','March','April','May','June','July','August','September','October','November','December'][now.getMonth()];
          lines.push(`Today is ${dayName}, ${monthName} ${now.getDate()}, ${now.getFullYear()}. Current time: ${now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}.`);
          try {
            const today = new Date().toISOString().slice(0, 10);
            const tasks = dbGet<{title:string;priority:number}>(
              "SELECT title, priority FROM personal_tasks WHERE status='todo' ORDER BY priority DESC, created_at DESC LIMIT 5"
            ) as {title:string;priority:number}[];
            if (tasks.length) lines.push('Open tasks: ' + tasks.map(t => t.title).join(', '));
            
            const habits = dbGet<{name:string}>(
              "SELECT h.name FROM habits h WHERE h.active=1 AND h.id NOT IN (SELECT habit_id FROM habit_logs WHERE date=?) ORDER BY h.created_at LIMIT 5",
              today
            ) as {name:string}[];
            if (habits.length) lines.push('Habits not yet done today: ' + habits.map((h: any) => h.name).join(', '));
            const doneHabits = dbGet<{name:string}>(
              "SELECT h.name FROM habits h WHERE h.active=1 AND h.id IN (SELECT habit_id FROM habit_logs WHERE date=?)",
              today
            ) as {name:string}[];
            if (doneHabits.length) lines.push('Habits completed today: ' + doneHabits.map((h: any) => h.name).join(', '));
            
            const goals = dbGet<{title:string;target_date:string}>(
              "SELECT title, target_date FROM goals WHERE status='active' ORDER BY priority_score DESC LIMIT 3"
            ) as {title:string;target_date:string}[];
            if (goals.length) lines.push('Active goals: ' + goals.map(g => g.title + (g.target_date ? ' (due '+g.target_date+')' : '')).join(', '));
            
            const rems = dbGet<{title:string;due_at:string}>(
              "SELECT title, due_at FROM reminders WHERE done=0 AND due_at <= datetime('now','+24 hours') ORDER BY due_at LIMIT 3"
            ) as {title:string;due_at:string}[];
            if (rems.length) lines.push('Due reminders: ' + rems.map(r => r.title).join(', '));
          } catch { /* best effort */ }
          return lines.length > 1 ? lines.join('\n') : null;
        })(),
      ].filter(Boolean).join('\n');

      const messages = [
        { role: 'system', content: systemPrompt },
        ...history.slice(-16),
        { role: 'user', content: userText }
      ];

      // Stream from Groq
      const { default: https } = await import('https');
      const postBody = JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 1500, stream: true });
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
                // Track AI response for intent resolution
                deviceContext.set(deviceId, { ...deviceContext.get(deviceId), lastAiResponse: fullText });

                // Extract and save any facts from this exchange
                try {
                  extractAndSaveFacts(body.text || '', fullText);
                } catch { /* non-critical */ }
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
                sendReply(cleanText);
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

          sendReply(finalText);
        });
      });
      req2.on('error', (e: Error) => {
        sendReply('Error: ' + e.message);
      });
      req2.write(postBody);
      req2.end();
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
