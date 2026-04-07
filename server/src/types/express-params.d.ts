// Express 5 types req.params values as `string | string[]` to support {*glob} patterns.
// All server routes use standard :param style, so params are always single strings.
// Adding specific property types narrows the return type for known param names.
import "express-serve-static-core";

declare module "express-serve-static-core" {
  interface ParamsDictionary {
    id: string;
    filename: string;
    modId: string;
    messageId: string;
    variableId: string;
    backupId: string;
    gameId: string;
    session: string;
    playerId: string;
  }
}
