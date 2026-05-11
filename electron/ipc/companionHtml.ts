/**
 * Henry AI Companion — iPad / iPhone web app
 * Served by the sync server at http://MAC_IP:4242
 *
 * iPad landscape: Chat pinned left (360px) + tabbed panel right
 * iPad portrait / iPhone: bottom tabs, full screen
 *
 * Tabs: Chat · Today · Screen · Control · Capture
 * Features: voice input, live habits, screenshot stream, shell runner,
 *            AI chat with streaming, quick capture, touch-to-click screen
 */

export function buildCompanionHtml(macName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover,interactive-widget=resizes-content">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Henry AI">
<meta name="application-name" content="Henry AI">
<meta name="theme-color" content="#07070f">
<meta name="description" content="Your personal AI assistant — Henry AI companion">
<meta name="msapplication-TileColor" content="#7c3aed">
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/icon-192.png">
<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
<title>Henry AI</title>
<style>
:root{
  --bg:#07070f;--s1:#0f0f1a;--s2:#16162a;--s3:#1e1e32;
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
  --border:rgba(255,255,255,.08);--accent:#7c3aed;--accent2:#6d28d9;
  --green:#22c55e;--red:#ef4444;--blue:#3b82f6;--yellow:#f59e0b;
  --text:#e8e8f0;--muted:rgba(232,232,240,.45);--muted2:rgba(232,232,240,.25);
  --safe-top:env(safe-area-inset-top,0px);
  --safe-bot:env(safe-area-inset-bottom,0px);
  --font:-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif;
}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
html,body{height:100%;height:100dvh;min-height:100dvh;background:var(--bg);color:var(--text);font-family:var(--font);overflow:hidden}

/* ── LAYOUT ─────────────────────────────────────────────────── */
#app{display:flex;height:100%;height:100dvh;padding-top:var(--safe-top);min-height:0}
#chat-col{display:flex;flex-direction:column;width:360px;flex-shrink:0;min-height:0;border-right:1px solid var(--border)}
#right-col{flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden}

/* Phone: single column */
@media(max-width:767px){
  #app{flex-direction:column}
  #chat-col{width:100%;flex:1;border-right:none;display:none}
  #chat-col.active{display:flex}
  #right-col{flex:1;display:none}
  #right-col.active{display:flex}
}

/* ── TAB BAR ─────────────────────────────────────────────────── */
#tabs{display:flex;background:var(--s1);border-bottom:1px solid var(--border);flex-shrink:0;padding:0 4px}
#tabs button{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:10px 4px 8px;background:none;border:none;color:var(--muted);font-size:10px;font-family:var(--font);cursor:pointer;transition:.15s;border-bottom:2px solid transparent;font-weight:600;letter-spacing:.02em}
#tabs button .ti{font-size:18px;line-height:1}
#tabs button.on{color:var(--accent);border-bottom-color:var(--accent)}
#tabs button:active{opacity:.7}

/* ── PANES ─────────────────────────────────────────────────── */
.pane{display:none;flex-direction:column;flex:1;overflow:hidden}
.pane.on{display:flex}

/* ── CHAT ─────────────────────────────────────────────────── */
#chat-header{display:flex;align-items:center;gap:10px;padding:14px 16px 10px;border-bottom:1px solid var(--border);flex-shrink:0}
#chat-header .logo{font-size:20px;color:var(--accent)}
#chat-header .mac-name{font-weight:700;font-size:15px;flex:1}
#conn-dot{width:8px;height:8px;border-radius:50%;background:var(--muted2);transition:.3s;flex-shrink:0}
#conn-dot.ok{background:var(--green);box-shadow:0 0 6px var(--green)}
#conn-dot.err{background:var(--red)}

#msgs{flex:1;min-height:0;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;-webkit-overflow-scrolling:touch}
#msgs::-webkit-scrollbar{display:none}

.msg{max-width:88%;display:flex;flex-direction:column;gap:2px}
.msg.u{align-self:flex-end;align-items:flex-end}
.msg.h{align-self:flex-start;align-items:flex-start}
.msg.s{align-self:center;align-items:center}
.bubble{padding:10px 14px;border-radius:18px;font-size:14px;line-height:1.5;word-break:break-word;white-space:pre-wrap}
.msg.u .bubble{background:var(--accent);color:#fff;border-bottom-right-radius:5px}
.msg.h .bubble{background:var(--s2);color:var(--text);border-bottom-left-radius:5px;border:1px solid var(--border)}
.msg.s .bubble{background:var(--s1);color:var(--muted);font-size:12px;border:1px solid var(--border);border-radius:12px}
.msg time{font-size:10px;color:var(--muted2);padding:0 4px}

#quick-row{display:flex;gap:6px;padding:8px 12px;overflow-x:auto;flex-shrink:0;scrollbar-width:none}
#quick-row::-webkit-scrollbar{display:none}
.qb{background:var(--s2);border:1px solid var(--border);border-radius:20px;padding:6px 12px;font-size:12px;color:var(--text);cursor:pointer;white-space:nowrap;flex-shrink:0;font-family:var(--font)}
.qb:active{background:var(--accent);color:#fff;border-color:var(--accent)}

#input-bar{display:flex;align-items:flex-end;gap:8px;padding:10px 12px;padding-bottom:calc(10px + var(--safe-bot));border-top:1px solid var(--border);background:var(--s1);flex-shrink:0}
#msg-in{flex:1;background:var(--s2);border:1px solid var(--border);border-radius:22px;padding:10px 16px;font-size:15px;color:var(--text);outline:none;resize:none;font-family:var(--font);max-height:120px;overflow-y:auto;line-height:1.4;-webkit-overflow-scrolling:touch}
#msg-in::placeholder{color:var(--muted2)}
#msg-in:focus{border-color:rgba(124,58,237,.5)}
#mic-btn,#send-btn{width:42px;height:42px;border-radius:50%;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;transition:.2s}
#mic-btn{background:var(--s2);color:var(--muted)}
#mic-btn.on{background:var(--red);color:#fff;animation:pulse .8s infinite}
#send-btn{background:var(--accent);color:#fff}
#send-btn:active{background:var(--accent2)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}

/* ── TODAY ─────────────────────────────────────────────────── */
#today-pane{overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px;gap:12px;display:flex;flex-direction:column}
.card{background:var(--s1);border:1px solid var(--border);border-radius:20px;overflow:hidden}
.card-head{display:flex;align-items:center;gap:8px;padding:14px 16px 8px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.card-head .ch-icon{font-size:16px}

/* Habits */
.habit-row{display:flex;align-items:center;gap:12px;padding:10px 16px;border-top:1px solid var(--border)}
.habit-check{width:34px;height:34px;border-radius:50%;border:2px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:16px;cursor:pointer;transition:.2s;flex-shrink:0}
.habit-check.done{border-color:var(--green);background:rgba(34,197,94,.12);color:var(--green)}
.habit-check.done::after{content:'✓';font-weight:800}
.habit-name{flex:1;font-size:14px;font-weight:500}
.habit-streak{font-size:11px;color:var(--accent);font-weight:700}

/* Tasks */
.task-row{display:flex;align-items:center;gap:10px;padding:10px 16px;border-top:1px solid var(--border)}
.task-dot{width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0}
.task-title{flex:1;font-size:14px}
.task-pri{font-size:11px;color:var(--muted)}

/* Reminders */
.rem-row{display:flex;align-items:center;gap:10px;padding:10px 16px;border-top:1px solid var(--border)}
.rem-icon{font-size:16px;flex-shrink:0}
.rem-title{flex:1;font-size:14px}
.rem-time{font-size:11px;color:var(--yellow)}

/* ── SCREEN ─────────────────────────────────────────────────── */
#screen-pane{display:flex;flex-direction:column;background:#000}
#screen-bar2{display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--s1);border-bottom:1px solid var(--border);flex-shrink:0}
#screen-bar2 label{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted);cursor:pointer}
#screen-bar2 label input{accent-color:var(--accent)}
#screen-wrap{flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;-webkit-overflow-scrolling:touch}
#screen-img{max-width:100%;max-height:100%;border-radius:4px;cursor:crosshair;user-select:none;-webkit-user-select:none}
#screen-ts{font-size:11px;color:var(--muted2);margin-left:auto}
#screen-status{font-size:11px;color:var(--green)}

/* ── CONTROL ─────────────────────────────────────────────────── */
#ctrl-pane{overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px;gap:12px;display:flex;flex-direction:column}
.ctrl-sec{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);padding:4px 0 8px}
.app-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.app-btn{display:flex;flex-direction:column;align-items:center;gap:5px;padding:12px 6px;background:var(--s2);border:1px solid var(--border);border-radius:16px;cursor:pointer;transition:.15s}
.app-btn:active{background:rgba(124,58,237,.2);border-color:var(--accent)}
.app-btn .ai{font-size:24px}
.app-btn .al{font-size:10px;color:var(--muted);text-align:center}
.action-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
.act-btn{display:flex;align-items:center;gap:8px;padding:12px 14px;background:var(--s2);border:1px solid var(--border);border-radius:14px;cursor:pointer;font-size:13px;color:var(--text);transition:.15s}
.act-btn:active{background:rgba(124,58,237,.15);border-color:var(--accent)}
.act-btn .ai2{font-size:18px;flex-shrink:0}
#shell-bar{display:flex;gap:8px;padding:0}
#shell-in{flex:1;background:var(--s2);border:1px solid var(--border);border-radius:12px;padding:10px 14px;font-size:14px;color:var(--text);outline:none;font-family:'SF Mono',monospace}
#shell-in::placeholder{color:var(--muted2)}
#shell-in:focus{border-color:rgba(124,58,237,.5)}
#shell-run{padding:10px 16px;background:var(--accent);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer}
#shell-out{background:var(--s2);border:1px solid var(--border);border-radius:12px;padding:12px 14px;font-size:12px;font-family:'SF Mono',monospace;color:var(--green);min-height:60px;white-space:pre-wrap;word-break:break-all;max-height:180px;overflow-y:auto}

/* ── BIBLE ──────────────────────────────────────────────────── */
.health-btn{background:var(--s2);border:1px solid var(--border);border-radius:14px;padding:16px 10px;color:var(--text);font-size:15px;cursor:pointer;font-family:inherit;line-height:1.4;text-align:center;transition:background .15s;-webkit-tap-highlight-color:transparent}
.health-btn:active{background:var(--accent);color:#fff;border-color:var(--accent)}
#bible-pane{overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px;gap:12px;display:flex;flex-direction:column}
#bible-search-bar{display:flex;gap:8px}
#bible-ref-in{flex:1;background:var(--s2);border:1px solid var(--border);border-radius:12px;padding:11px 14px;font-size:15px;color:var(--text);outline:none;font-family:var(--font)}
#bible-ref-in::placeholder{color:var(--muted2)}
#bible-ref-in:focus{border-color:rgba(124,58,237,.5)}
#bible-look-btn{padding:11px 16px;background:var(--accent);color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer}
#bible-result{background:var(--s1);border:1px solid var(--border);border-radius:16px;padding:18px;display:none}
#bible-result.show{display:block}
#bible-ref-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--accent);margin-bottom:8px}
#bible-text{font-size:16px;line-height:1.7;color:var(--text)}
.bible-qr{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:4px}
.bq{background:var(--s2);border:1px solid var(--border);border-radius:20px;padding:5px 12px;font-size:12px;color:var(--text);cursor:pointer}
.bq:active{background:var(--accent);color:#fff;border-color:var(--accent)}
#study-result{background:var(--s1);border:1px solid rgba(124,58,237,.3);border-radius:16px;padding:16px;display:none;font-size:13px;line-height:1.6;color:var(--text)}
#study-result.show{display:block}
#study-bar{display:flex;gap:8px}
#study-prompt-in{flex:1;background:var(--s2);border:1px solid var(--border);border-radius:12px;padding:10px 14px;font-size:14px;color:var(--text);outline:none;font-family:var(--font)}
#study-prompt-in:focus{border-color:rgba(124,58,237,.5)}

/* ── CAPTURE ─────────────────────────────────────────────────── */
#cap-pane{overflow-y:auto;-webkit-overflow-scrolling:touch;padding:16px;gap:12px;display:flex;flex-direction:column}
#cap-in{width:100%;background:var(--s2);border:1px solid var(--border);border-radius:16px;padding:16px;font-size:15px;color:var(--text);outline:none;resize:none;font-family:var(--font);min-height:140px;line-height:1.6}
#cap-in::placeholder{color:var(--muted2)}
#cap-in:focus{border-color:rgba(124,58,237,.5)}
.cap-btns{display:flex;gap:8px}
.cap-btn{flex:1;padding:13px;background:var(--s2);border:1px solid var(--border);border-radius:14px;font-size:13px;font-weight:600;color:var(--text);cursor:pointer;text-align:center;transition:.15s}
.cap-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.cap-btn:active{opacity:.75}
#cap-result{background:var(--s1);border:1px solid var(--border);border-radius:16px;padding:16px;font-size:13px;line-height:1.6;color:var(--text);display:none}
#cap-result.show{display:block}
.result-section{margin-bottom:12px}
.result-section h4{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--accent);margin-bottom:6px}
.result-section p{font-size:13px;color:var(--muted);line-height:1.5}

/* ── PAIR SCREEN ─────────────────────────────────────────────── */
#pair-screen{position:fixed;inset:0;z-index:200;background:var(--bg);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:40px 28px;text-align:center}
#pair-screen h1{font-size:28px;font-weight:900;letter-spacing:-.02em}
#pair-screen p{font-size:15px;color:var(--muted);line-height:1.6;max-width:280px}
.pair-ip{font-size:28px;font-weight:900;color:var(--accent);font-family:'SF Mono',monospace;letter-spacing:.04em}
.pair-btn{padding:16px 32px;background:var(--accent);color:#fff;border:none;border-radius:16px;font-size:16px;font-weight:700;cursor:pointer;width:100%;max-width:280px}

/* ── BOTTOM NAV (phone) ──────────────────────────────────────── */
#bottom-nav{display:none;flex-shrink:0;background:var(--s1);border-top:1px solid var(--border);padding-bottom:var(--safe-bot)}
@media(max-width:767px){
  #bottom-nav{display:flex}
  #bottom-nav button{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 4px;background:none;border:none;font-size:10px;font-weight:600;color:var(--muted);cursor:pointer;font-family:var(--font)}
  #bottom-nav button .bi{font-size:20px}
  #bottom-nav button.on{color:var(--accent)}
}
</style>
</head>
<body>

<div id="pair-screen" style="padding-top: max(44px, env(safe-area-inset-top, 44px))">
  <div style="font-size:48px">◉</div>
  <h1>Henry AI</h1>
  <p>Connected to <strong style="color:var(--text)">${macName}</strong></p>
  <div id="ps-ip" class="pair-ip"></div>
  <p style="font-size:13px">Open this address on your iPad or iPhone</p>
  <button class="pair-btn" onclick="hidePair()">Open Companion →</button>
</div>

<!-- Offline indicator (shown when Mac unreachable) -->
<div id="offline-bar" style="display:none;position:fixed;top:0;left:0;right:0;z-index:1000;background:#ef4444;color:#fff;text-align:center;padding:8px 16px;font-size:12px;font-weight:600;padding-top:max(8px,env(safe-area-inset-top,8px))">
  ⚡ Reconnecting to Henry on your Mac…
</div>

<div id="app" style="display:none">
  <!-- CHAT COLUMN (always visible on iPad) -->
  <div id="chat-col">
    <div id="chat-header">
      <span class="logo">◉</span>
      <span class="mac-name">Henry — ${macName}</span>
      <div id="conn-dot"></div>
    </div>
    <div id="msgs">
      <div class="msg h"><div class="bubble">Hi! I'm Henry. Chat with me, control your Mac, or tap a tab to see your day. What do you need?</div><time>${new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}</time></div>
    </div>
    <div id="quick-row">
      <button class="qb" onclick="q('take a screenshot')">📸 Screenshot</button>
      <button class="qb" onclick="q('what apps are running')">📱 Apps</button>
      <button class="qb" onclick="q('open Finder')">📁 Finder</button>
      <button class="qb" onclick="q('mute the mac')">🔇 Mute</button>
      <button class="qb" onclick="q('check disk space')">💾 Disk</button>
      <button class="qb" onclick="q('lock the screen')">🔒 Lock</button>
      <button class="qb" onclick="q('what did I capture today')">⊕ Today's captures</button>
    </div>
    <div id="input-bar">
      <textarea id="msg-in" placeholder="Message Henry…" rows="1" oninput="autoGrow(this)" onkeydown="inputKey(event)"></textarea>
      <button id="mic-btn" onclick="toggleMic()" title="Voice input">🎙</button>
      <button id="send-btn" onclick="sendMsg()">↑</button>
    </div>
  </div>

  <!-- RIGHT COLUMN (tabbed) -->
  <div id="right-col">
    <div id="tabs">
      <button class="on" onclick="showTab('today')" id="t-today"><span class="ti">⌂</span>Today</button>
      <button onclick="showTab('screen')" id="t-screen"><span class="ti">📺</span>Screen</button>
      <button onclick="showTab('ctrl')" id="t-ctrl"><span class="ti">⌘</span>Control</button>
      <button onclick="showTab('cap')" id="t-cap"><span class="ti">⊕</span>Capture</button>
      <button onclick="showTab('bible')" id="t-bible"><span class="ti">✝</span>Bible</button>
    </div>

    <!-- TODAY -->
    <div class="pane on" id="p-today">
      <div id="today-pane">
        <div id="today-date" style="font-size:22px;font-weight:900;padding:4px 0 8px"></div>

        <!-- Habits -->
        <div class="card" id="habits-card">
          <div class="card-head"><span class="ch-icon">✓</span>Habits Today<span id="habit-prog" style="margin-left:auto;font-size:11px;color:var(--accent)"></span></div>
          <div id="habit-list"><div style="padding:16px;color:var(--muted);font-size:13px">Loading…</div></div>
        </div>

        <!-- Tasks -->
        <div class="card" id="tasks-card">
          <div class="card-head"><span class="ch-icon">☐</span>Open Tasks</div>
          <div id="task-list"><div style="padding:16px;color:var(--muted);font-size:13px">Loading…</div></div>
        </div>

        <!-- Reminders -->
        <div class="card" id="rem-card">
          <div class="card-head"><span class="ch-icon">◎</span>Reminders Due</div>
          <div id="rem-list"><div style="padding:16px;color:var(--muted);font-size:13px">Loading…</div></div>
        </div>
      </div>
    </div>

    <!-- SCREEN -->
    <div class="pane" id="p-screen">
      <div id="screen-bar2">
        <label><input type="checkbox" id="auto-ref" checked onchange="toggleAutoRef()"> Auto-refresh</label>
        <span id="screen-status"></span>
        <span id="screen-ts" style="margin-left:auto"></span>
        <button onclick="refreshScreen()" style="background:var(--accent);color:#fff;border:none;border-radius:10px;padding:6px 12px;font-size:12px;cursor:pointer">↻ Refresh</button>
      </div>
      <div id="screen-wrap">
        <img id="screen-img" src="" alt="Mac screen" onclick="screenClick(event)" />
      </div>
    </div>

    <!-- CONTROL -->
    <div class="pane" id="p-ctrl">
      <div id="ctrl-pane">
        <div class="ctrl-sec">Quick Launch</div>
        <div class="app-grid" id="app-grid"></div>

        <div class="ctrl-sec" style="margin-top:4px">System Actions</div>
        <div class="action-grid" id="action-grid"></div>

        <div class="ctrl-sec" style="margin-top:4px">Shell</div>
        <div class="shell-bar" style="display:flex;gap:8px">
          <input id="shell-in" placeholder="$ run any command…" onkeydown="if(event.key==='Enter')runShell()">
          <button id="shell-run" onclick="runShell()">Run</button>
        </div>
        <pre id="shell-out">Ready.</pre>
      </div>
    </div>

    <!-- CAPTURE -->
    <div class="pane" id="p-cap">
      <div id="cap-pane">
        <p style="font-size:13px;color:var(--muted);line-height:1.6">Paste or type anything — an idea, article, email, note. Henry extracts what matters.</p>
        <textarea id="cap-in" placeholder="Paste text, type an idea, or speak…"></textarea>
        <div class="cap-btns">
          <button class="cap-btn" onclick="capMic()">🎙 Speak</button>
          <button class="cap-btn primary" onclick="processCapture()">⚡ Process</button>
        </div>
        <div id="cap-result"></div>
      </div>
    </div>
  </div>
</div>

    <!-- Tasks pane -->
    <div id="p-tasks" style="display:none;flex-direction:column;height:100%;overflow:hidden">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border);font-weight:700;font-size:15px">
        <span>✓ Tasks</span>
        <button onclick="showAddTask()" style="background:var(--accent);border:none;color:#fff;border-radius:99px;padding:4px 14px;font-size:12px;font-weight:700;cursor:pointer">+ Add</button>
      </div>
      <div id="add-task-row" style="display:none;padding:12px 16px;gap:8px;flex-wrap:wrap">
        <input id="task-in" placeholder="New task…" onkeydown="if(event.key==='Enter')addTask()" style="flex:1;min-width:0;background:var(--s2);border:1px solid var(--border);border-radius:12px;padding:10px 14px;color:var(--text);font-size:14px;outline:none"/>
        <button onclick="addTask()" style="background:var(--accent);border:none;color:#fff;border-radius:12px;padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;flex-shrink:0">Add</button>
      </div>
      <div id="task-list-pane" style="flex:1;overflow-y:auto;padding:8px 0"></div>
    </div>

    <!-- Reminders pane -->
    <div id="p-rem" style="display:none;flex-direction:column;height:100%;overflow:hidden">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border);font-weight:700;font-size:15px">
        <span>⏰ Reminders</span>
        <button onclick="showAddReminder()" style="background:var(--accent);border:none;color:#fff;border-radius:99px;padding:4px 14px;font-size:12px;font-weight:700;cursor:pointer">+ Add</button>
      </div>
      <div id="add-rem-row" style="display:none;padding:12px 16px;gap:8px;flex-wrap:wrap">
        <input id="rem-in" placeholder="Remind me to…" onkeydown="if(event.key==='Enter')addReminder()" style="flex:1;min-width:0;background:var(--s2);border:1px solid var(--border);border-radius:12px;padding:10px 14px;color:var(--text);font-size:14px;outline:none"/>
        <button onclick="addReminder()" style="background:var(--accent);border:none;color:#fff;border-radius:12px;padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;flex-shrink:0">Add</button>
      </div>
      <div id="rem-list-pane" style="flex:1;overflow-y:auto;padding:8px 0"></div>
    </div>

    <!-- Journal pane -->
    <div id="p-jnl" style="display:none;flex-direction:column;height:100%;overflow:hidden">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--border);font-weight:700;font-size:15px">
        <span>📔 Journal</span>
        <span id="jnl-date" style="font-size:12px;font-weight:400;color:var(--muted)"></span>
      </div>
      <div style="padding:16px;flex:1;display:flex;flex-direction:column;gap:10px">
        <textarea id="jnl-in" placeholder="Write anything…" style="flex:1;min-height:140px;background:var(--s2);border:1px solid var(--border);border-radius:14px;padding:14px;color:var(--text);font-size:15px;line-height:1.6;resize:none;outline:none;font-family:inherit"></textarea>
        <div style="display:flex;gap:8px">
          <select id="jnl-mood" style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:8px 12px;color:var(--text);font-size:14px;outline:none">
            <option value="">Mood…</option>
            <option value="😊">😊 Good</option><option value="🙏">🙏 Grateful</option>
            <option value="💪">💪 Motivated</option><option value="😴">😴 Tired</option>
            <option value="😤">😤 Frustrated</option><option value="😌">😌 Peaceful</option>
          </select>
          <button onclick="saveJournal()" style="flex:1;background:var(--accent);border:none;color:#fff;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer">Save entry</button>
        </div>
        <div id="jnl-status" style="font-size:12px;color:var(--muted);text-align:center"></div>
      </div>
    </div>

    <!-- Health pane -->
    <div id="p-health" style="display:none;flex-direction:column;height:100%;overflow:hidden">
      <div style="padding:14px 16px;border-bottom:1px solid var(--border);font-weight:700;font-size:15px">❤️ Health Log</div>
      <div style="padding:16px;display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <button class="health-btn" onclick="logHealth('water',8,'oz')">💧 Water<br/><span style="font-size:11px;opacity:.6">+8 oz</span></button>
        <button class="health-btn" onclick="logHealth('steps',1000,'steps')">👟 Steps<br/><span style="font-size:11px;opacity:.6">+1,000</span></button>
        <button class="health-btn" onclick="logHealth('exercise',30,'min')">🏃 Exercise<br/><span style="font-size:11px;opacity:.6">30 min</span></button>
        <button class="health-btn" onclick="logHealth('sleep',7,'hrs')">😴 Sleep<br/><span style="font-size:11px;opacity:.6">7 hrs</span></button>
        <button class="health-btn" onclick="logHealth('calories',500,'cal')">🍽 Calories<br/><span style="font-size:11px;opacity:.6">+500</span></button>
        <button class="health-btn" onclick="promptHealthLog()">📝 Custom<br/><span style="font-size:11px;opacity:.6">any value</span></button>
      </div>
      <div id="health-status" style="padding:12px 16px;font-size:13px;color:var(--muted);text-align:center"></div>
    </div>

<!-- PHONE: bottom nav -->
<div id="bottom-nav">
  <button class="on" onclick="phoneTo('chat')" id="bn-chat"><span class="bi">◉</span>Chat</button>
  <button onclick="phoneTo('today')" id="bn-today"><span class="bi">⌂</span>Today</button>
  <button onclick="phoneTo('tasks')" id="bn-tasks"><span class="bi">✓</span>Tasks</button>
  <button onclick="phoneTo('rem')" id="bn-rem"><span class="bi">⏰</span>Remind</button>
  <button onclick="phoneTo('jnl')" id="bn-jnl"><span class="bi">📔</span>Journal</button>
  <button onclick="phoneTo('health')" id="bn-health"><span class="bi">❤️</span>Health</button>
  <button onclick="phoneTo('bible')" id="bn-bible"><span class="bi">✝</span>Bible</button>
</div>

<script>
// ── State ─────────────────────────────────────────────────────────────────────
const BASE = location.origin;
let isIpad = window.innerWidth >= 768;
let screenTimer = null;
let busy = false;
let recognition = null;
let habitsData = [];
let habitLogsData = [];

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  updateDate();
  setInterval(updateDate, 60000);
  buildAppGrid();
  buildActionGrid();

  // Auto-hide pair screen if we're already at the Henry sync server URL
  // (i.e., the user opened http://192.168.x.x:4242 directly — no pairing needed)
  const isHenryServer = location.port === '4242' || location.hostname === '127.0.0.1';
  const isMobile = /iPad|iPhone|Android|Mobile/.test(navigator.userAgent);

  if (isHenryServer) {
    // Already at the companion URL — skip pairing, go straight in
    hidePair();
  } else if (!isMobile) {
    // Desktop browser not at server URL — show the connect URL
    const ips = await fetch(BASE + '/sync/state-internal', {
      headers: { 'X-Henry-Internal': 'true' }
    }).then(r => r.json()).then(d => d.localIPs || []).catch(() => []);
    if (ips.length) {
      document.getElementById('ps-ip').textContent = 'http://' + ips[0] + ':4242';
    }
    document.getElementById('pair-screen').style.display = 'flex';
  } else {
    hidePair();
  }

  loadToday();
  setInterval(loadToday, 15000);
  refreshScreen();
  checkConn();
  setInterval(checkConn, 8000);
});

