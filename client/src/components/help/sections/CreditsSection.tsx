import { FaArrowUpRightFromSquare } from "react-icons/fa6";

interface Credit {
  name: string;
  description: string;
  url: string;
  license: string;
}

const frontendCredits: Credit[] = [
  {
    name: "React",
    description: "UI component library",
    url: "https://react.dev",
    license: "MIT",
  },
  {
    name: "Vite",
    description: "Frontend build tool",
    url: "https://vite.dev",
    license: "MIT",
  },
  {
    name: "TypeScript",
    description: "Typed JavaScript superset",
    url: "https://www.typescriptlang.org",
    license: "Apache-2.0",
  },
  {
    name: "Tailwind CSS",
    description: "Utility-first CSS framework",
    url: "https://tailwindcss.com",
    license: "MIT",
  },
  {
    name: "shadcn/ui",
    description: "Reusable UI components",
    url: "https://ui.shadcn.com",
    license: "MIT",
  },
  {
    name: "CodeMirror",
    description: "Code editor component",
    url: "https://codemirror.net",
    license: "MIT",
  },
  {
    name: "Electron",
    description: "Desktop application framework",
    url: "https://www.electronjs.org",
    license: "MIT",
  },
  {
    name: "React Icons",
    description: "Icon library (Font Awesome, etc.)",
    url: "https://react-icons.github.io/react-icons",
    license: "MIT",
  },
  {
    name: "React Router",
    description: "Client-side routing",
    url: "https://reactrouter.com",
    license: "MIT",
  },
  {
    name: "Sonner",
    description: "Toast notification library",
    url: "https://sonner.emilkowal.ski",
    license: "MIT",
  },
];

const backendCredits: Credit[] = [
  {
    name: "Node.js",
    description: "JavaScript runtime",
    url: "https://nodejs.org",
    license: "MIT",
  },
  {
    name: "Express",
    description: "Web server framework",
    url: "https://expressjs.com",
    license: "MIT",
  },
  {
    name: "sql.js",
    description: "SQLite compiled to WebAssembly",
    url: "https://sql.js.org",
    license: "MIT",
  },
  {
    name: "selfsigned",
    description: "Self-signed TLS certificate generation",
    url: "https://github.com/jfromaniello/selfsigned",
    license: "MIT",
  },
  {
    name: "jsonwebtoken",
    description: "JWT authentication tokens",
    url: "https://github.com/auth0/node-jsonwebtoken",
    license: "MIT",
  },
  {
    name: "Archiver",
    description: "ZIP archive creation for backups",
    url: "https://github.com/archiverjs/node-archiver",
    license: "MIT",
  },
  {
    name: "esbuild",
    description: "JavaScript bundler",
    url: "https://esbuild.github.io",
    license: "MIT",
  },
];

const toolCredits: Credit[] = [
  {
    name: "SteamCMD",
    description: "Steam console client by Valve",
    url: "https://developer.valvesoftware.com/wiki/SteamCMD",
    license: "Proprietary (Valve)",
  },
  {
    name: "WinSW",
    description: "Windows Service wrapper",
    url: "https://github.com/winsw/winsw",
    license: "MIT",
  },
];

function CreditList({ credits }: { credits: Credit[] }) {
  return (
    <div className="divide-y">
      {credits.map((credit) => (
        <a
          key={credit.name}
          href={credit.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent/50 transition-colors"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">{credit.name}</span>
              <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {credit.license}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {credit.description}
            </p>
          </div>
          <FaArrowUpRightFromSquare className="h-2.5 w-2.5 text-muted-foreground opacity-40 shrink-0" />
        </a>
      ))}
    </div>
  );
}

export function CreditsSection() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-1">Open Source Credits</h2>
        <p className="text-sm text-muted-foreground">
          Game-Servum is built with these amazing open source projects
        </p>
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b bg-muted/30">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Frontend
            </h3>
          </div>
          <CreditList credits={frontendCredits} />
        </div>

        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b bg-muted/30">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Backend
            </h3>
          </div>
          <CreditList credits={backendCredits} />
        </div>

        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="px-4 py-2.5 border-b bg-muted/30">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Tools & Services
            </h3>
          </div>
          <CreditList credits={toolCredits} />
        </div>
      </div>
    </div>
  );
}
