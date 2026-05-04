/**
 * Henry Companion — iPad-optimized mobile web app
 * Served at http://HENRY-IP:4242/
 * 
 * Features:
 *   📱 Phone: full-screen chat + voice + quick actions
 *   🖥️ iPad: split layout — chat + control panel side by side
 *   5 tabs: Chat · Screen · Control · Notes · Capture
 *   Live Mac screen with auto-refresh
 *   System control (open apps, run commands, volume, etc.)
 *   Quick capture → Henry processes on Mac
 *   Voice input with auto-send
 *   Add to Home Screen support
 */
export function buildCompanionHtml(macName: string, tunnelUrl?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Henry">
<link rel="apple-touch-icon" href="/icons/icon128.png">
<title>Henry</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;-webkit-font-smoothing:antialiased}
:root{
  --bg:#08080e;--surface:#0e0e18;--surface2:#13131f;--surface3:#181827;
  --border:rgba(255,255,255,0.07);--accent:#7c3aed;--accent2:#6d28d9;
  --text:#e8e8f0;--muted:#6b6b8a;--green:#22c55e;--red:#ef4444;--blue:#3b82f6;
  --sidebar-w:64px;--safe-top:env(safe-area-inset-top,0px);
  --safe-bottom:env(safe-area-inset-bottom,0px);
  --safe-left:env(safe-area-inset-left,0px);
  --safe-right:env(safe-area-inset-right,0px);
}
html,body{height:100%;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif;overflow:hidden;position:fixed;width:100%;user-select:none;-webkit-user-select:none}

/* ── LAYOUT ─────────────────────────────────────────── */
#app{display:flex;height:100%;flex-direction:column}
#main{display:flex;flex:1;overflow:hidden}

/* Sidebar nav (iPad: vertical left; Phone: horizontal bottom) */
#sidenav{
  display:flex;flex-direction:column;align-items:center;
  background:var(--surface);border-right:1px solid var(--border);
  width:var(--sidebar-w);flex-shrink:0;gap:2px;
  padding-top:max(var(--safe-top),16px);
  padding-bottom:max(var(--safe-bottom),12px);
}
.nav-btn{
  width:48px;height:48px;border-radius:14px;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:3px;background:none;border:none;cursor:pointer;
  color:var(--muted);font-size:10px;transition:all .15s;
  -webkit-tap-highlight-color:transparent;
}
.nav-btn:active,.nav-btn.active{background:rgba(124,58,237,0.15);color:var(--accent)}
.nav-btn .ico{font-size:22px;line-height:1}
.nav-btn .lbl{font-size:9px;font-weight:600;letter-spacing:.02em;text-transform:uppercase}
#nav-spacer{flex:1}
#mac-dot{width:8px;height:8px;border-radius:50%;background:var(--muted);transition:background .3s;margin:8px 0}
#mac-dot.on{background:var(--green);box-shadow:0 0 8px rgba(34,197,94,.4)}

/* Content area */
#content{flex:1;display:flex;overflow:hidden;position:relative}

/* ── PANES ───────────────────────────────────────────── */
.pane{display:none;flex-direction:column;flex:1;overflow:hidden}
.pane.active{display:flex}

/* Topbar */
#topbar{
  padding:max(var(--safe-top),12px) 16px 10px;
  background:var(--surface);border-bottom:1px solid var(--border);
  display:flex;align-items:center;gap:8px;flex-shrink:0;min-height:44px;
}
.bar-title{font-size:16px;font-weight:700;flex:1;letter-spacing:-.3px}
.bar-badge{font-size:11px;color:var(--muted);background:var(--surface2);
  border:1px solid var(--border);border-radius:6px;padding:2px 8px}