function hidePair() {
  document.getElementById('pair-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  updateLayout();
}

function updateDate() {
  const el = document.getElementById('today-date');
  if (el) el.textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric'
  });
}

function updateLayout() {
  isIpad = window.innerWidth >= 768;
  const chatCol = document.getElementById('chat-col');
  const rightCol = document.getElementById('right-col');
  if (isIpad) {
    chatCol.classList.remove('active');
    rightCol.classList.remove('active');
    chatCol.style.display = '';
    rightCol.style.display = '';
  } else {
    // Default phone: show chat
    phoneTo('chat');
  }
}
window.addEventListener('resize', updateLayout);

// ── Connectivity ──────────────────────────────────────────────────────────────
async function checkConn() {
  const dot = document.getElementById('conn-dot');
  try {
    const r = await fetch(BASE + '/sync/health', { signal: AbortSignal.timeout(3000) });
    dot.className = r.ok ? 'ok' : 'err';
  } catch { dot.className = 'err'; }
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function showTab(id) {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.remove('on'));
  document.querySelectorAll('#right-col .pane').forEach(p => p.classList.remove('on'));
  const tabBtn = document.getElementById('t-' + id);
  const pane = document.getElementById('p-' + id);
  if (tabBtn) tabBtn.classList.add('on');
  if (pane) pane.classList.add('on');
  if (id === 'screen') startScreenRefresh();
  else stopScreenRefresh();
  if (id === 'rem') loadReminders();
  if (id === 'tasks') loadTasks();
  if (id === 'goals') loadGoals();
  if (id === 'fin') loadFinance();
  if (id === 'jnl') initJournal();
}

