import type { IconType } from "react-icons";
import {
  FaGauge,
  FaGear,
  FaCubes,
  FaUsers,
  FaFileLines,
  FaBoxArchive,
  FaWrench,
  FaFolderTree,
} from "react-icons/fa6";

export type ServerSection =
  | "overview"
  | "config"
  | "files"
  | "mods"
  | "players"
  | "logs"
  | "backups"
  | "settings";

interface SidebarItem {
  id: ServerSection;
  label: string;
  icon: IconType;
  group: string;
  condition?: string; // capability key to check
}

const sections: SidebarItem[] = [
  // Server
  { id: "overview", label: "Overview", icon: FaGauge, group: "Server" },
  {
    id: "config",
    label: "Configuration",
    icon: FaGear,
    group: "Server",
  },
  { id: "files", label: "Files", icon: FaFolderTree, group: "Server" },
  { id: "settings", label: "Settings", icon: FaWrench, group: "Server" },
  // Management
  { id: "mods", label: "Mods", icon: FaCubes, group: "Management" },
  {
    id: "players",
    label: "Players",
    icon: FaUsers,
    group: "Management",
    condition: "playerTracking",
  },
  { id: "backups", label: "Backups", icon: FaBoxArchive, group: "Management" },
  // Monitoring
  { id: "logs", label: "Logs", icon: FaFileLines, group: "Monitoring" },
];

interface ServerDetailSidebarProps {
  active: string;
  onChange: (section: ServerSection) => void;
  hiddenSections?: Set<string>;
}

export function ServerDetailSidebar({
  active,
  onChange,
  hiddenSections,
}: ServerDetailSidebarProps) {
  const visibleSections = hiddenSections
    ? sections.filter((s) => !hiddenSections.has(s.id))
    : sections;

  // Group sections while preserving order
  const groups: { label: string; items: SidebarItem[] }[] = [];
  for (const section of visibleSections) {
    const last = groups[groups.length - 1];
    if (last && last.label === section.group) {
      last.items.push(section);
    } else {
      groups.push({ label: section.group, items: [section] });
    }
  }

  return (
    <>
      {/* Desktop sidebar */}
      <nav className="hidden md:flex w-52 shrink-0 flex-col overflow-y-auto border-r bg-muted/20">
        <div className="p-3 space-y-4">
          {groups.map((group) => (
            <div key={group.label} className="space-y-0.5">
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                {group.label}
              </div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onChange(item.id)}
                  className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                    active === item.id
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  }`}
                >
                  <item.icon className="h-3.5 w-3.5 shrink-0" />
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </nav>

      {/* Mobile dropdown */}
      <div className="md:hidden border-b px-4 py-2">
        <select
          value={active}
          onChange={(e) => onChange(e.target.value as ServerSection)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          {visibleSections.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