/* ── CHAT PANE ─────────────────────────────────────── */
#msgs{
  flex:1;overflow-y:auto;padding:8px 4px 4px;
  display:flex;flex-direction:column;gap:2px;
  -webkit-overflow-scrolling:touch;
}
.row{display:flex;padding:2px 12px}
.row.user{justify-content:flex-end}
.row.ai{justify-content:flex-start}
.bubble{
  max-width:82%;padding:9px 14px;
  font-size:15px;line-height:1.5;word-break:break-word;white-space:pre-wrap;
  border-radius:20px;
}
.bubble.user{background:var(--accent);color:#fff;border-bottom-right-radius:5px}
.bubble.ai{
  background:var(--surface2);color:var(--text);
  border:1px solid var(--border);border-bottom-left-radius:5px;
}
.bubble img{max-width:100%;border-radius:10px;margin-top:6px;display:block}
.typing{display:inline-flex;gap:4px;padding:10px 14px;background:var(--surface2);
  border:1px solid var(--border);border-radius:20px;border-bottom-left-radius:5px;margin:2px 12px}
.typing span{width:6px;height:6px;background:var(--muted);border-radius:50%;animation:blink 1.2s infinite}
.typing span:nth-child(2){animation-delay:.2s}.typing span:nth-child(3){animation-delay:.4s}
@keyframes blink{0%,80%,100%{opacity:.2}40%{opacity:1}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
@keyframes spin{to{transform:rotate(360deg)}}

/* Quick actions */
#quick{
  display:flex;gap:6px;overflow-x:auto;padding:6px 12px;
  flex-shrink:0;scrollbar-width:none;
}
#quick::-webkit-scrollbar{display:none}
.q{
  background:var(--surface2);border:1px solid var(--border);
  border-radius:20px;padding:6px 14px;font-size:13px;color:var(--text);
  cursor:pointer;white-space:nowrap;flex-shrink:0;font-weight:500;
}
.q:active{background:var(--accent);border-color:var(--accent);color:#fff}

/* Chat input */
#inputbar{
  padding:8px 12px;
  padding-bottom:max(var(--safe-bottom),8px);
  background:var(--surface);border-top:1px solid var(--border);
  display:flex;align-items:flex-end;gap:8px;flex-shrink:0;
}
#mic{
  width:40px;height:40px;border-radius:50%;
  background:var(--surface2);border:1px solid var(--border);
  display:flex;align-items:center;justify-content:center;
  cursor:pointer;flex-shrink:0;transition:all .2s;font-size:18px;
}
#mic.listening{background:var(--red);border-color:var(--red);animation:pulse .8s infinite}
#inp{
  flex:1;background:var(--surface2);border:1px solid var(--border);
  border-radius:22px;padding:10px 16px;font-size:16px;
  color:var(--text);outline:none;resize:none;
  max-height:120px;font-family:inherit;line-height:1.4;
  -webkit-text-fill-color:var(--text);
}
#inp::placeholder{color:var(--muted)}
#inp:focus{border-color:rgba(124,58,237,0.4)}
#send{
  width:40px;height:40px;border-radius:50%;background:var(--accent);
  border:none;display:flex;align-items:center;justify-content:center;
  cursor:pointer;flex-shrink:0;font-size:18px;
  opacity:.4;transition:opacity .2s;
}
#send.ready{opacity:1}

/* ── SCREEN PANE ────────────────────────────────────── */
#screen-wrap{flex:1;overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:8px;background:#000}
#screen-img{max-width:100%;border-radius:8px;cursor:zoom-in}
#screen-controls{display:flex;align-items:center;gap:10px;padding:8px 14px;
  background:var(--surface);border-top:1px solid var(--border);flex-shrink:0}
#screen-controls label{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted);cursor:pointer}

/* ── CONTROL PANE ───────────────────────────────────── */
.ctrl-section{padding:12px 14px 6px;font-size:10px;font-weight:700;
  text-transform:uppercase;letter-spacing:.1em;color:var(--muted)}
.ctrl-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));
  gap:8px;padding:0 12px 12px}
