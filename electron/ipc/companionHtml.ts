/**
 * Henry Companion v3 — minimal remote control
 * Full-screen Mac display. Chat bar at bottom. Nothing else.
 * Tap screen = click on Mac. Type = talk to Henry.
 * Automatic. No setup. No popups.
 */

export function buildCompanionHtml(macName: string): string {
  const esc = macName.replace(/`/g, '\\`').replace(/\$/g, '\\$');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<meta name="mobile-web-app-capable" content="yes">
<link rel="manifest" href="data:application/json;base64,eyJuYW1lIjoiSGVucnkgQUkiLCJzaG9ydF9uYW1lIjoiSGVucnkiLCJkaXNwbGF5Ijoic3RhbmRhbG9uZSIsImJhY2tncm91bmRfY29sb3IiOiIjMDAwMDAwIiwidGhlbWVfY29sb3IiOiIjMDAwMDAwIiwiaWNvbnMiOlt7InNyYyI6Imljb24iLCJzaXplcyI6IjE5MngxOTIiLCJ0eXBlIjoiaW1hZ2UvcG5nIn1dfQ==">
<meta name="theme-color" content="#000">
<title>Henry</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
html,body{width:100%;height:100%;height:100dvh;background:#000;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,sans-serif}

/* Full-screen Mac display */
#screen{
  position:fixed;top:0;left:0;right:0;bottom:0;
  background:#111;display:flex;align-items:center;justify-content:center;
  touch-action:none;user-select:none;-webkit-user-select:none;
}
#screen img{
  max-width:100%;max-height:100%;object-fit:contain;display:block;
  pointer-events:none;
}
#screen-off{
  position:absolute;inset:0;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:12px;color:#444;font-size:14px;
}

/* Status bar — thin strip at very top */
#status-bar{
  position:fixed;top:0;left:0;right:0;height:3px;
  background:#1d4ed8;z-index:100;transition:background .3s;
}
#status-bar.ok{background:#16a34a}
#status-bar.err{background:#dc2626}

/* Chat overlay — slides up from bottom */
#chat-wrap{
  position:fixed;bottom:0;left:0;right:0;z-index:200;
  display:flex;flex-direction:column;
  padding-bottom:env(safe-area-inset-bottom,0px);
  transition:transform .25s ease;
}
#chat-wrap.collapsed #msgs-wrap{display:none}

#msgs-wrap{
  max-height:35vh;overflow-y:auto;
  background:rgba(0,0,0,.88);
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  padding:10px 14px 4px;
  display:flex;flex-direction:column;gap:6px;
  -webkit-overflow-scrolling:touch;
}
#msgs-wrap::-webkit-scrollbar{display:none}

.msg{max-width:80%;display:flex;flex-direction:column;gap:2px}
.msg.u{align-self:flex-end;align-items:flex-end}
.msg.h{align-self:flex-start;align-items:flex-start}
.bubble{padding:8px 12px;border-radius:16px;font-size:14px;line-height:1.45;word-break:break-word;white-space:pre-wrap}
.msg.u .bubble{background:#7c3aed;color:#fff;border-bottom-right-radius:4px}
.msg.h .bubble{background:rgba(255,255,255,.12);color:#fff;border-bottom-left-radius:4px}
.msg time{font-size:10px;color:rgba(255,255,255,.3);padding:0 3px}

#input-row{
  display:flex;align-items:flex-end;gap:8px;
  padding:8px 12px 10px;
  background:rgba(0,0,0,.92);
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  border-top:1px solid rgba(255,255,255,.08);
}
#msg-in{
  flex:1;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);
  border-radius:18px;padding:8px 14px;font-size:15px;color:#fff;
  outline:none;resize:none;font-family:inherit;max-height:80px;
  overflow-y:auto;line-height:1.4;-webkit-overflow-scrolling:touch;
}
#msg-in::placeholder{color:rgba(255,255,255,.3)}
#send-btn{
  width:36px;height:36px;border-radius:50%;border:none;
  background:#7c3aed;color:#fff;font-size:16px;
  cursor:pointer;display:flex;align-items:center;justify-content:center;
  flex-shrink:0;transition:.15s;
}
#send-btn:active{background:#6d28d9;transform:scale(.95)}
#send-btn.busy{background:#374151}

