/**
 * Connection Layer — reconnect banner.
 *
 * Amber warning bar shown inside any panel when the connection
 * is expired or errored. Clicking "Reconnect" calls `onReconnect`.
 *
 * Usage:
 *   {status === 'expired' && (
 *     <ReconnectBanner service="Slack" onReconnect={() => markExpired('slack')} />
 *   )}
 */

interface Props {
  service: string;
  reason?: string;
  onReconnect: () => void;
}

export default function ReconnectBanner({ service, reason, onReconnect }: Props) {
  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 bg-henry-warning/10 border-b border-henry-warning/25">
      <svg className="w-3.5 h-3.5 text-henry-warning shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <p className="flex-1 text-xs text-henry-warning leading-snug">
        {reason ?? `Your ${service} connection has expired.`}
      </p>
      <button
        onClick={onReconnect}
        className="shrink-0 text-xs font-semibold text-henry-warning underline hover:no-underline transition-all"
      >
        Reconnect
      </button>
    </div>
  );
}
