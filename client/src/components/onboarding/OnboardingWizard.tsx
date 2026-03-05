import { useState, useCallback, useEffect } from "react";
import { OnboardingLayout, type StepDef } from "./OnboardingLayout";
import { WelcomeStep } from "./steps/WelcomeStep";
import { ConnectAgentStep } from "./steps/ConnectAgentStep";
import { SteamCmdInstallStep } from "./steps/SteamCmdInstallStep";
import { SteamLoginStep } from "./steps/SteamLoginStep";
import { SteamGuardStep } from "./steps/SteamGuardStep";
import { CompleteStep } from "./steps/CompleteStep";
import { markOnboardingComplete } from "./onboardingState";
import { useBackend } from "@/hooks/useBackend";
import type { SteamCMDStatus } from "@/types";

// ── Step definitions ──

const STEPS: StepDef[] = [
  { key: "welcome", label: "Welcome" },
  { key: "connect", label: "Agent" },
  { key: "steamcmd", label: "SteamCMD" },
  { key: "login", label: "Login" },
  { key: "complete", label: "Done" },
];

// ── Step type union ──
type WizardStep =
  | "welcome"
  | "connect"
  | "steamcmd"
  | "login"
  | "guard"
  | "complete";

interface OnboardingWizardProps {
  onComplete: () => void;
  initialStep?: WizardStep;
}

/**
 * Unified onboarding wizard.
 *
 * Flow: Welcome → Connect Agent → SteamCMD Install → Steam Login → (Guard) → Complete
 */
export function OnboardingWizard({
  onComplete,
  initialStep,
}: OnboardingWizardProps) {
  const { api, activeConnection } = useBackend();

  const [step, setStep] = useState<WizardStep>(initialStep ?? "welcome");
  const [steamcmd, setSteamcmd] = useState<SteamCMDStatus | null>(null);
  const [loadingSteamcmd, setLoadingSteamcmd] = useState(false);

  // Fetch SteamCMD status when reaching the steamcmd step
  const fetchSteamcmdStatus = useCallback(async () => {
    setLoadingSteamcmd(true);
    try {
      const status = await api.steamcmd.getStatus();
      setSteamcmd(status);
    } catch {
      // If we can't reach the API, assume not installed
      setSteamcmd(null);
    } finally {
      setLoadingSteamcmd(false);
    }
  }, [api]);

  // Re-fetch SteamCMD status whenever we enter the steamcmd or login steps
  useEffect(() => {
    if (step === "steamcmd" || step === "login") {
      fetchSteamcmdStatus();
    }
  }, [step, fetchSteamcmdStatus]);

  // Map guard step to login for stepper display
  const displayStepKey = step === "guard" ? "login" : step;

  // Whether terminal output is visible (widens the layout)
  const wide = step === "steamcmd" || step === "login";

  function handleFinish() {
    markOnboardingComplete();
    onComplete();
  }

  // ── Step flow helpers ──

  function goToSteamcmd() {
    setStep("steamcmd");
  }

  function goToLogin() {
    setStep("login");
  }

  function goToGuard() {
    setStep("guard");
  }

  function goToComplete() {
    setStep("complete");
  }

  return (
    <OnboardingLayout steps={STEPS} currentStepKey={displayStepKey} wide={wide}>
      {/* Welcome */}
      {step === "welcome" && <WelcomeStep onNext={() => setStep("connect")} />}

      {/* Connect Agent (Dashboard only) */}
      {step === "connect" && <ConnectAgentStep onNext={goToSteamcmd} />}

      {/* SteamCMD Install */}
      {step === "steamcmd" && !loadingSteamcmd && (
        <SteamCmdInstallStep
          alreadyInstalled={steamcmd?.installed ?? false}
          onNext={goToLogin}
        />
      )}

      {/* Steam Login */}
      {step === "login" && !loadingSteamcmd && (
        <SteamLoginStep
          alreadyLoggedIn={steamcmd?.loggedIn ?? false}
          username={steamcmd?.username ?? null}
          onNext={goToComplete}
          onGuardRequired={goToGuard}
          onSkip={goToComplete}
        />
      )}

      {/* Steam Guard */}
      {step === "guard" && (
        <SteamGuardStep onNext={goToComplete} onBack={() => setStep("login")} />
      )}

      {/* Complete */}
      {step === "complete" && (
        <CompleteStep
          username={steamcmd?.username ?? null}
          agentName={activeConnection?.name ?? null}
          onFinish={handleFinish}
        />
      )}

      {/* Loading state for SteamCMD status fetch */}
      {(step === "steamcmd" || step === "login") && loadingSteamcmd && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-ring" />
        </div>
      )}
    </OnboardingLayout>
  );
}