/* Touch ripple */
#ripple{
  position:fixed;width:44px;height:44px;border-radius:50%;
  border:2px solid rgba(124,58,237,.7);pointer-events:none;
  transform:translate(-50%,-50%) scale(0);opacity:0;z-index:300;
  transition:transform .3s ease,opacity .3s ease;
}
#ripple.pop{transform:translate(-50%,-50%) scale(1);opacity:1}
#ripple.fade{transform:translate(-50%,-50%) scale(1.8);opacity:0}
</style>
</head>
<body>

<div id="status-bar"></div>

<!-- Mac Screen -->
<div id="screen">
  <div id="add-home-banner" style="position:fixed;bottom:60px;left:50%;transform:translateX(-50%);background:rgba(124,58,237,.92);color:#fff;padding:10px 18px;border-radius:20px;font-size:13px;font-weight:600;z-index:500;display:none;cursor:pointer;white-space:nowrap" onclick="document.getElementById(\'add-home-banner\').style.display=\'none\'">
  + Add to Home Screen for best experience
</div>
<div id="screen-off">
    <span style="font-size:32px">◉</span>
    <span>Connecting to ${esc}…</span>
  </div>
  <img id="screen-img" src="" alt="" style="display:none">
</div>

<!-- Touch ripple effect -->
<div id="ripple"></div>

<!-- Chat overlay -->
<div id="chat-wrap" class="collapsed">
  <div id="msgs-wrap"></div>
  <div id="input-row">
    <textarea id="msg-in" rows="1" placeholder="Message Henry…"></textarea>
    <button id="send-btn">↑</button>
  </div>
</div>

<script>
var BASE = location.origin;
var busy = false;
var screenTimer = null;
var _natW = 1440, _natH = 900;
var _connOk = false;
var _lastGoodFrame = 0;

// ── Status bar ────────────────────────────────────────────────────────────────
function setStatus(state) {
  var bar = document.getElementById('status-bar');
  if (!bar) return;
  bar.className = state; // 'ok' | 'err' | ''
}

// ── Screen stream ─────────────────────────────────────────────────────────────
function fetchFrame() {
  var img = document.getElementById('screen-img');
  var off = document.getElementById('screen-off');
  fetch(BASE + '/sync/mac/screen', {cache:'no-store', signal:AbortSignal.timeout(4000)})
    .then(function(r) {
      var ct = r.headers.get('content-type') || '';
      if (ct.includes('json')) {
        return r.json().then(function(d) {
          if (d.image) {
            img.src = d.image;
            // Get native dimensions from first frame
            if (!img._sized) { img._sized = true; var tmp = new Image(); tmp.onload = function() { _natW = tmp.width; _natH = tmp.height; }; tmp.src = d.image; }
            return 'ok';
          }
          throw new Error('no image');
        });
      } else {
        return r.blob().then(function(blob) {
          var url = URL.createObjectURL(blob);
          var old = img.src;
          img.src = url;
          if (old && old.startsWith('blob:')) URL.revokeObjectURL(old);
          return 'ok';
        });
      }
    })
    .then(function() {
      img.style.display = 'block';
      if (off) off.style.display = 'none';
      _lastGoodFrame = Date.now();
      setStatus('ok');
      _connOk = true;
    })
    .catch(function() {
      if (Date.now() - _lastGoodFrame > 6000) {
        if (img) img.style.display = 'none';
        if (off) { off.style.display = 'flex'; }
        setStatus('err');
        _connOk = false;
      }
    });
}

function startStream() {
  fetchFrame();
  screenTimer = setInterval(fetchFrame, 500);
}

// ── Touch → click on Mac ──────────────────────────────────────────────────────
var _touchStart = null;
var _touchMoved = false;

document.getElementById('screen').addEventListener('touchstart', function(e) {
  _touchStart = {x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now()};
  _touchMoved = false;
}, {passive: true});

document.getElementById('screen').addEventListener('touchmove', function(e) {
  if (!_touchStart) return;
  var dx = e.touches[0].clientX - _touchStart.x;
  var dy = e.touches[0].clientY - _touchStart.y;
  if (Math.abs(dx) > 8 || Math.abs(dy) > 8) _touchMoved = true;
}, {passive: true});

