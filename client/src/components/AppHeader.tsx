import type { ReactNode } from "react";

interface AppHeaderProps {
  left: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
}

/**
 * Unified app header component with consistent height and layout.
 * Provides three flexible content slots: left, center (optional), and right.
 */
export function AppHeader({ left, center, right }: AppHeaderProps) {
  const hasCenter = center !== undefined && center !== null;

  return (
    <header className="border-b shrink-0">
      <div className="px-4 h-16 flex items-center justify-between gap-4">
        {/* Left content */}
        <div className="flex items-center gap-4 min-w-0 flex-shrink-0">
          {left}
        </div>

        {/* Center content (optional) */}
        {hasCenter && (
          <div className="flex items-center gap-3 flex-shrink">{center}</div>
        )}

        {/* Spacer when no center content */}
        {!hasCenter && <div className="flex-1" />}

        {/* Right content */}
        {right && (
          <div className="flex items-center gap-2 flex-shrink-0">{right}</div>
        )}
      </div>
    </header>
  );
}