function phoneTo(id) {
  document.querySelectorAll('#bottom-nav button').forEach(b => b.classList.remove('on'));
  const bnBtn = document.getElementById('bn-' + id);
  if (bnBtn) bnBtn.classList.add('on');
  const chatCol = document.getElementById('chat-col');
  const rightCol = document.getElementById('right-col');
  // Phone-only panes (tasks/rem/jnl/health) — toggle display directly
  const phoneOnlyPanes = ['tasks','rem','jnl','health'];
  if (phoneOnlyPanes.includes(id)) {
    chatCol.classList.remove('active'); rightCol.classList.remove('active');
    phoneOnlyPanes.forEach(pid => {
      const el = document.getElementById('p-' + pid);
      if (el) el.style.display = 'none';
    });
    const pane = document.getElementById('p-' + id);
    if (pane) pane.style.display = 'flex';
    stopScreenRefresh();
    if (id === 'rem') loadReminders();
    if (id === 'tasks') loadTasks();
    if (id === 'jnl') initJournal();
  } else if (id === 'chat') {
    phoneOnlyPanes.forEach(pid => { const el = document.getElementById('p-' + pid); if (el) el.style.display = 'none'; });
    chatCol.classList.add('active'); rightCol.classList.remove('active');
  } else {
    phoneOnlyPanes.forEach(pid => { const el = document.getElementById('p-' + pid); if (el) el.style.display = 'none'; });
    chatCol.classList.remove('active'); rightCol.classList.add('active');
    showTab(id);
  }
}

