import React from 'react';

// ── Global renderer error safety ─────────────────────────────────────────────
// Catch unhandled JS errors and promise rejections in the renderer
// Sends them to main process for logging without crashing the whole app
window.addEventListener('error', (e) => {
  console.error('[Henry renderer] Uncaught error:', e.error?.message || e.message);
  // Don't show alert for minor errors - just log
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[Henry renderer] Unhandled rejection:', e.reason?.message || e.reason);
  e.preventDefault(); // Prevent default crash behavior
});
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
