/**
 * Game Installer Registry
 *
 * Re-exports the installer types and will hold the concrete implementations
 * once serverInstall.ts is refactored in Phase 3.
 */

export type {
  GameInstaller,
  InstallOptions,
  InstallResult,
  InstallProgress,
  InstallPhase,
  UpdateCheckResult,
} from "./types.js";
