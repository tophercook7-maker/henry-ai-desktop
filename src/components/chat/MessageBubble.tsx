import ReactMarkdown from 'react-markdown';
import type { Message } from '../../types';

/** Save markdown to workspace (Writer mode, Design3D mode, etc.) */
export interface WorkspaceSaveDraftProps {
  enabled: boolean;
  workspaceReady: boolean;
  busy?: boolean;
  onSave: () => void | Promise<void>;
  label: string;
}

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
  streamingContent?: string;
  workspaceSaveDraft?: WorkspaceSaveDraftProps;
  /** Follow-up Worker task from this assistant reply (chat → queue bridge). */
  createTask?: {
    onClick: () => void;
    disabled?: boolean;
  };
}

export default function MessageBubble({
  message,
  isStreaming: isStreamingProp,
  streamingContent,
  workspaceSaveDraft,
  createTask,
}: MessageBubbleProps) {
  const isUser = message.role === 'user';
  // Support both the explicit prop and the message flag
  const isStreaming = isStreamingProp || message.isStreaming;
  const content = isStreaming
    ? (streamingContent || message.content || '')
    : message.content;

  return (
    <div
      className={`flex gap-3 py-4 animate-fade-in ${
        isUser ? 'justify-end' : 'justify-start'
      }`}
    >
      {/* Avatar */}
      {!isUser && (
        <div className="shrink-0 w-8 h-8 rounded-lg bg-henry-accent/10 flex items-center justify-center text-sm">
          {message.engine === 'worker' ? '⚡' : '🧠'}
        </div>
      )}

      {/* Message content */}
      <div
        className={`max-w-[80%] ${
          isUser
            ? 'bg-henry-accent/15 border border-henry-accent/20 rounded-2xl rounded-br-md px-4 py-3'
            : 'bg-transparent'
        }`}
      >
        {/* Engine badge */}
        {!isUser && message.engine && (
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                message.engine === 'companion'
                  ? 'bg-henry-companion/10 text-henry-companion'
                  : 'bg-henry-worker/10 text-henry-worker'
              }`}
            >
              {message.engine === 'companion' ? 'Local' : 'Cloud'}
            </span>
            {message.model && (
              <span className="text-[10px] text-henry-text-muted">
                {message.model}
              </span>
            )}
          </div>
        )}

        {/* Content */}
        <div
          className={`text-sm leading-relaxed ${
            isUser ? 'text-henry-text' : 'markdown-content text-henry-text'
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{content}</p>
          ) : content ? (
            <ReactMarkdown>{content}</ReactMarkdown>
          ) : isStreaming ? (
            <p className="text-henry-text-muted text-sm italic">Thinking…</p>
          ) : null}

          {/* Streaming indicator */}
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-henry-accent/60 animate-pulse ml-0.5" />
          )}
        </div>

        {/* Cost info */}
        {!isUser && !isStreaming && message.cost && message.cost > 0 && (
          <div className="mt-2 flex items-center gap-3 text-[10px] text-henry-text-muted">
            <span>{message.tokens_used?.toLocaleString()} tokens</span>
            <span>${message.cost.toFixed(6)}</span>
          </div>
        )}

        {!isUser &&
          !isStreaming &&
          (message.content || '').trim().length > 0 &&
          ((workspaceSaveDraft?.enabled || createTask) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {workspaceSaveDraft?.enabled && (
                <button
                  type="button"
                  disabled={workspaceSaveDraft.busy || !workspaceSaveDraft.workspaceReady}
                  title={
                    !workspaceSaveDraft.workspaceReady
                      ? 'Set a workspace folder in Settings to save files'
                      : 'Save this reply as markdown in the workspace'
                  }
                  onClick={() => void workspaceSaveDraft.onSave()}
                  className="text-xs font-medium px-2.5 py-1 rounded-lg border border-henry-border/50 bg-henry-surface/30 text-henry-text hover:border-henry-accent/40 hover:bg-henry-surface/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {workspaceSaveDraft.busy ? 'Saving…' : workspaceSaveDraft.label}
                </button>
              )}
              {createTask && (
                <button
                  type="button"
                  disabled={createTask.disabled}
                  title="Queue a Worker follow-up linked to this reply"
                  onClick={createTask.onClick}
                  className="text-xs font-medium px-2.5 py-1 rounded-lg border border-henry-worker/35 bg-henry-worker/10 text-henry-worker hover:bg-henry-worker/20 disabled:opacity-40 transition-colors"
                >
                  Create task
                </button>
              )}
            </div>
          ))}
      </div>

      {/* User avatar */}
      {isUser && (
        <div className="shrink-0 w-8 h-8 rounded-lg bg-henry-hover flex items-center justify-center text-sm">
          👤
        </div>
      )}
    </div>
  );
}
