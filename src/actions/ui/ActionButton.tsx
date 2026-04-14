/**
 * Action Layer UI — ActionButton.
 *
 * A single-action trigger button that handles loading, success, and error
 * states inline. Optionally shows a confirmation dialog before running.
 *
 * Usage:
 *   <ActionButton
 *     actionId="github.create_issue"
 *     input={{ owner: 'acme', repo: 'api', title: 'Fix the thing' }}
 *     variant="primary"
 *   />
 */

import { useState, useCallback } from 'react';
import { getAction, runAction } from '../registry/actionRegistry';
import { canRunAction } from '../registry/actionResolver';
import ConfirmActionDialog from './ConfirmActionDialog';
import ActionStateBadge from './ActionStateBadge';
import type { ActionId, ActionStatus } from '../types/actionTypes';

interface Props {
  actionId: ActionId;
  input?: Record<string, unknown>;
  label?: string;
  variant?: 'primary' | 'ghost' | 'inline';
  size?: 'sm' | 'md';
  onSuccess?: (data: unknown) => void;
  onError?: (err: string) => void;
  className?: string;
}

export default function ActionButton({
  actionId, input = {}, label, variant = 'ghost', size = 'sm',
  onSuccess, onError, className = '',
}: Props) {
  const [status, setStatus] = useState<ActionStatus>('idle');
  const [showConfirm, setShowConfirm] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | undefined>();

  const def = getAction(actionId);
  const { ok, reason } = canRunAction(actionId);
  const displayLabel = label ?? def?.label ?? actionId;

  const execute = useCallback(async () => {
    setStatus('running');
    setErrorMsg(undefined);
    try {
      const result = await runAction(actionId, input);
      if (result.success) {
        setStatus('success');
        onSuccess?.(result.data);
        setTimeout(() => setStatus('idle'), 2200);
      } else {
        setStatus('error');
        setErrorMsg(result.message);
        onError?.(result.message ?? 'Failed');
        setTimeout(() => setStatus('idle'), 3000);
      }
    } catch (e: any) {
      setStatus('error');
      setErrorMsg(e?.message ?? 'Unexpected error');
      onError?.(e?.message ?? 'Unexpected error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  }, [actionId, input, onSuccess, onError]);

  function handleClick() {
    if (!ok) return;
    if (def?.requiresConfirmation) {
      setShowConfirm(true);
    } else {
      execute();
    }
  }

  const sizeClasses = size === 'md'
    ? 'px-4 py-2 text-sm'
    : 'px-3 py-1.5 text-xs';

  const variantClasses = {
    primary: 'bg-henry-accent text-white hover:bg-henry-accent/90 border border-transparent',
    ghost:   'bg-henry-surface border border-henry-border/50 text-henry-text hover:bg-henry-hover/50',
    inline:  'text-henry-accent underline hover:no-underline bg-transparent border-none p-0',
  }[variant];

  const isRunning = status === 'running';

  return (
    <>
      <button
        onClick={handleClick}
        disabled={!ok || isRunning}
        title={!ok ? reason : def?.description}
        className={`
          inline-flex items-center gap-1.5 rounded-lg font-medium
          transition-colors disabled:opacity-50 disabled:cursor-not-allowed
          ${sizeClasses} ${variantClasses} ${className}
        `}
      >
        {isRunning ? (
          <svg className="w-3 h-3 animate-spin shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        ) : status === 'success' ? (
          <svg className="w-3 h-3 text-henry-success shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : null}
        {status === 'success' ? 'Done' : displayLabel}
      </button>

      {status === 'error' && errorMsg && (
        <p className="text-[10px] text-henry-error mt-1">{errorMsg}</p>
      )}

      {showConfirm && def && (
        <ConfirmActionDialog
          action={def}
          onConfirm={() => { setShowConfirm(false); execute(); }}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      {status !== 'idle' && variant !== 'inline' && (
        <ActionStateBadge status={status} className="ml-1" />
      )}
    </>
  );
}
