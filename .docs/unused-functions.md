# Unused Functions

> Functions that are defined but not imported or called anywhere in the codebase.
> Review each to decide: **implement properly** or **remove**.

| #   | Function                   | File                                   | Purpose                                                       |
| --- | -------------------------- | -------------------------------------- | ------------------------------------------------------------- |
| 1   | `clearModUpdateStatus`     | `server/src/db/index.ts`               | Resets mod status from `update_available` back to `installed` |
| 2   | `deleteBackupsByServerId`  | `server/src/db/index.ts`               | Deletes all backup DB records for a server                    |
| 3   | `getCurrentVersion`        | `server/src/db/migrations/index.ts`    | Returns highest applied migration version                     |
| 4   | `getAllGameAdapters`       | `server/src/games/index.ts`            | Returns all registered game adapter instances                 |
| 5   | `getGameDefinitionByAppId` | `server/src/games/index.ts`            | Looks up a game definition by Steam App ID                    |
| 6   | `getAllGameMetadata`       | `server/src/games/index.ts`            | Returns frontend-friendly metadata for all games              |
| 7   | `cleanupServerBackups`     | `server/src/services/backupManager.ts` | Deletes all backup files on disk for a server                 |
| 8   | `cancelModInstallation`    | `server/src/services/modManager.ts`    | Kills an active mod download process                          |
| 9   | `isModInstalling`          | `server/src/services/modManager.ts`    | Checks if a mod is currently being installed                  |
| 10  | `getOnlinePlayerCount`     | `server/src/services/playerTracker.ts` | Returns count of online players for a server                  |
| 11  | `getInstallationStatus`    | `server/src/services/serverInstall.ts` | Returns whether a server is currently being installed         |
| 12  | `runSteamCMD`              | `server/src/services/steamcmd.ts`      | Generic SteamCMD spawn helper with output broadcasting        |
| 13  | `initializeUpdateCheckers` | `server/src/services/updateChecker.ts` | Batch-starts update checkers for multiple running servers     |
| 14  | `hasPendingUpdateRestart`  | `server/src/services/updateChecker.ts` | Checks if a server has a pending update-triggered restart     |
