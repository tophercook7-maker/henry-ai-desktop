import { Capacitor } from '@capacitor/core';

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
  private webRecognition: any = null;
  private _active = false;
  private _ambientLog: AmbientNote[] = [];
  private _lastWake = 0;
  private _useNative = false;

  get isActive() {
    return this._active;
  }

  async start(): Promise<'ok' | 'no-api' | 'native-ok'> {
    this._useNative = Capacitor.isNativePlatform();

    if (this._useNative) {
      return await this._startNative();
    } else {
      return this._startWeb();
    }
  }

  stop() {
    this._active = false;
    if (this._useNative) {
      this._stopNative();
    } else {
      this._stopWeb();
    }
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
  }

  // ── Native (Capacitor) ─────────────────────────────────────────────────────

  private async _startNative(): Promise<'ok' | 'native-ok' | 'no-api'> {
    try {
      const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');

      const perm = await SpeechRecognition.checkPermissions();
      if (perm.speechRecognition !== 'granted') {
        const req = await SpeechRecognition.requestPermissions();
        if (req.speechRecognition !== 'granted') {
          window.dispatchEvent(new CustomEvent('henry_wake_state', {
            detail: { active: false, error: 'mic-denied' },
          }));
          return 'no-api';
        }
      }

      this._active = true;
      this._loadAmbientLog();
      this._persist(true);

      await SpeechRecognition.start({
        language: 'en-US',
        maxResults: 1,
        partialResults: false,
        popup: false,
      });

      SpeechRecognition.addListener('partialResults', (data: { matches: string[] }) => {
        const text = data.matches?.[0]?.trim();
        if (text) this._handleTranscript(text);
      });

      window.dispatchEvent(new CustomEvent('henry_wake_state', { detail: { active: true } }));
      return 'native-ok';
    } catch {
      return this._startWeb();
    }
  }

  private async _stopNative() {
    try {
      const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
      await SpeechRecognition.stop();
      SpeechRecognition.removeAllListeners();
    } catch { /* ignore */ }
  }

  // ── Web (SpeechRecognition API) ────────────────────────────────────────────

  private _startWeb(): 'ok' | 'no-api' {
    const API = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!API) {
      window.dispatchEvent(new CustomEvent('henry_wake_state', {
        detail: { active: false, error: 'no-api' },
      }));
      return 'no-api';
    }

    this._active = true;
    this._loadAmbientLog();
    this._persist(true);
    this._createAndStartWeb(API);
    window.dispatchEvent(new CustomEvent('henry_wake_state', { detail: { active: true } }));
    return 'ok';
  }

  private _stopWeb() {
    try { this.webRecognition?.abort(); } catch { /* ignore */ }
    this.webRecognition = null;
  }

  private _createAndStartWeb(API: any) {
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
        window.dispatchEvent(new CustomEvent('henry_wake_state', {
          detail: { active: false, error: 'mic-denied' },
        }));
      }
    };

    r.onend = () => {
      this.webRecognition = null;
      if (this._active) {
        setTimeout(() => {
          const A = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
          if (A && this._active) this._createAndStartWeb(A);
        }, 300);
      }
    };

    r.start();
    this.webRecognition = r;
  }

  // ── Shared transcript handler ──────────────────────────────────────────────

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
