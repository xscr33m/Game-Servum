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
          <div className="rounded-md bg-muted/50 p-3 text-xs">
            <strong>Tip:</strong> The server must be stopped to add or remove
            mods. Mod load parameters are generated automatically and appended
            to the server's launch parameters.
          </div>
        </Guide>
      </div>
    </div>
  );
}