.ctrl-btn{
  background:var(--surface2);border:1px solid var(--border);
  border-radius:14px;padding:14px 12px;
  display:flex;flex-direction:column;align-items:flex-start;gap:6px;
  cursor:pointer;transition:all .15s;
}
.ctrl-btn:active{background:rgba(124,58,237,.15);border-color:rgba(124,58,237,.4)}
.ctrl-btn .ico{font-size:24px}
.ctrl-btn .lbl{font-size:13px;font-weight:600;color:var(--text)}
.ctrl-btn .desc{font-size:11px;color:var(--muted)}
.ctrl-row{display:flex;align-items:center;justify-content:space-between;
  padding:10px 14px;border-bottom:1px solid var(--border)}
.ctrl-row label{font-size:14px;color:var(--text)}
.ctrl-row input[type=range]{flex:1;margin:0 12px;accent-color:var(--accent)}

/* ── NOTES / CAPTURE PANE ───────────────────────────── */
#notes-area{
  flex:1;background:transparent;border:none;outline:none;resize:none;
  color:var(--text);font-size:16px;line-height:1.7;padding:16px;
  font-family:inherit;-webkit-text-fill-color:var(--text);
}
#notes-area::placeholder{color:var(--muted)}
.notes-bar{padding:8px 12px;padding-bottom:max(var(--safe-bottom),8px);
  background:var(--surface);border-top:1px solid var(--border);
  display:flex;gap:8px;flex-shrink:0}
.notes-btn{flex:1;padding:10px;border-radius:12px;border:none;font-size:14px;
  font-weight:600;cursor:pointer;transition:all .15s}
.notes-btn.primary{background:var(--accent);color:#fff}
.notes-btn.secondary{background:var(--surface2);border:1px solid var(--border);color:var(--text)}

/* ── PAIR SCREEN ────────────────────────────────────── */
#pair-screen{
  position:fixed;inset:0;background:var(--bg);
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:20px;padding:40px 32px;text-align:center;z-index:100;
}
.pair-logo{font-size:56px;line-height:1}
.pair-title{font-size:32px;font-weight:900;letter-spacing:-.5px}
.pair-sub{color:var(--muted);font-size:16px;line-height:1.5;max-width:280px}
#pair-spinner{width:28px;height:28px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto}
#pair-err{color:var(--red);font-size:13px;max-width:300px;line-height:1.4}
#pair-btn{
  background:var(--accent);color:#fff;border:none;border-radius:16px;
  padding:16px 32px;font-size:16px;font-weight:700;cursor:pointer;
  width:100%;max-width:300px;display:none;
}

/* ── iPad split layout ───────────────────────────────── */
@media (min-width: 768px) {
  #sidenav{
    width:80px;
  }
  .nav-btn{width:56px;height:56px;border-radius:16px}
  .nav-btn .ico{font-size:24px}
  .nav-btn .lbl{font-size:10px}
  
  /* iPad: show chat + secondary pane side by side */
  #content{flex-direction:row}
  
  /* On iPad, the chat pane takes left 40% by default */
  #pane-chat{
    width:40%;
    border-right:1px solid var(--border);
    max-width:480px;
  }
  
  /* Secondary pane takes remaining space */
  #pane-screen,#pane-control,#pane-notes,#pane-capture{
    flex:1;
  }
  
  /* On iPad: always show chat + keep secondary visible */
  #pane-chat{display:flex!important}
  
  .bubble{max-width:88%}
  
  #topbar{padding-top:max(var(--safe-top),16px)}
  .bar-title{font-size:17px}
}

@media (min-width: 1024px) {
  #pane-chat{width:380px;min-width:380px}
}
</style>
</head>
<body>
<div id="app">

<!-- PAIR / CONNECTING SCREEN -->
<div id="pair-screen">
  <div class="pair-logo">◉</div>
  <div class="pair-title">Henry</div>
  <div class="pair-sub" id="pair-sub">Connecting to <strong>${macName}</strong>…</div>
  <div id="pair-spinner"></div>
  <div id="pair-err"></div>
  <button id="pair-btn" onclick="autoPair()">Try Again</button>
</div>

