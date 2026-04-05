import { useState } from 'react';
import { useStore } from '../../store';
import WelcomeStep from './WelcomeStep';
import ProviderStep from './ProviderStep';
import EngineAssignStep from './EngineAssignStep';
import CompleteStep from './CompleteStep';

const STEPS = ['Welcome', 'Providers', 'Engines', 'Ready'];

export default function SetupWizard() {
  const [currentStep, setCurrentStep] = useState(0);

  function next() {
    setCurrentStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function back() {
    setCurrentStep((s) => Math.max(s - 1, 0));
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-henry-bg overflow-hidden">
      {/* Title bar drag area */}
      <div className="titlebar-drag h-12 shrink-0" />

      {/* Wizard content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 overflow-y-auto">
        <div className="w-full max-w-2xl">
          {/* Progress indicator */}
          <div className="flex items-center justify-center gap-2 mb-8">
            {STEPS.map((step, i) => (
              <div key={step} className="flex items-center gap-2">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-all ${
                    i === currentStep
                      ? 'bg-henry-accent text-white'
                      : i < currentStep
                      ? 'bg-henry-success/20 text-henry-success'
                      : 'bg-henry-hover text-henry-text-muted'
                  }`}
                >
                  {i < currentStep ? '✓' : i + 1}
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={`w-12 h-0.5 ${
                      i < currentStep ? 'bg-henry-success/30' : 'bg-henry-border'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>

          {/* Step content */}
          <div className="animate-fade-in">
            {currentStep === 0 && <WelcomeStep onNext={next} />}
            {currentStep === 1 && (
              <ProviderStep onNext={next} onBack={back} />
            )}
            {currentStep === 2 && (
              <EngineAssignStep onNext={next} onBack={back} />
            )}
            {currentStep === 3 && <CompleteStep onBack={back} />}
          </div>
        </div>
      </div>
    </div>
  );
}
