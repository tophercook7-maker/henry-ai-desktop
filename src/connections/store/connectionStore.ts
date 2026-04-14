/**
 * Connection Layer — central Zustand store.
 *
 * This is the authoritative source of truth for all external service
 * connection state. All panels read from here; none manage their own.
 *
 * Google (Gmail, Calendar, Drive) share a single connection record.
 * All other services have independent records keyed by service ID.
 */

import { create } from 'zustand';
import {
  getToken, setToken, removeToken,
  getGoogleToken, setGoogleToken, removeGoogleToken, isGoogleConnected,
  isConnected,
} from '../../henry/integrations';
import type {
  ConnectionStatus,
  GoogleProfile,
  ServiceConnection,
  GoogleConnection,
} from '../types/connectionTypes';

export type { ConnectionStatus, GoogleProfile, ServiceConnection, GoogleConnection };

const GOOGLE_SERVICES = new Set(['gmail', 'gcal', 'gdrive']);
const TOKEN_SERVICES = ['slack', 'github', 'notion', 'linear', 'stripe'] as const;

function googleStatusFromStorage(): ConnectionStatus {
  return isGoogleConnected() ? 'connected' : 'disconnected';
}

function tokenStatusFromStorage(id: string): ConnectionStatus {
  return isConnected(id) ? 'connected' : 'disconnected';
}

function initConnections(): {
  google: GoogleConnection;
  [key: string]: ServiceConnection | GoogleConnection;
} {
  const google: GoogleConnection = {
    status: googleStatusFromStorage(),
    profile: null,
    connectedAt: undefined,
  };
  const rest: Record<string, ServiceConnection> = {};
  for (const id of TOKEN_SERVICES) {
    rest[id] = { status: tokenStatusFromStorage(id) };
  }
  return { google, ...rest };
}

export interface ConnectionsState {
  connections: {
    google: GoogleConnection;
    [key: string]: ServiceConnection | GoogleConnection;
  };

  getStatus: (serviceId: string) => ConnectionStatus;
  getGoogleProfile: () => GoogleProfile | null;

  connectGoogle: (token: string) => Promise<void>;
  disconnectGoogle: () => void;

  connectService: (serviceId: string, token: string) => void;
  disconnectService: (serviceId: string) => void;

  markExpired: (serviceId: string) => void;
}

export const useConnectionStore = create<ConnectionsState>((set, get) => ({
  connections: initConnections(),

  getStatus: (serviceId: string): ConnectionStatus => {
    const key = GOOGLE_SERVICES.has(serviceId) ? 'google' : serviceId;
    return get().connections[key]?.status ?? 'disconnected';
  },

  getGoogleProfile: (): GoogleProfile | null => {
    return (get().connections.google as GoogleConnection).profile ?? null;
  },

  connectGoogle: async (token: string) => {
    setGoogleToken(token);
    set((s) => ({
      connections: {
        ...s.connections,
        google: { ...s.connections.google, status: 'connected', connectedAt: Date.now() },
      },
    }));
    try {
      const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const d = await r.json();
        const profile: GoogleProfile = {
          email: d.email || '',
          name: d.name || d.email || '',
          picture: d.picture,
        };
        set((s) => ({
          connections: {
            ...s.connections,
            google: { ...(s.connections.google as GoogleConnection), profile },
          },
        }));
      }
    } catch { /* profile fetch is best-effort */ }
  },

  disconnectGoogle: () => {
    removeGoogleToken();
    set((s) => ({
      connections: {
        ...s.connections,
        google: { status: 'disconnected', profile: null },
      },
    }));
  },

  connectService: (serviceId: string, token: string) => {
    setToken(serviceId, token);
    set((s) => ({
      connections: {
        ...s.connections,
        [serviceId]: { status: 'connected', connectedAt: Date.now() },
      },
    }));
  },

  disconnectService: (serviceId: string) => {
    removeToken(serviceId);
    set((s) => ({
      connections: {
        ...s.connections,
        [serviceId]: { status: 'disconnected' },
      },
    }));
  },

  markExpired: (serviceId: string) => {
    const key = GOOGLE_SERVICES.has(serviceId) ? 'google' : serviceId;
    set((s) => ({
      connections: {
        ...s.connections,
        [key]: { ...s.connections[key], status: 'expired' },
      },
    }));
  },
}));

/** Backward-compat: retained so existing useGoogleStore() calls still work */
export function useGoogleStore() {
  const store = useConnectionStore();
  const google = store.connections.google as GoogleConnection;
  return {
    status: google.status,
    profile: google.profile,
    connect: store.connectGoogle,
    disconnect: store.disconnectGoogle,
    markExpired: () => store.markExpired('google'),
  };
}