<!-- MAIN APP (shown after pair) -->
<div id="main" style="display:none">
  
  <!-- LEFT/BOTTOM SIDEBAR NAV -->
  <nav id="sidenav">
    <button class="nav-btn active" onclick="show('chat')" id="nav-chat">
      <span class="ico">◉</span><span class="lbl">Chat</span>
    </button>
    <button class="nav-btn" onclick="show('screen')" id="nav-screen">
      <span class="ico">📺</span><span class="lbl">Screen</span>
    </button>
    <button class="nav-btn" onclick="show('control')" id="nav-control">
      <span class="ico">⌘</span><span class="lbl">Control</span>
    </button>
    <button class="nav-btn" onclick="show('notes')" id="nav-notes">
      <span class="ico">✦</span><span class="lbl">Notes</span>
    </button>
    <button class="nav-btn" onclick="show('capture')" id="nav-capture">
      <span class="ico">⊕</span><span class="lbl">Capture</span>
    </button>
    <div id="nav-spacer"></div>
    <div id="mac-dot" title="Henry connection"></div>
  </nav>

  <!-- CONTENT -->
  <div id="content">

    <!-- ── CHAT PANE ─────────────────────────────────── -->
    <div class="pane active" id="pane-chat">
      <div id="topbar">
        <span class="bar-title">Henry</span>
        <span class="bar-badge" id="topbar-status">Connecting…</span>
      </div>
      <div id="msgs"></div>
      <div id="quick">
        <button class="q" onclick="q('open Finder')">📁 Finder</button>
        <button class="q" onclick="q('take a screenshot and show me')">📸 Screenshot</button>
        <button class="q" onclick="q('what apps are running')">📱 Apps</button>
        <button class="q" onclick="q('check disk space')">💾 Disk</button>
        <button class="q" onclick="q('open Safari')">🌐 Safari</button>
        <button class="q" onclick="q('open Chrome')">🔵 Chrome</button>
        <button class="q" onclick="q('open Terminal')">⌨️ Terminal</button>
        <button class="q" onclick="q('open VS Code')">💻 Code</button>
        <button class="q" onclick="q('mute the mac')">🔇 Mute</button>
        <button class="q" onclick="q('lock the screen')">🔒 Lock</button>
      </div>
      <div id="inputbar">
        <button id="mic" onclick="toggleMic()">🎤</button>
        <textarea id="inp" placeholder="Ask Henry anything…" rows="1" 
          oninput="onInput(this)" onkeydown="onKey(event)"></textarea>
        <button id="send" onclick="sendMsg()">➤</button>
      </div>
    </div>

    <!-- ── SCREEN PANE ────────────────────────────────── -->
    <div class="pane" id="pane-screen">
      <div id="topbar" style="position:static">
        <span class="bar-title">Mac Screen</span>
        <button class="bar-badge" onclick="refreshScreen()" style="cursor:pointer;border:none;background:none;color:var(--muted);font-size:11px">↺ Refresh</button>
      </div>
      <div id="screen-wrap">
        <img id="screen-img" alt="Tap Refresh to capture Mac screen" onclick="refreshScreen()">
      </div>
      <div id="screen-controls">
        <label>
          <input type="checkbox" id="auto-cb" onchange="toggleAuto(this.checked)">
          Auto-refresh (3s)
        </label>
        <button class="bar-badge" onclick="refreshScreen()" style="cursor:pointer;border:none;background:var(--surface2);color:var(--text);padding:6px 12px;border-radius:8px;font-size:12px">Refresh Now</button>
      </div>
    </div>

    <!-- ── CONTROL PANE ───────────────────────────────── -->
    <div class="pane" id="pane-control" style="overflow-y:auto">
      <div id="topbar" style="position:static">
        <span class="bar-title">Mac Control</span>
        <span class="bar-badge">HQ</span>
      </div>
      
      <div class="ctrl-section">Volume</div>
      <div class="ctrl-row">
        <label>🔊 Volume</label>
        <input type="range" id="vol-slider" min="0" max="100" value="50"
          oninput="setVolume(this.value)">
        <span id="vol-val" style="font-size:12px;color:var(--muted);width:30px;text-align:right">50</span>
      </div>
      
      <div class="ctrl-section">Quick Launch</div>
      <div class="ctrl-grid">
        ${[
          ['📁','Finder','Files','open Finder'],
          ['🌐','Safari','Browser','open Safari'],
          ['🔵','Chrome','Browser','open "Google Chrome"'],
          ['📧','Mail','Email','open Mail'],
          ['📅','Calendar','Schedule','open Calendar'],
          ['📝','Notes','Notes','open Notes'],
          ['💻','VS Code','Code editor','open "Visual Studio Code"'],
          ['⌨️','Terminal','Command line','open Terminal'],
          ['🎵','Music','Play music','open Music'],
          ['⚙️','Settings','System prefs','open "System Preferences"'],
        ].map(([ico,lbl,desc,cmd]) => `
        <button class="ctrl-btn" onclick="run('open -a ${cmd}')">
          <span class="ico">${ico}</span>
          <span class="lbl">${lbl}</span>
          <span class="desc">${desc}</span>
        </button>`).join('')}
      </div>
      
      <div class="ctrl-section">Actions</div>
      <div class="ctrl-grid">
        ${[
          ['🔒','Lock Screen','lock the mac now'],
          ['😴','Sleep','put the mac to sleep'],
          ['📸','Screenshot','take a screenshot'],
          ['🔇','Mute','mute the mac audio'],
          ['🔊','Unmute','unmute the mac audio'],
          ['🧹','Empty Trash','empty the trash'],
          ['📋','Clipboard','what is in my clipboard'],
          ['📡','My IP','what is my IP address'],
        ].map(([ico,lbl,cmd]) => `
        <button class="ctrl-btn" onclick="q('${cmd}')">
          <span class="ico">${ico}</span>
          <span class="lbl">${lbl}</span>
        </button>`).join('')}
      </div>

      <div class="ctrl-section">Run a Command</div>
      <div style="padding:0 12px 16px;display:flex;gap:8px">
        <input id="cmd-inp" placeholder="Any shell command…"
          style="flex:1;background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:10px 14px;font-size:14px;color:var(--text);outline:none;font-family:monospace;-webkit-text-fill-color:var(--text)"
          onkeydown="if(event.key==='Enter')runCmd()">
        <button onclick="runCmd()" 
          style="background:var(--accent);color:#fff;border:none;border-radius:12px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer">Run</button>
      </div>
    </div>

    <!-- ── NOTES PANE ─────────────────────────────────── -->
    <div class="pane" id="pane-notes">
      <div id="topbar" style="position:static">
        <span class="bar-title">Quick Note</span>
        <span class="bar-badge" id="notes-status">Unsaved</span>
      </div>
      <textarea id="notes-area" placeholder="Type a note… Henry will save it to your Journal or Captures on your Mac."></textarea>
      <div class="notes-bar">
        <button class="notes-btn secondary" onclick="clearNote()">Clear</button>
        <button class="notes-btn primary" onclick="saveNote('journal')">📔 Journal</button>
        <button class="notes-btn primary" onclick="saveNote('capture')">⊕ Capture</button>
      </div>
    </div>

    <!-- ── CAPTURE PANE ───────────────────────────────── -->
    <div class="pane" id="pane-capture">
      <div id="topbar" style="position:static">
        <span class="bar-title">Capture</span>
        <span class="bar-badge">→ Henry</span>
      </div>
      <div style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:12px">
        <p style="font-size:14px;color:var(--muted);line-height:1.5">
          Paste or type anything — Henry extracts ideas, tasks, and insights automatically.
        </p>
        <textarea id="cap-area" placeholder="Paste an article, a quote, a link, notes from a meeting, anything…"
          style="flex:1;min-height:200px;background:var(--surface2);border:1px solid var(--border);border-radius:16px;padding:14px;font-size:15px;color:var(--text);font-family:inherit;outline:none;resize:none;line-height:1.6;-webkit-text-fill-color:var(--text)"></textarea>
        
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <button onclick="capture('note')"
            style="padding:12px;background:var(--surface2);border:1px solid var(--border);border-radius:14px;color:var(--text);font-size:14px;font-weight:600;cursor:pointer">
            📝 Save as Note
          </button>
          <button onclick="capture('auto')"
            style="padding:12px;background:var(--accent);border:none;border-radius:14px;color:#fff;font-size:14px;font-weight:600;cursor:pointer">
            ⚡ Process with AI
          </button>
        </div>
        <div id="cap-feedback" style="display:none;padding:12px;border-radius:12px;font-size:13px;text-align:center"></div>
      </div>
    </div>

  </div><!-- /content -->
