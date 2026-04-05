import { useState } from 'react';
import { useStore } from '../../store';

interface CompleteStepProps {
  onBack: () => void;
}

export default function CompleteStep({ onBack }: CompleteStepProps) {
  const { settings, updateSetting, setSetupComplete } = useStore();
  const [completing, setCompleting] = useState(false);

  async function handleComplete() {
    setCompleting(true);
    try {
      await window.henryAPI.saveSetting('setup_complete', 'true');
      updateSetting('setup_complete', 'true');
      setSetupComplete(true);
    } catch (err) {
      console.error('Failed to complete setup:', err);
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div className="text-center animate-slide-up">
      <div className="text-6xl mb-6">✨</div>
      <h2 className="text-2xl font-bold text-henry-text mb-3">
        You're all set.
      </h2>
      <p className="text-henry-text-dim mb-8 max-w-md mx-auto leading-relaxed">
        Henry is ready to work. Your AI engines are configured, your workspace
        is set up, and everything runs locally on your machine.
      </p>

      <div className="bg-henry-surface/50 rounded-xl border border-henry-border/30 p-6 mb-8 max-w-md mx-auto text-left">
        <h3 className="text-sm font-semibold text-henry-text mb-4">
          Quick Reference
        </h3>
        <div className="space-y-3 text-xs">
          <div className="flex items-start gap-3">
            <span className="text-henry-companion">🧠</span>
            <div>
              <div className="font-medium text-henry-text">
                Companion Engine
              </div>
              <div className="text-henry-text-dim">
                Always available for chat. Quick answers, status updates, and
                planning.
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-henry-worker">⚡</span>
            <div>
              <div className="font-medium text-henry-text">Worker Engine</div>
              <div className="text-henry-text-dim">
                Handles heavy tasks in the background. Code, research, and deep
                work.
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span>💡</span>
            <div>
              <div className="font-medium text-henry-text">Pro Tip</div>
              <div className="text-henry-text-dim">
                Switch between engines in the chat header. The Companion keeps
                talking while the Worker executes.
              </div>
            </div>
          </div>
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
          className="px-10 py-3 bg-henry-accent text-white rounded-xl font-medium hover:bg-henry-accent-hover transition-colors text-lg"
        >
          {completing ? 'Starting Henry...' : 'Launch Henry →'}
        </button>
      </div>
    </div>
  );
}
