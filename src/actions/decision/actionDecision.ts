/**
 * Henry AI — Action Decision Layer
 *
 * Governs WHEN Henry acts vs. asks permission vs. offers vs. stops.
 *
 * Four modes:
 *   act     — safe to run immediately (read-only, or internal compose)
 *   confirm — write to an external system; Henry asks first
 *   suggest — Henry notices something useful and offers it, does not run
 *   block   — service not connected or auth expired; Henry explains naturally
 *
 * Architecture:
 *   - Reads action definitions from the registry (requiresConnection,
 *     requiresConfirmation, readonly, service, category)
 *   - Reads live connection state via isConnected() from integrations.ts
 *   - Returns a decision + a human-readable message for every action
 *   - Never exposes internals in messages
 */

import { REGISTRY } from '../registry/actionRegistry';
import { isConnected } from '../../henry/integrations';
import {
  actionReconnectMessage,
  actionNotConnectedMessage,
  actionConfirmMessage,
  serviceDisplayName,
} from '../voice/actionVoice';
import type { ActionId, ActionCategory } from '../types/actionTypes';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * The four decision modes for any action:
 *
 *   act     → run immediately, no confirmation needed
 *   confirm → ready to run, but Henry checks with the user first
 *   suggest → Henry offers the action proactively but does not execute
 *   block   → cannot run until connection / auth is fixed
 */
export type ActionMode = 'act' | 'confirm' | 'suggest' | 'block';

export interface ActionDecision {
  /** Which execution mode applies right now. */
  mode: ActionMode;
  /**
   * Human-readable message for the user.
   * - block   → why it cannot run and what to do
   * - confirm → what Henry is about to do, asking permission
   * - act     → what Henry is starting (use as the "start" message)
   * - suggest → Henry's offer phrasing
   */
  message: string;
  /** Only present for block decisions — the underlying reason. */
  blockReason?: 'not_connected' | 'auth_expired';
}

// ── Policy helpers (exported for use in UI and handlers) ─────────────────────

/**
 * True if the action is purely read-only and does not write to any
 * external service. These actions may run without confirmation.
 */
export function isReadOnly(id: ActionId): boolean {
  return REGISTRY[id]?.readonly === true;
}

/**
 * True if the action must be confirmed by the user before execution.
 * Derived from the registry `requiresConfirmation` flag.
 */
export function requiresConfirmation(id: ActionId): boolean {
  return REGISTRY[id]?.requiresConfirmation === true;
}

/**
 * True if the required service is currently connected.
 * Actions that do not require a connection always return true.
 */
export function canRunNow(id: ActionId): boolean {
  const action = REGISTRY[id];
  if (!action) return false;
  if (!action.requiresConnection) return true;
  return isConnected(action.service);
}

/**
 * Natural-language reason why an action is blocked, or null if not blocked.
 */
export function getBlockReason(id: ActionId): string | null {
  const action = REGISTRY[id];
  if (!action) return 'This action is not available.';
  if (!action.requiresConnection) return null;
  if (!isConnected(action.service)) {
    return actionNotConnectedMessage(action.service);
  }
  return null;
}

/**
 * Returns the service name for a given action (display-friendly).
 */
export function getServiceName(id: ActionId): string {
  const service = REGISTRY[id]?.service ?? '';
  return serviceDisplayName(service);
}

// ── Core decision resolver ────────────────────────────────────────────────────

/**
 * Returns the full decision for an action given current state.
 *
 * Decision priority:
 *   1. If service is not connected → block
 *   2. If action requiresConfirmation → confirm
 *   3. If action is read-only OR category is chat/query/compose → act
 *   4. Otherwise → confirm (default safe for unknown write actions)
 */
export function getActionDecision(id: ActionId): ActionDecision {
  const action = REGISTRY[id];

  if (!action) {
    return {
      mode: 'block',
      message: 'That action is not available.',
      blockReason: 'not_connected',
    };
  }

  // ── Step 1: Check connection ──────────────────────────────────────────────
  if (action.requiresConnection && !isConnected(action.service)) {
    return {
      mode: 'block',
      message: actionNotConnectedMessage(action.service),
      blockReason: 'not_connected',
    };
  }

  // ── Step 2: Confirm required by registry ─────────────────────────────────
  if (action.requiresConfirmation) {
    const confirmMsg = actionConfirmMessage(id, action.category as ActionCategory);
    return {
      mode: 'confirm',
      message: confirmMsg || `Ready to ${action.label.toLowerCase()} — want me to go ahead?`,
    };
  }

  // ── Step 3: Safe to act immediately ──────────────────────────────────────
  // Read-only actions, or actions that compose locally without external writes
  return {
    mode: 'act',
    message: `Starting: ${action.label}`,
  };
}

/**
 * Lightweight: just the mode, no message. Useful for conditional rendering.
 */
export function getActionMode(id: ActionId): ActionMode {
  return getActionDecision(id).mode;
}

// ── Category-level policy (for runtime decisions without a specific ActionId) ─

/**
 * Actions in these categories can run immediately without confirmation.
 * They are either read-only lookups or local-only compose operations.
 */
const IMMEDIATE_CATEGORIES: ActionCategory[] = ['chat', 'query', 'compose'];

export function categoryRequiresConfirmation(category: ActionCategory): boolean {
  return !IMMEDIATE_CATEGORIES.includes(category);
}

// ── Batch decisions (for rendering an action list) ────────────────────────────

/**
 * Returns decision objects for all actions, optionally filtered by service.
 */
export function getAllDecisions(serviceId?: string): Map<ActionId, ActionDecision> {
  const result = new Map<ActionId, ActionDecision>();
  const ids = (Object.keys(REGISTRY) as ActionId[]).filter(
    (id) => !serviceId || REGISTRY[id].service === serviceId,
  );
  for (const id of ids) {
    result.set(id, getActionDecision(id));
  }
  return result;
}

/**
 * Returns only the action IDs that can run immediately (act mode).
 */
export function getImmediateActions(serviceId?: string): ActionId[] {
  const ids = (Object.keys(REGISTRY) as ActionId[]).filter(
    (id) => !serviceId || REGISTRY[id].service === serviceId,
  );
  return ids.filter((id) => getActionMode(id) === 'act');
}

/**
 * Returns only the action IDs that are blocked by missing connection.
 */
export function getBlockedActions(serviceId?: string): ActionId[] {
  const ids = (Object.keys(REGISTRY) as ActionId[]).filter(
    (id) => !serviceId || REGISTRY[id].service === serviceId,
  );
  return ids.filter((id) => getActionMode(id) === 'block');
}