</div><!-- /main -->
</body>
<script>
// ── State ──────────────────────────────────────────────────────────────────
const S = {
  token: localStorage.getItem('henry_token') || '',
  uuid:  localStorage.getItem('henry_uuid')  || '',
  hmac:  localStorage.getItem('henry_hmac')  || '',
  secret:localStorage.getItem('henry_secret')|| '',
  history: [],
  es: null,
  autoTimer: null,
  streaming: null,
  streamText: '',
  activePane: 'chat',
  volume: 50,
};

// ── DOM helpers ────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const pairScreen = $('pair-screen');
const mainEl = $('main');
const msgs = $('msgs');
const inp = $('inp');
const sendBtn = $('send');
const dot = $('mac-dot');
const status = $('topbar-status');

// ── Pane switching ─────────────────────────────────────────────────────────
function show(pane) {
  // On phone: toggle single pane. On iPad: secondary pane only (chat always shown)
  const isIpad = window.innerWidth >= 768;
  
  document.querySelectorAll('.pane').forEach(el => {
    if (isIpad && el.id === 'pane-chat') return; // always visible on iPad
    el.classList.remove('active');
  });
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
  
  $('pane-' + pane).classList.add('active');
  $('nav-' + pane)?.classList.add('active');
  S.activePane = pane;
  
  if (pane === 'screen') refreshScreen();
}

