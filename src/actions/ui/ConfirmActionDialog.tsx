/**
 * Action Layer UI — ConfirmActionDialog.
 *
 * Modal confirmation dialog for write/destructive actions.
 * Shown automatically by ActionButton and ActionMenu for any action
 * where requiresConfirmation = true.
 *
 * Usage:
 *   <ConfirmActionDialog
 *     action={action}
 *     onConfirm={() => { ... run it ... }}
 *     onCancel={() => setShowConfirm(false)}
 *   />
 */

import type { HenryAction } from '../types/actionTypes';

interface Props {
  action: HenryAction;
  onConfirm: () => void;
  onCancel: () => void;
  details?: string;
}

export default function ConfirmActionDialog({ action, onConfirm, onCancel, details }: Props) {
  const isDestructive = ['send', 'modify'].includes(action.category);

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="w-full max-w-sm bg-henry-bg border border-henry-border/50 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-4">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0 ${
            isDestructive ? 'bg-henry-error/10 text-henry-error' : 'bg-henry-warning/10 text-henry-warning'
          }`}>
            {isDestructive ? '⚠️' : '✅'}
          </div>
          <div>
            <h2 className="text-sm font-semibold text-henry-text">{action.label}</h2>
            <p className="text-xs text-henry-text-muted mt-0.5">Requires your confirmation</p>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 pb-2 space-y-2">
          <p className="text-sm text-henry-text-muted leading-relaxed">
            {action.confirmationPrompt ?? `This will ${action.description?.toLowerCase() ?? 'perform an action'}.`}
          </p>
          {details && (
            <div className="rounded-xl bg-henry-surface/50 border border-henry-border/30 p-3">
              <p className="text-xs text-henry-text-muted leading-relaxed">{details}</p>
            </div>
          )}
          {isDestructive && (
            <p className="text-xs text-henry-error/80 leading-relaxed">
              This action writes to an external service. Make sure you want to proceed.
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-5 py-4">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 bg-henry-surface border border-henry-border/50 text-henry-text rounded-xl text-sm font-medium hover:bg-henry-hover/50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
              isDestructive
                ? 'bg-henry-error text-white hover:bg-henry-error/90'
                : 'bg-henry-accent text-white hover:bg-henry-accent/90'
            }`}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
