import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { HenrySelfRepairBoundary } from './components/HenrySelfRepairBoundary';
import './styles/globals.css';
import './webMock';
import { initCapacitor } from './capacitor';
import { logError } from './henry/selfRepairStore';

// ── Renderer-level error capture ─────────────────────────────────────────────
// These run before React's error boundary catches render crashes.
// They cover async errors (unhandled rejections) and non-render runtime crashes.
window.addEventListener('error', (e) => {
  console.error('[Henry:renderer] Uncaught error:', e.message, e.filename, e.lineno, e.error);
  try {
    logError('runtime', e.message || 'Uncaught error', {
      stack: e.error?.stack,
      context: `${e.filename}:${e.lineno}`,
      severity: 'high',
    });
  } catch { /* never throw inside global handler */ }
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[Henry:renderer] Unhandled rejection:', e.reason);
  try {
    const msg = e.reason instanceof Error
      ? e.reason.message
      : String(e.reason ?? 'Unhandled promise rejection');
    logError('runtime', msg, {
      stack: e.reason instanceof Error ? e.reason.stack : undefined,
      severity: 'medium',
    });
  } catch { /* never throw inside global handler */ }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HenrySelfRepairBoundary>
      <App />
    </HenrySelfRepairBoundary>
  </React.StrictMode>
);

// Initialize Capacitor native integrations after React mounts
// Safe to call on web — guards internally with isNative check
void initCapacitor();
