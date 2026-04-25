import { useState, useRef, useEffect, useCallback } from 'react';
import { useStore } from '../../store';
import { transcribeWithGroq } from '../../henry/ttsService';
import { useAmbientStore } from '../../henry/ambientStateStore';

interface ChatInputProps {
  onSend: (content: string) => void;
  isStreaming: boolean;
  onCancel?: () => void;
  placeholder?: string;
  injectDraft?: { id: number; text: string } | null;
  onInjectConsumed?: () => void;
  ttsEnabled?: boolean;
  onToggleTts?: () => void;
  onSearch?: (query: string) => void;
  isSearching?: boolean;
  onFileIngest?: (content: string, fileName: string) => void;
  ambientMode?: boolean;
}

export default function ChatInput({
  onSend,
  isStreaming,
  onCancel,
  placeholder = 'Message Henry...',
  injectDraft,
  onInjectConsumed,
  ttsEnabled = false,
  onToggleTts,
  onSearch,
  isSearching = false,
  onFileIngest,
  ambientMode = false,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const speechRecRef = useRef<any>(null);
  const settings = useStore((s) => s.settings);

  // Handle global henry_focus_input event (from keyboard shortcut Cmd+K)
  useEffect(() => {
    function handleFocusInput() {
      textareaRef.current?.focus();
    }
    window.addEventListener('henry_focus_input', handleFocusInput);
    return () => window.removeEventListener('henry_focus_input', handleFocusInput);
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [input]);

  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) {
      textareaRef.current?.focus();
    }
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

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state !== 'inactive') {
        mediaRecorderRef.current?.stop();
      }
      speechRecRef.current?.stop();
    };
  }, []);

  // Ambient mode: auto-start mic when TTS finishes speaking
  useEffect(() => {
    if (!ambientMode || !ttsEnabled) return;
    function onTtsDone() {
      if (!isStreaming) {
        startGroqWhisper();
      }
    }
    window.addEventListener('henry_tts_done', onTtsDone);
    return () => window.removeEventListener('henry_tts_done', onTtsDone);
  }, [ambientMode, ttsEnabled, isStreaming]);

  async function startGroqWhisper() {
    useAmbientStore.getState().setState('listening');
    useAmbientStore.getState().startSession();
    try {
      // Detect supported audio MIME type
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
        ? 'audio/mp4'
        : '';

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        speechRecRef.current?.stop();
        transcribeAudio();
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setListening(true);
      setInterimTranscript('');

      // Start SpeechRecognition for live interim display (Chrome/Edge/Android)
      const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SR) {
        try {
          const rec = new SR();
          rec.continuous = true;
          rec.interimResults = true;
          rec.lang = 'en-US';
          rec.onresult = (e: any) => {
            let interim = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
              if (!e.results[i].isFinal) interim += e.results[i][0].transcript;
            }
            if (interim) setInterimTranscript(interim);
          };
          rec.onerror = () => { /* ignore — Groq transcription is the source of truth */ };
          rec.start();
          speechRecRef.current = rec;
        } catch { /* SpeechRecognition not available — graceful degrade */ }
      }
    } catch {
      alert('Microphone access denied. Please allow microphone permission.');
    }
  }

  async function stopGroqWhisper() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    speechRecRef.current?.stop();
    speechRecRef.current = null;
    setListening(false);
    setTranscribing(true);
    setInterimTranscript('');
    useAmbientStore.getState().setState('thinking');
  }

  async function transcribeAudio() {
    try {
      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      if (blob.size < 1000) {
        setTranscribing(false);
        return;
      }

      const providers = await window.henryAPI.getProviders();
      const s = useStore.getState().settings;

      let transcript: string | undefined;

      if (window.henryAPI.whisperTranscribe) {
        // Electron desktop path — uses native IPC
        const groqProvider = providers.find((p: any) => p.id === 'groq');
        const apiKey = groqProvider?.api_key || groqProvider?.apiKey || '';
        if (apiKey) {
          transcript = await window.henryAPI.whisperTranscribe(blob, apiKey);
        }
      }

      if (!transcript) {
        // Web path — call Groq Whisper directly via proxy
        transcript = await transcribeWithGroq(blob, s, providers);
      }

      if (transcript?.trim()) {
        setInput((prev) => prev ? `${prev} ${transcript!.trim()}` : transcript!.trim());
        requestAnimationFrame(() => {
          const el = textareaRef.current;
          if (el) {
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
            el.focus();
          }
        });
      }
    } catch (err) {
      console.warn('Whisper transcription failed:', err);
    } finally {
      setTranscribing(false);
      useAmbientStore.getState().setState('ready');
    }
  }

  function toggleVoice() {
    if (listening) {
      stopGroqWhisper();
    } else {
      startGroqWhisper();
    }
  }

  function handleSubmit() {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    if (listening) stopGroqWhisper();
    onSend(trimmed);
    setInput('');
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.focus();
      }
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  async function handleFileUpload(file: File) {
    if (!onFileIngest) return;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!['txt', 'md', 'json', 'csv', 'js', 'ts', 'tsx', 'jsx', 'py', 'html', 'css', 'xml', 'yaml', 'yml'].includes(ext) && file.type !== 'text/plain') {
      // For non-text, just pass metadata
      onFileIngest(`[File: ${file.name} (${(file.size / 1024).toFixed(1)} KB) — binary or unsupported format. Describe what you'd like to do with it.]`, file.name);
      return;
    }
    try {
      const text = await file.text();
      const preview = text.length > 12000 ? text.slice(0, 12000) + '\n\n[... file truncated at 12,000 chars]' : text;
      onFileIngest(preview, file.name);
    } catch {
      onFileIngest(`[Could not read ${file.name}]`, file.name);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && onFileIngest) handleFileUpload(file);
  }

  const micAvailable = !!navigator.mediaDevices?.getUserMedia;

  return (
    <div
      className={`relative transition-all ${dragOver ? 'ring-2 ring-henry-accent/50 rounded-xl' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="absolute inset-0 rounded-xl bg-henry-accent/10 border-2 border-dashed border-henry-accent/50 flex items-center justify-center z-10 pointer-events-none">
          <p className="text-sm text-henry-accent font-medium">Drop to send to Henry</p>
        </div>
      )}

      <div className="flex items-end gap-2 bg-henry-bg/80 border border-henry-border rounded-xl px-4 py-3 focus-within:border-henry-accent/50 transition-colors">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={listening ? 'Listening… tap mic to stop' : transcribing ? 'Transcribing…' : placeholder}
          rows={1}
          className="flex-1 bg-transparent text-sm text-henry-text placeholder-henry-text-muted outline-none resize-none max-h-[200px]"
          disabled={transcribing}
        />

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Mic button — Groq Whisper — first and prominent */}
          {micAvailable && (
            <button
              onClick={toggleVoice}
              disabled={transcribing || isStreaming}
              title={listening ? 'Stop recording' : transcribing ? 'Transcribing…' : 'Voice input (Groq Whisper)'}
              className={`p-2.5 rounded-xl transition-all ${
                listening
                  ? 'bg-henry-error/20 text-henry-error animate-pulse hover:bg-henry-error/30 ring-1 ring-henry-error/40'
                  : transcribing
                  ? 'text-henry-accent animate-pulse bg-henry-accent/10'
                  : isStreaming
                  ? 'text-henry-text-muted opacity-40 cursor-not-allowed'
                  : 'text-henry-text-muted hover:text-henry-accent hover:bg-henry-accent/10'
              }`}
            >
              {transcribing ? (
                <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
                  <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
              ) : (
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              )}
            </button>
          )}

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

          {/* File/Document ingest button */}
          {onFileIngest && !isStreaming && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.target.value = ''; }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                title="Send a file to Henry"
                className="p-2 rounded-lg text-henry-text-muted hover:text-henry-text hover:bg-henry-hover/50 transition-all"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </button>
            </>
          )}

          {/* Web search button */}
          {onSearch && !isStreaming && (
            <button
              onClick={() => { const q = input.trim(); if (q) onSearch(q); }}
              disabled={!input.trim() || isSearching}
              title="Search the web for this query"
              className={`p-2 rounded-lg transition-all ${
                isSearching
                  ? 'text-henry-accent animate-pulse bg-henry-accent/10'
                  : input.trim()
                  ? 'text-henry-text-muted hover:text-henry-accent hover:bg-henry-accent/10'
                  : 'text-henry-text-muted opacity-40 cursor-not-allowed'
              }`}
            >
              {isSearching ? (
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
                  <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
              ) : (
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              )}
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
              disabled={!input.trim() || transcribing}
              className={`p-2 rounded-lg transition-all ${
                input.trim() && !transcribing
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

      <div className="flex items-center justify-between mt-2 px-1 min-h-[18px]">
        <span className="text-[10px] text-henry-text-muted flex items-center gap-1.5 overflow-hidden">
          {listening ? (
            <span className="flex items-center gap-1.5 text-henry-error font-medium">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-henry-error animate-pulse" />
              {interimTranscript
                ? <span className="text-henry-text font-normal truncate max-w-[280px]">{interimTranscript}</span>
                : 'Listening… tap mic to stop'}
            </span>
          ) : transcribing ? (
            <span className="flex items-center gap-1.5 text-henry-accent">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-henry-accent animate-pulse" />
              Transcribing with Whisper…
            </span>
          ) : (
            <>
              <span className="hidden sm:inline">Enter to send · Shift+Enter for new line · Drop files here</span>
              <span className="sm:hidden">Tap ↑ to send</span>
            </>
          )}
        </span>
        {isStreaming && (
          <div className="flex items-center gap-1.5 shrink-0">
            <div className="typing-dot" />
            <div className="typing-dot" />
            <div className="typing-dot" />
          </div>
        )}
      </div>
    </div>
  );
}
