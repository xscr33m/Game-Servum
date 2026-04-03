import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FaArrowLeft } from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import { AppHeader } from "@/components/AppHeader";
import { publicAsset } from "@/lib/assets";
import { HelpSidebar } from "@/components/help/HelpSidebar";
import type { HelpSection } from "@/components/help/HelpSidebar";
import { AboutSection } from "@/components/help/sections/AboutSection";
import { GettingStartedSection } from "@/components/help/sections/GettingStartedSection";
import { GuidesSection } from "@/components/help/sections/GuidesSection";
import { FAQSection } from "@/components/help/sections/FAQSection";
import { TipsSection } from "@/components/help/sections/TipsSection";
import { CreditsSection } from "@/components/help/sections/CreditsSection";

const sectionComponents: Record<HelpSection, React.ComponentType> = {
  about: AboutSection,
  "getting-started": GettingStartedSection,
  guides: GuidesSection,
  faq: FAQSection,
  tips: TipsSection,
  credits: CreditsSection,
};

export function Help() {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<HelpSection>("about");

  const ActiveComponent = sectionComponents[activeSection];

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <AppHeader
        left={
          <>
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
              <FaArrowLeft className="h-4 w-4 mr-2" />
              <img
                src={publicAsset("commander-icon.png")}
                alt=""
                className="h-7 w-auto mr-1"
              />
            </Button>
            <div className="h-7 w-px bg-ring/30" />
            <h1 className="text-xl font-bold">Help & Info</h1>
          </>
        }
      />

      <div className="flex-1 flex overflow-hidden flex-col md:flex-row">
        <HelpSidebar active={activeSection} onChange={setActiveSection} />

        <main className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
          <div className="max-w-3xl mx-auto px-6 py-6">
            <ActiveComponent />
          </div>
        </main>
      </div>
    </div>
  );
}
