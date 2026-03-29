import { useState } from "react";
import {
  FaCircleInfo,
  FaRocket,
  FaBook,
  FaCircleQuestion,
  FaLightbulb,
  FaHeart,
  FaBars,
} from "react-icons/fa6";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";

export type HelpSection =
  | "about"
  | "getting-started"
  | "guides"
  | "faq"
  | "tips"
  | "credits";

interface SidebarItem {
  id: HelpSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const sections: SidebarItem[] = [
  { id: "about", label: "About", icon: FaCircleInfo },
  { id: "getting-started", label: "Getting Started", icon: FaRocket },
  { id: "guides", label: "Guides", icon: FaBook },
  { id: "faq", label: "FAQ", icon: FaCircleQuestion },
  { id: "tips", label: "Tips & Tricks", icon: FaLightbulb },
  { id: "credits", label: "Open Source Credits", icon: FaHeart },
];

interface HelpSidebarProps {
  active: HelpSection;
  onChange: (section: HelpSection) => void;
}

export function HelpSidebar({ active, onChange }: HelpSidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeItem = sections.find((s) => s.id === active);

  function renderNavList(onItemClick?: () => void) {
    return (
      <div className="p-3 space-y-0.5">
        {sections.map((item) => (
          <button
            key={item.id}
            onClick={() => {
              onChange(item.id);
              onItemClick?.();
            }}
            className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors relative ${
              active === item.id
                ? "bg-ring/10 text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-muted hover:cursor-pointer"
            }`}
          >
            {active === item.id && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-ring rounded-r-full" />
            )}
            <item.icon
              className={`h-3.5 w-3.5 shrink-0 ${active === item.id ? "text-ring" : ""}`}
            />
            {item.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Desktop sidebar */}
      <nav className="hidden md:flex w-56 shrink-0 flex-col border-r bg-muted/20 overflow-y-auto">
        {renderNavList()}
      </nav>

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
          aria-describedby={undefined}
        >
          <VisuallyHidden.Root>
            <SheetTitle>Navigation</SheetTitle>
          </VisuallyHidden.Root>
          {/* Header spacer to align with close button */}
          <div className="flex items-center px-4 py-3 border-b">
            <span className="text-sm font-medium text-muted-foreground">
              Help
            </span>
          </div>
          {renderNavList(() => setMobileOpen(false))}
        </SheetContent>
      </Sheet>
    </>
  );
}
