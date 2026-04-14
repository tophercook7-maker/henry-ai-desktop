/**
 * Henry AI — Shared Google Auth State
 *
 * Single connection, three services (Gmail, Calendar, Drive).
 * All panels subscribe here.
 *
 * FLOW PRIORITY
 *   1. Desktop (Electron) — PKCE + loopback via main-process IPC
 *      `window.henryAPI.googleStartAuth` is available
 *   2. Web fallback — short-lived access token entered manually
 *      Used in the browser preview and as the Advanced option
 *
 * TOKEN CACHING
 *   The main process holds the refresh token (encrypted with safeStorage).
 *   The renderer stores the short-lived access token + expiry in localStorage
 *   so `getGoogleToken()` stays synchronous for all API helpers.
 *   `syncTokenFromMain()` is called at init and whenever a refresh is needed.
 */

import { create } from 'zustand';
import { getGoogleToken, setGoogleToken, removeGoogleToken } from './integrations';

export type GoogleConnectionStatus =
  | 'disconnected'
  | 'connecting'    // PKCE flow in progress
  | 'refreshing'    // silent background refresh
  | 'connected'
  | 'expired'       // refresh token revoked — user must re-authorize
  | 'error';        // unexpected error; errorMessage holds detail

const EXPIRY_KEY    = 'henry:google_token_expiry';
const CLIENT_ID_KEY = 'henry:google_client_id';
const CLIENT_SEC_KEY= 'henry:google_client_secret';

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getGoogleClientId(): string {
  return (localStorage.getItem(CLIENT_ID_KEY) ?? '').trim();
}
export function setGoogleClientId(id: string): void {
  localStorage.setItem(CLIENT_ID_KEY, id);
}
export function getGoogleClientSecret(): string {
  return (localStorage.getItem(CLIENT_SEC_KEY) ?? '').trim();
}
export function setGoogleClientSecret(secret: string): void {
  localStorage.setItem(CLIENT_SEC_KEY, secret);
}

function getStoredExpiry(): number | null {
  const raw = localStorage.getItem(EXPIRY_KEY);
  return raw ? Number(raw) : null;
}
function storeExpiry(expiry: number): void {
  localStorage.setItem(EXPIRY_KEY, String(expiry));
}
function clearExpiry(): void {
  localStorage.removeItem(EXPIRY_KEY);
}

/** True if `window.henryAPI` has the desktop Google OAuth methods. */
function isDesktopFlowAvailable(): boolean {
  return typeof (window as any).henryAPI?.googleStartAuth === 'function';
}

// ── Store ─────────────────────────────────────────────────────────────────────

export interface GoogleProfile {
  email:    string;
  name:     string;
  picture?: string;
}

interface GoogleState {
  status:       GoogleConnectionStatus;
  profile:      GoogleProfile | null;
  expiresAt:    number | null;
  errorMessage: string | null;

  /** Primary: PKCE desktop flow (Electron only). */
  startDesktopAuth: () => Promise<void>;

  /** Secondary/fallback: caller already has an access token. */
  connect: (token: string, expiresAt?: number) => Promise<void>;

  /** Silent background refresh via IPC. */
  silentRefresh: () => Promise<void>;

  /** Called when main process detects refresh token revocation. */
  handleRevoked: () => void;

  /** Disconnect and wipe all credentials. */
  disconnect: () => void;

  /** Called on app init — restores state from storage / main process. */
  restoreFromStorage: () => Promise<void>;
}