// ── Connection ────────────────────────────────────────────────────────────
async function autoPair() {
  $('pair-spinner').style.display = 'block';
  $('pair-btn').style.display = 'none';
  $('pair-err').textContent = '';
  
  const ua = navigator.userAgent;
  const isIpad = ua.includes('iPad') || (ua.includes('Mac') && navigator.maxTouchPoints > 1);
  const isIphone = ua.includes('iPhone');
  
  try {
    const r = await fetch('/sync/auto-pair', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        deviceName: isIpad ? 'iPad' : isIphone ? 'iPhone' : 'Browser',
        platform: (isIphone || isIpad) ? 'ios' : 'android',
        capabilities: ['chat','prompt','notify','capture'],
      })
    });
    const d = await r.json();
    if (d.companionToken) {
      S.token = d.companionToken;
      S.uuid = d.deviceId || '';
      localStorage.setItem('henry_token', S.token);
      localStorage.setItem('henry_uuid', S.uuid);
      goToApp();
    } else {
      throw new Error(d.error || 'Could not connect');
    }
  } catch(e) {
    $('pair-spinner').style.display = 'none';
    $('pair-btn').style.display = 'block';
    $('pair-err').textContent = e.message + '. Make sure Henry is open on your Mac.';
  }
}

function goToApp() {
  pairScreen.style.display = 'none';
  mainEl.style.display = 'flex';
  startSSE();
  addMsg('ai', 'Hi! I\\'m Henry — connected to ${macName}. What do you need?');
}

function startSSE() {
  if (S.es) S.es.close();
  status.textContent = 'Connecting…';
  S.es = new EventSource('/sync/stream?token=' + S.token);
  S.es.onopen = () => { dot.className = 'on'; status.textContent = 'Ready'; };
  S.es.onerror = () => {
    dot.className = '';
    status.textContent = 'Reconnecting…';
    setTimeout(startSSE, 3000);
  };
  S.es.onmessage = (e) => {
    try {
      const d = JSON.parse(e.data);
      if (d.type === 'companion_chunk') appendChunk(d.payload.chunk);
      else if (d.type === 'companion_response') finalizeStream(d.payload.text);
    } catch {}
  };
}

// ── Messaging ──────────────────────────────────────────────────────────────
function addMsg(role, text) {
  removeTyping();
  const row = document.createElement('div');
  row.className = 'row ' + (role === 'user' ? 'user' : 'ai');
  const b = document.createElement('div');
  b.className = 'bubble ' + (role === 'user' ? 'user' : 'ai');
  if (text.startsWith('data:image/')) {
    const img = document.createElement('img');
    img.src = text; img.onclick = () => window.open(text);
    b.appendChild(img);
  } else {
    b.textContent = text;
  }
  row.appendChild(b);
  msgs.appendChild(row);
  msgs.scrollTop = msgs.scrollHeight;
  if (role === 'user') S.history.push({role:'user', content:text});
  else S.history.push({role:'assistant', content:text});
}

function showTyping() {
  removeTyping();
  const t = document.createElement('div');
  t.id = 'typing';
  t.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
  msgs.appendChild(t);
  msgs.scrollTop = msgs.scrollHeight;
}

function removeTyping() {
  $('typing')?.remove();
}

function appendChunk(chunk) {
  removeTyping();
  if (!S.streaming) {
    const row = document.createElement('div');
    row.className = 'row ai';
    S.streaming = document.createElement('div');
    S.streaming.className = 'bubble ai';
    row.appendChild(S.streaming);
    msgs.appendChild(row);
    S.streamText = '';
  }
  S.streamText += chunk;
  S.streaming.textContent = S.streamText;
  msgs.scrollTop = msgs.scrollHeight;
}

function finalizeStream(full) {
  if (S.streaming) {
    S.streaming.textContent = full;
    S.history.push({role:'assistant', content:full});
    S.streaming = null; S.streamText = '';
  } else if (full) {
    addMsg('ai', full);
  }
  sendBtn.disabled = false;
  msgs.scrollTop = msgs.scrollHeight;
}

async function sendMsg() {
  const text = inp.value.trim();
  if (!text || sendBtn.disabled) return;
  inp.value = ''; inp.style.height = 'auto';
  sendBtn.disabled = true; sendBtn.classList.remove('ready');
  addMsg('user', text);
  showTyping();
  try {
    const r = await fetch('/sync/prompt', {
      method: 'POST',
      headers: {'Content-Type':'application/json','Authorization':'Bearer '+S.token},
      body: JSON.stringify({text, history: S.history.slice(-12)}),
    });
    if (r.status === 401) { localStorage.clear(); await autoPair(); return; }
    if (!r.ok) { removeTyping(); addMsg('ai', 'Error. Try again.'); sendBtn.disabled = false; }
  } catch {
    removeTyping();
    addMsg('ai', 'Connection error. Check WiFi.');
    sendBtn.disabled = false;
  }
}

function q(text) { inp.value = text; sendBtn.classList.add('ready'); sendMsg(); }
function onInput(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  sendBtn.classList.toggle('ready', el.value.trim().length > 0);
}
function onKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
}

