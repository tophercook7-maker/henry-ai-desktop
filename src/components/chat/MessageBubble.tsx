import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import hljs from 'highlight.js';
import type { Message } from '../../types';

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
  createTask?: {
    onClick: () => void;
    disabled?: boolean;
  };
  onQuickAction?: (prompt: string) => void;
}

const QUICK_ACTIONS = [
  { label: 'Summarize', prompt: 'Summarize the above response in 3–5 concise bullet points.' },
  { label: '→ Tasks', prompt: 'Extract all action items and next steps from the above as a numbered checklist.' },
  { label: 'Shorter', prompt: 'Rewrite the above in half the words. Keep the key points, cut everything else.' },
  { label: 'Simpler', prompt: 'Rewrite the above in plain, everyday language — like you\'re explaining it to a friend.' },
];

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  let highlighted = '';
  try {
    highlighted = language
      ? hljs.highlight(code, { language, ignoreIllegals: true }).value
      : hljs.highlightAuto(code).value;
  } catch {
    highlighted = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return (
    <div className="relative my-3 rounded-xl overflow-hidden border border-henry-border/40 bg-henry-bg">
      <div className="flex items-center justify-between px-4 py-2 bg-henry-surface/50 border-b border-henry-border/30">
        <span className="text-[10px] font-medium text-henry-text-muted uppercase tracking-wide font-mono">
          {language || 'code'}
        </span>
        <button
          onClick={copy}
          className="text-[10px] text-henry-text-muted hover:text-henry-text transition-colors flex items-center gap-1"
        >
          {copied ? (
            <>
              <svg className="w-3 h-3 text-henry-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              <span className="text-henry-success">Copied</span>
            </>
          ) : (
            <>
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
              </svg>
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-4">
        <code
          className="text-xs font-mono leading-relaxed"
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      </pre>
    </div>
  );
}

const markdownComponents: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  code(props) {
    const { children, className } = props as { children?: React.ReactNode; className?: string };
    const raw = String(children ?? '').replace(/\n$/, '');
    const langMatch = /^language-(\w+)/.exec(className || '');
    const isBlock = langMatch || raw.includes('\n');
    if (!isBlock) {
      return (
        <code className="bg-henry-bg/70 border border-henry-border/30 px-1.5 py-0.5 rounded text-[0.8em] font-mono text-henry-accent/90">
          {raw}
        </code>
      );
    }
    return <CodeBlock language={langMatch?.[1] || ''} code={raw} />;
  },
  pre(props) {
    return <>{props.children}</>;
  },
  a(props) {
    return (
      <a
        href={props.href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-henry-accent hover:underline"
      >
        {props.children}
      </a>
    );
  },
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function MessageBubble({
  message,
  isStreaming: isStreamingProp,
  streamingContent,
  workspaceSaveDraft,
  createTask,
  onQuickAction,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [hovered, setHovered] = useState(false);

  const isUser = message.role === 'user';
  const isStreaming = isStreamingProp || message.isStreaming;
  const content = isStreaming
    ? (streamingContent || message.content || '')
    : message.content;

  function copyMessage() {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  return (
    <div
      className={`flex gap-3 py-4 animate-fade-in ${isUser ? 'justify-end' : 'justify-start'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {!isUser && (
        <div className="shrink-0 w-8 h-8 rounded-lg bg-henry-accent/10 flex items-center justify-center text-sm">
          {message.engine === 'worker' ? '⚡' : '🧠'}
        </div>
      )}

      <div className={`max-w-[80%] ${isUser ? 'bg-henry-accent/15 border border-henry-accent/20 rounded-2xl rounded-br-md px-4 py-3' : 'bg-transparent'}`}>

        {!isUser && message.engine && (
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
              message.engine === 'companion'
                ? 'bg-henry-companion/10 text-henry-companion'
                : 'bg-henry-worker/10 text-henry-worker'
            }`}>
              {message.engine === 'companion' ? 'Local' : 'Cloud'}
            </span>
            {message.model && (
              <span className="text-[10px] text-henry-text-muted">{message.model}</span>
            )}
          </div>
        )}

        <div className={`text-sm leading-relaxed ${isUser ? 'text-henry-text' : 'markdown-content text-henry-text'}`}>
          {isUser ? (
            <p className="whitespace-pre-wrap">{content}</p>
          ) : content ? (
            <ReactMarkdown components={markdownComponents}>{content}</ReactMarkdown>
          ) : isStreaming ? (
            <p className="text-henry-text-muted text-sm italic">Thinking…</p>
          ) : null}

          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-henry-accent/60 animate-pulse ml-0.5 align-middle" />
          )}
        </div>

        {!isUser && !isStreaming && message.cost != null && message.cost > 0 && (
          <div className="mt-2 flex items-center gap-3 text-[10px] text-henry-text-muted">
            {message.tokens_used != null && message.tokens_used > 0 && (
              <span>{message.tokens_used.toLocaleString()} tokens</span>
            )}
            <span>${message.cost.toFixed(6)}</span>
          </div>
        )}

        {!isUser && !isStreaming && (message.content || '').trim().length > 0 && (
          (workspaceSaveDraft?.enabled || createTask) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {workspaceSaveDraft?.enabled && (
                <button
                  type="button"
                  disabled={workspaceSaveDraft.busy || !workspaceSaveDraft.workspaceReady}
                  title={!workspaceSaveDraft.workspaceReady ? 'Set a workspace folder in Settings to save files' : 'Save this reply as markdown in the workspace'}
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
          )
        )}

        {/* Hover actions row: copy + timestamp */}
        {!isStreaming && (message.content || '').trim().length > 0 && (
          <div className={`mt-2 transition-opacity duration-150 ${hovered ? 'opacity-100' : 'opacity-0'}`}>
            {!isUser && onQuickAction && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {QUICK_ACTIONS.map(({ label, prompt }) => (
                  <button
                    key={label}
                    onClick={() => onQuickAction(prompt)}
                    className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-henry-border/40 bg-henry-surface/40 text-henry-text-muted hover:text-henry-text hover:border-henry-accent/40 hover:bg-henry-surface/70 transition-all"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-3">
              <button
                onClick={copyMessage}
                title="Copy to clipboard"
                className="flex items-center gap-1 text-[10px] text-henry-text-muted hover:text-henry-text transition-colors"
              >
                {copied ? (
                  <>
                    <svg className="w-3 h-3 text-henry-success" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    <span className="text-henry-success">Copied</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                    </svg>
                    Copy
                  </>
                )}
              </button>
              {message.created_at && (
                <span className="text-[10px] text-henry-text-muted/60">
                  {formatTime(message.created_at)}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {isUser && (
        <div className="shrink-0 w-8 h-8 rounded-lg bg-henry-hover flex items-center justify-center text-sm">
          👤
        </div>
      )}
    </div>
  );
}