// ── Chat ──────────────────────────────────────────────────────────────────────
function msgTime() {
  return new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function addMsg(role, text) {
  const msgs = document.getElementById('msgs');
  const d = document.createElement('div');
  d.className = 'msg ' + role;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  const t = document.createElement('time');
  t.textContent = msgTime();
  d.appendChild(bubble);
  d.appendChild(t);
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
  return bubble;
}

// Build conversation history from the DOM — last 16 messages —
// so Henry remembers what we just talked about.
function buildHistory() {
  const out = [];
  const nodes = document.querySelectorAll('#msgs .msg');
  for (const n of nodes) {
    const isUser = n.classList.contains('u');
    const isHenry = n.classList.contains('h');
    if (!isUser && !isHenry) continue;
    const bubble = n.querySelector('.bubble');
    if (!bubble) continue;
    const txt = (bubble.textContent || '').trim();
    // Skip the placeholder “…” bubble that's currently waiting for a response
    if (!txt || txt === '…') continue;
    // Skip error placeholders so Henry doesn't try to respond to them
    if (txt.startsWith('⚠')) continue;
    out.push({ role: isUser ? 'user' : 'assistant', content: txt });
  }
  // Drop the very last user message (we send it as text separately) and trim to 16
  if (out.length && out[out.length - 1].role === 'user') out.pop();
  return out.slice(-16);
}

async function sendMsg() {
  const inp = document.getElementById('msg-in');
  const text = inp.value.trim();
  if (!text || busy) return;
  inp.value = ''; inp.style.height = '';
  addMsg('u', text);
  busy = true;
  const bubble = addMsg('h', '…');
  try {
    const history = buildHistory();
    const r = await fetch(BASE + '/sync/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, source: 'companion', history }),
      signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) {
      bubble.textContent = r.status === 401
        ? '⚠ Henry AI is not connected. Make sure you opened Henry on your Mac and try again.'
        : '⚠ Error ' + r.status + '. Is Henry running on your Mac?';
    } else {
      const d = await r.json();
      bubble.textContent = d.reply || d.response || d.text || d.content || JSON.stringify(d);
    }
  } catch (e) {
    bubble.textContent = '⚠ Connection error — is Henry running?';
  }
  busy = false;
  document.getElementById('msgs').scrollTop = 9999;
}

function q(text) {
  document.getElementById('msg-in').value = text;
  sendMsg();
}

function inputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
}

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ── Voice Input ───────────────────────────────────────────────────────────────
let micActive = false;

