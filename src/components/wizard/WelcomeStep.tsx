interface WelcomeStepProps {
  onNext: () => void;
}

export default function WelcomeStep({ onNext }: WelcomeStepProps) {
  return (
    <div className="text-center animate-slide-up">
      <div className="text-6xl mb-6">🧠</div>
      <h1 className="text-3xl font-bold text-henry-text mb-3">
        Welcome to Henry AI
      </h1>
      <p className="text-henry-text-dim text-lg mb-8 max-w-md mx-auto leading-relaxed">
        Your local AI operating system. Henry runs on your machine, your data
        stays with you, and you control everything.
      </p>

      <div className="grid grid-cols-2 gap-4 mb-8 max-w-lg mx-auto text-left">
        <Feature
          icon="🏠"
          title="Local Brain (Ollama)"
          desc="Free forever. Runs privately on your machine — no account needed"
        />
        <Feature
          icon="☁️"
          title="Second Brain (Cloud)"
          desc="Optional GPT-4, Claude, or Gemini for when you need more power"
        />
        <Feature
          icon="🔒"
          title="Private by Default"
          desc="Your conversations stay on your machine. No data leaves without you"
        />
        <Feature
          icon="🎭"
          title="Multiple Modes"
          desc="Companion chat, Biblical study, Writer, Developer, and 3D design"
        />
      </div>

      <p className="text-sm text-henry-text-muted mb-6">
        Let's get you set up. It takes about 2 minutes.
      </p>

      <button
        onClick={onNext}
        className="px-8 py-3 bg-henry-accent text-white rounded-xl font-medium hover:bg-henry-accent-hover transition-colors text-lg"
      >
        Get Started →
      </button>
    </div>
  );
}

function Feature({
  icon,
  title,
  desc,
}: {
  icon: string;
  title: string;
  desc: string;
}) {
  return (
    <div className="p-4 rounded-xl bg-henry-surface/50 border border-henry-border/30">
      <div className="text-xl mb-2">{icon}</div>
      <div className="text-sm font-medium text-henry-text mb-1">{title}</div>
      <div className="text-xs text-henry-text-muted leading-relaxed">
        {desc}
      </div>
    </div>
  );
}
