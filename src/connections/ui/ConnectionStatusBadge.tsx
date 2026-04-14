/**
 * Connection Layer — status badge.
 *
 * Shows a small inline pill reflecting the current connection status.
 * Import and drop next to any service name in a list or header.
 *
 * Usage:
 *   const status = useConnectionStore(selectStatus('slack'));
 *   <ConnectionStatusBadge status={status} />
 */

import type { ConnectionStatus } from '../types/connectionTypes';

interface Props {
  status: ConnectionStatus;
  showLabel?: boolean;
  size?: 'sm' | 'md';
}

const CONFIG: Record<ConnectionStatus, { dot: string; label: string; text: string }> = {
  connected:    { dot: 'bg-henry-success',        label: 'Connected',    text: 'text-henry-success' },
  connecting:   { dot: 'bg-henry-accent animate-pulse', label: 'Connecting…', text: 'text-henry-accent' },
  expired:      { dot: 'bg-henry-warning',         label: 'Reconnect',    text: 'text-henry-warning' },
  error:        { dot: 'bg-henry-error',            label: 'Error',        text: 'text-henry-error' },
  disconnected: { dot: 'bg-henry-text-muted/50',   label: 'Not connected', text: 'text-henry-text-muted' },
};

export default function ConnectionStatusBadge({ status, showLabel = true, size = 'sm' }: Props) {
  const c = CONFIG[status] ?? CONFIG.disconnected;
  const dotSize = size === 'md' ? 'w-2 h-2' : 'w-1.5 h-1.5';
  const textSize = size === 'md' ? 'text-xs' : 'text-[11px]';

  return (
    <span className={`inline-flex items-center gap-1.5 ${textSize} font-medium ${c.text}`}>
      <span className={`rounded-full shrink-0 ${dotSize} ${c.dot}`} />
      {showLabel && c.label}
    </span>
  );
}
