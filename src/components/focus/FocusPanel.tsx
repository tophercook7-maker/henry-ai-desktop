import { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store';
import ReactMarkdown from 'react-markdown';

type TimerState = 'idle' | 'working' | 'break' | 'done';

interface FocusSession {
  id: string;
  task: string;
  duration: number;
  completedAt: string;
  henryCheckIn?: string;
}

const SESSIONS_KEY = 'henry:focus_sessions';

function loadSessions(): FocusSession[] {
  try {
    return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]');
  } catch { return []; }
}

function saveSession(s: FocusSession) {
  const all = loadSessions();
  all.unshift(s);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(all.slice(0, 50)));
}

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

const WORK_DURATIONS = [
  { label: '15 min', secs: 15 * 60 },
  { label: '25 min', secs: 25 * 60 },
  { label: '45 min', secs: 45 * 60 },
  { label: '60 min', secs: 60 * 60 },
];

export default function FocusPanel() {
  const settings = useStore((s) => s.settings);
  const [timerState, setTimerState] = useState<TimerState>('idle');
  const [taskName, setTaskName] = useState('');
  const [workSecs, setWorkSecs] = useState(25 * 60);
  const [remaining, setRemaining] = useState(25 * 60);
  const [sessions, setSessions] = useState<FocusSession[]>([]);
  const [checkIn, setCheckIn] = useState('');
  const [loadingCheckIn, setLoadingCheckIn] = useState(false);
  const [sessionCount, setSessionCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const currentTaskRef = useRef('');

  useEffect(() => {
    setSessions(loadSessions());
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  function startWork() {
    if (!taskName.trim()) return;
    currentTaskRef.current = taskName.trim();
    setTimerState('working');
    setRemaining(workSecs);
    setCheckIn('');
    startTimeRef.current = Date.now();

    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!);
          handleWorkComplete();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  async function handleWorkComplete() {
    const newCount = sessionCount + 1;
    setSessionCount(newCount);
    setTimerState('break');

    const session: FocusSession = {
      id: `fs_${Date.now()}`,
      task: currentTaskRef.current,
      duration: workSecs,
      completedAt: new Date().toISOString(),
    };

    await fetchCheckIn(session, newCount);
    saveSession(session);
    setSessions(loadSessions());
  }

  async function fetchCheckIn(session: FocusSession, count: number) {
    setLoadingCheckIn(true);
    try {
      const s = useStore.getState().settings;
      if (!s.companion_provider || !s.companion_model) return;
      const providers = await window.henryAPI.getProviders();
      const provider = providers.find((p: any) => p.id === s.companion_provider);
      if (!provider) return;

      const mins = Math.round(session.duration / 60);
      const focusOwner = localStorage.getItem('henry:owner_name')?.trim() || 'the user';
      const prompt = `${focusOwner} just completed a ${mins}-minute focus session on: "${session.task}". This is session #${count} today. Give a brief, warm, energizing check-in — acknowledge the work, ask how it went, one practical next thought. Under 60 words, conversational.`;

      let full = '';
      const stream = window.henryAPI.streamMessage({
        provider: s.companion_provider,
        model: s.companion_model,
        apiKey: provider.api_key || provider.apiKey || '',
        messages: [
          { role: 'system', content: 'You are Henry. Brief check-ins after focus sessions. Warm, direct, no filler.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.75,
      });
      stream.onChunk((chunk: string) => { full += chunk; setCheckIn(full); });
      stream.onDone(() => setLoadingCheckIn(false));
      stream.onError(() => setLoadingCheckIn(false));
    } catch {
      setLoadingCheckIn(false);
    }
  }

  function stopTimer() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setTimerState('idle');
    setRemaining(workSecs);
    setCheckIn('');
  }

  function startBreak(secs: number) {
    setTimerState('break');
    setRemaining(secs);
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!);
          setTimerState('idle');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  const todaySessions = sessions.filter((s) =>
    s.completedAt.slice(0, 10) === new Date().toISOString().slice(0, 10)
  );

  const progress = timerState === 'working' ? 1 - remaining / workSecs : 1;
  const circumference = 2 * Math.PI * 54;

  return (
    <div className="h-full flex flex-col bg-henry-bg overflow-y-auto">
      <div className="shrink-0 px-6 py-4 border-b border-henry-border/50">
        <h1 className="text-lg font-semibold text-henry-text">Focus</h1>
        <p className="text-xs text-henry-text-muted mt-0.5">
          {todaySessions.length > 0
            ? `${todaySessions.length} session${todaySessions.length > 1 ? 's' : ''} completed today`
            : 'No sessions today yet'}
        </p>
      </div>

      <div className="flex-1 px-6 py-6 max-w-xl mx-auto w-full space-y-6">
        {/* Timer ring */}
        <div className="flex flex-col items-center">
          <div className="relative w-36 h-36 mb-4">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="54" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
              <circle
                cx="60" cy="60" r="54"
                fill="none"
                stroke={timerState === 'break' ? '#10b981' : '#6b5cf6'}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (timerState === 'working' ? 1 - progress : timerState === 'break' ? 0 : 1)}
                style={{ transition: 'stroke-dashoffset 1s linear' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold font-mono text-henry-text tabular-nums">
                {formatTime(remaining)}
              </span>
              <span className="text-[10px] text-henry-text-muted mt-0.5 uppercase tracking-wider">
                {timerState === 'idle' ? 'ready' : timerState === 'working' ? 'focus' : 'break'}
              </span>
            </div>
          </div>

          {/* Controls */}
          {timerState === 'idle' && (
            <div className="w-full space-y-3">
              <input
                type="text"
                value={taskName}
                onChange={(e) => setTaskName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') startWork(); }}
                placeholder="What are you working on?"
                className="w-full bg-henry-surface/40 border border-henry-border/30 rounded-xl px-4 py-3 text-sm text-henry-text placeholder-henry-text-muted outline-none focus:border-henry-accent/40 transition-all"
              />
              <div className="flex gap-2 justify-center">
                {WORK_DURATIONS.map((d) => (
                  <button
                    key={d.secs}
                    onClick={() => { setWorkSecs(d.secs); setRemaining(d.secs); }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      workSecs === d.secs
                        ? 'bg-henry-accent/20 text-henry-accent border border-henry-accent/30'
                        : 'bg-henry-surface/40 text-henry-text-dim border border-henry-border/20 hover:text-henry-text'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <button
                onClick={startWork}
                disabled={!taskName.trim()}
                className="w-full py-3 rounded-xl text-sm font-semibold bg-henry-accent text-white hover:bg-henry-accent/90 disabled:opacity-40 transition-all"
              >
                Start Focus Session
              </button>
            </div>
          )}

          {timerState === 'working' && (
            <div className="text-center space-y-2">
              <p className="text-sm text-henry-text-dim">Focusing on: <span className="text-henry-text font-medium">{currentTaskRef.current}</span></p>
              <button
                onClick={stopTimer}
                className="px-5 py-2 rounded-xl text-xs font-medium bg-henry-surface border border-henry-border/40 text-henry-text-dim hover:text-henry-text transition-all"
              >
                Stop early
              </button>
            </div>
          )}

          {timerState === 'break' && (
            <div className="w-full space-y-3 text-center">
              {checkIn && (
                <div className="text-left rounded-xl border border-henry-accent/20 bg-henry-accent/5 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm">🧠</span>
                    <span className="text-[10px] font-medium text-henry-accent uppercase tracking-wide">Henry</span>
                  </div>
                  <div className="text-sm text-henry-text-dim leading-relaxed">
                    <ReactMarkdown>{checkIn}</ReactMarkdown>
                  </div>
                  {loadingCheckIn && <span className="inline-block w-1 h-4 bg-henry-accent animate-pulse ml-1" />}
                </div>
              )}
              <p className="text-sm text-henry-text font-medium">Session complete! Take a break.</p>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => startBreak(5 * 60)}
                  className="px-4 py-2 rounded-xl text-xs font-medium bg-henry-success/15 border border-henry-success/25 text-henry-success hover:bg-henry-success/25 transition-all"
                >
                  5 min break
                </button>
                <button
                  onClick={() => startBreak(15 * 60)}
                  className="px-4 py-2 rounded-xl text-xs font-medium bg-henry-success/15 border border-henry-success/25 text-henry-success hover:bg-henry-success/25 transition-all"
                >
                  15 min break
                </button>
                <button
                  onClick={() => { setTimerState('idle'); setRemaining(workSecs); setCheckIn(''); }}
                  className="px-4 py-2 rounded-xl text-xs font-medium bg-henry-surface border border-henry-border/30 text-henry-text-dim hover:text-henry-text transition-all"
                >
                  Done for now
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Session history */}
        {todaySessions.length > 0 && (
          <div>
            <p className="text-[11px] font-medium text-henry-text-muted uppercase tracking-wider mb-3">Today's sessions</p>
            <div className="space-y-2">
              {todaySessions.map((s) => (
                <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-henry-surface/30 border border-henry-border/20">
                  <span className="text-green-400 text-sm">✓</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-henry-text truncate">{s.task}</p>
                    <p className="text-[10px] text-henry-text-muted">{Math.round(s.duration / 60)} min · {new Date(s.completedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 px-4 py-3 rounded-xl bg-henry-surface/20 border border-henry-border/10">
              <p className="text-xs text-henry-text-dim">
                <span className="font-medium text-henry-text">{todaySessions.reduce((a, s) => a + Math.round(s.duration / 60), 0)} minutes</span> of focused work today
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