function toggleMic() {
  micActive ? stopMic() : startMic();
}

function startMic() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    alert('Voice input not available in this browser. Try Safari.');
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  recognition.onstart = () => {
    micActive = true;
    document.getElementById('mic-btn').classList.add('on');
    document.getElementById('mic-btn').textContent = '🔴';
  };
  recognition.onresult = (e) => {
    const t = Array.from(e.results).map(r => r[0].transcript).join('');
    document.getElementById('msg-in').value = t;
    autoGrow(document.getElementById('msg-in'));
  };
  recognition.onend = () => {
    micActive = false;
    document.getElementById('mic-btn').classList.remove('on');
    document.getElementById('mic-btn').textContent = '🎙';
    if (document.getElementById('msg-in').value.trim()) sendMsg();
  };
  recognition.onerror = () => {
    micActive = false;
    document.getElementById('mic-btn').classList.remove('on');
    document.getElementById('mic-btn').textContent = '🎙';
  };
  recognition.start();
}

function stopMic() {
  if (recognition) recognition.stop();
}

// ── TODAY ─────────────────────────────────────────────────────────────────────
async function loadToday() {
  try {
    const d = await fetch(BASE + '/sync/mac/today').then(r => r.json());
    habitsData = d.habits || [];
    habitLogsData = d.habitLogs || [];
    renderHabits(habitsData, habitLogsData);
    renderTasks(d.tasks || []);
    renderReminders(d.reminders || []);
  } catch { /* offline */ }
}