// ── Screen ─────────────────────────────────────────────────────────────────
function refreshScreen() {
  const img = $('screen-img');
  if (img) img.src = '/screen?' + Date.now();
}
function toggleAuto(on) {
  clearInterval(S.autoTimer);
  if (on) S.autoTimer = setInterval(refreshScreen, 3000);
}

// ── Control ────────────────────────────────────────────────────────────────
async function run(cmd) {
  addMsg('user', cmd.replace('open -a ', 'Open '));
  showTyping();
  sendBtn.disabled = true;
  try {
    const r = await fetch('/sync/prompt', {
      method: 'POST',
      headers: {'Content-Type':'application/json','Authorization':'Bearer '+S.token},
      body: JSON.stringify({text: cmd, history: []}),
    });
    if (!r.ok) { removeTyping(); addMsg('ai', 'Error'); sendBtn.disabled = false; }
  } catch { removeTyping(); addMsg('ai', 'Error'); sendBtn.disabled = false; }
}

function runCmd() {
  const cmd = $('cmd-inp').value.trim();
  if (!cmd) return;
  $('cmd-inp').value = '';
  show('chat');
  q('Run this command: ' + cmd);
}

function setVolume(v) {
  $('vol-val').textContent = v;
  // Send volume command (debounced)
  clearTimeout(S.volTimer);
  S.volTimer = setTimeout(() => {
    fetch('/sync/prompt', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+S.token},
      body: JSON.stringify({text: 'set mac volume to ' + v, history:[]}),
    }).catch(()=>{});
  }, 500);
}

