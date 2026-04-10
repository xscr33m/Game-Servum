import { useState, type ReactNode } from "react";
import { FaBars } from "react-icons/fa6";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface AppHeaderProps {
  left: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  /** Content rendered inside a right-side Sheet drawer on mobile (<md). When provided, `right` and `center` are hidden below md and a hamburger button appears instead. */
  mobileMenu?: ReactNode;
  /** Title shown in the Sheet header (screen-reader accessible). Defaults to "Menu". */
  mobileMenuTitle?: string;
}

/**
 * Unified app header component with consistent height and layout.
 * Provides three flexible content slots: left, center (optional), and right.
 * When `mobileMenu` is provided, center/right are hidden below `md` and a
 * hamburger icon opens a Sheet drawer with the mobile menu content.
 */
export function AppHeader({
  left,
  center,
  right,
  mobileMenu,
  mobileMenuTitle = "Menu",
}: AppHeaderProps) {
  const hasCenter = center !== undefined && center !== null;
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="border-b shrink-0">
      <div className="px-4 h-14 md:h-16 flex items-center justify-between gap-2 md:gap-4">
        {/* Left content */}
        <div className="flex items-center gap-2 md:gap-4 min-w-0 flex-shrink">
          {left}
        </div>

        {/* Center content (optional) — hidden on mobile when mobileMenu provided */}
        {hasCenter && (
          <div
            className={`flex items-center gap-3 flex-shrink ${mobileMenu ? "hidden md:flex" : ""}`}
          >
            {center}
          </div>
        )}

        {/* Spacer when no center content */}
        {!hasCenter && !mobileMenu && <div className="flex-1" />}
        {!hasCenter && mobileMenu && <div className="hidden md:flex flex-1" />}

        {/* Right content — hidden on mobile when mobileMenu provided */}
        {right && (
          <div
            className={`flex items-center gap-2 flex-shrink-0 ${mobileMenu ? "hidden md:flex" : ""}`}
          >
            {right}
          </div>
        )}

        {/* Mobile hamburger button — only when mobileMenu is provided */}
        {mobileMenu && (
          <>
            <div className="flex-1 md:hidden" />
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden h-9 w-9"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <FaBars className="h-4 w-4" />
            </Button>
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetContent
                side="right"
                className="w-[300px] p-0 flex flex-col"
                aria-describedby={undefined}
              >
                <SheetHeader className="px-5 pt-5 pb-4 border-b shrink-0">
                  <SheetTitle className="text-base font-semibold">
                    {mobileMenuTitle}
                  </SheetTitle>
                </SheetHeader>
                <div
                  className="flex-1 overflow-y-auto px-4 py-4"
                  onClick={(e) => {
                    // Close the sheet when a navigation link/button inside is clicked
                    const target = e.target as HTMLElement;
                    if (
                      target.closest(
                        "a, [data-mobile-nav], button:not([data-keep-open])",
                      )
                    ) {
                      setMobileOpen(false);
                    }
                  }}
                >
                  {mobileMenu}
                </div>
              </SheetContent>
            </Sheet>
          </>
        )}
      </div>
    </header>
  );
}
