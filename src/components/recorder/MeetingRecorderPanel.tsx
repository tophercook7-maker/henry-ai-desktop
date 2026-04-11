import { useState, useRef, useEffect } from 'react';
import { useStore } from '../../store';

interface Recording {
  id: string;
  title: string;
  date: string;
  duration: number;
  transcript?: string;
  summary?: string;
  actionItems?: string[];
}

const RECORDINGS_KEY = 'henry:recordings';

function loadRecordings(): Recording[] {
  try { return JSON.parse(localStorage.getItem(RECORDINGS_KEY) || '[]'); } catch { return []; }
}

function saveRecordings(recs: Recording[]) {
  try { localStorage.setItem(RECORDINGS_KEY, JSON.stringify(recs.slice(0, 30))); } catch { /* ignore */ }
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function MeetingRecorderPanel() {
  const settings = useStore((s) => s.settings);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState('');
  const [selectedRecording, setSelectedRecording] = useState<Recording | null>(null);
  const [meetingTitle, setMeetingTitle] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const mimeTypeRef = useRef<string>('audio/webm');

  useEffect(() => {
    setRecordings(loadRecordings());
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  function getSupportedMimeType(): string {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', ''];
    for (const type of candidates) {
      if (type === '' || MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedMimeType();
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mimeTypeRef.current = mr.mimeType || mimeType || 'audio/webm';
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.start(1000);
      mediaRecorderRef.current = mr;
      startTimeRef.current = Date.now();
      setRecording(true);
      setElapsed(0);
      setStatus('Recording…');
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
    } catch (err) {
      setStatus('Microphone access denied. Allow mic permission and try again.');
    }
  }

  async function stopRecording() {
    if (!mediaRecorderRef.current) return;
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
    setProcessing(true);
    setStatus('Transcribing with Groq Whisper…');

    const durationSecs = Math.floor((Date.now() - startTimeRef.current) / 1000);

    await new Promise<void>((res) => setTimeout(res, 500));

    const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
    await processRecording(blob, durationSecs);
  }

  async function processRecording(blob: Blob, durationSecs: number) {
    try {
      const s = useStore.getState().settings;
      const providers = await window.henryAPI.getProviders();
      const groqProvider = providers.find((p: any) => p.id === 'groq');
      const apiKey = groqProvider?.api_key || groqProvider?.apiKey || '';

      let transcript = '';

      if (apiKey && window.henryAPI.whisperTranscribe) {
        try {
          setStatus('Transcribing…');
          transcript = await window.henryAPI.whisperTranscribe(blob, apiKey);
        } catch (err) {
          console.warn('Whisper failed:', err);
          transcript = '[Transcription unavailable — configure Groq API key for Whisper]';
        }
      } else {
        transcript = '[Transcription unavailable — configure Groq API key in Settings → AI Providers]';
      }

      setStatus('Summarizing…');

      let summary = '';
      let actionItems: string[] = [];

      const companionProvider = s.companion_provider;
      const companionModel = s.companion_model;
      if (companionProvider && companionModel && transcript && !transcript.startsWith('[')) {
        const provider = providers.find((p: any) => p.id === companionProvider);
        if (provider) {
          try {
            const res = await window.henryAPI.sendMessage({
              provider: companionProvider,
              model: companionModel,
              apiKey: provider.api_key || provider.apiKey || '',
              messages: [
                { role: 'system', content: 'You extract meeting summaries and action items. Be concise and structured.' },
                { role: 'user', content: `Transcript:\n\n${transcript}\n\nProvide:\n1. A 3-5 sentence summary\n2. Action items (as a JSON array of strings)\n\nFormat: SUMMARY:\n...\n\nACTION_ITEMS:\n["item1","item2"]` },
              ],
              temperature: 0.3,
              maxTokens: 1000,
            });
            const content = (res as any)?.content || '';
            const summaryMatch = content.match(/SUMMARY:\s*([\s\S]*?)(?=ACTION_ITEMS:|$)/);
            const actionMatch = content.match(/ACTION_ITEMS:\s*(\[[\s\S]*?\])/);
            summary = summaryMatch?.[1]?.trim() || content;
            try { actionItems = JSON.parse(actionMatch?.[1] || '[]'); } catch { actionItems = []; }
          } catch { /* skip summarization */ }
        }
      }

      const title = meetingTitle.trim() || `Meeting — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
      const rec: Recording = {
        id: `rec_${Date.now()}`,
        title,
        date: new Date().toISOString(),
        duration: durationSecs,
        transcript,
        summary,
        actionItems,
      };

      const all = [rec, ...loadRecordings()];
      saveRecordings(all);
      setRecordings(all);
      setSelectedRecording(rec);
      setMeetingTitle('');
      setStatus('');

      if (actionItems.length > 0 && s.companion_provider) {
        for (const item of actionItems.slice(0, 5)) {
          try {
            await window.henryAPI.submitTask({
              description: item,
              type: 'custom',
              priority: 5,
            });
          } catch { /* ignore */ }
        }
      }
    } catch (err) {
      setStatus(`Error: ${String(err)}`);
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="h-full flex flex-col bg-henry-bg">
      <div className="shrink-0 px-6 py-4 border-b border-henry-border/50">
        <h1 className="text-lg font-semibold text-henry-text">Meeting Recorder</h1>
        <p className="text-xs text-henry-text-muted mt-0.5">Record → Whisper transcription → Summary + action items</p>
      </div>

      <div className="flex-1 overflow-hidden flex">
        {/* Left: recorder controls */}
        <div className="w-72 shrink-0 border-r border-henry-border/30 flex flex-col p-5 space-y-4">
          {/* Title */}
          <input
            type="text"
            value={meetingTitle}
            onChange={(e) => setMeetingTitle(e.target.value)}
            placeholder="Meeting title (optional)"
            disabled={recording || processing}
            className="w-full bg-henry-surface/40 border border-henry-border/30 rounded-xl px-3 py-2.5 text-sm text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/40 transition-all disabled:opacity-50"
          />

          {/* Record button */}
          <div className="flex flex-col items-center gap-3 py-4">
            <button
              onClick={recording ? stopRecording : startRecording}
              disabled={processing}
              className={`w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-lg ${
                recording
                  ? 'bg-henry-error animate-pulse hover:bg-henry-error/80'
                  : processing
                  ? 'bg-henry-surface border-2 border-henry-border/30 opacity-50 cursor-not-allowed'
                  : 'bg-henry-error/20 border-2 border-henry-error/40 hover:bg-henry-error/30 hover:border-henry-error/60'
              }`}
            >
              {recording ? (
                <svg className="w-8 h-8 text-white" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              ) : processing ? (
                <svg className="w-8 h-8 text-henry-text-muted animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
                  <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
              ) : (
                <svg className="w-8 h-8 text-henry-error" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="12" r="8" />
                </svg>
              )}
            </button>

            {recording && (
              <div className="text-center">
                <p className="text-2xl font-bold font-mono text-henry-error tabular-nums">{formatDuration(elapsed)}</p>
                <p className="text-xs text-henry-text-muted mt-1">Recording… tap to stop</p>
              </div>
            )}

            {status && !recording && (
              <p className="text-xs text-henry-text-muted text-center animate-pulse">{status}</p>
            )}

            {!recording && !processing && !status && (
              <p className="text-xs text-henry-text-muted text-center">Tap to start recording</p>
            )}
          </div>

          {/* Past recordings list */}
          {recordings.length > 0 && (
            <div className="flex-1 overflow-y-auto">
              <p className="text-[11px] font-medium text-henry-text-muted uppercase tracking-wider mb-2">Past recordings</p>
              <div className="space-y-1.5">
                {recordings.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setSelectedRecording(r)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl border transition-all ${
                      selectedRecording?.id === r.id
                        ? 'bg-henry-accent/10 border-henry-accent/25 text-henry-accent'
                        : 'bg-henry-surface/20 border-henry-border/20 text-henry-text-dim hover:text-henry-text hover:bg-henry-surface/40'
                    }`}
                  >
                    <p className="text-xs font-medium truncate">{r.title}</p>
                    <p className="text-[10px] text-henry-text-muted mt-0.5">{formatDuration(r.duration)} · {new Date(r.date).toLocaleDateString()}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: recording detail */}
        <div className="flex-1 overflow-y-auto p-5">
          {!selectedRecording ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="text-4xl mb-3">🎙</div>
                <p className="text-henry-text-muted text-sm">Record a meeting to get a transcript, summary, and action items</p>
                <p className="text-henry-text-muted/60 text-xs mt-2">Uses Groq Whisper for transcription · Free with Groq API key</p>
              </div>
            </div>
          ) : (
            <div className="max-w-2xl space-y-5">
              <div>
                <h2 className="text-base font-semibold text-henry-text">{selectedRecording.title}</h2>
                <p className="text-xs text-henry-text-muted mt-1">
                  {new Date(selectedRecording.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · {formatDuration(selectedRecording.duration)}
                </p>
              </div>

              {selectedRecording.summary && (
                <div className="rounded-xl border border-henry-accent/20 bg-henry-accent/5 p-4">
                  <p className="text-[11px] font-medium text-henry-accent uppercase tracking-wide mb-2">Summary</p>
                  <p className="text-sm text-henry-text-dim leading-relaxed">{selectedRecording.summary}</p>
                </div>
              )}

              {selectedRecording.actionItems && selectedRecording.actionItems.length > 0 && (
                <div className="rounded-xl border border-henry-border/30 bg-henry-surface/20 p-4">
                  <p className="text-[11px] font-medium text-henry-text-muted uppercase tracking-wide mb-3">Action Items</p>
                  <div className="space-y-2">
                    {selectedRecording.actionItems.map((item, i) => (
                      <div key={i} className="flex items-start gap-2.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-henry-accent mt-1.5 shrink-0" />
                        <p className="text-sm text-henry-text">{item}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedRecording.transcript && (
                <div className="rounded-xl border border-henry-border/20 bg-henry-surface/10 p-4">
                  <p className="text-[11px] font-medium text-henry-text-muted uppercase tracking-wide mb-2">Transcript</p>
                  <p className="text-xs text-henry-text-dim leading-relaxed whitespace-pre-wrap">{selectedRecording.transcript}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
