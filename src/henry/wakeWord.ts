export type AmbientNote = {
  text: string;
  timestamp: string;
};

const AMBIENT_KEY = 'henry:ambient_notes';
const WAKE_STATE_KEY = 'henry:wake_active';
const COOLDOWN_MS = 4000;

const WAKE_PATTERNS: RegExp[] = [
  /(?:^|[\s,])(?:hey|okay|ok|yo)\s+henry[,\s]*(.*)/i,
  /(?:^|[\s])henry\s*[,?!]*\s+(.*)/i,
  /^henry[,!?\s]*$/i,
];

class WakeWordManager {
  private recognition: any = null;
  private _active = false;
  private _ambientLog: AmbientNote[] = [];
  private _lastWake = 0;

  get isActive() {
    return this._active;
  }

  start(): 'ok' | 'no-api' {
    const API = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!API) return 'no-api';

    this._active = true;
    this._loadAmbientLog();
    this._persist(true);
    this._createAndStart(API);
    window.dispatchEvent(new CustomEvent('henry_wake_state', { detail: { active: true } }));
    return 'ok';
  }

  stop() {
    this._active = false;
    try { this.recognition?.abort(); } catch { /* ignore */ }
    this.recognition = null;
    this._persist(false);
    window.dispatchEvent(new CustomEvent('henry_wake_state', { detail: { active: false } }));
  }

  savedState(): boolean {
    try { return localStorage.getItem(WAKE_STATE_KEY) === 'true'; } catch { return false; }
  }

  getAmbientLog(): AmbientNote[] {
    return [...this._ambientLog];
  }

  clearAmbientLog() {
    this._ambientLog = [];
    try { localStorage.removeItem(AMBIENT_KEY); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent('henry_wake_state', { detail: { active: this._active } }));
  }

  private _createAndStart(API: any) {
    if (!this._active) return;

    const r = new API();
    r.continuous = true;
    r.interimResults = false;
    r.lang = 'en-US';
    r.maxAlternatives = 1;

    r.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          this._handleTranscript(event.results[i][0].transcript.trim());
        }
      }
    };

    r.onerror = (e: any) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this._active = false;
        this._persist(false);
        window.dispatchEvent(new CustomEvent('henry_wake_state', { detail: { active: false, error: 'mic-denied' } }));
      }
    };

    r.onend = () => {
      this.recognition = null;
      if (this._active) {
        setTimeout(() => {
          const A = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
          if (A && this._active) this._createAndStart(A);
        }, 300);
      }
    };

    r.start();
    this.recognition = r;
  }

  private _handleTranscript(text: string) {
    if (!text) return;

    const note: AmbientNote = { text, timestamp: new Date().toISOString() };
    this._ambientLog.push(note);
    if (this._ambientLog.length > 300) this._ambientLog.shift();
    this._saveAmbientLog();

    window.dispatchEvent(new CustomEvent('henry_ambient_note', { detail: { note } }));

    const now = Date.now();
    if (now - this._lastWake < COOLDOWN_MS) return;

    for (const pattern of WAKE_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        this._lastWake = now;
        const query = (match[1] || '').trim().replace(/^[,\s]+|[,\s]+$/g, '');
        window.dispatchEvent(new CustomEvent('henry_wake_word', {
          detail: { query, fullTranscript: text },
        }));
        return;
      }
    }
  }

  private _persist(active: boolean) {
    try { localStorage.setItem(WAKE_STATE_KEY, active ? 'true' : 'false'); } catch { /* ignore */ }
  }

  private _loadAmbientLog() {
    try {
      const stored = JSON.parse(localStorage.getItem(AMBIENT_KEY) || '[]');
      if (Array.isArray(stored)) this._ambientLog = stored.slice(-300);
    } catch { /* ignore */ }
  }

  private _saveAmbientLog() {
    try {
      localStorage.setItem(AMBIENT_KEY, JSON.stringify(this._ambientLog.slice(-200)));
    } catch { /* ignore */ }
  }
}

export const wakeWordManager = new WakeWordManager();
