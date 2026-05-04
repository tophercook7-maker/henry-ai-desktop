import { useState, useEffect } from 'react';
import { useStore } from '../../store';

export const ONBOARDING_DONE_KEY = 'henry:onboarding_v1_complete';
export function shouldShowOnboarding(): boolean {
  return !localStorage.getItem(ONBOARDING_DONE_KEY);
}

interface Props { onComplete: () => void }
type Step = 'welcome' | 'name' | 'ai' | 'permissions' | 'done';
const STEPS: Step[] = ['welcome', 'name', 'ai', 'permissions', 'done'];

export default function OnboardingWizard({ onComplete }: Props) {
  const { setProviders, providers } = useStore();
  const [step, setStep]         = useState<Step>('welcome');
  const [groqKey, setGroqKey]   = useState('');
  const [saving, setSaving]     = useState(false);
  const [keyError, setKeyError] = useState('');
  const [localUrl, setLocalUrl] = useState('http://192.168.x.x:4242');
  const [tunnelUrl, setTunnelUrl] = useState('');

  const stepIdx = STEPS.indexOf(step);

  useEffect(() => {
    if (step !== 'done') return; // tunnel check on last step
    fetch('http://127.0.0.1:4242/sync/tunnel-url').then(r => r.json()).then(d => { if (d.url) setTunnelUrl(d.url); }).catch(() => {});
    fetch('http://127.0.0.1:4242/sync/state-internal', { headers: { 'X-Henry-Internal': 'true' } }).then(r => r.json()).then(d => {
      const ip = d?.localIp || '192.168.x.x'; setLocalUrl('http://' + ip + ':4242');
    }).catch(() => {});
  }, [step]);

  async function saveGroqKey() {
    const key = groqKey.trim();
    if (!key.startsWith('gsk_') || key.length < 30) { setKeyError('Keys start with "gsk_" — get yours free at console.groq.com'); return; }
    setSaving(true); setKeyError('');
    try {
      const api = (window as any).henryAPI;
      if (api?.invoke) await api.invoke('provider:save', { id: 'groq', apiKey: key, enabled: true }).catch(() => {});
      const updated = (providers || []).filter((p: any) => p.id !== 'groq');
      const newEntry = { id: 'groq', name: 'Groq', apiKey: key, api_key: key, enabled: true, models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] };
      updated.push(newEntry as any);
      setProviders(updated as any);
      // CRITICAL: write to localStorage so chat immediately works
      try {
        const existing = JSON.parse(localStorage.getItem('henry:providers') || '[]');
        const filtered = existing.filter((p: any) => p.id !== 'groq');
        filtered.push({ id: 'groq', name: 'Groq', api_key: key, apiKey: key, enabled: true, models: '[]' });
        localStorage.setItem('henry:providers', JSON.stringify(filtered));
      } catch { /* non-critical */ }
    } catch { }
    setSaving(false); next();
  }

  function next() { const i = STEPS.indexOf(step); if (i < STEPS.length - 1) setStep(STEPS[i + 1]); }
  function back() { const i = STEPS.indexOf(step); if (i > 0) setStep(STEPS[i - 1]); }
  function finish() { localStorage.setItem(ONBOARDING_DONE_KEY, 'true'); onComplete(); }

  const inp = "w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/30 outline-none focus:border-henry-accent/60 transition-all font-mono text-sm";
  const primary = "w-full py-3.5 rounded-xl bg-henry-accent text-white font-bold text-sm hover:bg-henry-accent/80 transition-all disabled:opacity-40";

  return (
    <div className="fixed inset-0 z-50 bg-henry-bg flex flex-col items-center justify-center p-6 overflow-y-auto">
      <div className="flex gap-1.5 mb-10">
        {STEPS.slice(0,-1).map((_s,i) => (
          <div key={i} className={'h-1 rounded-full transition-all ' + (i < stepIdx ? 'w-8 bg-henry-accent' : i === stepIdx ? 'w-8 bg-white' : 'w-4 bg-white/20')} />
        ))}
      </div>
      <div className="w-full max-w-sm">

        {step === 'welcome' && (
          <div className="space-y-6 text-center">
            <div><p className="text-5xl mb-4">◉</p>
              <h1 className="text-3xl font-black text-white tracking-tight">Meet Henry</h1>
              <p className="text-white/50 text-sm mt-3 leading-relaxed">Your personal AI — runs on your Mac, works on your phone, costs almost nothing, fixes itself when something breaks.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-left">
              {[['🧠','Remembers you','Facts, preferences, context'],['💻','Controls your Mac','Open apps, create files, run commands'],['📱','Works anywhere','Chat and voice from any device'],['💰','Almost free','Groq free tier handles 90% of tasks']].map(([icon,t,d]) => (
                <div key={t as string} className="bg-white/5 border border-white/10 rounded-xl p-3">
                  <p className="text-xl mb-1">{icon}</p>
                  <p className="text-white text-xs font-semibold">{t as string}</p>
                  <p className="text-white/40 text-[10px] mt-0.5 leading-snug">{d as string}</p>
                </div>
              ))}
            </div>
            <button onClick={next} className={primary}>Get Started →</button>
          </div>
        )}



        {step === 'permissions' && (
          <div className="space-y-5">
            <div className="text-center"><p className="text-4xl mb-3">🔒</p>
              <h2 className="text-2xl font-bold text-white">Grant Permissions</h2>
              <p className="text-white/50 text-sm mt-2">Henry needs these to control your Mac. Grant them now or anytime in System Settings.</p>
            </div>
            <div className="space-y-3">
              {[
                { icon: '📺', title: 'Screen Recording', desc: 'See your Mac screen live on your phone', handler: () => { try { (window as any).open('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'); } catch { } } },
                { icon: '♿', title: 'Accessibility', desc: 'Control apps and automate UI tasks', handler: () => { try { (window as any).open('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'); } catch { } } },
              ].map(p => (
                <div key={p.title} className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center gap-3">
                  <span className="text-2xl">{p.icon}</span>
                  <div className="flex-1"><p className="text-white text-sm font-semibold">{p.title}</p><p className="text-white/40 text-xs">{p.desc}</p></div>
                  <button onClick={p.handler} className="text-[11px] px-3 py-1.5 rounded-lg bg-henry-accent/10 border border-henry-accent/30 text-henry-accent hover:bg-henry-accent/20 transition-all font-medium flex-shrink-0">Grant</button>
                </div>
              ))}
            </div>
            <button onClick={next} className={primary}>Continue →</button>
          </div>
        )}

        {false && step === 'done' && false && (
          <div className="space-y-5">
            <div className="text-center"><p className="text-4xl mb-3">📱</p>
              <h2 className="text-2xl font-bold text-white">Henry on Your Phone</h2>
              <p className="text-white/50 text-sm mt-2">Open this on any device on your WiFi — auto-connects instantly.</p>
            </div>
            <div className="bg-henry-accent/10 border border-henry-accent/30 rounded-xl p-4 text-center">
              <p className="text-[10px] uppercase tracking-wider text-henry-accent mb-2">Local URL</p>
              <p className="text-white font-mono text-sm break-all">{localUrl}</p>
            </div>
            {tunnelUrl && (
              <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-center">
                <p className="text-[10px] uppercase tracking-wider text-green-400 mb-2">Remote URL (works anywhere)</p>
                <p className="text-white font-mono text-xs break-all">{tunnelUrl}</p>
              </div>
            )}
            <button onClick={next} className={primary}>Continue →</button>
          </div>
        )}

        {step === 'done' && (
          <div className="text-center space-y-6">
            <div><p className="text-5xl mb-4">✓</p>
              <h2 className="text-2xl font-bold text-white">Henry is ready.</h2>
              <p className="text-white/50 text-sm mt-2 leading-relaxed">Ask him anything. Tell him to do things. He learns your preferences and gets better every day.</p>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-left space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-white/30 mb-3">Try these</p>
              {['Create a folder called Work on my Desktop','What can you do?','Remind me to check email at 9am','Take a screenshot'].map(s => (
                <p key={s} className="text-white/50 text-xs font-mono bg-white/5 rounded-lg px-3 py-2">"{s}"</p>
              ))}
            </div>
            <button onClick={finish} className={primary}>Start using Henry →</button>
          </div>
        )}

        {stepIdx > 0 && step !== 'done' && (
          <button onClick={back} className="w-full text-center text-white/30 text-xs hover:text-white/50 transition-all mt-4">← Back</button>
        )}
      </div>
    </div>
  );
}
