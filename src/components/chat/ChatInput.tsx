import { useState, useRef, useEffect } from 'react';

interface ChatInputProps {
  onSend: (content: string) => void;
  isStreaming: boolean;
  onCancel?: () => void;
  placeholder?: string;
  /** Parent bumps `id` to replace the textarea value (e.g. “Use in chat” from scripture tools). */
  injectDraft?: { id: number; text: string } | null;
  onInjectConsumed?: () => void;
}

export default function ChatInput({
  onSend,
  isStreaming,
  onCancel,
  placeholder = 'Message Henry...',
  injectDraft,
  onInjectConsumed,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [input]);

  // Focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!injectDraft?.text) return;
    setInput(injectDraft.text);
    onInjectConsumed?.();
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }, [injectDraft?.id, injectDraft?.text, onInjectConsumed]);

  function handleSubmit() {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    onSend(trimmed);
    setInput('');
    // Reset height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="relative">
      <div className="flex items-end gap-2 bg-henry-bg/80 border border-henry-border rounded-xl px-4 py-3 focus-within:border-henry-accent/50 transition-colors">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className="flex-1 bg-transparent text-sm text-henry-text placeholder-henry-text-muted outline-none resize-none max-h-[200px]"
          disabled={isStreaming}
        />

        {isStreaming ? (
          <button
            onClick={onCancel}
            disabled={!onCancel}
            className="shrink-0 p-2 rounded-lg bg-henry-error/10 text-henry-error hover:bg-henry-error/20 transition-colors disabled:opacity-50"
            title="Stop generating"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!input.trim()}
            className={`shrink-0 p-2 rounded-lg transition-all ${
              input.trim()
                ? 'bg-henry-accent text-white hover:bg-henry-accent-hover'
                : 'bg-henry-hover text-henry-text-muted cursor-not-allowed'
            }`}
            title="Send message (Enter)"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        )}
      </div>

      <div className="flex items-center justify-between mt-2 px-1">
        <span className="text-[10px] text-henry-text-muted">
          Enter to send · Shift+Enter for new line
        </span>
        {isStreaming && (
          <div className="flex items-center gap-1.5">
            <div className="typing-dot" />
            <div className="typing-dot" />
            <div className="typing-dot" />
          </div>
        )}
      </div>
    </div>
  );
}
