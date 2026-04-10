import { useState, useCallback, useEffect } from "react";
import { OnboardingLayout, type StepDef } from "./OnboardingLayout";
import { WelcomeStep } from "./steps/WelcomeStep";
import { ConnectAgentStep } from "./steps/ConnectAgentStep";
import { SteamCmdInstallStep } from "./steps/SteamCmdInstallStep";
import { SteamLoginStep } from "./steps/SteamLoginStep";
import { SteamGuardStep } from "./steps/SteamGuardStep";
import { CompleteStep } from "./steps/CompleteStep";
import { hasSeenWelcome, markWelcomeSeen } from "./onboardingState";
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

const STEPS_NO_WELCOME: StepDef[] = STEPS.filter((s) => s.key !== "welcome");

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
  onClose: () => void;
  initialStep?: WizardStep;
}

/**
 * Agent setup wizard.
 *
 * Flow: [Welcome →] Connect Agent → SteamCMD Install → Steam Login → (Guard) → Complete
 * Welcome step is only shown on the very first launch.
 */
export function OnboardingWizard({
  onComplete,
  onClose,
  initialStep,
}: OnboardingWizardProps) {
  const { api, activeConnection } = useBackend();

  // Determine initial step: skip welcome if already seen
  const defaultStep = hasSeenWelcome() ? "connect" : "welcome";
  const [step, setStep] = useState<WizardStep>(initialStep ?? defaultStep);
  const [steamcmd, setSteamcmd] = useState<SteamCMDStatus | null>(null);
  const [loadingSteamcmd, setLoadingSteamcmd] = useState(false);

  // Use step list without Welcome when welcome was already seen
  const showWelcome = !hasSeenWelcome() && !initialStep;
  const steps = showWelcome ? STEPS : STEPS_NO_WELCOME;

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
    onComplete();
  }

  function handleWelcomeNext() {
    markWelcomeSeen();
    setStep("connect");
  }

  // ── Step flow helpers ──

  // Called by ConnectAgentStep with the freshly-connected agent's URL and token.
  // Uses direct fetch to check SteamCMD status — no dependency on React state.
  async function handleAgentConnected(agentUrl: string, sessionToken: string) {
    setLoadingSteamcmd(true);
    try {
      const res = await fetch(`${agentUrl}/api/v1/steamcmd/status`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (!res.ok) throw new Error("Failed to fetch SteamCMD status");
      const status = await res.json();
      setSteamcmd(status);
      if (status?.installed && status?.loggedIn) {
        setStep("complete");
      } else if (status?.installed) {
        setStep("login");
      } else {
        setStep("steamcmd");
      }
    } catch {
      setStep("steamcmd");
    } finally {
      setLoadingSteamcmd(false);
    }
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

  // When closing the wizard on the welcome step, mark it as seen
  // so re-opening doesn't show the welcome again.
  function handleClose() {
    if (step === "welcome") {
      markWelcomeSeen();
    }
    onClose();
  }

  return (
    <OnboardingLayout
      steps={steps}
      currentStepKey={displayStepKey}
      wide={wide}
      onClose={handleClose}
    >
      {/* Welcome */}
      {step === "welcome" && <WelcomeStep onNext={handleWelcomeNext} />}

      {/* Connect Agent (Commander only) */}
      {step === "connect" && <ConnectAgentStep onNext={handleAgentConnected} />}

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
