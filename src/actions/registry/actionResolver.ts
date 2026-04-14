/**
 * Action Layer — resolver.
 *
 * Answers "what actions can Henry run right now?" for a given service,
 * taking connection status and capability requirements into account.
 *
 * Usage:
 *   const available = resolveActions('github');   // ActionId[]
 *   const blocked   = resolveBlockedActions('gcal'); // with reason
 */

import { useConnectionStore } from '../../connections/store/connectionStore';
import type { ActionId } from '../types/actionTypes';
import { ACTION_CAPABILITIES } from '../types/actionCapabilities';
import { REGISTRY } from './actionRegistry';

export interface ResolvedAction {
  id: ActionId;
  available: boolean;
  blockedReason?: string;
  needsConfirmation: boolean;
  isWrite: boolean;
}

/**
 * Resolve which actions are available for a service right now.
 * Checks: (1) service connected, (2) action enabled in registry.
 */
export function resolveActions(serviceId: string): ResolvedAction[] {
  const store = useConnectionStore.getState();
  const status = store.getStatus(serviceId);
  const connected = status === 'connected';

  return Object.entries(REGISTRY)
    .filter(([, def]) => def.service === serviceId)
    .map(([id, def]) => {
      const cap = ACTION_CAPABILITIES[id as ActionId];

      if (!def.enabled) {
        return {
          id: id as ActionId,
          available: false,
          blockedReason: 'Coming soon',
          needsConfirmation: cap?.needsConfirmation ?? false,
          isWrite: cap?.isWrite ?? false,
        };
      }

      if (!connected) {
        return {
          id: id as ActionId,
          available: false,
          blockedReason: `${serviceId} is not connected`,
          needsConfirmation: cap?.needsConfirmation ?? false,
          isWrite: cap?.isWrite ?? false,
        };
      }

      return {
        id: id as ActionId,
        available: true,
        needsConfirmation: cap?.needsConfirmation ?? false,
        isWrite: cap?.isWrite ?? false,
      };
    });
}

/**
 * Returns only the IDs that are currently executable.
 */
export function getAvailableActionIds(serviceId: string): ActionId[] {
  return resolveActions(serviceId)
    .filter((a) => a.available)
    .map((a) => a.id);
}

/**
 * Check a single action — returns whether it can run and why not if blocked.
 */
export function canRunAction(id: ActionId): { ok: boolean; reason?: string } {
  const cap = ACTION_CAPABILITIES[id];
  if (!cap) return { ok: false, reason: 'Unknown action' };

  const store = useConnectionStore.getState();
  const status = store.getStatus(cap.service);

  if (status !== 'connected') {
    return { ok: false, reason: `${cap.service} is not connected` };
  }

  const def = REGISTRY[id];
  if (!def?.enabled) {
    return { ok: false, reason: 'This action is not yet implemented' };
  }

  return { ok: true };
}
