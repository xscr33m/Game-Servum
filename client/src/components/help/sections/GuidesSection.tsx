import { FaChevronDown } from "react-icons/fa6";

interface GuideProps {
  title: string;
  children: React.ReactNode;
}

function Guide({ title, children }: GuideProps) {
  return (
    <details className="group rounded-lg border bg-card">
      <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-accent/50 transition-colors [&::-webkit-details-marker]:hidden list-none">
        {title}
        <FaChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t px-4 py-4 text-sm text-muted-foreground leading-relaxed space-y-3">
        {children}
      </div>
    </details>
  );
}

export function GuidesSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">Guides</h2>
        <p className="text-sm text-muted-foreground">
          Step-by-step instructions for common tasks
        </p>
      </div>

      <div className="space-y-3">
        {/* Guide: SteamCMD Setup */}
        <Guide title="Steam Login & SteamCMD Setup">
          <p>
            SteamCMD is the command-line tool used to download and update
            dedicated game servers. Game-Servum manages SteamCMD for you — you
            just need to install it and optionally log in.
          </p>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">
              Installing SteamCMD
            </h4>
            <ol className="list-decimal list-inside space-y-1 ml-1">
              <li>Open the Commander and connect to an Agent.</li>
              <li>
                If SteamCMD is not installed, the onboarding wizard will prompt
                you to install it. You can also install it later from the
                Commander.
              </li>
              <li>
                Click <strong>Install SteamCMD</strong> and wait for the
                download to complete.
              </li>
            </ol>
          </div>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">
              Logging in to Steam
            </h4>
            <ol className="list-decimal list-inside space-y-1 ml-1">
              <li>
                Click the Steam account badge in the Commander header (shows
                &quot;Anonymous&quot; when not logged in).
              </li>
              <li>Enter your Steam username and password.</li>
              <li>
                If Steam Guard is enabled, you'll be prompted for a code — check
                your email or authenticator app.
              </li>
              <li>Once logged in, the badge will show your Steam username.</li>
            </ol>
          </div>
          <div className="rounded-md bg-muted/50 p-3 text-xs">
            <strong>Tip:</strong> Some games (like 7 Days to Die) can be
            downloaded anonymously. Others (like DayZ) require a Steam account
            that owns the game. Check the game's requirements when adding a
            server.
          </div>
        </Guide>

        {/* Guide: Server Creation */}
        <Guide title="Creating & Installing a Server">
          <p>
            Game-Servum makes it easy to set up a new dedicated game server.
            SteamCMD handles the download and installation automatically.
          </p>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">Steps</h4>
            <ol className="list-decimal list-inside space-y-1 ml-1">
              <li>
                Click <strong>Add Server</strong> on the Commander.
              </li>
              <li>Select the game you want to host from the list.</li>
              <li>
                Choose a name for your server and configure the port. The
                Commander will suggest an available port and warn about
                conflicts.
              </li>
              <li>
                Click <strong>Create Server</strong> to begin the installation.
              </li>
              <li>
                The server card will show a progress bar while SteamCMD
                downloads the game files. This can take a while depending on the
                game size and your internet speed.
              </li>
              <li>
                Once complete, the server status changes to{" "}
                <strong>Stopped</strong> — it's ready to be configured and
                started.
              </li>
            </ol>
          </div>
          <div className="rounded-md bg-muted/50 p-3 text-xs">
            <strong>Tip:</strong> Each game server needs a set of consecutive
            ports. The Commander automatically checks for port conflicts with
            your existing servers.
          </div>
        </Guide>

        {/* Guide: Server Start/Stop */}
        <Guide title="Starting & Stopping a Server">
          <p>
            Once a server is installed, you can start and stop it directly from
            the Commander or the server detail page.
          </p>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">Starting a server</h4>
            <ol className="list-decimal list-inside space-y-1 ml-1">
              <li>
                Click the green <strong>Start</strong> button on the server card
                or the server detail page.
              </li>
              <li>
                Game-Servum checks that all requirements are met (executable
                exists, config is valid, dependencies like BattlEye or DirectX
                are available).
              </li>
              <li>
                The server process is launched and the status changes to{" "}
                <strong>Starting</strong>, then <strong>Running</strong> once
                the server is ready to accept players.
              </li>
            </ol>
          </div>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">Stopping a server</h4>
            <ol className="list-decimal list-inside space-y-1 ml-1">
              <li>
                Click the <strong>Stop</strong> button. The server will be
                gracefully shut down.
              </li>
              <li>
                The status changes to <strong>Stopping</strong> and then{" "}
                <strong>Stopped</strong>.
              </li>
            </ol>
          </div>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">Crash protection</h4>
            <p>
              If a server crashes unexpectedly, Game-Servum will automatically
              restart it (up to 3 times within 10 minutes). After exceeding the
              crash limit, the server status changes to <strong>Error</strong>{" "}
              and an automatic restart will not be attempted.
            </p>
          </div>
        </Guide>

        {/* Guide: Mods */}
        <Guide title="Installing & Managing Mods">
          <p>
            Game-Servum supports Steam Workshop mods for games that use the
            Workshop system (such as DayZ and ARK).
          </p>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">Installing a mod</h4>
            <ol className="list-decimal list-inside space-y-1 ml-1">
              <li>
                Open a server's detail page and go to the <strong>Mods</strong>{" "}
                tab.
              </li>
              <li>
                Enter the Steam Workshop mod ID (the number from the Workshop
                URL) and click <strong>Add Mod</strong>.
              </li>
              <li>
                SteamCMD will download the mod files. Progress is shown in
                real-time.
              </li>
              <li>
                Once installed, the mod appears in your mod list and will be
                loaded automatically when the server starts.
              </li>
            </ol>
          </div>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">Managing mods</h4>
            <ul className="list-disc list-inside space-y-1 ml-1">
              <li>
                <strong>Reorder</strong> — Drag mods to change the load order
                (important for some games).
              </li>
              <li>
                <strong>Update</strong> — Game-Servum checks for mod updates
                automatically. You can also trigger a manual check.
              </li>
              <li>
                <strong>Remove</strong> — Delete a mod and its files from the
                server.
              </li>
              <li>
                <strong>Reinstall</strong> — Re-download a mod if files are
                corrupted.
              </li>
            </ul>
          </div>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">
              Mod list files (DayZ)
            </h4>
            <p>
              DayZ servers use{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                mod_list.txt
              </code>{" "}
              and{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                server_mod_list.txt
              </code>{" "}
              files to define which mods are loaded. Game-Servum can export and
              import these files for easy sharing and migration.
            </p>
            <ul className="list-disc list-inside space-y-1 ml-1">
              <li>
                <strong>Export</strong> — Generates mod list files from your
                current mod configuration. Use this to share your mod setup with
                others or as a backup.
              </li>
              <li>
                <strong>Import</strong> — Reads a mod list file and
                automatically installs any mods that are not yet on the server.
                Great for setting up a server with the same mods as another.
              </li>
            </ul>
          </div>
          <div className="rounded-md bg-muted/50 p-3 text-xs">
            <strong>Note:</strong> 7 Days to Die does not support Steam Workshop
            mods. Mods for 7DTD must be installed manually via the File
            Explorer.
          </div>
          <div className="rounded-md bg-muted/50 p-3 text-xs">
            <strong>Tip:</strong> The server must be stopped to add or remove
            mods. Mod load parameters are generated automatically and appended
            to the server's launch parameters.
          </div>
        </Guide>

        {/* Guide: Security & TLS */}
        <Guide title="Security & HTTPS (TLS)">
          <p>
            Game-Servum encrypts all communication between the Commander and
            Agent using HTTPS (TLS). This is enabled automatically on first
            start.
          </p>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">How TLS works</h4>
            <p>
              When the Agent starts for the first time, it generates a
              self-signed TLS certificate (RSA 2048-bit, valid for 10 years).
              All API and WebSocket connections are then served over HTTPS and
              WSS (secure WebSocket).
            </p>
          </div>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">
              Accepting self-signed certificates
            </h4>
            <ul className="list-disc list-inside space-y-1 ml-1">
              <li>
                <strong>Electron (Desktop App)</strong> — Self-signed
                certificates are accepted automatically. No extra steps needed.
              </li>
              <li>
                <strong>Browser / Docker</strong> — Your browser will show a
                security warning because the certificate is not issued by a
                trusted authority. Open the Agent&apos;s health endpoint (e.g.{" "}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">
                  https://your-agent-ip:3001/api/v1/health
                </code>
                ) directly in your browser and accept the certificate. After
                that, the Commander will connect normally.
              </li>
            </ul>
          </div>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">
              Using your own certificate
            </h4>
            <p>
              You can replace the self-signed certificate with your own via the
              TLS API endpoint. Provide paths to your certificate and private
              key files on the Agent machine.
            </p>
          </div>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">Disabling TLS</h4>
            <p>
              If you need plain HTTP (e.g. behind a reverse proxy that handles
              TLS), set the environment variable{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                TLS_ENABLED=false
              </code>{" "}
              on the Agent and restart it.
            </p>
          </div>
          <div className="rounded-md bg-muted/50 p-3 text-xs">
            <strong>Tip:</strong> The Commander shows a warning banner when
            connected to an Agent over unencrypted HTTP.
          </div>
        </Guide>

        {/* Guide: Authentication */}
        <Guide title="Authentication & Credentials">
          <p>
            Game-Servum uses API-Key + Password authentication secured with JWT
            session tokens. Authentication is enabled by default.
          </p>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">
              First-time credentials
            </h4>
            <ol className="list-decimal list-inside space-y-1 ml-1">
              <li>
                When the Agent starts for the first time, it generates an API
                key and password automatically.
              </li>
              <li>
                These credentials are written to a{" "}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">
                  CREDENTIALS.txt
                </code>{" "}
                file in the Agent&apos;s data directory (default:{" "}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">
                  C:\ProgramData\Game-Servum\
                </code>
                ).
              </li>
              <li>
                Enter the API key and password when connecting the Commander to
                the Agent for the first time.
              </li>
            </ol>
          </div>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">How it works</h4>
            <p>
              Your API key is hashed (SHA-256) and your password is stored using
              PBKDF2 (100k iterations, SHA-512) — credentials are never stored
              in plain text. The Commander receives a JWT session token (valid
              for 24 hours) after authentication and refreshes it automatically.
            </p>
          </div>
          <div className="rounded-md bg-muted/50 p-3 text-xs">
            <strong>Security tip:</strong> Delete the CREDENTIALS.txt file after
            you&apos;ve saved the credentials in a secure place.
          </div>
        </Guide>

        {/* Guide: Docker Deployment */}
        <Guide title="Docker / Web Deployment">
          <p>
            The Commander can be hosted as a web application using Docker,
            making it accessible from any browser without installing a desktop
            app.
          </p>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">Quick setup</h4>
            <ol className="list-decimal list-inside space-y-1 ml-1">
              <li>
                Clone the repository and navigate to the project directory.
              </li>
              <li>
                Copy{" "}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">
                  .env.example
                </code>{" "}
                to{" "}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">
                  .env
                </code>{" "}
                and configure the Commander Server settings (port, data path).
              </li>
              <li>
                Run{" "}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">
                  docker compose up -d
                </code>{" "}
                to start the container.
              </li>
              <li>
                Open{" "}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">
                  http://your-host:8080
                </code>{" "}
                in your browser to access the Commander.
              </li>
              <li>
                On first launch, you&apos;ll be prompted to set an admin
                password.
              </li>
            </ol>
          </div>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">How it works</h4>
            <p>
              The Docker container runs a lightweight Node.js server that serves
              the Commander frontend and handles session authentication. Agent
              connections and credentials are stored in a persistent data
              volume.
            </p>
          </div>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">TLS with Docker</h4>
            <p>
              The Commander Server itself runs on HTTP inside the container. For
              HTTPS, use a reverse proxy (e.g. Traefik, nginx, Caddy) in front
              of the container. Set{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                TRUST_PROXY=true
              </code>{" "}
              in the environment if you use a reverse proxy.
            </p>
          </div>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">
              Network requirements
            </h4>
            <p>
              In Docker/web mode, all communication between the browser and the
              Agent is routed through the Commander Server. The browser never
              connects to the Agent directly — the Commander Server acts as a
              proxy.
            </p>
            <p>
              This means the Commander Server (Docker container) must be able to
              reach the Agent over the network. If the Commander runs in the
              cloud (e.g. on a VPS) and the Agent is on a private/local network
              (e.g. 192.168.x.x), the connection will fail because private IP
              addresses are not reachable from the internet.
            </p>
            <div className="rounded-md bg-muted/50 p-3 space-y-2">
              <p className="font-medium text-foreground text-xs">
                How to make your Agent reachable:
              </p>
              <ul className="list-disc list-inside space-y-1 ml-1 text-xs">
                <li>
                  <strong>Public IP / Dedicated Server:</strong> If the Agent
                  runs on a server with a public IP (e.g. Hetzner, OVH), no
                  extra setup is needed.
                </li>
                <li>
                  <strong>Port Forwarding + DynDNS:</strong> Forward port 3001
                  on your router to the Agent machine and use a DynDNS service
                  (e.g. ipv64.net, DuckDNS) for a stable domain name.
                </li>
                <li>
                  <strong>VPN / Tunnel:</strong> Use Tailscale, WireGuard, or
                  Cloudflare Tunnel to connect your VPS to your local network.
                </li>
              </ul>
            </div>
            <p>
              The Electron desktop app does not have this limitation — it runs
              on your local machine and can connect to Agents on the same
              network directly.
            </p>
          </div>
          <div className="rounded-md bg-muted/50 p-3 text-xs">
            <strong>Note:</strong> The Docker deployment runs only the Commander
            (frontend). The Agent still needs to run on a Windows machine where
            your game servers are hosted.
          </div>
        </Guide>

        {/* Guide: Server Backups */}
        <Guide title="Server Backups">
          <p>
            Game-Servum can create full or partial backups of your game servers
            as ZIP archives.
          </p>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">Creating a backup</h4>
            <ol className="list-decimal list-inside space-y-1 ml-1">
              <li>
                Open the server detail page and go to the{" "}
                <strong>Backups</strong> tab.
              </li>
              <li>
                Click <strong>Create Backup</strong>. You can optionally provide
                a name and tags.
              </li>
              <li>
                The server will be stopped automatically during the backup
                process and restarted afterward (if it was running).
              </li>
              <li>Progress is shown in real-time via WebSocket updates.</li>
            </ol>
          </div>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">
              Customizing backups
            </h4>
            <ul className="list-disc list-inside space-y-1 ml-1">
              <li>
                <strong>Full backup</strong> — Archives the entire server
                directory.
              </li>
              <li>
                <strong>Selective backup</strong> — Choose specific paths to
                include or exclude. Each game provides sensible defaults.
              </li>
              <li>
                <strong>Restore</strong> — Select a backup from the history to
                restore the server to that state.
              </li>
            </ul>
          </div>
          <div className="rounded-md bg-muted/50 p-3 text-xs">
            <strong>Tip:</strong> Backups are stored in the Agent&apos;s data
            directory. Keep an eye on disk space for large game servers.
          </div>
        </Guide>

        {/* Guide: File Explorer */}
        <Guide title="File Explorer">
          <p>
            The Files tab in the server detail page gives you direct access to
            browse and edit your server&apos;s files — no need for remote
            desktop or FTP.
          </p>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">Features</h4>
            <ul className="list-disc list-inside space-y-1 ml-1">
              <li>
                <strong>Browse</strong> — Navigate the server&apos;s directory
                tree. Folders are lazy-loaded for performance.
              </li>
              <li>
                <strong>Edit</strong> — Open text files in a syntax-highlighted
                code editor (CodeMirror). Changes are saved directly to the
                server.
              </li>
              <li>
                <strong>Upload</strong> — Drag and drop files to upload them.
                Conflicts (existing files) are detected and you&apos;re asked to
                confirm overwriting.
              </li>
              <li>
                <strong>Download / Delete</strong> — Download individual files
                or delete them from the server.
              </li>
            </ul>
          </div>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">
              Browsable directories
            </h4>
            <p>
              For security, each game only exposes specific directories. For
              example, DayZ shows{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                profiles/
              </code>{" "}
              and{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                mpmissions/
              </code>
              , while ARK shows its{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                Saved/Config/
              </code>{" "}
              directory.
            </p>
          </div>
          <div className="rounded-md bg-muted/50 p-3 text-xs">
            <strong>Tip:</strong> The sidebar is resizable — drag the divider to
            adjust the directory tree width. On mobile, the sidebar collapses
            into a toggleable panel.
          </div>
        </Guide>

        {/* Guide: Firewall Rules */}
        <Guide title="Firewall Rules (Windows)">
          <p>
            Game-Servum can automatically create Windows Firewall rules for your
            game servers so players can connect without manual rule
            configuration.
          </p>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">How it works</h4>
            <ol className="list-decimal list-inside space-y-1 ml-1">
              <li>
                Open the server detail page and go to the{" "}
                <strong>Settings</strong> tab.
              </li>
              <li>
                Find the <strong>Firewall Rules</strong> section. It shows which
                rules are currently active and which are missing.
              </li>
              <li>
                Click <strong>Create Rules</strong> to add the missing rules.
                Rules are named{" "}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">
                  Game-Servum - ServerName (Description)
                </code>
                .
              </li>
            </ol>
          </div>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">
              Game-specific rules
            </h4>
            <p>
              Each game defines its own required ports and protocols. For
              example, DayZ needs UDP rules for game ports, RCON, and Steam
              Query. ARK needs UDP for game/peer, TCP for RCON, and UDP for
              Steam Query.
            </p>
          </div>
          <div className="rounded-md bg-muted/50 p-3 text-xs">
            <strong>Note:</strong> Firewall management is only available on
            Windows. The Agent uses{" "}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">
              netsh advfirewall
            </code>{" "}
            commands and requires appropriate permissions.
          </div>
        </Guide>

        {/* Guide: Scheduled Restarts & Messages */}
        <Guide title="Scheduled Restarts & RCON Messages">
          <p>
            Keep your servers healthy with automatic restarts and keep players
            informed with recurring RCON broadcast messages.
          </p>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">
              Scheduled restarts
            </h4>
            <ol className="list-decimal list-inside space-y-1 ml-1">
              <li>
                Open the server&apos;s <strong>Settings</strong> tab and find
                the <strong>Scheduled Restart</strong> section.
              </li>
              <li>Set a restart interval (e.g. every 4 hours).</li>
              <li>
                Configure pre-restart warning times (e.g. 30 min, 15 min, 5 min,
                1 min before restart).
              </li>
              <li>
                Customize the warning message template. Use{" "}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">
                  {"{MINUTES}"}
                </code>{" "}
                as a placeholder for the remaining minutes.
              </li>
            </ol>
          </div>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">
              Recurring RCON messages
            </h4>
            <p>
              Broadcast custom messages to players at configurable intervals.
              For example, server rules, Discord links, or upcoming events. Each
              message can have its own interval and supports template variables
              like{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                {"{SERVER_NAME}"}
              </code>
              ,{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                {"{PLAYER_COUNT}"}
              </code>
              , and custom per-server variables.
            </p>
          </div>
        </Guide>

        {/* Guide: Anonymous Statistics */}
        <Guide title="Anonymous Statistics (Opt-in)">
          <p>
            Game-Servum can optionally report anonymous usage statistics to help
            the developer understand how the software is used. This feature is
            <strong> disabled by default</strong> and must be explicitly
            enabled.
          </p>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">
              What is collected?
            </h4>
            <ul className="list-disc list-inside space-y-1 ml-1">
              <li>Total number of game servers managed</li>
              <li>Number of servers per game (e.g. DayZ, ARK)</li>
              <li>Total mods installed across all servers</li>
              <li>Total unique players tracked</li>
              <li>Agent version</li>
            </ul>
          </div>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">
              What is NOT collected?
            </h4>
            <ul className="list-disc list-inside space-y-1 ml-1">
              <li>No IP addresses or location data</li>
              <li>No server names, player names, or Steam IDs</li>
              <li>No configuration files or passwords</li>
              <li>No personal data of any kind</li>
            </ul>
          </div>
          <div className="space-y-2">
            <h4 className="font-semibold text-foreground">
              How to enable or disable
            </h4>
            <ol className="list-decimal list-inside space-y-1 ml-1">
              <li>
                Go to <strong>Settings</strong> and find the{" "}
                <strong>Privacy</strong> section.
              </li>
              <li>
                Toggle <strong>Anonymous Statistics</strong> on or off.
              </li>
              <li>
                When enabled, the Agent registers with a random UUID and reports
                stats every 12 hours.
              </li>
              <li>
                When disabled, the Agent deregisters and deletes all stored
                credentials immediately.
              </li>
            </ol>
          </div>
          <div className="rounded-md bg-muted/50 p-3 text-xs">
            <strong>Privacy:</strong> Each Agent is identified only by a random
            UUID that is not linked to any user account, IP address, or hardware
            identifier. The aggregated data is displayed publicly on the
            Game-Servum website.
          </div>
        </Guide>
      </div>
    </div>
  );
}