document.getElementById('screen').addEventListener('touchend', function(e) {
  if (!_touchStart || _touchMoved) { _touchStart = null; return; }
  var dt = Date.now() - _touchStart.t;
  var clientX = _touchStart.x, clientY = _touchStart.y;
  _touchStart = null;
  
  // Show ripple
  var rip = document.getElementById('ripple');
  if (rip) {
    rip.style.left = clientX + 'px';
    rip.style.top = clientY + 'px';
    rip.className = 'pop';
    setTimeout(function() { rip.className = 'fade'; setTimeout(function() { rip.className = ''; }, 300); }, 200);
  }

  // Calculate Mac coordinates
  var img = document.getElementById('screen-img');
  var rect = document.getElementById('screen').getBoundingClientRect();
  var imgW = img.offsetWidth || rect.width;
  var imgH = img.offsetHeight || rect.height;
  // Center the image in the screen div
  var imgLeft = rect.left + (rect.width - imgW) / 2;
  var imgTop = rect.top + (rect.height - imgH) / 2;
  var relX = clientX - imgLeft;
  var relY = clientY - imgTop;
  var macX = Math.round(relX / imgW * _natW);
  var macY = Math.round(relY / imgH * _natH);

  if (dt > 500) {
    // Long press = right click
    sendMacAction({action:'rightclick', x:macX, y:macY});
  } else {
    sendMacAction({action:'click', x:macX, y:macY});
  }
}, {passive: true});

// Mouse click (desktop browser)
document.getElementById('screen').addEventListener('click', function(e) {
  if ('ontouchstart' in window) return; // skip on touch devices (handled above)
  var img = document.getElementById('screen-img');
  var rect = img.getBoundingClientRect();
  var macX = Math.round((e.clientX - rect.left) / rect.width * _natW);
  var macY = Math.round((e.clientY - rect.top) / rect.height * _natH);
  sendMacAction({action:'click', x:macX, y:macY});
});

function sendMacAction(payload) {
  fetch(BASE + '/sync/mac/open-app', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  }).catch(function() {});
}

// ── Chat ──────────────────────────────────────────────────────────────────────
function addMsg(role, text) {
  var wrap = document.getElementById('msgs-wrap');
  if (!wrap) return null;
  // Show chat area when messages arrive
  var chatWrap = document.getElementById('chat-wrap');
  if (chatWrap) chatWrap.classList.remove('collapsed');
  
  var d = document.createElement('div');
  d.className = 'msg ' + role;
  var bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  d.appendChild(bubble);
  wrap.appendChild(d);
  wrap.scrollTop = wrap.scrollHeight;
  return bubble;
}

function sendMsg() {
  var inp = document.getElementById('msg-in');
  var btn = document.getElementById('send-btn');
  var text = inp ? inp.value.trim() : '';
  if (!text || busy) return;
  inp.value = '';
  inp.style.height = '';
  busy = true;
  if (btn) btn.className = 'busy';
  addMsg('u', text);
  var bubble = addMsg('h', '…');
  fetch(BASE + '/sync/prompt', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({text:text})
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (bubble) bubble.textContent = d.reply || 'Done.';
    busy = false;
    if (btn) btn.className = '';
  })
  .catch(function(e) {
    if (bubble) bubble.textContent = '⚠ ' + (e.message || 'Connection lost');
    busy = false;
    if (btn) btn.className = '';
  });
}

// ── Input ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  var inp = document.getElementById('msg-in');
  var sb = document.getElementById('send-btn');
  
  if (inp) {
    inp.addEventListener('input', function() {
      inp.style.height = '';
      inp.style.height = Math.min(inp.scrollHeight, 80) + 'px';
    });
    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
    });
  }
  if (sb) sb.addEventListener('click', sendMsg);

  // Show "Add to Home Screen" for Android non-PWA
  if (/android/i.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches) {
    setTimeout(function() {
      var b = document.getElementById('add-home-banner');
      if (b) b.style.display = 'block';
      setTimeout(function() { if (b) b.style.display = 'none'; }, 8000);
    }, 3000);
  }

  // Start screen stream
  startStream();
  
  // Size auto-detected from first frame

  // Wake lock
  if (navigator.wakeLock) {
    navigator.wakeLock.request('screen').catch(function() {});
  }
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible' && navigator.wakeLock) {
      navigator.wakeLock.request('screen').catch(function() {});
    }
  });
  
  // Heartbeat
  setInterval(function() {
    fetch(BASE + '/sync/health', {cache:'no-store', signal:AbortSignal.timeout(3000)})
      .then(function(r) { return r.json(); })
      .then(function(d) { setStatus('ok'); _connOk = true; })
      .catch(function() { setStatus('err'); _connOk = false; });
  }, 10000);
});
</script>
</body></html>`;
}
