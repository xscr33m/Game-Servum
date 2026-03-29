import {
  FaDownload,
  FaPlug,
  FaSteam,
  FaServer,
  FaDesktop,
  FaWindows,
} from "react-icons/fa6";

const steps = [
  {
    icon: FaDownload,
    title: "1. Install the Agent",
    description:
      "Download and install the Game-Servum Agent on your Windows machine. The Agent runs as a Windows Service and manages your game servers in the background.",
  },
  {
    icon: FaPlug,
    title: "2. Connect the Dashboard",
    description:
      "Open the Dashboard (this app) and connect it to your Agent by entering the Agent's IP address, port, API-key and password. You can connect to multiple Agents from a single Dashboard.",
  },
  {
    icon: FaSteam,
    title: "3. Set up SteamCMD",
    description:
      "Install SteamCMD through the Dashboard and log in with your Steam account. Some games require a logged-in Steam account, while others work with anonymous access.",
  },
  {
    icon: FaServer,
    title: "4. Create a server",
    description:
      'Click "Add Server" on the Dashboard, choose a game, configure the port, and start the installation. SteamCMD will download and set up the dedicated server files automatically.',
  },
];

export function GettingStartedSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">Getting Started</h2>
        <p className="text-sm text-muted-foreground">
          Get up and running in a few simple steps
        </p>
      </div>

      {/* What is Game-Servum */}
      <div className="rounded-lg border bg-card p-5">
        <h3 className="text-base font-semibold mb-2">What is Game-Servum?</h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Game-Servum is an open source tool for managing dedicated game
          servers. It uses SteamCMD to install and update servers, provides
          real-time monitoring, mod management, scheduled restarts, and more —
          all through a modern web-based dashboard.
        </p>
      </div>

      {/* Architecture */}
      <div className="rounded-lg border bg-card p-5">
        <h3 className="text-base font-semibold mb-3">Architecture</h3>
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
          Game-Servum consists of two components that can run on the same or
          different machines:
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border bg-muted/30 p-4">
            <div className="flex items-center gap-2 mb-2">
              <FaWindows className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Agent</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Runs on Windows as a background service. Manages game servers,
              SteamCMD, mods, and all server-side operations. One Agent per
              Windows machine.
            </p>
          </div>
          <div className="rounded-md border bg-muted/30 p-4">
            <div className="flex items-center gap-2 mb-2">
              <FaDesktop className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Dashboard</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Runs on Windows, Linux, or macOS — either as a desktop app or in
              the browser. Connects to one or more Agents over the network.
            </p>
          </div>
        </div>
      </div>

      {/* Quick Start Steps */}
      <div>
        <h3 className="text-base font-semibold mb-3">Quick Start</h3>
        <div className="space-y-3">
          {steps.map((step) => (
            <div
              key={step.title}
              className="flex gap-4 rounded-lg border bg-card p-4"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <step.icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold mb-0.5">{step.title}</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
