/**
 * Device Link Panel — Desktop side
 *
 * Shows in Henry Settings → "Companion Devices".
 * Lets the user:
 *   - Start the sync server
 *   - Generate a pairing QR / code for iPhone/iPad
 *   - See linked devices
 *   - Unlink devices
 */

import { useEffect, useState, useCallback } from 'react';
import type { SyncServerState } from '../../sync/types';
import { buildPairCodePayload } from '../../sync/deviceLink';

const isElectron = typeof window !== 'undefined' && !!window.henryAPI?.syncGetState;

export default function DeviceLinkPanel() {
  const [serverState, setServerState] = useState<SyncServerState | null>(null);
  const [pairCode, setPairCode] = useState<string | null>(null);
  const [codeExpiry, setCodeExpiry] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const loadState = useCallback(async () => {
    if (!isElectron) return;
    try {
      const state = await window.henryAPI.syncGetState();
      setServerState(state);
      if (state.pairToken && state.pairTokenExpiry) {
        const payload = buildPairCodePayload(
          state.localIp,
          state.port,
          state.pairToken
        );
        setPairCode(payload);
        setCodeExpiry(state.pairTokenExpiry);
      }
    } catch {
      // electron not available
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  // Countdown timer for pair code
  useEffect(() => {
    if (!codeExpiry) return;
    const tick = () => {
      const remaining = Math.max(0, Math.floor((codeExpiry - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining === 0) {
        setPairCode(null);
        setCodeExpiry(null);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [codeExpiry]);

  async function startServer() {
    if (!isElectron) return;
    setLoading(true);
    try {
      await window.henryAPI.syncStart();
      await loadState();
    } finally {
      setLoading(false);
    }
  }

  async function generateCode() {
    if (!isElectron) return;
    setLoading(true);
    try {
      if (!serverState?.running) await window.henryAPI.syncStart();
      const token = await window.henryAPI.syncGeneratePairToken();
      const state = await window.henryAPI.syncGetState();
      setServerState(state);
      const payload = buildPairCodePayload(
        state.localIp,
        state.port,
        token
      );
      setPairCode(payload);
      setCodeExpiry(Date.now() + 5 * 60 * 1000);
    } finally {
      setLoading(false);
    }
  }

  async function revokeCode() {
    if (!isElectron) return;
    await window.henryAPI.syncRevokePairToken();
    setPairCode(null);
    setCodeExpiry(null);
  }

  async function unlinkDevice(deviceId: string) {
    if (!isElectron) return;
    await window.henryAPI.syncUnlinkDevice(deviceId);
    await loadState();
  }

  const shortCode = pairCode
    ? (() => {
        try {
          const parsed = JSON.parse(pairCode);
          return `${parsed.h}:${parsed.p}:${parsed.t}`;
        } catch {
          return pairCode;
        }
      })()
    : null;

  if (!isElectron) {
    return (
      <div className="p-4 rounded-2xl bg-henry-surface border border-henry-border/20 text-center">
        <p className="text-sm text-henry-text-muted">
          Companion device linking is only available in the desktop (Electron) app.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Server status */}
      <div className="bg-henry-surface rounded-2xl border border-henry-border/20 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-henry-text">Companion Sync Server</p>
            <p className="text-xs text-henry-text-muted mt-0.5">
              {serverState?.running
                ? `Running on ${serverState.localIp}:${serverState.port}`
                : 'Not running'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div
              className={`w-2 h-2 rounded-full ${
                serverState?.running ? 'bg-henry-success' : 'bg-henry-text-muted'
              }`}
            />
            {!serverState?.running && (
              <button
                onClick={() => void startServer()}
                disabled={loading}
                className="px-3 py-1.5 rounded-lg bg-henry-accent text-white text-xs font-medium active:bg-henry-accent/80 transition-colors disabled:opacity-50"
              >
                Start
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Add device */}
      <div className="bg-henry-surface rounded-2xl border border-henry-border/20 p-4 space-y-4">
        <div>
          <p className="text-sm font-semibold text-henry-text">Add iPhone or iPad</p>
          <p className="text-xs text-henry-text-muted mt-0.5">
            Generate a pairing code, then enter it in Henry on your iPhone or iPad.
          </p>
        </div>

        {pairCode ? (
          <div className="space-y-3">
            {/* QR display via external service */}
            <div className="flex justify-center">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(pairCode)}&bgcolor=0a0a12&color=a5b4fc`}
                alt="Pairing QR code"
                className="w-44 h-44 rounded-2xl border border-henry-border/20"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            </div>

            {/* Manual code */}
            <div className="bg-henry-bg rounded-xl px-4 py-3 space-y-1">
              <p className="text-[10px] font-medium text-henry-text-muted uppercase tracking-wider">
                Manual entry code
              </p>
              <p className="text-sm font-mono text-henry-accent break-all select-all">
                {shortCode}
              </p>
            </div>

            {/* Expiry countdown */}
            <div className="flex items-center justify-between">
              <p className="text-xs text-henry-text-muted">
                Code expires in {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
              </p>
              <button
                onClick={() => void revokeCode()}
                className="text-xs text-henry-error active:opacity-60 transition-opacity"
              >
                Revoke
              </button>
            </div>

            <div className="bg-henry-accent/10 border border-henry-accent/20 rounded-xl px-3 py-2.5">
              <p className="text-xs text-henry-accent leading-relaxed">
                On your iPhone/iPad: Open Henry → Companion Devices → Connect to Desktop → enter the code above.
                Both devices must be on the same WiFi network.
              </p>
            </div>
          </div>
        ) : (
          <button
            onClick={() => void generateCode()}
            disabled={loading}
            className="w-full py-3.5 rounded-xl bg-henry-accent text-white text-sm font-semibold active:bg-henry-accent/80 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Generating…
              </>
            ) : (
              'Generate Pairing Code'
            )}
          </button>
        )}
      </div>

      {/* Linked devices */}
      {serverState?.linkedDevices && serverState.linkedDevices.length > 0 && (
        <div className="bg-henry-surface rounded-2xl border border-henry-border/20 p-4 space-y-3">
          <p className="text-sm font-semibold text-henry-text">
            Linked Devices ({serverState.linkedDevices.length})
          </p>
          {serverState.linkedDevices.map((device) => (
            <div
              key={device.id}
              className="flex items-center gap-3 bg-henry-bg rounded-xl px-3 py-2.5"
            >
              <span className="text-xl shrink-0">
                {device.platform === 'ios' ? '📱' : device.platform === 'android' ? '🤖' : '💻'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-henry-text truncate">{device.name}</p>
                <p className="text-[10px] text-henry-text-muted">
                  {device.platform} · Linked {new Date(device.linkedAt).toLocaleDateString()}
                  {device.lastSeen && ` · Seen ${formatAge(Date.now() - new Date(device.lastSeen).getTime())} ago`}
                </p>
              </div>
              <button
                onClick={() => void unlinkDevice(device.id)}
                className="text-xs text-henry-error active:opacity-60 transition-opacity shrink-0"
              >
                Unlink
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Cloud relay note */}
      <div className="bg-henry-surface rounded-2xl border border-henry-border/20 p-4 space-y-2">
        <p className="text-sm font-semibold text-henry-text">Cloud Relay (Phase 2)</p>
        <p className="text-xs text-henry-text-muted leading-relaxed">
          Currently, sync requires your iPhone/iPad and Mac to be on the same WiFi network.
          Cloud relay support (allowing sync from anywhere) is coming in the next update.
        </p>
      </div>
    </div>
  );
}

function formatAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}
