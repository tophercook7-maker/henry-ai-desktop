/**
 * Henry AI — Shared Brain State
 * The single source of truth that bridges the background brain and the front brain.
 * The background brain writes here. The coordinator and charter.ts read from here.
 * Never write to this directly from UI components — only the background brain updates it.
 */

import { create } from 'zustand';
import type { PrioritySnapshot } from '../henry/priority/priorityTypes';
import type { AwarenessSnapshot } from '../henry/awarenessStore';

export type ConnectionStatus = 'healthy' | 'expiring' | 'disconnected' | 'unknown';

export interface BrainConnectionHealth {
  service: string;
  status: ConnectionStatus;
  note?: string;
}

export interface BrainSuggestedAction {
  id: string;
  label: string;
  reason: string;
  priority: number;
}

export interface SharedBrainState {
  // ── Priority (pre-computed by background brain) ──────────────────────────
  prioritySnapshot: PrioritySnapshot | null;
  priorityReadyAt: number | null;

  // ── Awareness (pre-computed) ─────────────────────────────────────────────
  awarenessSnapshot: AwarenessSnapshot | null;
  awarenessReadyAt: number | null;

  // ── Connection health ────────────────────────────────────────────────────
  connectionHealth: BrainConnectionHealth[];
  reconnectNeeded: string[];

  // ── Coordinator output (what the front brain actually uses) ───────────────
  /** Items ready to be surfaced proactively in conversation. Coordinator-filtered. */
  surfaceNow: string[];
  /** Current top focus — one plain-language string. */
  topFocus: string | null;
  /** Items explicitly suppressed (too soon to repeat, low value). */
  keepQuiet: string[];
  /** Connection/auth alerts worth mentioning. */
  connectionAlerts: string[];

  // ── Continuity ───────────────────────────────────────────────────────────
  /** Primary active thread title (plain string for quick reference). */
  activeThread: string | null;
  /** Secondary thread titles — other arcs in motion. */
  secondaryThreads: string[];
  unresolvedCount: number;

  // ── Background brain meta ─────────────────────────────────────────────────
  lastBackgroundRun: number | null;
  backgroundRunning: boolean;
  runCount: number;

  // ── Mutations (only used by background brain + coordinator) ───────────────
  _setPrioritySnapshot: (s: PrioritySnapshot) => void;
  _setAwarenessSnapshot: (s: AwarenessSnapshot) => void;
  _setConnectionHealth: (h: BrainConnectionHealth[]) => void;
  _setCoordinatorOutput: (output: {
    surfaceNow: string[];
    topFocus: string | null;
    keepQuiet: string[];
    connectionAlerts: string[];
    activeThread: string | null;
    secondaryThreads: string[];
    unresolvedCount: number;
  }) => void;
  _setBackgroundRunning: (running: boolean) => void;
  _markBackgroundRun: () => void;
}

export const useSharedBrainState = create<SharedBrainState>((set) => ({
  prioritySnapshot: null,
  priorityReadyAt: null,
  awarenessSnapshot: null,
  awarenessReadyAt: null,
  connectionHealth: [],
  reconnectNeeded: [],
  surfaceNow: [],
  topFocus: null,
  keepQuiet: [],
  connectionAlerts: [],
  activeThread: null,
  secondaryThreads: [],
  unresolvedCount: 0,
  lastBackgroundRun: null,
  backgroundRunning: false,
  runCount: 0,

  _setPrioritySnapshot: (s) => set({ prioritySnapshot: s, priorityReadyAt: Date.now() }),
  _setAwarenessSnapshot: (s) => set({ awarenessSnapshot: s, awarenessReadyAt: Date.now() }),
  _setConnectionHealth: (h) => set({
    connectionHealth: h,
    reconnectNeeded: h.filter((x) => x.status === 'disconnected' || x.status === 'expiring').map((x) => x.service),
  }),
  _setCoordinatorOutput: (output) => set(output),
  _setBackgroundRunning: (running) => set({ backgroundRunning: running }),
  _markBackgroundRun: () => set((s) => ({ lastBackgroundRun: Date.now(), runCount: s.runCount + 1 })),
}));

/** Read-only snapshot of shared state for charter.ts (no React hook required). */
export function getSharedBrainState() {
  return useSharedBrainState.getState();
}
