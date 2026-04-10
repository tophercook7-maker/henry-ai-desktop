interface WelcomeStepProps {
  onNext: () => void;
}

export default function WelcomeStep({ onNext }: WelcomeStepProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] animate-fade-in text-center px-4">
      <div className="text-7xl mb-8">🧠</div>

      <div className="max-w-lg mx-auto mb-10">
        <div className="bg-henry-surface/40 border border-henry-border/30 rounded-2xl p-7 text-left relative">
          <div className="absolute -top-3 left-6 text-xs font-medium text-henry-text-muted bg-henry-bg px-2">
            Henry
          </div>
          <p className="text-henry-text text-lg leading-relaxed mb-4">
            Hey. I'm Henry.
          </p>
          <p className="text-henry-text-dim leading-relaxed mb-4">
            I'm going to be your personal AI — not a generic chatbot, but{' '}
            <span className="text-henry-text font-medium">your</span> AI. I can help you
            think, write, study scripture, work through code, and design things.
          </p>
          <p className="text-henry-text-dim leading-relaxed">
            I just need to know how you want me to think. Takes about 90 seconds.
          </p>
        </div>
        <div className="flex justify-start ml-7 mt-1">
          <div className="w-3 h-3 border-l border-b border-henry-border/30 rounded-bl-sm" />
        </div>
      </div>

      <button
        onClick={onNext}
        className="px-10 py-4 bg-henry-accent text-white rounded-2xl font-semibold text-lg hover:bg-henry-accent-hover transition-all shadow-lg shadow-henry-accent/20"
      >
        Let's do this →
      </button>

      <p className="text-xs text-henry-text-muted mt-4">No account needed · Works offline with Ollama</p>
    </div>
  );
}
