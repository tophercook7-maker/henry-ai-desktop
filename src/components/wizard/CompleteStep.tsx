import { useState, useEffect } from 'react';
import { useStore } from '../../store';

interface CompleteStepProps {
  onBack: () => void;
}

export default function CompleteStep({ onBack }: CompleteStepProps) {
  const { settings, updateSetting, setSetupComplete } = useStore();
  const [completing, setCompleting] = useState(false);
  const [visible, setVisible] = useState(false);

  const localModel = settings.companion_model || '';
  const provider = settings.companion_provider || '';
  const isOllama = provider === 'ollama';

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 200);
    return () => clearTimeout(t);
  }, []);

  const brainDescription = isOllama
    ? `Ollama · ${localModel || 'local model'}`
    : localModel
    ? `${provider.charAt(0).toUpperCase() + provider.slice(1)} · ${localModel}`
    : 'your AI brain';

  async function handleComplete() {
    setCompleting(true);
    try {
      await window.henryAPI.saveSetting('setup_complete', 'true');
      await window.henryAPI.saveSetting('henry_first_launch', 'true');
      updateSetting('setup_complete', 'true');
      updateSetting('henry_first_launch', 'true');
      setSetupComplete(true);
    } catch (err) {
      console.error('Failed to complete setup:', err);
      setCompleting(false);
    }
  }

  return (
    <div className="text-center animate-slide-up">
      <div className="text-5xl mb-6">✅</div>
      <h2 className="text-xl font-bold text-henry-text mb-2">
        {brainDescription ? `Running on ${brainDescription}` : "You're all set"}
      </h2>
      <p className="text-sm text-henry-text-muted mb-10">
        You can add more AI providers or change settings anytime.
      </p>

      {/* Henry's first words */}
      <div className={`max-w-lg mx-auto mb-10 transition-all duration-700 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
        <div className="bg-henry-surface/40 border border-henry-border/30 rounded-2xl p-6 text-left relative">
          <div className="absolute -top-3 left-6 text-xs font-medium text-henry-text-muted bg-henry-bg px-2">
            Henry
          </div>
          <p className="text-henry-text leading-relaxed mb-3">
            Alright. I'm up.
          </p>
          <p className="text-henry-text-dim leading-relaxed mb-3">
            I'll be here whenever you need to think something through, write something, work through
            scripture, debug code, or design something. You don't need to use a special command —
            just talk to me like you would a smart colleague who's always around.
          </p>
          <p className="text-henry-text-dim leading-relaxed">
            Hit the button and we'll get started. I'll open with a question.
          </p>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4">
        <button
          onClick={onBack}
          className="px-6 py-2.5 text-henry-text-dim hover:text-henry-text transition-colors text-sm"
        >
          ← Back
        </button>
        <button
          onClick={handleComplete}
          disabled={completing}
          className="px-12 py-4 bg-henry-accent text-white rounded-2xl font-semibold text-lg hover:bg-henry-accent-hover transition-all shadow-lg shadow-henry-accent/20 disabled:opacity-60"
        >
          {completing ? 'Starting up...' : 'Meet Henry →'}
        </button>
      </div>
    </div>
  );
}
