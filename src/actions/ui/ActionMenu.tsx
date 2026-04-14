/**
 * Action Layer UI — ActionMenu.
 *
 * Overflow menu showing all available actions for a service or item.
 * Groups write vs read-only actions. Shows "Coming soon" for disabled ones.
 *
 * Usage (in a panel item card):
 *   <ActionMenu
 *     serviceId="github"
 *     input={{ number: 42, title: 'Fix bug', repo: 'acme/api', ... }}
 *     trigger={<button>⋯</button>}
 *   />
 */

import { useState, useRef, useEffect } from 'react';
import { getActions, runAction } from '../registry/actionRegistry';
import { canRunAction } from '../registry/actionResolver';
import ConfirmActionDialog from './ConfirmActionDialog';
import type { ActionId, HenryAction, ActionStatus } from '../types/actionTypes';

interface Props {
  serviceId: string;
  input?: Record<string, unknown>;
  trigger?: React.ReactNode;
  align?: 'left' | 'right';
  onActionComplete?: (id: ActionId, success: boolean) => void;
}

interface RunningAction {
  id: ActionId;
  status: ActionStatus;
}

export default function ActionMenu({
  serviceId, input = {}, trigger, align = 'right', onActionComplete,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<HenryAction | null>(null);
  const [running, setRunning] = useState<RunningAction | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const actions = getActions(serviceId);
  const enabled  = actions.filter((a) => a.enabled);
  const disabled = actions.filter((a) => !a.enabled);

  const readActions  = enabled.filter((a) => a.readonly);
  const writeActions = enabled.filter((a) => !a.readonly);

  async function run(action: HenryAction) {
    setOpen(false);
    setRunning({ id: action.id, status: 'running' });
    try {
      const result = await runAction(action.id, input);
      setRunning({ id: action.id, status: result.success ? 'success' : 'error' });
      onActionComplete?.(action.id, result.success);
      setTimeout(() => setRunning(null), 2000);
    } catch {
      setRunning({ id: action.id, status: 'error' });
      setTimeout(() => setRunning(null), 2000);
    }
  }

  function handleClick(action: HenryAction) {
    const { ok } = canRunAction(action.id);
    if (!ok) return;
    if (action.requiresConfirmation) {
      setPendingConfirm(action);
    } else {
      run(action);
    }
  }

  const alignClass = align === 'right' ? 'right-0' : 'left-0';

  return (
    <div className="relative inline-block" ref={ref}>
      {/* Trigger */}
      <div onClick={() => setOpen((v) => !v)} className="cursor-pointer">
        {trigger ?? (
          <button className="p-1.5 rounded-lg text-henry-text-muted hover:text-henry-text hover:bg-henry-hover/50 transition-colors">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5"  r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
            </svg>
          </button>
        )}
      </div>

      {/* Running toast */}
      {running && (
        <div className="absolute top-8 right-0 z-50 bg-henry-bg border border-henry-border/50 rounded-xl px-3 py-2 shadow-xl flex items-center gap-2 whitespace-nowrap text-xs">
          {running.status === 'running' && (
            <svg className="w-3 h-3 animate-spin text-henry-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
          )}
          {running.status === 'success' && <span className="text-henry-success">✓</span>}
          {running.status === 'error'   && <span className="text-henry-error">✗</span>}
          <span className="text-henry-text-muted">
            {running.status === 'running' ? 'Running…' : running.status === 'success' ? 'Done' : 'Failed'}
          </span>
        </div>
      )}

      {/* Dropdown */}
      {open && (
        <div className={`absolute top-8 ${alignClass} z-50 w-56 bg-henry-bg border border-henry-border/50 rounded-2xl shadow-2xl overflow-hidden`}>
          {readActions.length > 0 && (
            <div>
              <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-henry-text-muted">Ask Henry</p>
              {readActions.map((a) => (
                <MenuRow key={a.id} action={a} onClick={() => handleClick(a)} />
              ))}
            </div>
          )}
          {writeActions.length > 0 && (
            <div className={readActions.length > 0 ? 'border-t border-henry-border/20' : ''}>
              <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-henry-text-muted">Actions</p>
              {writeActions.map((a) => (
                <MenuRow key={a.id} action={a} onClick={() => handleClick(a)} isWrite />
              ))}
            </div>
          )}
          {disabled.length > 0 && (
            <div className="border-t border-henry-border/20">
              {disabled.slice(0, 3).map((a) => (
                <div key={a.id} className="flex items-center gap-2.5 px-3 py-2 opacity-40 cursor-not-allowed">
                  <span className="flex-1 text-xs text-henry-text-muted">{a.label}</span>
                  <span className="text-[10px] text-henry-text-muted">Soon</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {pendingConfirm && (
        <ConfirmActionDialog
          action={pendingConfirm}
          onConfirm={() => { const a = pendingConfirm; setPendingConfirm(null); run(a); }}
          onCancel={() => setPendingConfirm(null)}
        />
      )}
    </div>
  );
}

function MenuRow({
  action, onClick, isWrite,
}: {
  action: HenryAction;
  onClick: () => void;
  isWrite?: boolean;
}) {
  const { ok, reason } = canRunAction(action.id);

  return (
    <button
      onClick={onClick}
      disabled={!ok}
      title={!ok ? reason : action.description}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        ok ? 'hover:bg-henry-hover/50' : ''
      }`}
    >
      {isWrite && (
        <svg className="w-3 h-3 text-henry-warning shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
        </svg>
      )}
      <span className="flex-1 text-xs text-henry-text">{action.label}</span>
      {action.requiresConfirmation && (
        <span className="text-[9px] text-henry-text-muted border border-henry-border/30 rounded px-1 py-0.5">confirm</span>
      )}
    </button>
  );
}
