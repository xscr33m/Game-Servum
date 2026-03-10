/**
 * Game Definitions - Backward Compatibility Layer
 *
 * All game-specific logic has moved to server/src/games/.
 * This file re-exports for backward compatibility.
 *
 * @deprecated Import from "../games/index.js" instead.
 */

export {
  GAME_DEFINITIONS,
  getGameDefinition,
  getGameDefinitionByAppId,
  getAllGameDefinitions,
  runPostInstall,
} from "../games/index.js";
export type { GameDefinition } from "../games/index.js";
