import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';
import './webMock';
import { initCapacitor } from './capacitor';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Initialize Capacitor native integrations after React mounts
// Safe to call on web — guards internally with isNative check
void initCapacitor();