export const useGoogleStore = create<GoogleState>((set, get) => ({
  status:       getGoogleToken() ? 'connected' : 'disconnected',
  profile:      null,
  expiresAt:    getStoredExpiry(),
  errorMessage: null,

  // ── Desktop PKCE flow ───────────────────────────────────────────────────────

  startDesktopAuth: async () => {
    const clientId     = getGoogleClientId();
    const clientSecret = getGoogleClientSecret();
    if (!clientId || !clientSecret) {
      set({ status: 'error', errorMessage: 'Enter your Google Client ID and Secret first.' });
      return;
    }

    set({ status: 'connecting', errorMessage: null });
    try {
      const api    = (window as any).henryAPI;
      const result = await api.googleStartAuth(clientId, clientSecret) as {
        accessToken: string; expiresAt: number;
      };

      setGoogleToken(result.accessToken);
      storeExpiry(result.expiresAt);
      set({ status: 'connected', expiresAt: result.expiresAt, errorMessage: null });

      // Fetch profile in background
      void fetchGoogleProfile(result.accessToken).then((profile) => {
        if (profile) set({ profile });
      });
    } catch (err: unknown) {
      const msg = (err as Error)?.message ?? 'Authorization failed. Please try again.';
      set({ status: 'error', errorMessage: msg });
    }
  },

  // ── Manual token fallback ───────────────────────────────────────────────────

  connect: async (token: string, expiresAt?: number) => {
    setGoogleToken(token);
    if (expiresAt) storeExpiry(expiresAt);
    set({ status: 'connected', expiresAt: expiresAt ?? null, errorMessage: null });
    try {
      const profile = await fetchGoogleProfile(token);
      if (profile) set({ profile });
    } catch { /* ignore */ }
  },

  // ── Silent refresh ──────────────────────────────────────────────────────────

  silentRefresh: async () => {
    if (!isDesktopFlowAvailable()) return;
    const clientId     = getGoogleClientId();
    const clientSecret = getGoogleClientSecret();
    if (!clientId || !clientSecret) return;

    const current = get().status;
    if (current === 'refreshing' || current === 'connecting') return;

    set({ status: 'refreshing' });
    try {
      const api    = (window as any).henryAPI;
      const result = await api.googleRefreshToken(clientId, clientSecret) as {
        accessToken: string; expiresAt: number;
      };
      setGoogleToken(result.accessToken);
      storeExpiry(result.expiresAt);
      set({ status: 'connected', expiresAt: result.expiresAt, errorMessage: null });
    } catch (err: unknown) {
      const msg = (err as Error)?.message ?? '';
      if (msg.includes('revoked') || msg.includes('invalid_grant')) {
        get().handleRevoked();
      } else {
        // Transient error — stay connected, don't lose the old token
        set({ status: 'connected' });
      }
    }
  },

  // ── Revocation ──────────────────────────────────────────────────────────────

  handleRevoked: () => {
    removeGoogleToken();
    clearExpiry();
    set({
      status:       'expired',
      profile:      null,
      expiresAt:    null,
      errorMessage: 'Your Google authorization was revoked. Please reconnect.',
    });
  },

  // ── Disconnect ──────────────────────────────────────────────────────────────

  disconnect: () => {
    removeGoogleToken();
    clearExpiry();
    set({ status: 'disconnected', profile: null, expiresAt: null, errorMessage: null });
    // Tell the main process to wipe credentials too
    if (isDesktopFlowAvailable()) {
      void (window as any).henryAPI.googleDisconnect();
    }
  },

  // ── Restore from storage ────────────────────────────────────────────────────

  restoreFromStorage: async () => {
    // Check if the main process already has long-lived credentials
    if (isDesktopFlowAvailable()) {
      const clientId     = getGoogleClientId();
      const clientSecret = getGoogleClientSecret();

      if (clientId && clientSecret) {
        try {
          const api         = (window as any).henryAPI;
          const hasCreds    = await api.googleHasCredentials() as boolean;

          if (hasCreds) {
            // Get a valid (possibly auto-refreshed) access token from main process
            const result = await api.googleGetToken(clientId, clientSecret) as {
              accessToken: string; expiresAt: number;
            } | null;

            if (result) {
              setGoogleToken(result.accessToken);
              storeExpiry(result.expiresAt);
              set({ status: 'connected', expiresAt: result.expiresAt });
              void fetchGoogleProfile(result.accessToken).then((p) => {
                if (p) set({ profile: p });
              });
              return;
            } else {
              // Credentials exist but refresh failed — mark revoked
              get().handleRevoked();
              return;
            }
          }
        } catch {
          // IPC unavailable or failed — fall through to localStorage check
        }
      }
    }

    // Fallback: use whatever token is still in localStorage
    const token = getGoogleToken();
    if (token) {
      const expiry = getStoredExpiry();
      // If stored token is expired (manual token flow), mark it expired
      if (expiry && expiry < Date.now()) {
        set({ status: 'expired' });
        return;
      }
      set({ status: 'connected', expiresAt: expiry });
      void fetchGoogleProfile(token).then((p) => {
        if (p) set({ profile: p });
      });
    } else {
      set({ status: 'disconnected' });
    }
  },
}));

// ── Profile fetch ─────────────────────────────────────────────────────────────

async function fetchGoogleProfile(token: string): Promise<GoogleProfile | null> {
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const d = await r.json();
    return { email: d.email ?? '', name: d.name ?? d.email ?? '', picture: d.picture };
  } catch {
    return null;
  }
}

// ── Token-revoked listener ────────────────────────────────────────────────────
// Set up once at module load when running in Electron.

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    const api = (window as any).henryAPI;
    if (typeof api?.onGoogleTokenRevoked === 'function') {
      api.onGoogleTokenRevoked(() => {
        useGoogleStore.getState().handleRevoked();
      });
    }
  });
}

export function isGoogleExpiredError(status: number): boolean {
  return status === 401 || status === 403;
}
