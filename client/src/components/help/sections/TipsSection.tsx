import {
  FaLightbulb,
  FaArrowsRotate,
  FaCode,
  FaClock,
  FaShieldHalved,
} from "react-icons/fa6";

const tips = [
  {
    icon: FaCode,
    title: "Template Variables",
    description:
      "Use variables like {SERVER_NAME}, {PLAYER_COUNT}, {PORT}, and {NEXT_RESTART} in broadcast messages and restart warnings. Define custom variables per server in the Settings tab.",
  },
  {
    icon: FaArrowsRotate,
    title: "Auto-Update Detection",
    description:
      "Game-Servum automatically checks for game server and mod updates. Enable auto-restart on update in the server's Settings tab to keep your servers up to date without manual intervention.",
  },
  {
    icon: FaClock,
    title: "Scheduled Restarts with Warnings",
    description:
      "Configure scheduled restarts with RCON warning messages. Players will receive in-game notifications at configurable intervals before a restart (e.g., 30 min, 15 min, 5 min, 1 min).",
  },
  {
    icon: FaLightbulb,
    title: "Config Editor",
    description:
      "The Config tab provides a game-specific configuration editor with descriptions for each setting. Changes are written directly to the server's config files — no manual file editing needed.",
  },
  {
    icon: FaShieldHalved,
    title: "Authentication & Security",
    description:
      "Game-Servum uses API-Key + JWT authentication by default. The Agent generates initial credentials on first start — check CREDENTIALS.txt in the data directory. Delete the file for safety after connecting the Dashboard.",
  },
];

export function TipsSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">Tips & Tricks</h2>
        <p className="text-sm text-muted-foreground">
          Useful hints to get the most out of Game-Servum
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {tips.map((tip) => (
          <div key={tip.title} className="rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                <tip.icon className="h-3.5 w-3.5" />
              </div>
              <h3 className="text-sm font-semibold">{tip.title}</h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {tip.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
