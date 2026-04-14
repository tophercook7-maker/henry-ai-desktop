/**
 * Connection Layer — service card for the integrations hub.
 *
 * Shows icon, name, status badge, description, and a primary CTA button.
 * Used inside IntegrationsPanel and any future connections hub.
 *
 * Usage:
 *   <ConnectionCard
 *     icon="💬"
 *     name="Slack"
 *     description="Read channels and send messages"
 *     status={status}
 *     capabilities={['Read channels', 'Send messages']}
 *     onConnect={() => ...}
 *     onDisconnect={() => ...}
 *     onOpen={() => ...}
 *     hasPanel
 *   />
 */

import ConnectionStatusBadge from './ConnectionStatusBadge';
import type { ConnectionStatus } from '../types/connectionTypes';

interface Props {
  icon: string;
  name: string;
  description: string;
  status: ConnectionStatus;
  capabilities?: string[];
  hasPanel?: boolean;
  onConnect: () => void;
  onOpen?: () => void;
  onDisconnect?: () => void;
}

export default function ConnectionCard({
  icon, name, description, status,
  capabilities, hasPanel, onConnect, onOpen, onDisconnect,
}: Props) {
  const connected = status === 'connected';
  const expired = status === 'expired';

  return (
    <div className={`rounded-2xl border transition-all ${
      connected
        ? 'bg-henry-surface/50 border-henry-accent/20'
        : expired
        ? 'bg-henry-warning/5 border-henry-warning/25'
        : 'bg-henry-surface/20 border-henry-border/30 hover:border-henry-border/50'
    }`}>
      <div className="flex items-center gap-3 p-4">
        {/* Icon */}
        <div className="w-10 h-10 rounded-xl bg-henry-bg/60 flex items-center justify-center text-xl shrink-0">
          {icon}
        </div>

        {/* Identity */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-henry-text">{name}</span>
            <ConnectionStatusBadge status={status} />
          </div>
          <p className="text-xs text-henry-text-muted mt-0.5 truncate">{description}</p>
        </div>

        {/* CTA */}
        <div className="shrink-0 flex items-center gap-2">
          {connected && hasPanel && onOpen && (
            <button
              onClick={onOpen}
              className="px-3 py-1.5 text-xs font-medium bg-henry-accent/10 text-henry-accent border border-henry-accent/20 rounded-lg hover:bg-henry-accent/20 transition-colors"
            >
              Open
            </button>
          )}
          {(expired || !connected) && (
            <button
              onClick={onConnect}
              className="px-3 py-1.5 text-xs font-medium bg-henry-surface border border-henry-border/50 text-henry-text rounded-lg hover:bg-henry-hover/50 transition-colors"
            >
              {expired ? 'Reconnect' : 'Connect'}
            </button>
          )}
          {connected && onDisconnect && (
            <button
              onClick={onDisconnect}
              className="p-1.5 text-henry-text-muted hover:text-henry-error transition-colors rounded-lg hover:bg-henry-error/5"
              title={`Disconnect ${name}`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Capabilities — shown only when connected */}
      {connected && capabilities && capabilities.length > 0 && (
        <div className="px-4 pb-3 flex flex-wrap gap-1.5">
          {capabilities.slice(0, 3).map((cap) => (
            <span
              key={cap}
              className="px-2 py-0.5 rounded-full bg-henry-surface/60 border border-henry-border/30 text-[10px] text-henry-text-muted"
            >
              {cap}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
