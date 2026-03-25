import {
  FaCircleInfo,
  FaRocket,
  FaBook,
  FaCircleQuestion,
  FaLightbulb,
  FaHeart,
} from "react-icons/fa6";

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
  return (
    <>
      {/* Desktop sidebar */}
      <nav className="hidden md:flex w-56 shrink-0 flex-col border-r bg-muted/20 overflow-y-auto">
        <div className="p-3 space-y-0.5">
          {sections.map((item) => (
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
      </nav>

      {/* Mobile dropdown */}
      <div className="md:hidden border-b px-4 py-2">
        <select
          value={active}
          onChange={(e) => onChange(e.target.value as HelpSection)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          {sections.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
