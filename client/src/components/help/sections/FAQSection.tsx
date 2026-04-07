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
      "It depends on the game. Some games (like 7 Days to Die and ARK) can be downloaded with anonymous SteamCMD access. Others (like DayZ) require a Steam account that owns the game. The Commander will tell you when a login is required.",
  },
  {
    question: "Can I run multiple servers at the same time?",
    answer:
      "Yes! You can create and run as many servers as your hardware supports. Each server uses its own set of ports, and Game-Servum checks for port conflicts automatically.",
  },
  {
    question: "Is the connection between Commander and Agent encrypted?",
    answer:
      "Yes. The Agent enables HTTPS (TLS) by default using a self-signed certificate that is generated automatically on first start. All API and WebSocket connections are encrypted. The Electron desktop app accepts self-signed certificates automatically. In a browser, you need to accept the certificate once by opening the Agent's health endpoint directly.",
  },
  {
    question:
      "What is a self-signed certificate and why does my browser warn me?",
    answer:
      "A self-signed certificate encrypts the connection just like a regular certificate, but it is not signed by a trusted Certificate Authority (CA). Your browser shows a warning because it cannot verify who issued the certificate. This is normal and expected for local/private servers. Accept the certificate once in your browser and the warning won't appear again for that Agent.",
  },
  {
    question: "Can I use my own TLS certificate?",
    answer:
      "Yes. You can replace the auto-generated self-signed certificate with your own via the Agent's TLS API endpoint. Provide paths to your certificate and private key files on the Agent machine. If you use a reverse proxy (e.g. nginx, Traefik) for TLS termination, you can disable the Agent's built-in TLS by setting TLS_ENABLED=false.",
  },
  {
    question: "How do I connect the Commander to a remote Agent?",
    answer:
      'Click the "+" button in the header to add a new Agent connection. Enter the Agent\'s address (e.g. https://192.168.1.100:3001), your API key, and password. The default port is 3001. Make sure the port is open in your firewall — the Agent can create firewall rules automatically.',
  },
  {
    question: "Can I run the Commander in Docker?",
    answer:
      "Yes! The Commander can be deployed as a Docker container for browser-based access. Use docker compose up -d to start it. The Docker container runs a lightweight web server with its own admin authentication. It connects to your Windows Agent(s) over the network just like the desktop app.",
  },
  {
    question:
      "Why can't the Docker Commander connect to my Agent on a local/private IP?",
    answer:
      "In Docker/web mode, the Commander Server proxies all requests to the Agent server-side. If the Commander runs in the cloud (e.g. on a VPS) and the Agent is on a private network (192.168.x.x), the server cannot reach it — private IPs are not routable over the internet. To fix this, make the Agent reachable via a public IP, port forwarding with DynDNS, or a VPN/tunnel (e.g. Tailscale, WireGuard). The Electron desktop app does not have this limitation since it runs on your local machine.",
  },
  {
    question: "What happens if my server crashes?",
    answer:
      "Game-Servum includes crash protection. If a server process terminates unexpectedly, it will be automatically restarted after a 10-second delay. If the server crashes more than 3 times within 10 minutes, automatic restart is disabled and the status changes to Error.",
  },
  {
    question: "How do I update a game server?",
    answer:
      "You can update a server manually from the server detail page (Overview tab), or enable automatic update detection. When an update is detected, Game-Servum can automatically stop the server, apply the update via SteamCMD, and restart it. Configure auto-restart on update in the server's Settings tab.",
  },
  {
    question: "How do backups work?",
    answer:
      "Open the Backups tab on any server to create a ZIP archive of the server files. You can choose between a full backup (entire directory) or selective backup (specific paths). The server is stopped during backup and restarted afterward. Backups are stored in the Agent's data directory and can be restored at any time.",
  },
  {
    question: "Does the Agent update itself?",
    answer:
      "Yes. The Agent checks for updates on GitHub Releases every 4 hours. When a new version is available, it can be installed from the Commander's Settings page. The update process stops the Windows Service, replaces the Agent files, and restarts automatically.",
  },
  {
    question: "Where is my data stored?",
    answer:
      "The Agent stores its database and configuration in the data directory (default: C:\\ProgramData\\Game-Servum\\ on Windows). Game server files are stored in the servers directory. The Commander (Electron) stores connection credentials locally. The Docker Commander stores credentials in a persistent volume.",
  },
  {
    question: "Can I manage firewall rules from the Commander?",
    answer:
      'Yes (Windows only). Each server\'s Settings tab has a Firewall Rules section that shows which rules exist and which are missing. Click "Create Rules" to automatically add the required Windows Firewall rules (ports, protocols) for that game server.',
  },
  {
    question: "What are mod list files and how do I use them?",
    answer:
      "DayZ uses mod_list.txt and server_mod_list.txt files to define which mods are loaded. In the Mods tab, you can export these files from your current mod setup (for sharing or backup) and import them to automatically install missing mods. This makes it easy to replicate a mod configuration on a new server.",
  },
  {
    question: "Is Game-Servum free?",
    answer:
      "Yes, Game-Servum is completely free and open source under the GPL-3.0 license. You can use and modify it freely.",
  },
  {
    question: "What anonymous statistics does Game-Servum collect?",
    answer:
      "When you opt in via Settings > Privacy, the Agent periodically reports anonymous aggregate counts: total servers managed, total mods installed, total unique players tracked, and a breakdown by game. No personal data, IP addresses, server names, or player identities are ever sent. Each Agent is identified by a random UUID. You can disable this at any time — the Agent will deregister and delete all stored credentials.",
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
