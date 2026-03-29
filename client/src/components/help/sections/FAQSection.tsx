import { FaChevronDown } from "react-icons/fa6";

const faqs = [
  {
    question: "Which games are supported?",
    answer:
      "Game-Servum currently supports DayZ, 7 Days to Die, and ARK: Survival Evolved. The game module system is designed to be extensible — more games can be added over time.",
  },
  {
    question: "Do I need a Steam account?",
    answer:
      "It depends on the game. Some games (like 7 Days to Die) can be downloaded with anonymous SteamCMD access. Others (like DayZ) require a Steam account that owns the game. The Dashboard will tell you when a login is required.",
  },
  {
    question: "Can I run multiple servers at the same time?",
    answer:
      "Yes! You can create and run as many servers as your hardware supports. Each server uses its own set of ports, and Game-Servum checks for port conflicts automatically.",
  },
  {
    question: "How do I connect the Dashboard to a remote Agent?",
    answer:
      'Click the "+" button in the header bar to add a new Agent connection. Enter the Agent\'s IP address and port (default: 3001). The Dashboard communicates with the Agent over HTTP and WebSocket. Make sure the port is open in your firewall.',
  },
  {
    question: "What happens if my server crashes?",
    answer:
      "Game-Servum includes crash protection. If a server process terminates unexpectedly, it will be automatically restarted after a 10-second delay. If the server crashes more than 3 times within 10 minutes, automatic restart is disabled and the status changes to Error.",
  },
  {
    question: "How do I update a game server?",
    answer:
      'You can update a server manually from the server detail page, or enable automatic update detection. When an update is detected, Game-Servum can automatically stop the server, apply the update via SteamCMD, and restart it. Configure this in the server\'s "Settings" tab.',
  },
  {
    question: "Where is my data stored?",
    answer:
      "The Agent stores its database and configuration in the data directory (default: C:\\ProgramData\\Game-Servum\\ on Windows). Game server files are stored in the servers directory. The Dashboard stores connection credentials in localStorage (browser) or a local JSON file (Electron app).",
  },
  {
    question: "Is Game-Servum free?",
    answer:
      "Yes, Game-Servum is completely free and open source under the GPL-3.0 license. You can use and modify it freely.",
  },
];

export function FAQSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">FAQ</h2>
        <p className="text-sm text-muted-foreground">
          Frequently asked questions
        </p>
      </div>

      <div className="space-y-2">
        {faqs.map((faq) => (
          <details
            key={faq.question}
            className="group rounded-lg border bg-card"
          >
            <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium hover:bg-accent/50 transition-colors [&::-webkit-details-marker]:hidden list-none">
              {faq.question}
              <FaChevronDown className="h-3 w-3 text-muted-foreground transition-transform group-open:rotate-180 shrink-0 ml-4" />
            </summary>
            <div className="border-t px-4 py-3 text-sm text-muted-foreground leading-relaxed">
              {faq.answer}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
