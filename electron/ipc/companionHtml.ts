/**
 * Henry AI Companion — clean rewrite v2
 * All JS at module level — no closure scope issues.
 * No TypeScript syntax in browser script blocks.
 */

export function buildCompanionHtml(macName: string): string {
  const escaped = macName.replace(/`/g, '\\`');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0a0a0f">
<title>Henry AI</title>
<style>
:root{--bg:#0a0a0f;--s1:#111118;--s2:#1a1a24;--border:rgba(255,255,255,.08);--text:#e8e8f0;--muted:rgba(232,232,240,.45);--accent:#7c3aed;--accent2:#6d28d9;--green:#22c55e;--red:#ef4444;--safe-top:env(safe-area-inset-top,0px);--safe-bot:env(safe-area-inset-bottom,0px)}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
html,body{height:100%;height:100dvh;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,sans-serif;overflow:hidden}
#tunnel-bar{height:3px;background:var(--accent);flex-shrink:0;transition:background .4s}
#app{display:flex;height:calc(100% - 3px);height:calc(100dvh - 3px);min-height:0}
#chat-col{display:flex;flex-direction:column;width:320px;flex-shrink:0;border-right:1px solid var(--border);min-height:0}
#right-col{flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden}
@media(max-width:767px){
  #app{flex-direction:column}
  #chat-col,#right-col{width:100%;border:none}
  #chat-col{display:none;flex:1}
  #chat-col.active{display:flex}
  #right-col{display:none;flex:1}
  #right-col.active{display:flex}
}
/* tabs */
#nav-tabs{display:flex;background:var(--s1);border-bottom:1px solid var(--border);flex-shrink:0}
#nav-tabs button{flex:1;padding:10px 4px 8px;background:none;border:none;border-bottom:2px solid transparent;color:var(--muted);font-size:10px;font-weight:700;letter-spacing:.04em;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;font-family:inherit}
#nav-tabs button .icon{font-size:18px;line-height:1}
#nav-tabs button.on{color:var(--accent);border-bottom-color:var(--accent)}
/* panes */
.pane{display:none;flex-direction:column;flex:1;overflow:hidden;min-height:0}
.pane.on{display:flex}
/* chat */
#chat-hdr{display:flex;align-items:center;gap:10px;padding:14px 14px 10px;border-bottom:1px solid var(--border);flex-shrink:0}
#chat-hdr .logo{font-size:20px;color:var(--accent)}
#chat-hdr .mac{font-weight:700;font-size:14px;flex:1}
#conn-dot{width:8px;height:8px;border-radius:50%;background:var(--muted);flex-shrink:0;transition:.3s}
#conn-dot.ok{background:var(--green);box-shadow:0 0 6px var(--green)}
#conn-dot.err{background:var(--red)}
#msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;min-height:0;-webkit-overflow-scrolling:touch}
#msgs::-webkit-scrollbar{display:none}
.msg{max-width:88%;display:flex;flex-direction:column;gap:2px}
.msg.u{align-self:flex-end;align-items:flex-end}
.msg.h{align-self:flex-start;align-items:flex-start}
.bubble{padding:10px 14px;border-radius:18px;font-size:14px;line-height:1.5;word-break:break-word;white-space:pre-wrap}
.msg.u .bubble{background:var(--accent);color:#fff;border-bottom-right-radius:4px}
.msg.h .bubble{background:var(--s2);border:1px solid var(--border);border-bottom-left-radius:4px}
.msg time{font-size:10px;color:var(--muted);padding:0 4px}
#quick-row{display:flex;gap:6px;padding:6px 10px;overflow-x:auto;flex-shrink:0;scrollbar-width:none}
#quick-row::-webkit-scrollbar{display:none}
.qb{background:var(--s2);border:1px solid var(--border);border-radius:20px;padding:5px 12px;font-size:12px;color:var(--text);cursor:pointer;white-space:nowrap;flex-shrink:0}
#input-bar{display:flex;align-items:flex-end;gap:8px;padding:10px 12px;padding-bottom:calc(10px + var(--safe-bot));border-top:1px solid var(--border);background:var(--s1);flex-shrink:0}
#msg-in{flex:1;background:var(--s2);border:1px solid var(--border);border-radius:20px;padding:9px 14px;font-size:15px;color:var(--text);outline:none;resize:none;font-family:inherit;max-height:100px;overflow-y:auto;line-height:1.4;-webkit-overflow-scrolling:touch}
#msg-in::placeholder{color:var(--muted)}
#send-btn{width:40px;height:40px;border-radius:50%;border:none;background:var(--accent);color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
/* today */
#today-pane{overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch}
.card{background:var(--s1);border:1px solid var(--border);border-radius:18px;overflow:hidden}
.card-hdr{display:flex;align-items:center;gap:8px;padding:12px 14px 6px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.habit-row{display:flex;align-items:center;gap:10px;padding:9px 14px;border-top:1px solid var(--border)}
.habit-check{width:32px;height:32px;border-radius:50%;border:2px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:15px;cursor:pointer;flex-shrink:0;transition:.2s}
.habit-check.done{border-color:var(--green);background:rgba(34,197,94,.12);color:var(--green)}
.habit-name{font-size:13px;flex:1}
.task-row{display:flex;align-items:center;gap:10px;padding:9px 14px;border-top:1px solid var(--border)}
.task-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.task-title{font-size:13px;flex:1}
/* screen */
#screen-img{width:100%;height:100%;object-fit:contain;display:block;cursor:crosshair;touch-action:none}
#screen-wrap{flex:1;position:relative;background:#000;overflow:hidden;min-height:0}
#screen-hdr{display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--border);flex-shrink:0;font-size:12px;color:var(--muted)}
#screen-hdr .fps{margin-left:auto;font-family:monospace;font-size:11px}
/* bottom nav (phone only) */
#bottom-nav{display:none;background:var(--s1);border-top:1px solid var(--border);padding:0 0 var(--safe-bot);flex-shrink:0}
@media(max-width:767px){#bottom-nav{display:flex}}
#bottom-nav button{flex:1;padding:8px 4px 6px;background:none;border:none;color:var(--muted);font-size:9px;font-weight:700;letter-spacing:.04em;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px;font-family:inherit}
#bottom-nav button .bi{font-size:20px;line-height:1}
#bottom-nav button.on{color:var(--accent)}
/* control */
#control-pane{overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch}
.ctrl-sec{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);padding:4px 0}
.ctrl-row{display:flex;flex-wrap:wrap;gap:8px}
.ctrl-btn{background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:8px 14px;font-size:13px;cursor:pointer;color:var(--text);font-family:inherit}
.ctrl-btn:active{background:var(--accent);color:#fff}
/* loading placeholder */
.loading-msg{padding:14px;color:var(--muted);font-size:13px}
</style>
</head>
<body>

<div id="tunnel-bar"></div>

<div id="app">
  <!-- CHAT COLUMN -->
  <div id="chat-col" class="active">
    <div id="chat-hdr">
      <span class="logo">◉</span>
      <span class="mac">${escaped}</span>
      <div id="conn-dot"></div>
    </div>
    <div id="msgs"></div>
    <div id="quick-row">
      <button class="qb" onclick="sendQ('gm')">☀️ GM</button>
      <button class="qb" onclick="sendQ('status')">📊 Status</button>
      <button class="qb" onclick="sendQ('plan my day')">📅 Plan day</button>
      <button class="qb" onclick="sendQ('habit consistency')">🔥 Habits</button>
      <button class="qb" onclick="sendQ('show my goals')">🎯 Goals</button>
      <button class="qb" onclick="sendQ('do a full analysis')">💰 Finance</button>
    </div>
    <div id="input-bar">
      <textarea id="msg-in" rows="1" placeholder="Message Henry…"></textarea>
      <button id="send-btn">↑</button>
    </div>
  </div>

  <!-- RIGHT COLUMN -->
  <div id="right-col" class="active">
    <div id="nav-tabs">
      <button class="on" id="t-today" onclick="showPane('today')"><span class="icon">📅</span>Today</button>
      <button id="t-screen" onclick="showPane('screen')"><span class="icon">🖥</span>Screen</button>
      <button id="t-control" onclick="showPane('control')"><span class="icon">⌘</span>Control</button>
    </div>

    <!-- TODAY PANE -->
    <div class="pane on" id="p-today">
      <div id="today-pane">
        <div id="today-date" style="font-size:20px;font-weight:900;padding:2px 0 6px"></div>
        <div class="card">
          <div class="card-hdr">✓ Habits Today <span id="habit-prog" style="margin-left:auto;color:var(--accent)"></span></div>
          <div id="habit-list"><div class="loading-msg">Loading…</div></div>
        </div>
        <div class="card">
          <div class="card-hdr">☐ Open Tasks</div>
          <div id="task-list"><div class="loading-msg">Loading…</div></div>
        </div>
        <div class="card">
          <div class="card-hdr">◎ Reminders</div>
          <div id="rem-list"><div class="loading-msg">Loading…</div></div>
        </div>
      </div>
    </div>

    <!-- SCREEN PANE -->
    <div class="pane" id="p-screen">
      <div id="screen-hdr">
        <span>Live Mac Screen</span>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-left:auto">
          <input type="checkbox" id="auto-ref" checked onchange="toggleScreenRefresh()"> Auto
        </label>
        <span class="fps" id="fps-counter">—</span>
      </div>
      <div id="screen-wrap">
        <img id="screen-img" src="" alt="" draggable="false">
      </div>
    </div>

    <!-- CONTROL PANE -->
    <div class="pane" id="p-control">
      <div id="control-pane">
        <div class="ctrl-sec">VPN & Tunnel</div>
        <div class="ctrl-row">
          <button class="ctrl-btn" onclick="sendQ('vpn')">🔒 VPN Setup</button>
          <button class="ctrl-btn" onclick="sendQ('pair my phone')">📱 Pair</button>
          <button class="ctrl-btn" onclick="sendQ('tunnel url')">🌐 Tunnel URL</button>
        </div>
        <div class="ctrl-sec">Keyboard</div>
        <div class="ctrl-row">
          <button class="ctrl-btn" onclick="macKey('space','meta')">⌘ Space</button>
          <button class="ctrl-btn" onclick="macKey('Tab','meta')">⌘ Tab</button>
          <button class="ctrl-btn" onclick="macKey('c','meta')">⌘ C</button>
          <button class="ctrl-btn" onclick="macKey('v','meta')">⌘ V</button>
          <button class="ctrl-btn" onclick="macKey('z','meta')">⌘ Z</button>
          <button class="ctrl-btn" onclick="macKey('Return','')">↵ Enter</button>
          <button class="ctrl-btn" onclick="macKey('Escape','')">Esc</button>
          <button class="ctrl-btn" onclick="macKey('Backspace','')">⌫</button>
        </div>
        <div class="ctrl-sec">Apps</div>
        <div class="ctrl-row">
          <button class="ctrl-btn" onclick="sendQ('open Finder')">📁 Finder</button>
          <button class="ctrl-btn" onclick="sendQ('open Terminal')">💻 Terminal</button>
          <button class="ctrl-btn" onclick="sendQ('open Chrome')">🌐 Chrome</button>
          <button class="ctrl-btn" onclick="sendQ('open Safari')">🧭 Safari</button>
          <button class="ctrl-btn" onclick="sendQ('open Cursor')">⚡ Cursor</button>
          <button class="ctrl-btn" onclick="sendQ('open Slack')">💬 Slack</button>
        </div>
        <div class="ctrl-sec">Henry</div>
        <div class="ctrl-row">
          <button class="ctrl-btn" onclick="sendQ('henry addons')">🧰 Addons</button>
          <button class="ctrl-btn" onclick="sendQ('what can you do')">❓ Help</button>
          <button class="ctrl-btn" onclick="loadToday()">🔄 Refresh</button>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- PHONE BOTTOM NAV -->
<div id="bottom-nav">
  <button class="on" id="bn-chat" onclick="phoneNav('chat')"><span class="bi">◉</span>Chat</button>
  <button id="bn-today" onclick="phoneNav('today')"><span class="bi">📅</span>Today</button>
  <button id="bn-screen" onclick="phoneNav('screen')"><span class="bi">🖥</span>Screen</button>
  <button id="bn-control" onclick="phoneNav('control')"><span class="bi">⌘</span>Control</button>
</div>

<script>
// ── Constants ─────────────────────────────────────────────────────────────────
var BASE = location.origin;
var busy = false;
var screenTimer = null;
var _connOk = false;
var _scFrameTs = 0;

// ── Date display ──────────────────────────────────────────────────────────────
function updateDate() {
  var el = document.getElementById('today-date');
  if (el) el.textContent = new Date().toLocaleDateString('en-US', {weekday:'long',month:'long',day:'numeric'});
}

// ── Tab navigation ────────────────────────────────────────────────────────────
function showPane(id) {
  document.querySelectorAll('#nav-tabs button').forEach(function(b) { b.classList.remove('on'); });
  document.querySelectorAll('.pane').forEach(function(p) { p.classList.remove('on'); });
  var tb = document.getElementById('t-' + id);
  var pn = document.getElementById('p-' + id);
  if (tb) tb.classList.add('on');
  if (pn) pn.classList.add('on');
  if (id === 'screen') startScreenRefresh();
  else stopScreenRefresh();
}

function phoneNav(id) {
  document.querySelectorAll('#bottom-nav button').forEach(function(b) { b.classList.remove('on'); });
  var bn = document.getElementById('bn-' + id);
  if (bn) bn.classList.add('on');
  var isWide = window.innerWidth >= 768;
  if (isWide) { showPane(id); return; }
  var chatCol = document.getElementById('chat-col');
  var rightCol = document.getElementById('right-col');
  if (id === 'chat') {
    if (chatCol) chatCol.classList.add('active');
    if (rightCol) rightCol.classList.remove('active');
  } else {
    if (chatCol) chatCol.classList.remove('active');
    if (rightCol) rightCol.classList.add('active');
    showPane(id);
  }
}

// ── Layout init ───────────────────────────────────────────────────────────────
function initLayout() {
  var isWide = window.innerWidth >= 768;
  var chatCol = document.getElementById('chat-col');
  var rightCol = document.getElementById('right-col');
  if (isWide) {
    if (chatCol) { chatCol.classList.add('active'); chatCol.style.display = ''; }
    if (rightCol) { rightCol.classList.add('active'); rightCol.style.display = ''; }
  }
}
window.addEventListener('resize', initLayout);

// ── Chat ──────────────────────────────────────────────────────────────────────
function addMsg(role, text) {
  var msgs = document.getElementById('msgs');
  if (!msgs) return;
  var d = document.createElement('div');
  d.className = 'msg ' + role;
  var bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  var t = document.createElement('time');
  t.textContent = new Date().toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit'});
  d.appendChild(bubble);
  d.appendChild(t);
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
  return bubble;
}

function sendMsg() {
  var inp = document.getElementById('msg-in');
  var text = inp ? inp.value.trim() : '';
  if (!text || busy) return;
  inp.value = '';
  inp.style.height = '';
  addMsg('u', text);
  busy = true;
  var bubble = addMsg('h', '…');
  fetch(BASE + '/sync/prompt', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({text: text})
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (bubble) bubble.textContent = d.reply || d.response || 'No response';
    busy = false;
  })
  .catch(function(e) {
    if (bubble) bubble.textContent = '⚠ ' + (e.message || 'Error');
    busy = false;
  });
}

function sendQ(text) {
  var inp = document.getElementById('msg-in');
  if (inp) inp.value = text;
  sendMsg();
}

function sendPrompt(text) { sendQ(text); }

// ── Today data ────────────────────────────────────────────────────────────────
var _todayLoaded = false;
function loadToday() {
  fetch(BASE + '/sync/mac/today', {cache: 'no-store'})
    .then(function(r) { return r.json(); })
    .then(function(d) {
      _todayLoaded = true;
      renderHabits(d.habits || [], d.habitLogs || []);
      renderTasks(d.tasks || []);
      renderReminders(d.reminders || []);
    })
    .catch(function() {
      // Server not ready yet — retry in 1 second
      if (!_todayLoaded) setTimeout(loadToday, 1000);
    });
}

function renderHabits(habits, logs) {
  var el = document.getElementById('habit-list');
  var prog = document.getElementById('habit-prog');
  if (!el) return;
  if (!habits.length) {
    el.innerHTML = '<div class="loading-msg">No habits set up yet</div>';
    return;
  }
  var done = habits.filter(function(h) {
    return logs.find(function(l) { return l.habit_id === h.id; });
  }).length;
  if (prog) prog.textContent = done + '/' + habits.length;
  el.innerHTML = habits.map(function(h) {
    var isDone = !!logs.find(function(l) { return l.habit_id === h.id; });
    return '<div class="habit-row">' +
      '<div class="habit-check ' + (isDone ? 'done' : '') + '" onclick="toggleHabit(\\'' + h.id + '\\',' + isDone + ')">' +
      (isDone ? '✓' : (h.icon || '○')) + '</div>' +
      '<span class="habit-name">' + h.name + '</span></div>';
  }).join('');
}

function renderTasks(tasks) {
  var el = document.getElementById('task-list');
  if (!el) return;
  if (!tasks.length) { el.innerHTML = '<div class="loading-msg">All clear ✓</div>'; return; }
  el.innerHTML = tasks.slice(0, 8).map(function(t) {
    var col = t.priority >= 3 ? '#ef4444' : t.priority === 2 ? '#f59e0b' : 'var(--accent)';
    return '<div class="task-row">' +
      '<div class="task-dot" style="background:' + col + '"></div>' +
      '<span class="task-title">' + t.title + '</span></div>';
  }).join('');
}

function renderReminders(rems) {
  var el = document.getElementById('rem-list');
  if (!el) return;
  if (!rems.length) { el.innerHTML = '<div class="loading-msg">Nothing due</div>'; return; }
  el.innerHTML = rems.slice(0, 5).map(function(r) {
    return '<div class="task-row"><span style="margin-right:6px">◎</span><span class="task-title">' + r.title + '</span></div>';
  }).join('');
}

function toggleHabit(id, wasDone) {
  fetch(BASE + '/sync/mac/habit-toggle', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({habit_id: id, date: new Date().toISOString().slice(0, 10)})
  }).then(function() { loadToday(); }).catch(function() {});
}

// ── Screen stream ─────────────────────────────────────────────────────────────
function startScreenRefresh() {
  if (screenTimer) return;
  fetchScreen();
  screenTimer = setInterval(fetchScreen, 700);
}

function stopScreenRefresh() {
  if (screenTimer) { clearInterval(screenTimer); screenTimer = null; }
}

function toggleScreenRefresh() {
  var cb = document.getElementById('auto-ref');
  if (cb && cb.checked) startScreenRefresh(); else stopScreenRefresh();
}

function fetchScreen() {
  var img = document.getElementById('screen-img');
  if (!img) return;
  var t0 = Date.now();
  fetch(BASE + '/sync/mac/screen', {cache: 'no-store'})
    .then(function(r) { return r.blob(); })
    .then(function(blob) {
      var url = URL.createObjectURL(blob);
      var old = img.src;
      img.src = url;
      if (old && old.startsWith('blob:')) URL.revokeObjectURL(old);
      var fps = document.getElementById('fps-counter');
      if (fps) fps.textContent = Math.round(1000 / (Date.now() - t0)) + ' fps';
      // Touch-to-click
      if (!img._touch) {
        img._touch = true;
        img.addEventListener('click', function(e) { sendScreenClick(e, img); });
      }
    })
    .catch(function() {});
}

function sendScreenClick(e, img) {
  var rect = img.getBoundingClientRect();
  var natW = img.naturalWidth || 1440;
  var natH = img.naturalHeight || 900;
  var scaleX = natW / rect.width;
  var scaleY = natH / rect.height;
  var x = Math.round((e.clientX - rect.left) * scaleX);
  var y = Math.round((e.clientY - rect.top) * scaleY);
  fetch(BASE + '/sync/mac/open-app', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({action: 'click', x: x, y: y})
  }).catch(function() {});
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
function macKey(key, mod) {
  fetch(BASE + '/sync/mac/open-app', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({action: 'key', key: key, modifiers: mod})
  }).catch(function() {});
}

// ── Connection check ──────────────────────────────────────────────────────────
function checkConn() {
  var dot = document.getElementById('conn-dot');
  var bar = document.getElementById('tunnel-bar');
  fetch(BASE + '/sync/health', {cache: 'no-store', signal: AbortSignal.timeout(4000)})
    .then(function(r) { return r.json(); })
    .then(function(d) {
      _connOk = true;
      if (dot) { dot.className = 'ok'; }
      if (bar) bar.style.background = d.tunnelUrl ? 'var(--accent)' : 'var(--green)';
    })
    .catch(function() {
      _connOk = false;
      if (dot) dot.className = 'err';
      if (bar) bar.style.background = 'var(--red)';
    });
}

// ── Wake lock ─────────────────────────────────────────────────────────────────
var _wakeLock = null;
function acquireWakeLock() {
  if (!navigator.wakeLock) return;
  navigator.wakeLock.request('screen').then(function(wl) {
    _wakeLock = wl;
    wl.addEventListener('release', function() { setTimeout(acquireWakeLock, 2000); });
  }).catch(function() {});
}
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') { acquireWakeLock(); checkConn(); }
});

// ── Heartbeat ─────────────────────────────────────────────────────────────────
setInterval(function() {
  if (_connOk) fetch(BASE + '/sync/health', {cache:'no-store'}).catch(function(){});
}, 15000);

// ── Input auto-grow ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  var inp = document.getElementById('msg-in');
  if (inp) {
    inp.addEventListener('input', function() {
      inp.style.height = '';
      inp.style.height = Math.min(inp.scrollHeight, 100) + 'px';
    });
    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
    });
  }
  var sb = document.getElementById('send-btn');
  if (sb) sb.addEventListener('click', sendMsg);

  // Init
  updateDate();
  setInterval(updateDate, 60000);
  initLayout();
  // Poll until data lands (server may take a moment on startup)
  loadToday(); // try immediately
  setInterval(loadToday, 15000); // then every 15s
  checkConn();
  setInterval(checkConn, 10000);
  acquireWakeLock();

  // Greet
  addMsg('h', 'Hi! I\\'m Henry. Chat with me, or tap a tab to see your day.');
});
</script>
</body></html>`;
}
