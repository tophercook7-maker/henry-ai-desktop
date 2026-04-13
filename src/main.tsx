import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';
import './webMock';
import { initCapacitor } from './capacitor';

// ── Temporary renderer diagnostics — remove when black-screen root cause confirmed ──
window.addEventListener('error', (e) => {
  console.error('[Henry:renderer] Uncaught error:', e.message, e.filename, e.lineno, e.error);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[Henry:renderer] Unhandled rejection:', e.reason);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Initialize Capacitor native integrations after React mounts
// Safe to call on web — guards internally with isNative check
void initCapacitor();