function renderHabits(habits, logs) {
  const el = document.getElementById('habit-list');
  const prog = document.getElementById('habit-prog');
  if (!habits.length) { el.innerHTML = '<div style="padding:14px 16px;color:var(--muted);font-size:13px">No habits set up yet — open Henry to add some</div>'; return; }
  const done = habits.filter(h => logs.find(l => l.habit_id === h.id && l.count >= h.target_per_day)).length;
  prog.textContent = done + '/' + habits.length;
  el.innerHTML = habits.map(h => {
    const log = logs.find(l => l.habit_id === h.id);
    const isDone = log && log.count >= h.target_per_day;
    return \`<div class="habit-row">
      <div class="habit-check \${isDone ? 'done' : ''}" onclick="toggleHabit('\${h.id}',\${isDone})">\${isDone ? '' : h.icon}</div>
      <span class="habit-name">\${h.name}</span>
      \${isDone ? '<span class="habit-streak">✓ Done</span>' : ''}
    </div>\`;
  }).join('');
}

async function toggleHabit(id, wasDone) {
  try {
    await fetch(BASE + '/sync/mac/habit-toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ habit_id: id, date: new Date().toISOString().slice(0, 10) }),
    });
    await loadToday();
  } catch { /* offline */ }
}

function renderTasks(tasks) {
  const el = document.getElementById('task-list');
  if (!tasks.length) { el.innerHTML = '<div style="padding:14px 16px;color:var(--muted);font-size:13px">All clear ✓</div>'; return; }
  el.innerHTML = tasks.slice(0, 6).map(t => \`
    <div class="task-row">
      <div class="task-dot" style="background:\${t.priority >= 3 ? '#ef4444' : t.priority === 2 ? '#f59e0b' : 'var(--accent)'}"></div>
      <span class="task-title">\${t.title}</span>
      <span class="task-pri">\${t.priority >= 3 ? 'High' : t.priority === 2 ? 'Med' : 'Low'}</span>
    </div>
  \`).join('');
}

function renderReminders(rems) {
  const el = document.getElementById('rem-list');
  if (!rems.length) { el.innerHTML = '<div style="padding:14px 16px;color:var(--muted);font-size:13px">Nothing due</div>'; return; }
  el.innerHTML = rems.slice(0, 5).map(r => {
    const t = r.due_at ? new Date(r.due_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
    return \`<div class="rem-row"><span class="rem-icon">◎</span><span class="rem-title">\${r.title}</span>\${t ? '<span class="rem-time">'+t+'</span>' : ''}</div>\`;
  }).join('');
}

// ── SCREEN ────────────────────────────────────────────────────────────────────
async function refreshScreen() {
  const img = document.getElementById('screen-img');
  const ts = document.getElementById('screen-ts');
  const status = document.getElementById('screen-status');
  try {
    status.textContent = '↻ Loading…';
    const d = await fetch(BASE + '/sync/mac/screen', { signal: AbortSignal.timeout(8000) }).then(r => r.json());
    if (d.image) {
      img.src = d.image;
      ts.textContent = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      status.textContent = '● Live';
      status.style.color = 'var(--green)';
    }
  } catch {
    status.textContent = '○ Offline';
    status.style.color = 'var(--muted)';
  }
}

function startScreenRefresh() {
  stopScreenRefresh();
  if (document.getElementById('auto-ref').checked) {
    screenTimer = setInterval(refreshScreen, 3000);
    refreshScreen();
  }
}

function stopScreenRefresh() {
  if (screenTimer) { clearInterval(screenTimer); screenTimer = null; }
}

function toggleAutoRef() {
  if (document.getElementById('auto-ref').checked) startScreenRefresh();
  else stopScreenRefresh();
}

function screenClick(e) {
  const img = document.getElementById('screen-img');
  const rect = img.getBoundingClientRect();
  const xPct = (e.clientX - rect.left) / rect.width;
  const yPct = (e.clientY - rect.top) / rect.height;
  // Send click to Mac via Henry HQ shell
  const script = \`osascript -e 'tell application "System Events" to click at {'\${Math.round(xPct*1920)}, \${Math.round(yPct*1080)}}'\`
  fetch(BASE + '/sync/mac/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command: script }),
  }).catch(() => {});
}

// ── CONTROL ───────────────────────────────────────────────────────────────────
const APPS = [
  { icon: '📁', name: 'Finder' }, { icon: '⌨️', name: 'Terminal' },
  { icon: '🌐', name: 'Chrome' }, { icon: '📧', name: 'Mail' },
  { icon: '📅', name: 'Calendar' }, { icon: '📝', name: 'Notes' },
  { icon: '🎵', name: 'Music' }, { icon: '⚙️', name: 'System Preferences' },
  { icon: '💻', name: 'VS Code' }, { icon: '💬', name: 'Slack' },
  { icon: '📷', name: 'Photos' }, { icon: '🧭', name: 'Safari' },
];

const ACTIONS = [
  { icon: '🔇', label: 'Mute Mac', cmd: "osascript -e 'set volume output muted true'" },
  { icon: '🔊', label: 'Unmute', cmd: "osascript -e 'set volume output muted false'" },
  { icon: '📸', label: 'Screenshot', cmd: "screencapture ~/Desktop/HenryCapture_$(date +%Y%m%d_%H%M%S).png" },
  { icon: '🔒', label: 'Lock Screen', cmd: "pmset displaysleepnow" },
  { icon: '🧹', label: 'Empty Trash', cmd: "osascript -e 'tell application Finder to empty trash'" },
  { icon: '📋', label: 'Show Clipboard', cmd: "pbpaste | head -5" },
  { icon: '🔄', label: 'Restart Dock', cmd: "killall Dock" },
  { icon: '📡', label: 'Show IP', cmd: "curl -s ifconfig.me" },
];

function buildAppGrid() {
  document.getElementById('app-grid').innerHTML = APPS.map(a =>
    \`<div class="app-btn" onclick="openApp('\${a.name}')"><span class="ai">\${a.icon}</span><span class="al">\${a.name.split(' ')[0]}</span></div>\`
  ).join('');
}

function buildActionGrid() {
  document.getElementById('action-grid').innerHTML = ACTIONS.map(a =>
    \`<div class="act-btn" onclick="runCmd(this.dataset.cmd)" data-cmd="\${a.cmd.replace(/"/g,'&quot;')}"><span class="ai2">\${a.icon}</span>\${a.label}</div>\`
  ).join('');
}

async function openApp(name) {
  const out = document.getElementById('shell-out');
  out.textContent = 'Opening ' + name + '…';
  try {
    await fetch(BASE + '/sync/mac/open-app', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app: name }),
    });
    out.textContent = '✓ Opened ' + name;
  } catch { out.textContent = '⚠ Failed to open ' + name; }
}

async function runCmd(cmd) {
  const out = document.getElementById('shell-out');
  out.textContent = '$ ' + cmd.slice(0, 60) + (cmd.length > 60 ? '...' : '') + '\\n...';
  try {
    const d = await fetch(BASE + '/sync/mac/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd }),
    }).then(r => r.json());
    out.textContent = '$ ' + cmd + '\\n' + (d.output || '(done)');
  } catch { out.textContent = '⚠ Error'; }
}

async function runShell() {
  const inp = document.getElementById('shell-in');
  const cmd = inp.value.trim();
  if (!cmd) return;
  inp.value = '';
  await runCmd(cmd);
}

// ── CAPTURE ───────────────────────────────────────────────────────────────────
let capMicRec = null;

function capMic() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    alert('Voice not available. Try Safari on iOS.');
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  capMicRec = new SR();
  capMicRec.continuous = false;
  capMicRec.interimResults = true;
  capMicRec.lang = 'en-US';
  capMicRec.onresult = (e) => {
    const t = Array.from(e.results).map(r => r[0].transcript).join('');
    document.getElementById('cap-in').value = t;
  };
  capMicRec.onend = () => {};
  capMicRec.start();
}

async function processCapture() {
  const text = document.getElementById('cap-in').value.trim();
  if (!text) return;
  const result = document.getElementById('cap-result');
  result.className = 'show';
  result.innerHTML = '<div style="color:var(--muted);font-size:13px">⚡ Processing with Henry AI…</div>';
  try {
    const d = await fetch(BASE + '/sync/capture-and-process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, source: 'companion-ipad' }),
    }).then(r => r.json());
    const sections = [];
    if (d.ideas?.length) sections.push({ title: '💡 Ideas', items: d.ideas });
    if (d.prospects?.length) sections.push({ title: '🎯 Prospects', items: d.prospects });
    if (d.tasks?.length) sections.push({ title: '✅ Tasks', items: d.tasks });
    if (d.insights?.length) sections.push({ title: '🔍 Insights', items: d.insights });
    if (d.quotes?.length) sections.push({ title: '💬 Quotes', items: d.quotes });
    if (!sections.length) { result.innerHTML = '<div style="color:var(--muted);font-size:13px">Captured and saved to Henry.</div>'; return; }
    result.innerHTML = sections.map(s => \`
      <div class="result-section">
        <h4>\${s.title}</h4>
        \${s.items.map(i => '<p>' + (typeof i === 'string' ? i : JSON.stringify(i)) + '</p>').join('')}
      </div>
    \`).join('');
  } catch {
    result.innerHTML = '<div style="color:var(--red)">⚠ Error processing. Is Henry running?</div>';
  }
}

// ── BIBLE ─────────────────────────────────────────────────────────────────────
let currentVerseText = '';
let currentVerseRef = '';

async function lookupVerse(ref) {
  if (!ref || !ref.trim()) return;
  const resultEl = document.getElementById('bible-result');
  const refLabel = document.getElementById('bible-ref-label');
  const textEl = document.getElementById('bible-text');
  resultEl.className = 'show';
  refLabel.textContent = ref.trim().toUpperCase();
  textEl.textContent = 'Looking up…';

  try {
    const r = await fetch(BASE + '/sync/prompt', {
      signal: AbortSignal.timeout(25000),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'BIBLE_LOOKUP:' + ref.trim(), source: 'companion-bible' }),
    });
    const d = await r.json();
    const text = d.reply || d.response || d.text || '';
    textEl.textContent = text;
    currentVerseText = text;
    currentVerseRef = ref.trim();
  } catch {
    // Fallback: try scripture lookup IPC via sync
    textEl.textContent = r.status === 401
        ? '⚠ Could not connect to Henry. Open Henry on your Mac and make sure you are on the same WiFi, then reload this page.'
        : '⚠ Verse not found. Try downloading the KJV first (✝ Scripture → 📥 Import in the desktop app).';
  }
}

async function studyPassage() {
  const prompt = document.getElementById('study-prompt-in').value.trim();
  if (!prompt || !currentVerseText) return;
  studyWith(prompt);
}

// ── SWIPE NAV (free — CSS touch events) ──────────────────────────────────────
let touchStartX = 0;
let touchStartY = 0;
const phoneOrder = ['chat','today','tasks','rem','jnl','health','bible'];

document.addEventListener('touchstart', e => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchend', e => {
  if (!document.getElementById('chat-col').classList.contains('active') && 
      !document.getElementById('right-col').classList.contains('active')) return; // iPad: no swipe
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.8) return; // too short or too vertical
  const active = document.querySelector('#bottom-nav button.on');
  if (!active) return;
  const currentId = active.id.replace('bn-','');
  const idx = phoneOrder.indexOf(currentId);
  if (dx < 0 && idx < phoneOrder.length - 1) phoneTo(phoneOrder[idx + 1]); // swipe left = next
  if (dx > 0 && idx > 0) phoneTo(phoneOrder[idx - 1]); // swipe right = prev
}, { passive: true });

// ── PULL TO REFRESH (free) ────────────────────────────────────────────────────
let pullStartY = 0;
let pulling = false;
const pullEl = (() => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;top:0;left:0;right:0;height:40px;background:var(--accent);color:#fff;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;transform:translateY(-100%);transition:transform .2s;z-index:999';
  d.textContent = '↓ Pull to refresh';
  document.body.appendChild(d);
  return d;
})();

document.addEventListener('touchstart', e => { pullStartY = e.touches[0].clientY; }, { passive: true });
document.addEventListener('touchmove', e => {
  const dy = e.touches[0].clientY - pullStartY;
  if (dy > 60 && window.scrollY === 0) {
    pullEl.style.transform = 'translateY(0)';
    pullEl.textContent = '↑ Release to refresh';
    pulling = true;
  }
}, { passive: true });
document.addEventListener('touchend', () => {
  if (pulling) {
    pulling = false;
    pullEl.style.transform = 'translateY(-100%)';
    pullEl.textContent = '↓ Pull to refresh';
    loadToday();
    const active = document.querySelector('#bottom-nav button.on');
    if (active) {
      const id = active.id.replace('bn-','');
      if (id === 'tasks') loadTasks();
      if (id === 'rem') loadReminders();
      if (id === 'goals') loadGoals();
    }
  }
}, { passive: true });

// ── JOURNAL ──────────────────────────────────────────────────────────────────
function initJournal() {
  const d = document.getElementById('jnl-date');
  if (d) d.textContent = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

async function saveJournal() {
  const content = document.getElementById('jnl-in').value.trim();
  if (!content) return;
  const mood = document.getElementById('jnl-mood').value;
  const status = document.getElementById('jnl-status');
  status.textContent = 'Saving…';
  try {
    const r = await fetch(BASE + '/sync/mac/journal/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, mood, title: 'From companion' }),
    });
    if (r.ok) {
      document.getElementById('jnl-in').value = '';
      document.getElementById('jnl-mood').value = '';
      status.textContent = '✓ Saved to journal';
      setTimeout(() => { status.textContent = ''; }, 3000);
    } else {
      status.textContent = 'Save failed';
    }
  } catch { status.textContent = 'Could not reach Henry'; }
}

// ── REMINDER QUICK-ADD ───────────────────────────────────────────────────────
function showAddReminder() {
  const row = document.getElementById('add-rem-row');
  row.style.display = row.style.display === 'none' ? 'flex' : 'none';
  if (row.style.display === 'flex') document.getElementById('rem-in').focus();
}

async function addReminder() {
  const inp = document.getElementById('rem-in');
  const title = inp.value.trim();
  if (!title) return;
  try {
    await fetch(BASE + '/sync/mac/reminders/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    inp.value = '';
    document.getElementById('add-rem-row').style.display = 'none';
    await loadReminders();
  } catch { alert('Could not add reminder'); }
}

async function doneReminder(id) {
  try {
    await fetch(BASE + '/sync/mac/reminders/done', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    await loadReminders();
  } catch { /* ignore */ }
}

// ── HEALTH LOGGING ───────────────────────────────────────────────────────────
async function logHealth(category, value, unit) {
  const status = document.getElementById('health-status');
  status.textContent = 'Logging…';
  try {
    const r = await fetch(BASE + '/sync/mac/health/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, value }),
    });
    if (r.ok) {
      status.textContent = '✓ Logged ' + value + ' ' + unit + ' ' + category;
      setTimeout(() => { status.textContent = ''; }, 3000);
    }
  } catch { status.textContent = 'Could not reach Henry'; }
}

async function promptHealthLog() {
  const cats = ['water','exercise','sleep','weight','mood','calories','steps'];
  const cat = prompt('Category: ' + cats.join(', '));
  if (!cat) return;
  const val = prompt('Value:');
  if (val === null) return;
  await logHealth(cat.trim(), parseFloat(val) || 0, '');
}

// ── REMINDERS ──────────────────────────────────────────────────────────────────
async function loadReminders() {
  try {
    const d = await fetch(BASE + '/sync/mac/reminders').then(r => r.json());
    const rems = d.reminders || [];
    const remCount = document.getElementById('rem-count');
    if (remCount) remCount.textContent = String(rems.length);
    const elRem = document.getElementById('rem-list');
    const elRemPane = document.getElementById('rem-list-pane');
    const el = elRem || elRemPane;
    if (!rems.length) { el.innerHTML = '<div class="empty-msg">No due reminders</div>'; return; }
    el.innerHTML = rems.map(r => {
      const t = r.due_at ? new Date(r.due_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
      const dateStr = r.due_at ? new Date(r.due_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
      return '<div class="rem-row"><span class="rem-icon">⏰</span><div style="flex:1"><div class="rem-title">' + r.title + '</div>' + (t ? '<div class="rem-time">' + dateStr + ' ' + t + '</div>' : '') + '</div><button onclick="doneReminder(' + "'" + r.id + "'" + ')" style="background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer;padding:4px;flex-shrink:0" title="Mark done">✓</button></div>';
    }).join('');
  } catch (e) { 
    document.getElementById('rem-list').innerHTML = '<div class="empty-msg">Could not reach Henry. Is it running?</div>';
  }
}

// ── TASKS ────────────────────────────────────────────────────────────────────
async function loadTasks() {
  try {
    const d = await fetch(BASE + '/sync/mac/tasks').then(r => r.json());
    const tasks = d.tasks || [];
    // Update today card list AND dedicated pane
    const elToday = document.getElementById('task-list');
    const elPane = document.getElementById('task-list-pane');
    if (!tasks.length) {
      if (elToday) elToday.innerHTML = '<div class="empty-msg">No open tasks</div>';
      if (elPane) elPane.innerHTML = '<div style="padding:24px;color:var(--muted);text-align:center;font-size:14px">No open tasks</div>';
      return;
    }
    const el = elToday || elPane;
    if (!el) return;
    const html = tasks.map(t => {
      const priColor = t.priority >= 3 ? '#ef4444' : t.priority === 2 ? '#f59e0b' : '#6b7280';
      return '<div class="task-row2"><div class="task-check" title="Mark done" data-tid="' + t.id + '" onclick="completeTaskEl(this)"></div><div class="task-pri-dot" style="background:' + priColor + '"></div><span style="flex:1;font-size:14px;color:var(--text)">' + t.title + '</span></div>';
    }).join('');
    if (elToday) elToday.innerHTML = html;
    if (elPane) elPane.innerHTML = html;
  } catch (e) {
    document.getElementById('task-list').innerHTML = '<div class="empty-msg">Could not reach Henry. Is it running?</div>';
  }
}

function showAddTask() {
  const row = document.getElementById('add-task-row');
  row.style.display = row.style.display === 'none' ? 'flex' : 'none';
  if (row.style.display === 'flex') document.getElementById('task-in').focus();
}

async function addTask() {
  const inp = document.getElementById('task-in');
  const title = inp.value.trim();
  if (!title) return;
  try {
    await fetch(BASE + '/sync/mac/tasks/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, priority: 2 }),
    });
    inp.value = '';
    document.getElementById('add-task-row').style.display = 'none';
    await loadTasks();
  } catch { alert('Could not add task'); }
}

function completeTaskEl(el) {
  el.textContent = '✓';
  el.style.background = 'var(--accent)';
  el.style.borderColor = 'var(--accent)';
  completeTask(el.dataset.tid);
}

async function completeTask(id) {
  try {
    await fetch(BASE + '/sync/mac/tasks/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    await loadTasks();
  } catch { /* ignore */ }
}

// ── GOALS ────────────────────────────────────────────────────────────────────
async function loadGoals() {
  try {
    const d = await fetch(BASE + '/sync/mac/goals').then(r => r.json());
    const goals = d.goals || [];
    document.getElementById('goals-count').textContent = String(goals.length);
    const el = document.getElementById('goals-list');
    if (!goals.length) { el.innerHTML = '<div class="empty-msg">No active goals</div>'; return; }
    el.innerHTML = goals.map(g => {
      const score = Math.round((g.priority_score || 0) * 10);
      return '<div class="goal-row"><div class="goal-title">' + g.title + '</div>' + (g.summary ? '<div style="font-size:12px;color:var(--muted);margin-bottom:6px">' + g.summary.slice(0,80) + '</div>' : '') + '<div class="goal-bar-wrap"><div class="goal-bar" style="width:' + score + '%"></div></div><div style="font-size:10px;color:var(--muted);margin-top:3px">Priority: ' + score + '/10</div></div>';
    }).join('');
  } catch (e) {
    document.getElementById('goals-list').innerHTML = '<div class="empty-msg">Could not reach Henry. Is it running?</div>';
  }
}

// ── FINANCE ──────────────────────────────────────────────────────────────────
async function loadFinance() {
  try {
    const d = await fetch(BASE + '/sync/mac/finance').then(r => r.json());
    const recent = d.trends || [];
    const latest = recent[recent.length - 1] || {};
    const sumEl = document.getElementById('fin-summary');
    sumEl.innerHTML = [
      { label: 'Income', amount: latest.income || 0, cls: 'pos' },
      { label: 'Expenses', amount: latest.expenses || 0, cls: 'neg' },
      { label: 'Net', amount: (latest.income || 0) - (latest.expenses || 0), cls: ((latest.income||0)-(latest.expenses||0)) >= 0 ? 'pos' : 'neg' },
    ].map(c => '<div class="fin-card"><div class="fin-card-label">' + c.label + '</div><div class="fin-card-amount ' + c.cls + '">$' + Math.abs(c.amount).toFixed(0) + '</div></div>').join('');
    document.getElementById('fin-list').innerHTML = recent.slice(-3).reverse().map(m =>
      '<div style="padding:10px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between"><span style="font-size:13px;color:var(--muted)">' + m.month + '</span><span style="font-size:13px;color:' + (m.net >= 0 ? '#22c55e' : '#ef4444') + ';font-weight:700">' + (m.net >= 0 ? '+' : '') + '$' + m.net.toFixed(0) + '</span></div>'
    ).join('');
  } catch { /* ignore */ }
}

async function studyWith(prompt) {
  if (!currentVerseText) {
    document.getElementById('study-result').className = 'show';
    document.getElementById('study-result').textContent = 'Look up a verse first, then ask your question.';
    return;
  }
  const result = document.getElementById('study-result');
  result.className = 'show';
  result.textContent = 'Henry is studying…';

  try {
    const r = await fetch(BASE + '/sync/prompt', {
      signal: AbortSignal.timeout(25000),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
   text: 'Study this passage: "' + currentVerseRef + '" ' + currentVerseText + ' Question: ' + prompt,
      }),
    });
    const d = await r.json();
    result.textContent = d.reply || d.response || d.text || 'No response';
  } catch {
    result.textContent = '⚠ Could not reach Henry.';
  }
}
</script>
</body></html>`;
}
