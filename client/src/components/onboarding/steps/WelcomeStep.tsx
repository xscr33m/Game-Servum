import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  FaArrowRight,
  FaServer,
  FaGamepad,
  FaCircleQuestion,
} from "react-icons/fa6";
import { publicAsset } from "@/lib/assets";

interface WelcomeStepProps {
  onNext: () => void;
}

/**
 * First step of onboarding — compact welcome with branding.
 */
export function WelcomeStep({ onNext }: WelcomeStepProps) {
  const navigate = useNavigate();

  return (
    <Card>
      <CardHeader className="text-center pb-4">
        <div className="flex justify-center mb-4">
          <img
            src={publicAsset("commander-icon.png")}
            alt="Game-Servum"
            className="h-24 w-auto drop-shadow-xl"
          />
        </div>
        <CardTitle className="text-2xl">Welcome to Game-Servum</CardTitle>
        <CardDescription className="text-base mt-2 max-w-sm mx-auto">
          Connect to a Game-Servum Agent to manage your game servers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Brief feature highlights */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex items-start gap-2.5 rounded-lg border border-border/50 p-3">
            <FaGamepad className="h-4 w-4 text-ring mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium">Multi-Game</p>
              <p className="text-xs text-muted-foreground">
                DayZ, ARK, Valheim & more
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2.5 rounded-lg border border-border/50 p-3">
            <FaServer className="h-4 w-4 text-ring mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium">Full Control</p>
              <p className="text-xs text-muted-foreground">
                Install, Config, Mods, Logs
              </p>
            </div>
          </div>
        </div>

        <Button onClick={onNext} className="w-full group" size="lg">
          Get Started
          <FaArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
        </Button>

        <Button
          variant="outline"
          className="w-full"
          size="lg"
          onClick={() => navigate("/help")}
        >
          <FaCircleQuestion className="mr-2 h-4 w-4" />
          Learn More
        </Button>

        <p className="text-xs text-center text-muted-foreground/60">
          Open Source &middot; Self-Hosted &middot; Secure
        </p>
      </CardContent>
    </Card>
  );
}
