import { useState } from "react";
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
  FaChevronLeft,
  FaChevronRight,
  FaBars,
} from "react-icons/fa6";
import {
  getGameLogo,
  getGameName,
} from "@/components/server-details/games/registry";
import { publicAsset } from "@/lib/assets";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";

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

function getStoredCollapsed(): boolean {
  try {
    return localStorage.getItem("sidebar-collapsed") === "true";
  } catch {
    return false;
  }
}

interface ServerDetailSidebarProps {
  active: string;
  onChange: (section: ServerSection) => void;
  hiddenSections?: Set<string>;
  gameId?: string;
}

export function ServerDetailSidebar({
  active,
  onChange,
  hiddenSections,
  gameId,
}: ServerDetailSidebarProps) {
  const [collapsed, setCollapsed] = useState(getStoredCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  const gameLogo = gameId ? getGameLogo(gameId) : null;
  const gameName = gameId ? getGameName(gameId) : null;

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

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("sidebar-collapsed", String(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }

  const activeItem = visibleSections.find((s) => s.id === active);

  // Shared navigation list used in both desktop expanded and mobile sheet
  function renderNavList(onItemClick?: () => void) {
    return (
      <div className="p-3 space-y-4">
        {groups.map((group) => (
          <div key={group.label} className="space-y-0.5">
            <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              {group.label}
            </div>
            {group.items.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  onChange(item.id);
                  onItemClick?.();
                }}
                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                  active === item.id
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50 hover:cursor-pointer"
                }`}
              >
                <item.icon className="h-3.5 w-3.5 shrink-0" />
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Desktop sidebar */}
      <TooltipProvider delayDuration={150}>
        <nav
          className={`hidden md:flex shrink-0 flex-col border-r bg-muted/20 transition-[width] duration-200 ease-in-out ${
            collapsed ? "w-14" : "w-52"
          }`}
        >
          {/* Game header */}
          {gameName && (
            <div
              className={`flex items-center border-b overflow-hidden ${
                collapsed ? "justify-center px-2 py-3" : "gap-2.5 px-4 py-3"
              }`}
            >
              {gameLogo ? (
                <>
                  <img
                    src={publicAsset(gameLogo)}
                    alt={gameName}
                    className="h-6 w-auto object-contain shrink-0"
                  />
                  {!collapsed && (
                    <span className="text-sm font-medium text-muted-foreground truncate">
                      {gameName}
                    </span>
                  )}
                </>
              ) : (
                !collapsed && (
                  <span className="text-sm font-semibold text-muted-foreground truncate">
                    {gameName}
                  </span>
                )
              )}
            </div>
          )}

          {/* Navigation */}
          <div className="flex-1 overflow-y-auto">
            {collapsed ? (
              /* Collapsed: icon-only with tooltips */
              <div className="px-1.5 py-3 space-y-3">
                {groups.map((group, groupIndex) => (
                  <div key={group.label}>
                    {groupIndex > 0 && (
                      <div className="mx-2.5 mb-3 border-t border-border/40" />
                    )}
                    <div className="space-y-0.5">
                      {group.items.map((item) => (
                        <Tooltip key={item.id}>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => onChange(item.id)}
                              aria-label={item.label}
                              className={`flex w-full items-center justify-center rounded-md p-2.5 transition-colors ${
                                active === item.id
                                  ? "bg-accent text-accent-foreground"
                                  : "text-muted-foreground hover:text-foreground hover:bg-accent/50 hover:cursor-pointer"
                              }`}
                            >
                              <item.icon className="h-4 w-4" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            {item.label}
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* Expanded: full labels */
              renderNavList()
            )}
          </div>

          {/* Collapse toggle */}
          <div className="border-t p-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleCollapsed}
                  aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                  className={`flex w-full items-center rounded-md p-2 text-muted-foreground hover:text-foreground hover:bg-accent/50 hover:cursor-pointer transition-colors ${
                    collapsed ? "justify-center" : "gap-2.5 px-3"
                  }`}
                >
                  {collapsed ? (
                    <FaChevronRight className="h-3 w-3" />
                  ) : (
                    <>
                      <FaChevronLeft className="h-3 w-3 shrink-0" />
                      <span className="text-xs">Collapse</span>
                    </>
                  )}
                </button>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right">Expand sidebar</TooltipContent>
              )}
            </Tooltip>
          </div>
        </nav>
      </TooltipProvider>

      {/* Mobile navigation bar + Sheet drawer */}
      <div className="md:hidden border-b">
        <button
          onClick={() => setMobileOpen(true)}
          className="flex w-full items-center gap-3 px-4 py-3 text-sm hover:bg-accent/30 transition-colors"
        >
          <FaBars className="h-4 w-4 text-muted-foreground shrink-0" />
          {activeItem && (
            <div className="flex items-center gap-2 min-w-0">
              <activeItem.icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="font-medium truncate">{activeItem.label}</span>
            </div>
          )}
        </button>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-64 p-0 [&>button:last-child]:top-3.5"
        >
          <VisuallyHidden.Root>
            <SheetTitle>Navigation</SheetTitle>
          </VisuallyHidden.Root>
          {/* Game header */}
          {gameName && (
            <div className="flex items-center gap-2.5 px-4 py-3 border-b">
              {gameLogo && (
                <img
                  src={publicAsset(gameLogo)}
                  alt={gameName}
                  className="h-6 w-auto object-contain"
                />
              )}
              <span className="text-sm font-medium text-muted-foreground">
                {gameName}
              </span>
            </div>
          )}
          {/* Navigation list */}
          {renderNavList(() => setMobileOpen(false))}
        </SheetContent>
      </Sheet>
    </>
  );
}
