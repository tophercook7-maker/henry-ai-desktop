/**
 * Connection Layer — selectors.
 *
 * Use these in components instead of writing inline selector functions.
 * All selectors are reactive — components re-render only when the
 * selected value actually changes.
 *
 * Usage:
 *   const status = useConnectionStore(selectStatus('slack'));
 *   const profile = useConnectionStore(selectGoogleProfile);
 *   const isConnected = useConnectionStore(selectIsConnected('github'));
 */

import type { ConnectionsState } from './connectionStore';
import type { ConnectionStatus, GoogleProfile } from '../types/connectionTypes';

/** Select connection status for any service ID. Google services share one status. */
export function selectStatus(serviceId: string) {
  return (s: ConnectionsState): ConnectionStatus => s.getStatus(serviceId);
}

/** Select the Google account profile (name, email, picture). */
export const selectGoogleProfile = (s: ConnectionsState): GoogleProfile | null =>
  s.getGoogleProfile();

/** Select a boolean — true only when status is exactly 'connected'. */
export function selectIsConnected(serviceId: string) {
  return (s: ConnectionsState): boolean => s.getStatus(serviceId) === 'connected';
}

/** Select true when the connection exists but has expired — i.e., reconnect needed. */
export function selectNeedsReconnect(serviceId: string) {
  return (s: ConnectionsState): boolean => s.getStatus(serviceId) === 'expired';
}

/** Select the full connections map for the integrations hub. */
export const selectAllConnections = (s: ConnectionsState) => s.connections;
