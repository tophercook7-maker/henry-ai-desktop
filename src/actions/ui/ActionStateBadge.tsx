/**
 * Action Layer UI — ActionStateBadge.
 *
 * A tiny inline badge showing the current state of an action.
 * Used inside ActionButton and ActionMenu to give live feedback.
 *
 * Usage:
 *   <ActionStateBadge status="running" />
 *   <ActionStateBadge status="success" message="Issue created" />
 *   <ActionStateBadge status="error"   message="Failed to send" />
 */

import type { ActionStatus } from '../types/actionTypes';

interface Props {
  status: ActionStatus;
  message?: string;
  className?: string;
}

const CONFIG: Record<
  ActionStatus,
  { label: string; icon: string; classes: string } | null
> = {
  idle:               null,
  running:            { label: 'Working…',      icon: '↻',  classes: 'text-henry-accent' },
  success:            { label: 'Done',           icon: '✓',  classes: 'text-henry-success' },
  error:              { label: 'Failed',         icon: '✗',  classes: 'text-henry-error' },
  needs_confirmation: { label: 'Confirm first',  icon: '!',  classes: 'text-henry-warning' },
};

export default function ActionStateBadge({ status, message, className = '' }: Props) {
  const cfg = CONFIG[status];
  if (!cfg) return null;

  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium ${cfg.classes} ${className}`}
    >
      <span className={status === 'running' ? 'inline-block animate-spin' : ''}>{cfg.icon}</span>
      {message ?? cfg.label}
    </span>
  );
}
