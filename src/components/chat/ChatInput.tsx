import { useState, useRef, useEffect, useCallback } from 'react';

interface ChatInputProps {
  onSend: (content: string) => void;
  isStreaming: boolean;
  onCancel?: () => void;
  placeholder?: string;
  injectDraft?: { id: number; text: string } | null;
  onInjectConsumed?: () => void;
  ttsEnabled?: boolean;
  onToggleTts?: () => void;
}

const SpeechRecognitionAPI =
  typeof window !== 'undefined'
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

export default function ChatInput({
  onSend,
  isStreaming,
  onCancel,
  placeholder = 'Message Henry...',
  injectDraft,
  onInjectConsumed,
  ttsEnabled = false,
  onToggleTts,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

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

  // Inject draft from parent
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

  // Cleanup recognition on unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }, []);

  function toggleVoice() {
    if (listening) {
      stopListening();
      return;
    }
    if (!SpeechRecognitionAPI) {
      alert('Voice input is not supported in this browser. Try Chrome or Edge.');
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    const baseText = input;

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results as any[])
        .map((r: any) => r[0].transcript)
        .join('');
      setInput(baseText ? `${baseText} ${transcript}` : transcript);
    };

    recognition.onerror = () => {
      stopListening();
    };

    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.style.height = 'auto';
          el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    };

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  function handleSubmit() {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    stopListening();
    onSend(trimmed);
    setInput('');
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
          placeholder={listening ? 'Listening...' : placeholder}
          rows={1}
          className="flex-1 bg-transparent text-sm text-henry-text placeholder-henry-text-muted outline-none resize-none max-h-[200px]"
          disabled={isStreaming}
        />

        <div className="flex items-center gap-1.5 shrink-0">
          {/* TTS toggle */}
          {onToggleTts && (
            <button
              onClick={onToggleTts}
              title={ttsEnabled ? 'Voice responses on — click to mute' : 'Enable voice responses'}
              className={`p-2 rounded-lg transition-all ${
                ttsEnabled
                  ? 'bg-henry-accent/20 text-henry-accent hover:bg-henry-accent/30'
                  : 'text-henry-text-muted hover:text-henry-text hover:bg-henry-hover/50'
              }`}
            >
              {ttsEnabled ? (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                </svg>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="23" y1="9" x2="17" y2="15" />
                  <line x1="17" y1="9" x2="23" y2="15" />
                </svg>
              )}
            </button>
          )}

          {/* Mic button */}
          {SpeechRecognitionAPI && !isStreaming && (
            <button
              onClick={toggleVoice}
              title={listening ? 'Stop listening' : 'Voice input'}
              className={`p-2 rounded-lg transition-all ${
                listening
                  ? 'bg-henry-error/20 text-henry-error animate-pulse hover:bg-henry-error/30'
                  : 'text-henry-text-muted hover:text-henry-text hover:bg-henry-hover/50'
              }`}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </button>
          )}

          {/* Send / Stop */}
          {isStreaming ? (
            <button
              onClick={onCancel}
              disabled={!onCancel}
              className="p-2 rounded-lg bg-henry-error/10 text-henry-error hover:bg-henry-error/20 transition-colors disabled:opacity-50"
              title="Stop generating"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!input.trim()}
              className={`p-2 rounded-lg transition-all ${
                input.trim()
                  ? 'bg-henry-accent text-white hover:bg-henry-accent-hover'
                  : 'bg-henry-hover text-henry-text-muted cursor-not-allowed'
              }`}
              title="Send message (Enter)"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mt-2 px-1">
        <span className="text-[10px] text-henry-text-muted">
          {listening ? (
            <span className="text-henry-error">● Recording — speak now</span>
          ) : (
            'Enter to send · Shift+Enter for new line'
          )}
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