// ── Notes ──────────────────────────────────────────────────────────────────
function clearNote() {
  $('notes-area').value = '';
  $('notes-status').textContent = 'Cleared';
}
async function saveNote(dest) {
  const text = $('notes-area').value.trim();
  if (!text) return;
  $('notes-status').textContent = 'Saving…';
  try {
    await fetch('/sync/capture', {
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+S.token},
      body: JSON.stringify({text, source:'ipad-notes', category: dest === 'journal' ? 'note' : 'note', from:'companion'}),
    });
    $('notes-status').textContent = 'Saved ✓';
    if (dest === 'journal') addMsg('ai', 'Saved to Journal on your Mac ✓');
  } catch { $('notes-status').textContent = 'Error'; }
}

// ── Capture ────────────────────────────────────────────────────────────────
async function capture(mode) {
  const text = $('cap-area').value.trim();
  if (!text) return;
  const fb = $('cap-feedback');
  fb.style.display = 'block';
  fb.style.background = 'rgba(124,58,237,0.1)';
  fb.style.border = '1px solid rgba(124,58,237,0.3)';
  fb.style.color = '#a78bfa';
  fb.textContent = mode === 'auto' ? '⚡ Sending to Henry for processing…' : '📝 Saving capture…';
  
  const endpoint = mode === 'auto' ? '/sync/capture-and-process' : '/sync/capture';
  try {
    await fetch(endpoint, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({text, source:'ipad-capture', category:'web_clip', from:'companion'}),
    });
    fb.textContent = mode === 'auto' 
      ? '✓ Henry is processing — check Captures panel on your Mac'
      : '✓ Saved to Captures on your Mac';
    fb.style.background = 'rgba(34,197,94,0.1)';
    fb.style.border = '1px solid rgba(34,197,94,0.3)';
    fb.style.color = '#4ade80';
    $('cap-area').value = '';
  } catch {
    fb.textContent = '✗ Error saving. Check connection.';
    fb.style.background = 'rgba(239,68,68,0.1)';
    fb.style.color = '#ef4444';
  }
}

// ── Voice ──────────────────────────────────────────────────────────────────
let recognition = null, listening = false;
function toggleMic() {
  const mic = $('mic');
  if (!recognition) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { mic.textContent = '🚫'; return; }
    recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onstart = () => { listening = true; mic.classList.add('listening'); inp.placeholder = 'Listening…'; };
    recognition.onresult = (e) => {
      const t = Array.from(e.results).map(r => r[0].transcript).join('');
      inp.value = t;
      onInput(inp);
      if (e.results[e.results.length-1].isFinal) setTimeout(sendMsg, 400);
    };
    recognition.onend = () => { listening = false; mic.classList.remove('listening'); inp.placeholder = 'Ask Henry anything…'; };
    recognition.onerror = () => { listening = false; mic.classList.remove('listening'); };
  }
  listening ? recognition.stop() : (inp.value = '', recognition.start());
}

// ── Boot ───────────────────────────────────────────────────────────────────
(async function boot() {
  // Try stored token
  if (S.token) {
    try {
      const r = await fetch('/sync/snapshot', {headers:{'Authorization':'Bearer '+S.token}});
      if (r.ok) { goToApp(); return; }
    } catch {}
    localStorage.clear();
    S.token = '';
  }
  await autoPair();
})();
</script>
</html>`;
}
