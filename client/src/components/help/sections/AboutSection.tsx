import {
  FaGithub,
  FaGlobe,
  FaHeart,
  FaArrowUpRightFromSquare,
  FaScaleBalanced,
} from "react-icons/fa6";
import { publicAsset } from "@/lib/assets";
import { APP_VERSION } from "@game-servum/shared";

export function AboutSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">About</h2>
        <p className="text-sm text-muted-foreground">
          Application information and links
        </p>
      </div>

      {/* App Identity */}
      <div className="rounded-lg border bg-card p-6">
        <div className="flex items-center gap-4 mb-4">
          <img
            src={publicAsset("commander-icon.png")}
            alt="Game-Servum"
            className="h-14 w-auto"
          />
          <div>
            <h3 className="text-xl font-bold">Game-Servum</h3>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-sm text-muted-foreground font-mono">
                v{APP_VERSION}
              </span>
              <span className="text-muted-foreground/40">&middot;</span>
              <a
                href="https://game-servum.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline"
              >
                game-servum.com
              </a>
            </div>
          </div>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Open Source Game Server Manager powered by SteamCMD. Manage DayZ, 7
          Days to Die, ARK, and other dedicated game servers from a modern
          Commander — as a desktop app, in Docker, or directly in your browser.
          Connect to one or more Agents across your network with built-in TLS
          encryption and JWT authentication.
        </p>
      </div>

      {/* Links */}
      <div className="rounded-lg border bg-card divide-y">
        <a
          href="https://github.com/xscr33m/Game-Servum"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 px-4 py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
        >
          <FaGithub className="h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-foreground">GitHub</p>
            <p className="text-xs">Source code, issues, and releases</p>
          </div>
          <FaArrowUpRightFromSquare className="h-3 w-3 opacity-40" />
        </a>
        <a
          href="https://xscr33mlabs.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 px-4 py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
        >
          <FaGlobe className="h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-foreground">Developer</p>
            <p className="text-xs">xscr33mLabs — Developer website</p>
          </div>
          <FaArrowUpRightFromSquare className="h-3 w-3 opacity-40" />
        </a>
        <a
          href="https://ko-fi.com/xscr33m"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 px-4 py-3 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
        >
          <FaHeart className="h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-foreground">Donate</p>
            <p className="text-xs">Support the development on Ko-fi</p>
          </div>
          <FaArrowUpRightFromSquare className="h-3 w-3 opacity-40" />
        </a>
      </div>

      {/* License */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2 mb-2">
          <FaScaleBalanced className="h-4 w-4 text-muted-foreground" />
          <h4 className="text-sm font-semibold">License</h4>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Game-Servum is licensed under the{" "}
          <a
            href="https://www.gnu.org/licenses/gpl-3.0.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            GNU General Public License v3.0
          </a>
        </p>
        <p className="text-xs text-muted-foreground mt-2">
          &copy; {new Date().getFullYear()} xscr33m / xscr33mLabs
        </p>
      </div>
    </div>
  );
}
