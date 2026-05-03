/**
 * Henry Engage — Background Service Worker
 * Handles context menu actions and communication with Henry AI (port 4242)
 */

const HENRY_URL = 'http://127.0.0.1:4242';

// Create right-click context menu items
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'henry-capture-selection',
    title: 'Send to Henry: "%s"',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: 'henry-capture-page',
    title: 'Send page summary to Henry',
    contexts: ['page'],
  });
  chrome.contextMenus.create({
    id: 'henry-capture-link',
    title: 'Send link to Henry',
    contexts: ['link'],
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  let text = '';
  let source = tab?.url || '';
  let category = 'web_clip';

  if (info.menuItemId === 'henry-capture-selection') {
    text = info.selectionText || '';
    category = 'quote';
  } else if (info.menuItemId === 'henry-capture-page') {
    text = `Page: ${tab?.title || source}`;
    category = 'web_clip';
  } else if (info.menuItemId === 'henry-capture-link') {
    text = `Link: ${info.linkUrl}`;
    source = info.linkUrl || '';
    category = 'link';
  }

  if (text) {
    await sendToHenry({ text, source, category });
    showNotification('Sent to Henry', text.slice(0, 60));
  }
});

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'CAPTURE') {
    sendToHenry(msg.payload)
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true; // async
  }
  if (msg.type === 'CHECK_HENRY') {
    fetch(`${HENRY_URL}/sync/health`, { signal: AbortSignal.timeout(2000) })
      .then(r => r.json())
      .then(d => sendResponse({ ok: true, version: d.version, paired: d.paired }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
});

async function sendToHenry(payload) {
  const { text, source, category } = payload;
  const res = await fetch(`${HENRY_URL}/sync/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, source, category, from: 'henry-engage' }),
  });
  if (!res.ok) throw new Error(`Henry returned ${res.status}`);
  return res.json();
}

function showNotification(title, message) {
  chrome.notifications?.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title,
    message,
  });
}
