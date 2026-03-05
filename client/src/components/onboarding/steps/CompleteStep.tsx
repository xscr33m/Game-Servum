import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FaCheck, FaArrowRight } from "react-icons/fa6";

interface CompleteStepProps {
  username: string | null;
  agentName: string | null;
  onFinish: () => void;
}

/**
 * Final onboarding step — confirms setup is complete.
 */
export function CompleteStep({
  username,
  agentName,
  onFinish,
}: CompleteStepProps) {
  return (
    <Card>
      <CardHeader className="text-center">
        <div className="flex justify-center mb-2">
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-green-500/10 text-green-500">
            <FaCheck className="h-7 w-7" />
          </div>
        </div>
        <CardTitle className="text-xl text-green-600">Setup Complete</CardTitle>
        <CardDescription className="text-sm">
          {agentName
            ? `Connected to ${agentName}. ${username ? `Logged in as ${username}.` : "Anonymous mode."}`
            : "All set!"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground text-center">
          You can now install and manage game servers from the dashboard.
        </p>
        <Button onClick={onFinish} className="w-full group" size="lg">
          Go to Dashboard
          <FaArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
        </Button>
      </CardContent>
    </Card>
  );
}
