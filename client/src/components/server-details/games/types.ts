/**
 * Frontend Game Module Types
 *
 * Each game registers a GameUIPlugin that provides:
 * - Config editor component (for the Config tab)
 * - Fallback metadata (name, logo) used when API data isn't loaded yet
 */

import type { ComponentType } from "react";

/** Props passed to every game-specific config editor component */
export interface ConfigEditorProps {
  rawContent: string;
  originalContent: string;
  onContentChange: (content: string) => void;
  fileName: string;
  /** When true, show only initial setup fields (pre-first-start) */
  initialMode?: boolean;
  /** Server ID — needed for initial mode and map selection API calls */
  serverId?: number;
  /** Current launch parameters — needed for map selection */
  launchParams?: string;
  /** Callback when launch params change (e.g. map selection) */
  onLaunchParamsChange?: () => void;
  /** Server name — used as default for SessionName in initial mode */
  serverName?: string;
}

/** Frontend game plugin — provides UI components for a specific game */
export interface GameUIPlugin {
  /** Unique game identifier (must match backend gameId) */
  id: string;
  /** Fallback display metadata (also served from backend API) */
  metadata: {
    name: string;
    logo: string;
  };
  /** Config editor component, or undefined for raw-text-only config */
  ConfigEditor?: ComponentType<ConfigEditorProps>;
}
