import { useState } from 'react';
import { useStore } from '../../store';

interface CompleteStepProps {
  onBack: () => void;
}

export default function CompleteStep({ onBack }: CompleteStepProps) {
  const { settings, updateSetting, setSetupComplete } = useStore();
  const [completing, setCompleting] = useState(false);

  const localModel = settings.companion_model || 'Not set';
  const cloudModel = settings.worker_model && settings.worker_provider !== 'ollama'
    ? settings.worker_model
    : null;

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
      <h2 className="text-2xl font-bold text-henry-text mb-3">You're all set.</h2>
      <p className="text-henry-text-dim mb-8 max-w-md mx-auto leading-relaxed">
        Henry is ready. Your engines are configured — start talking.
      </p>

      <div className="bg-henry-surface/50 rounded-xl border border-henry-border/30 p-6 mb-8 max-w-md mx-auto text-left">
        <h3 className="text-sm font-semibold text-henry-text mb-4">Your setup</h3>
        <div className="space-y-3 text-xs">
          <div className="flex items-start gap-3">
            <span>🏠</span>
            <div>
              <div className="font-medium text-henry-text">Local Brain</div>
              <div className="text-henry-text-dim">
                <code className="text-henry-accent">{localModel}</code> — free, private, runs on your machine.
                This is Henry's default for all chat.
              </div>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span>☁️</span>
            <div>
              <div className="font-medium text-henry-text">Second Brain</div>
              {cloudModel ? (
                <div className="text-henry-text-dim">
                  <code className="text-henry-accent">{cloudModel}</code> — available for when you need
                  more power. Switch to it per message using the engine toggle.
                </div>
              ) : (
                <div className="text-henry-text-dim">
                  Not configured. Add a cloud API key in Settings anytime to unlock this.
                </div>
              )}
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span>💡</span>
            <div>
              <div className="font-medium text-henry-text">Switching engines</div>
              <div className="text-henry-text-dim">
                Use the toggle at the top of the chat area. Local Brain is always free.
                Second Brain uses cloud tokens.
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
