/**
 * Action Layer UI — ActionResultCard.
 *
 * A dismissible result card shown after an action completes.
 * Supports success, error, and partial states.
 *
 * Usage:
 *   <ActionResultCard
 *     status="success"
 *     title="Issue created"
 *     message="GitHub issue #42 has been opened."
 *     actionLabel="View on GitHub"
 *     actionUrl={issue.html_url}
 *     onDismiss={() => setResult(null)}
 *   />
 */

interface Props {
  status: 'success' | 'error' | 'needs_confirmation';
  title: string;
  message?: string;
  actionLabel?: string;
  actionUrl?: string;
  onAction?: () => void;
  onDismiss: () => void;
}

const STYLES = {
  success: {
    border: 'border-henry-success/25',
    bg: 'bg-henry-success/5',
    icon: '✓',
    iconClass: 'text-henry-success bg-henry-success/15',
    titleClass: 'text-henry-success',
  },
  error: {
    border: 'border-henry-error/25',
    bg: 'bg-henry-error/5',
    icon: '✗',
    iconClass: 'text-henry-error bg-henry-error/15',
    titleClass: 'text-henry-error',
  },
  needs_confirmation: {
    border: 'border-henry-warning/25',
    bg: 'bg-henry-warning/5',
    icon: '!',
    iconClass: 'text-henry-warning bg-henry-warning/15',
    titleClass: 'text-henry-warning',
  },
};

export default function ActionResultCard({
  status, title, message, actionLabel, actionUrl, onAction, onDismiss,
}: Props) {
  const s = STYLES[status];

  return (
    <div className={`rounded-xl border ${s.border} ${s.bg} p-3 flex items-start gap-3`}>
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${s.iconClass}`}>
        {s.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${s.titleClass}`}>{title}</p>
        {message && <p className="text-xs text-henry-text-muted mt-0.5 leading-snug">{message}</p>}
        {(actionLabel || onAction) && (
          <div className="mt-2">
            {actionUrl ? (
              <a
                href={actionUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-henry-accent hover:underline"
              >
                {actionLabel ?? 'View'}
              </a>
            ) : onAction ? (
              <button
                onClick={onAction}
                className="text-xs font-medium text-henry-accent hover:underline"
              >
                {actionLabel ?? 'View'}
              </button>
            ) : null}
          </div>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="p-1 rounded-lg text-henry-text-muted hover:text-henry-text hover:bg-henry-hover/50 transition-colors shrink-0"
      >
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
