import type { ReactNode } from "react";
import { FaCheck } from "react-icons/fa6";
import { publicAsset } from "@/lib/assets";

export interface StepDef {
  key: string;
  label: string;
}

interface OnboardingLayoutProps {
  steps: StepDef[];
  currentStepKey: string;
  children: ReactNode;
  /** Whether the terminal / extra content is visible — widens the card */
  wide?: boolean;
}

/**
 * Shared layout wrapper for all onboarding steps.
 * Renders branding, a horizontal stepper, and the step content in a centered card.
 */
export function OnboardingLayout({
  steps,
  currentStepKey,
  children,
  wide,
}: OnboardingLayoutProps) {
  const currentIndex = steps.findIndex((s) => s.key === currentStepKey);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      {/* Branding */}
      <div className="flex items-center gap-3 mb-8">
        <img
          src={publicAsset("dashboard-icon.png")}
          alt="Game-Servum"
          className="h-10 w-auto"
        />
        <span className="text-xl font-bold">
          Game-<span className="text-ring">Servum</span>
        </span>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-2 mb-8">
        {steps.map((step, i) => {
          const isActive = step.key === currentStepKey;
          const isCompleted = i < currentIndex;
          return (
            <div key={step.key} className="flex items-center gap-2">
              {i > 0 && (
                <div
                  className={`w-12 h-px ${isCompleted || isActive ? "bg-ring" : "bg-border"}`}
                />
              )}
              <div className="flex items-center gap-1.5">
                <div
                  className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium transition-colors ${
                    isCompleted
                      ? "bg-ring text-white"
                      : isActive
                        ? "bg-ring/20 text-ring border border-ring"
                        : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {isCompleted ? <FaCheck className="h-3.5 w-3.5" /> : i + 1}
                </div>
                <span
                  className={`text-sm hidden sm:inline ${
                    isActive
                      ? "text-foreground font-medium"
                      : isCompleted
                        ? "text-ring"
                        : "text-muted-foreground"
                  }`}
                >
                  {step.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Step content */}
      <div className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} space-y-4`}>
        {children}
      </div>
    </div>
  );
}
