/**
 * Henry Engage — Content Script
 * Adds a floating "Send to Henry" button when text is selected
 */

let floatBtn = null;
let hideTimer = null;

function createButton() {
  const btn = document.createElement('div');
  btn.id = 'henry-engage-btn';
  btn.innerHTML = `
    <div style="
      position: fixed;
      z-index: 2147483647;
      background: #7c3aed;
      color: white;
      border-radius: 20px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      font-family: -apple-system, sans-serif;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(124,58,237,0.4);
      display: flex;
      align-items: center;
      gap: 6px;
      user-select: none;
      transition: opacity 0.15s, transform 0.15s;
    " id="henry-engage-inner">
      <span style="font-size:14px">◉</span>
      <span>Send to Henry</span>
    </div>
  `;
  document.body.appendChild(btn);
  btn.querySelector('#henry-engage-inner').addEventListener('click', handleCapture);
  return btn;
}

function positionButton(x, y) {
  if (!floatBtn) floatBtn = createButton();
  const inner = floatBtn.querySelector('#henry-engage-inner');
  inner.style.left = `${Math.min(x, window.innerWidth - 180)}px`;
  inner.style.top = `${Math.max(y - 44, 8)}px`;
  inner.style.opacity = '1';
  inner.style.transform = 'scale(1)';
}

function hideButton() {
  if (floatBtn) {
    const inner = floatBtn.querySelector('#henry-engage-inner');
    if (inner) { inner.style.opacity = '0'; inner.style.transform = 'scale(0.9)'; }
  }
}

function handleCapture() {
  const sel = window.getSelection();
  const text = sel?.toString().trim();
  if (!text) return;

  const payload = {
    text,
    source: window.location.href,
    pageTitle: document.title,
    category: 'quote',
  };

  chrome.runtime.sendMessage({ type: 'CAPTURE', payload }, (resp) => {
    const inner = floatBtn?.querySelector('#henry-engage-inner');
    if (inner) {
      inner.style.background = resp?.ok ? '#16a34a' : '#dc2626';
      inner.innerHTML = resp?.ok
        ? '<span style="font-size:14px">✓</span><span>Sent to Henry</span>'
        : '<span style="font-size:14px">✗</span><span>Henry not running</span>';
      setTimeout(() => { hideButton(); }, 1500);
    }
    sel?.removeAllRanges();
  });
}

// Show button on text selection
document.addEventListener('mouseup', (e) => {
  clearTimeout(hideTimer);
  setTimeout(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (text && text.length > 10) {
      positionButton(e.clientX, e.clientY);
    } else {
      hideButton();
    }
  }, 100);
});

document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('#henry-engage-btn')) {
    hideTimer = setTimeout(hideButton, 200);
  }
});
